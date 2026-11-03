import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { defaultProfile, validateProfile } from '../lib/config.js'
import { registerGoogleProviderSettings } from '../lib/provider-settings.js'
import { providerRemoteInfo, providerSettingsSchema, ProviderSettingsRemoteError, saveProviderSettings } from '../lib/provider-remote.js'
import { chatRemoteInfo } from '../lib/chat-remote.js'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'

const studio = 'google-ai-studio'
const vertex = 'google-vertex-native'
const signal = () => new AbortController().signal
const models = [{ id: 'gemini-3.8-flash', name: 'Upstream Flash', supportsGenerateContent: true }]

function fixture() {
  const ctx = new Context()
  new TypertRegistry(ctx)
  const profiles = { [studio]: defaultProfile(studio), [vertex]: defaultProfile(vertex) }
  const values = new Map([['GOOGLE_API_KEY', 'saved-test-secret']])
  const writes = [], discovered = [], operations = []
  let revision = 4
  let writable = true
  let credentialWritable = true
  let keyFailure = false
  let mutateFailure
  let resolveCount = 0
  let discoverImpl = async () => models
  ctx.provide('settings', {
    get writable() { return writable },
    describe() { return [{ ns: 'google-plugin-entry', revision, value: { notForWire: 'hidden-config-value' } }] },
    async mutate(namespace, ops, expected) {
      assert.equal(namespace, 'google-plugin-entry')
      if (mutateFailure) throw mutateFailure
      if (expected !== revision) throw new SettingsConflictError(namespace, expected, revision)
      operations.push(structuredClone(ops))
      for (const op of ops) {
        assert.equal(op.op, 'set')
        const target = op.path[0] === 'aiStudio' ? profiles[studio] : profiles[vertex]
        let parent = target
        for (const key of op.path.slice(1, -1)) parent = parent[key] ??= {}
        parent[op.path.at(-1)] = structuredClone(op.value)
      }
      revision++
    },
  })
  ctx.provide('credentials', {
    async describe(ref) { return { configured: values.has(ref), writable: credentialWritable, ...(values.has(ref) ? { source: 'file' } : {}) } },
    async resolve(ref) { resolveCount++; return values.has(ref) ? { value: values.get(ref), source: 'file' } : undefined },
    async set(ref, value) { if (keyFailure) throw new Error('write failed: '+value); values.set(ref,value); writes.push({ref,value}) },
  })
  const service = registerGoogleProviderSettings(ctx, {
    settingsNs: 'google-plugin-entry', profiles: () => profiles,
    async discover(profile, apiKey, signal) { discovered.push({ profile, apiKey, signal }); return discoverImpl(profile,apiKey,signal) },
  })
  const connection = provider => {
    const profile = profiles[provider]
    return { enabled: profile.enabled, apiKeyEnv: profile.apiKeyEnv, vertexAuth: profile.vertexAuth,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
      ...(profile.project ? { project: profile.project } : {}),
      ...(profile.location ? { location: profile.location } : {}),
    }
  }
  return { ctx, service, profiles, values, writes, discovered, operations, connection,
    revision: () => revision, setRevision: value => {revision=value},
    resolveCount: () => resolveCount,
    writable: value => {writable=value}, credentialWritable: value => {credentialWritable=value},
    keyFailure: value => {keyFailure=value}, mutateFailure: value => {mutateFailure=value},
    discovery: value => {discoverImpl=value},
  }
}

test('settings read exposes safe connection and credential presence without reading secret values or advanced headers', async () => {
  const f = fixture()
  f.profiles[studio].generationConfig.httpOptions = { headers: { authorization: 'hidden-header-secret' } }
  f.profiles[studio].baseURL = 'https://gateway.example/native/v1beta'
  const result = await f.service.get({},signal())
  assert.equal(result.revision,4)
  assert.equal(result.settingsNs,'google-plugin-entry')
  assert.equal(result.profiles[0].connection.baseURL,'https://gateway.example/native/v1beta')
  assert.deepEqual(result.profiles[0].credential,{ configured:true,writable:true,source:'file' })
  assert.equal(f.resolveCount(),0,'presence reads never resolve a plaintext secret')
  assert.doesNotMatch(JSON.stringify(result),/saved-test-secret|hidden-header-secret|hidden-config-value|generationConfig/)
  assert.equal(f.operations.length,0)
})

test('file settings expose effective byte defaults and only the three editable size limits', async () => {
  const f = fixture()
  f.profiles[studio].files = { inlineThresholdBytes: 67108864, pollIntervalMs: 777, processingTimeoutMs: 999999 }
  const result = await f.service.get({}, signal())
  assert.deepEqual(result.profiles[0].connection.files, {
    inlineThresholdBytes: 67108864, inlineMaxBytes: 16777216, maxFileBytes: 314572800,
  })
  assert.deepEqual(result.profiles[1].connection.files, {
    inlineThresholdBytes: 8388608, inlineMaxBytes: 16777216, maxFileBytes: 314572800,
  })
  assert.doesNotMatch(JSON.stringify(result), /pollIntervalMs|processingTimeoutMs/)
  assert.equal(f.resolveCount(), 0)
  assert.equal(f.operations.length, 0)
})

test('partial file size edits merge without changing processing options, model settings or the other provider', async () => {
  const f = fixture()
  f.profiles[studio].files = { inlineThresholdBytes: 8388608, inlineMaxBytes: 33554432,
    maxFileBytes: 314572800, pollIntervalMs: 777, processingTimeoutMs: 999999 }
  const originalFiles = structuredClone(f.profiles[studio].files)
  const originalModels = structuredClone(f.profiles[studio].models)
  const other = structuredClone(f.profiles[vertex])
  const connection = { ...f.connection(studio), files: { inlineThresholdBytes: 67108864 } }
  await f.service.discover({ provider: studio, connection }, signal())
  assert.deepEqual(f.discovered[0].profile.files, { ...originalFiles, inlineThresholdBytes: 67108864 })
  assert.deepEqual(f.profiles[studio].files, originalFiles, 'discovery only uses a draft')
  const before = await f.service.get({}, signal())
  const saved = await f.service.save({ provider: studio, connection, models: before.profiles[0].models,
    expectedRevision: before.revision }, signal())
  assert.equal(saved.profiles[0].connection.files.inlineThresholdBytes, 67108864)
  assert.deepEqual(f.profiles[studio].files, { ...originalFiles, inlineThresholdBytes: 67108864 })
  assert.deepEqual(f.profiles[studio].models, originalModels)
  assert.deepEqual(f.profiles[vertex], other)
  assert.deepEqual(f.operations[0].filter(op => op.path[1] === 'files'), [
    { op: 'set', path: ['aiStudio', 'files', 'inlineThresholdBytes'], value: 67108864 },
  ])
})

test('older clients and empty file patches retain existing file settings without adding defaults', async () => {
  const f = fixture()
  f.profiles[studio].files = { inlineThresholdBytes: 33554432, maxFileBytes: 134217728,
    pollIntervalMs: 777, processingTimeoutMs: 999999 }
  const existing = structuredClone(f.profiles[studio].files)
  for (const files of [undefined, {}]) {
    await f.service.save({ provider: studio, connection: { ...f.connection(studio), ...(files ? { files } : {}) },
      models, expectedRevision: f.revision() }, signal())
    assert.deepEqual(f.profiles[studio].files, existing)
    assert.equal(f.operations.at(-1).some(op => op.path[1] === 'files'), false)
  }
})

test('invalid file byte limits are rejected before discovery, settings writes or credential writes', async () => {
  const f = fixture()
  for (const field of ['inlineThresholdBytes', 'inlineMaxBytes', 'maxFileBytes']) {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '67108864']) {
      const request = { provider: studio, connection: { ...f.connection(studio), files: { [field]: value } },
        apiKey: 'transient-only-key' }
      await assert.rejects(f.service.discover(request, signal()), error => error.code === 'gateway/bad-request')
      await assert.rejects(f.service.save({ ...request, models, expectedRevision: 4 }, signal()), error => error.code === 'gateway/bad-request')
    }
  }
  for (const files of [null, [], { pollIntervalMs: 1 }, { unknown: 1 }]) {
    await assert.rejects(f.service.save({ provider: studio, connection: { ...f.connection(studio), files },
      models, expectedRevision: 4 }, signal()), error => error.code === 'gateway/bad-request')
  }
  assert.equal(f.discovered.length, 0)
  assert.equal(f.operations.length, 0)
  assert.equal(f.writes.length, 0)
})

test('real profile persists independent provider file limits and reloads them without replacing processing options', async t => {
  const { ctx, dir } = await realSettingsProfile(t, { config: {
    aiStudio: { files: { pollIntervalMs: 777, processingTimeoutMs: 999999 },
      generationConfig: { temperature: 0.2 }, models: [{ id: 'custom-audio', inputTypes: ['text', 'audio'] }] },
    vertex: { files: { inlineMaxBytes: 33554432, pollIntervalMs: 555 } },
  } })
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  const fiber = entry.fiber
  let snapshot = await ctx.nativeGoogleSettings.get({}, signal())
  for (const [provider, files] of [
    [studio, { inlineThresholdBytes: 67108864, maxFileBytes: 268435456 }],
    [vertex, { inlineMaxBytes: 50331648, maxFileBytes: 201326592 }],
  ]) {
    const before = snapshot.profiles.find(profile => profile.provider === provider)
    snapshot = await ctx.nativeGoogleSettings.save({ provider, connection: { ...before.connection, files },
      models: before.models, expectedRevision: snapshot.revision }, signal())
  }
  assert.equal(entry.fiber, fiber, 'file edits apply through the existing rc.5 settings fiber')
  assert.deepEqual(fiber.config.aiStudio.get().files, {
    inlineThresholdBytes: 67108864, maxFileBytes: 268435456, pollIntervalMs: 777, processingTimeoutMs: 999999,
  })
  assert.deepEqual(fiber.config.vertex.get().files, {
    inlineMaxBytes: 50331648, maxFileBytes: 201326592, pollIntervalMs: 555,
  })
  assert.equal(fiber.config.aiStudio.get().generationConfig.temperature, 0.2)
  const stored = parseYaml(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'))
  const persisted = stored.flatMap(operation => operation.insert ?? []).find(item => item.id === 'dsh-google-native')
  assert.ok(persisted, 'the real settings writer retains the existing plugin entry')
  const reloaded = await realSettingsProfile(t, { patches: stored })
  const actual = await reloaded.ctx.nativeGoogleSettings.get({}, signal())
  assert.deepEqual(actual.profiles.map(profile => profile.connection.files), snapshot.profiles.map(profile => profile.connection.files))
  assert.deepEqual(actual.profiles[0].models[0].inputTypes, ['text', 'audio'])
})

test('discovery uses unsaved custom connection and transient key without persisting either', async () => {
  const f = fixture()
  const draft = { ...f.connection(studio), enabled:false, baseURL:'https://draft.example/proxy/v1beta',apiVersion:'v1beta' }
  const result = await f.service.discover({ provider:studio,connection:draft,apiKey:'one-time-test-key' },signal())
  assert.deepEqual(result,{models})
  assert.equal(f.discovered[0].profile.baseURL,draft.baseURL)
  assert.equal(f.discovered[0].profile.enabled,false,'disabled profiles may be tested before enabling')
  assert.equal(f.discovered[0].apiKey,'one-time-test-key')
  assert.equal(f.profiles[studio].baseURL,undefined)
  assert.equal(f.operations.length,0)
  assert.equal(f.writes.length,0)
  assert.equal(f.values.get('GOOGLE_API_KEY'),'saved-test-secret')
  assert.equal(JSON.stringify(result).includes('one-time-test-key'),false)
})

test('saving chosen models preserves advanced fields, other profile settings and stores keys only in credentials', async () => {
  const f = fixture()
  const old = f.profiles[studio].models[0]
  old.name = 'My custom name'
  old.generationConfig = { topP:0.4 }
  old.capabilities = { search:false }
  const preserved = structuredClone(old)
  const other = structuredClone(f.profiles[vertex])
  const result = await f.service.save({ provider:studio,connection:{...f.connection(studio),baseURL:'https://saved.example/api'},
    models:[{id:old.id,name:'Upstream renamed it'}, {id:'gateway-custom',name:'Custom upstream',contextWindow:32000}],
    expectedRevision:4,apiKey:'replacement-test-secret',
  },signal())
  assert.equal(result.revision,5)
  assert.deepEqual(f.profiles[studio].models[0],preserved)
  assert.deepEqual(f.profiles[studio].models[1],{id:'gateway-custom',name:'Custom upstream',contextWindow:32000})
  assert.equal(f.profiles[studio].baseURL,'https://saved.example/api')
  assert.equal(f.profiles[studio].generationConfig.thinkingConfig.includeThoughts,true)
  assert.deepEqual(f.profiles[vertex],other)
  assert.equal(f.values.get('GOOGLE_API_KEY'),'replacement-test-secret')
  assert.doesNotMatch(JSON.stringify(f.operations),/replacement-test-secret/)
  assert.doesNotMatch(JSON.stringify(result),/replacement-test-secret/)
})

test('new known models inherit thinking presets and duplicate Google aliases are rejected before writes', async () => {
  const f = fixture()
  f.profiles[studio].models=[]
  await f.service.save({provider:studio,connection:f.connection(studio),models:[{id:'publishers/google/models/gemini-3.8-flash'}],expectedRevision:4},signal())
  assert.equal(f.profiles[studio].models[0].reasoning[1].thinkingLevel,'MEDIUM')
  assert.equal(f.profiles[studio].models[0].capabilities.search,true)
  const before = f.operations.length
  await assert.rejects(f.service.save({provider:studio,connection:f.connection(studio),models:[{id:'gemini-3.8-flash'},{id:'models/gemini-3.8-flash'}],expectedRevision:5},signal()),error=>error.code==='gateway/bad-request')
  assert.equal(f.operations.length,before)
})

test('omitting optional connection fields clears inherited endpoint overrides and selected models can be empty', async () => {
  const f = fixture()
  f.profiles[studio].baseURL='https://inherited.example'
  const connection=f.connection(studio)
  delete connection.baseURL
  const saved=await f.service.save({provider:studio,connection,models:[],expectedRevision:4},signal())
  assert.equal(f.profiles[studio].baseURL,'')
  assert.equal(saved.profiles[0].connection.baseURL,undefined)
  assert.deepEqual(saved.profiles[0].models,[])
})

test('stale or readonly settings, invalid endpoints and unwritable key stores are refused before any commit', async () => {
  const f = fixture()
  const request={provider:studio,connection:f.connection(studio),models,expectedRevision:4,apiKey:'test-write-secret'}
  await assert.rejects(f.service.save({...request,expectedRevision:3},signal()),error=>error.code==='native-google/settings-conflict')
  f.writable(false)
  await assert.rejects(f.service.save(request,signal()),error=>error.code==='gateway/bad-request')
  f.writable(true)
  await assert.rejects(f.service.save({...request,connection:{...request.connection,baseURL:'https://user:password@example.com'}},signal()),error=>error.code==='gateway/bad-request'&&!error.message.includes('password'))
  f.credentialWritable(false)
  await assert.rejects(f.service.save(request,signal()),error=>error.code==='gateway/bad-request')
  assert.equal(f.operations.length,0)
  assert.equal(f.writes.length,0)
})

test('credential write failures report an honest partial save without exposing the key', async () => {
  const f = fixture()
  f.keyFailure(true)
  await assert.rejects(f.service.save({provider:studio,connection:{...f.connection(studio),baseURL:'https://committed.example'},models,expectedRevision:4,apiKey:'do-not-leak-me'},signal()),error=>
    error.code==='native-google/credential-save-failed'&&error.details.revision===5&&!error.message.includes('do-not-leak-me'))
  assert.equal(f.profiles[studio].baseURL,'https://committed.example')
  assert.equal(f.values.get('GOOGLE_API_KEY'),'saved-test-secret')
})

test('raced settings conflicts happen before key writes and parallel saves serialize their revision checks', async () => {
  const f = fixture()
  const request={provider:studio,connection:f.connection(studio),models,expectedRevision:4,apiKey:'test-write-secret'}
  f.mutateFailure(new SettingsConflictError('google-plugin-entry',4,9))
  await assert.rejects(f.service.save(request,signal()),error=>error.code==='native-google/settings-conflict'&&error.details.revision===9)
  assert.equal(f.writes.length,0)
  f.mutateFailure(undefined)
  const results=await Promise.allSettled([f.service.save(request,signal()),f.service.save(request,signal())])
  assert.deepEqual(results.map(result=>result.status),['fulfilled','rejected'])
  assert.equal(f.operations.length,1)
  assert.equal(f.writes.length,1)
})

test('discovery errors keep safe unavailable guidance but redact arbitrary provider bodies', async () => {
  const f = fixture()
  f.discovery(async()=>{throw Object.assign(new Error('provider-body contains secret-key'),{status:401})})
  await assert.rejects(f.service.discover({provider:studio,connection:f.connection(studio)},signal()),error=>error.code==='native-google/discovery-failed'&&error.details.status===401&&!error.message.includes('secret-key'))
  f.discovery(async()=>{throw new LlmError('此上游未提供模型列表，请手动添加模型 ID。','MODEL_DISCOVERY_UNAVAILABLE',{status:404})})
  await assert.rejects(f.service.discover({provider:studio,connection:f.connection(studio)},signal()),error=>error.code==='native-google/discovery-failed'&&/手动添加/.test(error.message))
})

test('chat and settings reflection contributions coexist and actual Gateway requires global authorization', async () => {
  const f=fixture()
  f.ctx.typert.remotes.register(chatRemoteInfo)
  const decisions=[]
  f.ctx.provide('remoteAccess',{ decide(input) { decisions.push(input); return {kind:'deny',reason:'not-authorized'} } })
  const gateway=new TypertGatewayService(f.ctx,{})
  const peer={id:'settings-peer',ctx:f.ctx,principal:{kind:'external-test'},signal:signal(),interactions:'none',async dispose(){}}
  for (const [method,request] of [
    ['get',{}],['discover',{provider:studio,connection:f.connection(studio)}],
    ['save',{provider:studio,connection:f.connection(studio),models,expectedRevision:4}],
  ]) {
    await assert.rejects(gateway.invoke({namespace:'nativeGoogleSettings',method,args:{request},peer}),error=>error.code==='remote-access/denied')
    assert.deepEqual(decisions.at(-1).resources,[{kind:'global'}])
  }
  assert.equal(f.discovered.length,0)
  assert.equal(f.operations.length,0)
  const strict=providerRemoteInfo.methods['nativeGoogleSettings/discover'].input({strict:true}).create()
  assert.throws(()=>strict.parse({request:{provider:studio,connection:f.connection(studio),sessionId:'cannot-downgrade-to-session'}}))
})

test('save helper exposes only safe conflict or partial-save recovery metadata', async () => {
  const remote={ nativeGoogleSettings:{ async save(){return {ok:false,error:{
    code:'native-google/credential-save-failed',message:'连接已保存，但密钥保存失败。',details:{revision:12,apiKey:'never-copy-this-secret'},
  }}}} }
  await assert.rejects(saveProviderSettings(remote,{},signal()),error=>{
    assert.ok(error instanceof ProviderSettingsRemoteError)
    assert.equal(error.code,'native-google/credential-save-failed')
    assert.equal(error.revision,12)
    assert.equal('details' in error,false)
    assert.equal(JSON.stringify(error).includes('never-copy-this-secret'),false)
    return true
  })
})

test('provider timeouts read and save the existing SDK option without changing advanced fields or the other provider', async () => {
  const f = fixture()
  f.profiles[studio].generationConfig = {
    temperature: 0.23,
    httpOptions: { timeout: 1850, headers: { authorization: 'never-return-this-header' }, extraBody: { custom: true } },
  }
  f.profiles[studio].models[0].generationConfig = { httpOptions: { timeout: 4500 }, topP: 0.4 }
  const advanced = structuredClone(f.profiles[studio].generationConfig)
  const model = structuredClone(f.profiles[studio].models[0])
  const vertexBefore = structuredClone(f.profiles[vertex])
  const before = await f.service.get({}, signal())
  assert.equal(before.profiles[0].connection.requestTimeoutMs, 1850)
  assert.equal(before.profiles[1].connection.requestTimeoutMs, undefined)
  assert.doesNotMatch(JSON.stringify(before), /never-return-this-header|custom/)
  assert.equal(before.profiles[0].models[0].advanced.requestTimeoutMs, 4500)
  const saved = await f.service.save({ provider: studio,
    connection: { ...before.profiles[0].connection, requestTimeoutMs: 600000 },
    models: before.profiles[0].models, expectedRevision: before.revision,
  }, signal())
  assert.equal(saved.profiles[0].connection.requestTimeoutMs, 600000)
  assert.deepEqual(f.profiles[studio].generationConfig, { ...advanced, httpOptions: { ...advanced.httpOptions, timeout: 600000 } })
  assert.deepEqual(f.profiles[studio].models[0], model)
  assert.deepEqual(f.profiles[vertex], vertexBefore)
  assert.deepEqual(f.operations[0].find(op => op.path.at(-1) === 'timeout'), {
    op: 'set', path: ['aiStudio', 'generationConfig', 'httpOptions', 'timeout'], value: 600000,
  })
})

test('zero disables a provider deadline, while omitted fields from older clients preserve existing timeouts', async () => {
  const f = fixture()
  f.profiles[studio].generationConfig.httpOptions = { timeout: 300000, headers: { custom: 'keep' } }
  await f.service.save({ provider: studio, connection: f.connection(studio), models, expectedRevision: 4 }, signal())
  assert.equal(f.profiles[studio].generationConfig.httpOptions.timeout, 300000)
  assert.equal(f.operations[0].some(op => op.path.at(-1) === 'timeout'), false)
  const saved = await f.service.save({ provider: studio,
    connection: { ...f.connection(studio), requestTimeoutMs: 0 }, models, expectedRevision: 5 }, signal())
  assert.equal(saved.profiles[0].connection.requestTimeoutMs, 0)
  assert.deepEqual(f.profiles[studio].generationConfig.httpOptions, { timeout: 0, headers: { custom: 'keep' } })
})

test('timeout input rejects invalid or overflowing timers before discovery, settings writes or credential writes', async () => {
  const f = fixture()
  for (const value of [-1, 0.5, NaN, Infinity, 2147483648, null, '600000']) {
    const request = { provider: studio, connection: { ...f.connection(studio), requestTimeoutMs: value }, apiKey: 'transient-only-key' }
    await assert.rejects(f.service.discover(request, signal()), error => error.code === 'gateway/bad-request')
    await assert.rejects(f.service.save({ ...request, models, expectedRevision: 4 }, signal()), error => error.code === 'gateway/bad-request')
  }
  assert.equal(f.discovered.length, 0)
  assert.equal(f.operations.length, 0)
  assert.equal(f.writes.length, 0)
})

test('advanced profile and per-model SDK timeouts are validated against Node timer limits', () => {
  for (const provider of [studio, vertex]) for (const scope of ['profile', 'model']) {
    for (const value of [-1, 0.1, NaN, Infinity, 2147483648, null, '600000']) {
      const profile = defaultProfile(provider)
      const target = scope === 'profile' ? profile : profile.models[0]
      target.generationConfig = { httpOptions: { timeout: value } }
      assert.throws(() => validateProfile(provider, profile), error => error.code === 'INVALID_CONFIG')
    }
    for (const value of [0, 1, 2147483647]) {
      const profile = defaultProfile(provider)
      const target = scope === 'profile' ? profile : profile.models[0]
      target.generationConfig = { httpOptions: { timeout: value } }
      assert.equal(validateProfile(provider, profile).provider, provider)
    }
  }
})

test('model advanced settings read only safe fields and persist explicit patches without replacing private native options', async () => {
  const f = fixture()
  const old = f.profiles[studio].models[0]
  old.generationConfig = {
    temperature: 0.3, topP: 0.7, cachedContent: 'private-cache-resource',
    httpOptions: { timeout: 5000, headers: { authorization: 'private-model-header' }, extraBody: { vendor: 'private-vendor-extension' } },
    thinkingConfig: { includeThoughts: true, privateExtension: 'private-thinking-extension' },
  }
  old.capabilities = { search: false, nativeFiles: true }
  const originalCapabilities = structuredClone(old.capabilities)
  const vertexOriginal = structuredClone(f.profiles[vertex])
  const before = await f.service.get({}, signal())
  assert.equal(before.profiles[0].models[0].advanced.requestTimeoutMs, 5000)
  assert.equal(before.profiles[0].models[0].advanced.thinkingConfig.includeThoughts, true)
  assert.doesNotMatch(JSON.stringify(before), /private-cache-resource|private-model-header|private-vendor-extension|private-thinking-extension|temperature|topP/)
  const advanced = {
    name: 'Edited Flash', contextWindow: 65536, maxTokens: 8192,
    inputTypes: ['text', 'image', 'pdf'], responseModalities: ['TEXT', 'IMAGE'], requestTimeoutMs: 120000,
    reasoning: [{ id: 'economy', name: 'Economy thinking', thinkingBudget: 1024 }, { id: 'deep', name: 'Deep thinking', thinkingBudget: 8192 }],
    defaultReasoning: 'economy', thinkingConfig: { includeThoughts: false },
  }
  const result = await f.service.save({ provider: studio, connection: f.connection(studio),
    models: [{ id: old.id, name: 'discovery-name-must-not-win', advanced }], expectedRevision: 4,
  }, signal())
  const saved = f.profiles[studio].models[0]
  assert.equal(saved.name, advanced.name)
  assert.equal(saved.contextWindow, 65536)
  assert.equal(saved.maxTokens, 8192)
  assert.deepEqual(saved.inputTypes, advanced.inputTypes)
  assert.deepEqual(saved.reasoning, advanced.reasoning)
  assert.equal(saved.defaultReasoning, 'economy')
  assert.equal(saved.generationConfig.httpOptions.timeout, 120000)
  assert.deepEqual(saved.generationConfig.responseModalities, advanced.responseModalities)
  assert.equal(saved.generationConfig.thinkingConfig.includeThoughts, false)
  assert.equal(saved.generationConfig.thinkingConfig.privateExtension, 'private-thinking-extension')
  assert.deepEqual(saved.generationConfig.httpOptions.headers, { authorization: 'private-model-header' })
  assert.equal(saved.generationConfig.httpOptions.extraBody.vendor, 'private-vendor-extension')
  assert.equal(saved.generationConfig.topP, 0.7)
  assert.equal(saved.generationConfig.cachedContent, 'private-cache-resource')
  assert.deepEqual(saved.capabilities, originalCapabilities)
  assert.deepEqual(f.profiles[vertex], vertexOriginal)
  assert.deepEqual(result.profiles[0].models[0].advanced, advanced)
  assert.doesNotMatch(JSON.stringify(result), /private-model-header|private-vendor-extension|private-thinking-extension|private-cache-resource/)
})

test('null advanced patches clear only their own fields and old clients retain the complete model configuration', async () => {
  const f = fixture()
  const old = f.profiles[studio].models[0]
  old.maxTokens = 2048
  old.defaultReasoning = 'low'
  old.inputTypes = ['text', 'image']
  old.generationConfig = { topP: 0.7, responseModalities: ['TEXT'], httpOptions: { timeout: 1000, headers: { vendor: 'retain' } },
    thinkingConfig: { thinkingBudget: 2048, includeThoughts: true, opaque: 'retain-private' } }
  const original = structuredClone(old)
  await f.service.save({ provider: studio, connection: f.connection(studio),
    models: [{ id: old.id, name: 'unadopted-upstream-name', contextWindow: 2000, maxTokens: 1000 }], expectedRevision: 4,
  }, signal())
  assert.deepEqual(f.profiles[studio].models[0], original)
  await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: old.id, advanced: {
    name: null, contextWindow: null, maxTokens: null, inputTypes: null,
    responseModalities: null, requestTimeoutMs: null, reasoning: null, defaultReasoning: null, thinkingConfig: null,
  } }], expectedRevision: 5 }, signal())
  const cleared = f.profiles[studio].models[0]
  for (const key of ['name', 'contextWindow', 'maxTokens', 'inputTypes', 'reasoning', 'defaultReasoning']) assert.equal(cleared[key], undefined)
  assert.deepEqual(cleared.generationConfig, { topP: 0.7, httpOptions: { headers: { vendor: 'retain' } }, thinkingConfig: { opaque: 'retain-private' } })
})

test('native thinking format changes replace only the opposite known field and legacy unknown values stay editable', async () => {
  const f = fixture()
  const model = f.profiles[studio].models[0]
  model.generationConfig = { responseModalities: ['FUTURE_NATIVE_MODALITY'],
    thinkingConfig: { thinkingBudget: null, thinkingLevel: null, opaque: 'private-thinking' } }
  const before = await f.service.get({}, signal())
  assert.equal(before.profiles[0].models[0].advanced.responseModalities, undefined)
  assert.equal(before.profiles[0].models[0].advanced.thinkingConfig, undefined)
  await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: model.id,
    advanced: { name: 'Editable legacy model' } }], expectedRevision: 4 }, signal())
  assert.deepEqual(f.profiles[studio].models[0].generationConfig, model.generationConfig)
  await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: model.id,
    advanced: { thinkingConfig: { thinkingLevel: 'HIGH' } } }], expectedRevision: 5 }, signal())
  assert.deepEqual(f.profiles[studio].models[0].generationConfig.thinkingConfig, { thinkingLevel: 'HIGH', opaque: 'private-thinking' })
  await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: model.id,
    advanced: { thinkingConfig: { thinkingBudget: -1 } } }], expectedRevision: 6 }, signal())
  assert.deepEqual(f.profiles[studio].models[0].generationConfig.thinkingConfig, { thinkingBudget: -1, opaque: 'private-thinking' })
})

test('invalid advanced model patches are rejected before configuration or credentials are written', async () => {
  const invalid = [
    { contextWindow: 0 }, { maxTokens: 1.5 }, { contextWindow: 1024, maxTokens: 1024 },
    { inputTypes: ['image'] }, { inputTypes: ['text', 'image', 'image'] },
    { responseModalities: ['VIDEO'] }, { responseModalities: ['TEXT', 'TEXT'] },
    { thinkingConfig: { thinkingBudget: 10, thinkingLevel: 'HIGH' } },
    { reasoning: [{ id: 'same', name: 'A', thinkingBudget: 10 }, { id: 'same', name: 'B', thinkingBudget: 20 }] },
    { reasoning: [{ id: 'empty', name: 'A', thinkingBudget: 10 }], defaultReasoning: 'missing' },
    { reasoning: null, defaultReasoning: 'high' }, { requestTimeoutMs: -1 },
    { generationConfig: { httpOptions: { headers: { secret: 'not-accepted' } } } },
  ]
  for (const advanced of invalid) {
    const f = fixture()
    await assert.rejects(f.service.save({ provider: studio, connection: f.connection(studio),
      models: [{ id: f.profiles[studio].models[0].id, advanced }], expectedRevision: 4,
      apiKey: 'must-not-be-written',
    }, signal()), error => error.code === 'gateway/bad-request')
    assert.equal(f.operations.length, 0)
    assert.equal(f.writes.length, 0)
  }
  const f = fixture()
  f.profiles[studio].models[0].maxTokens = 1024
  await assert.rejects(f.service.save({ provider: studio, connection: f.connection(studio),
    models: [{ id: f.profiles[studio].models[0].id, advanced: { contextWindow: 1024 } }], expectedRevision: 4,
  }, signal()), error => error.code === 'gateway/bad-request', 'merged existing capacities are checked too')
})

test('raw model configuration validates capacities, native input declarations and reasoning without rejecting future native payload fields', () => {
  for (const provider of [studio, vertex]) {
    const profile = defaultProfile(provider)
    const original = profile.models[0]
    const invalid = [
      { contextWindow: 0 }, { contextWindow: 0.5 }, { maxTokens: Number.MAX_SAFE_INTEGER + 1 },
      { contextWindow: 1024, maxTokens: 1024 }, { inputTypes: [] }, { inputTypes: ['pdf'] },
      { inputTypes: ['text', 'video', 'video'] }, { inputTypes: ['text', 'future'] },
      { reasoning: [{ id: 'same', name: 'a' }, { id: 'same', name: 'b' }], defaultReasoning: 'same' },
      { reasoning: [{ id: 'bad', name: 'bad', thinkingBudget: 1.25 }], defaultReasoning: 'bad' },
      { reasoning: [{ id: 'bad', name: 'bad', thinkingBudget: 1024, thinkingLevel: 'HIGH' }], defaultReasoning: 'bad' },
    ]
    for (const patch of invalid) {
      assert.throws(() => validateProfile(provider, { ...profile, models: [{ ...original, ...patch }] }),
        /./, `${provider}: ${JSON.stringify(patch)}`)
    }
    const nativeUnknowns = { responseModalities: ['FUTURE_NATIVE_OUTPUT'], thinkingConfig: {
      thinkingBudget: null, thinkingLevel: null, futureOption: { retained: true },
    } }
    assert.doesNotThrow(() => validateProfile(provider, { ...profile, models: [{ ...original, generationConfig: nativeUnknowns }] }))
  }
})

test('explicit advanced clears remove stale model SDK and raw REST aliases while retaining provider defaults and private adjacent options', async () => {
  const f = fixture()
  const model = f.profiles[studio].models[0]
  model.maxTokens = 512
  model.generationConfig = { temperature: 0.2, maxOutputTokens: 256, responseModalities: ['IMAGE'],
    thinkingConfig: { thinkingBudget: 1024, includeThoughts: true, futureThinking: 'retain' },
    httpOptions: { headers: { 'x-private': 'retain' }, extraBody: { cachedContent: 'retain-cache',
      generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 128,
        thinkingConfig: { thinkingBudget: 2048, includeThoughts: true, privateThinking: 'retain-thinking' },
        temperature: 0.8 },
      generation_config: { response_modalities: ['IMAGE'], max_output_tokens: 64,
        thinking_config: { thinking_level: 'HIGH', include_thoughts: false, extra_thinking: 'retain-extra' },
        top_k: 5 },
    } } }
  f.profiles[studio].generationConfig.httpOptions = { extraBody: {
    generationConfig: { responseModalities: ['TEXT'], maxOutputTokens: 8000,
      thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } },
  } }
  const providerDefault = structuredClone(f.profiles[studio].generationConfig)
  await f.service.save({ provider: studio, connection: f.connection(studio),
    models: [{ id: model.id, advanced: { maxTokens: null, responseModalities: null, thinkingConfig: null } }], expectedRevision: 4,
  }, signal())
  const saved = f.profiles[studio].models[0]
  assert.equal(saved.maxTokens, undefined)
  assert.equal(saved.generationConfig.maxOutputTokens, undefined)
  assert.equal(saved.generationConfig.responseModalities, undefined)
  assert.deepEqual(saved.generationConfig.thinkingConfig, { futureThinking: 'retain' })
  assert.equal(saved.generationConfig.temperature, 0.2)
  assert.deepEqual(saved.generationConfig.httpOptions.headers, { 'x-private': 'retain' })
  assert.deepEqual(saved.generationConfig.httpOptions.extraBody, {
    cachedContent: 'retain-cache', generationConfig: { temperature: 0.8, top_k: 5,
      thinkingConfig: { privateThinking: 'retain-thinking', extra_thinking: 'retain-extra' } },
  })
  assert.deepEqual(f.profiles[studio].generationConfig, providerDefault)
})

test('native model output defaults are visible without promotion and survive unrelated edits until explicitly cleared', async () => {
  for (const provider of [studio, vertex]) {
    const f = fixture()
    const model = f.profiles[provider].models[0]
    delete model.maxTokens
    model.generationConfig = { maxOutputTokens: 2048, topP: 0.4, httpOptions: {
      headers: { 'x-private': 'retain' }, extraBody: { generationConfig: { max_output_tokens: 1024, temperature: 0.6 } },
    } }
    const original = structuredClone(model)
    const snapshot = await f.service.get({}, signal())
    const view = snapshot.profiles.find(profile => profile.provider === provider).models[0]
    assert.equal(view.advanced.maxTokens, 1024, 'raw REST output limits take priority over native SDK defaults')
    assert.equal(view.maxTokens, undefined, 'legacy native output limits do not change outer catalog metadata')
    assert.deepEqual(model, original, 'reading never promotes native defaults into model metadata')
    assert.equal(f.operations.length, 0)
    await f.service.save({ provider, connection: f.connection(provider),
      models: [{ id: model.id, advanced: { name: 'Edited name' } }], expectedRevision: 4,
    }, signal())
    assert.deepEqual(f.profiles[provider].models[0].generationConfig, original.generationConfig)
    assert.equal(f.profiles[provider].models[0].maxTokens, undefined)
    const cleared = await f.service.save({ provider, connection: f.connection(provider),
      models: [{ id: model.id, advanced: { maxTokens: null } }], expectedRevision: 5,
    }, signal())
    const saved = f.profiles[provider].models[0]
    assert.equal(saved.maxTokens, undefined)
    assert.equal(saved.generationConfig.maxOutputTokens, undefined)
    assert.deepEqual(saved.generationConfig.httpOptions.extraBody, { generationConfig: { temperature: 0.6 } })
    assert.deepEqual(saved.generationConfig.httpOptions.headers, { 'x-private': 'retain' })
    assert.equal(saved.generationConfig.topP, 0.4)
    assert.equal(cleared.profiles.find(profile => profile.provider === provider).models[0].advanced.maxTokens, undefined)
  }
})

test('legacy native output limits above a declared context remain readable while invalid explicit saves are rejected before writes', async () => {
  for (const provider of [studio, vertex]) {
    const f = fixture()
    const model = f.profiles[provider].models[0]
    model.contextWindow = 1024
    delete model.maxTokens
    model.generationConfig = { maxOutputTokens: 2048 }
    const original = structuredClone(f.profiles[provider])
    const snapshot = await f.service.get({}, signal())
    assert.doesNotThrow(() => providerSettingsSchema.parse(snapshot))
    const view = snapshot.profiles.find(profile => profile.provider === provider).models[0]
    assert.equal(view.advanced.maxTokens, 2048)
    assert.equal(view.contextWindow, 1024)
    assert.deepEqual(f.profiles[provider], original)
    await assert.rejects(f.service.save({ provider, connection: f.connection(provider),
      models: [{ id: model.id, advanced: { maxTokens: 1024 } }], expectedRevision: 4,
      apiKey: 'must-not-write-this-key',
    }, signal()), error => error.code === 'gateway/bad-request')
    assert.equal(f.operations.length, 0)
    assert.equal(f.writes.length, 0)
    assert.deepEqual(f.profiles[provider], original)
  }
})

test('upstream support declarations survive discovery and persist as defaults for new models without selecting response formats', async () => {
  for (const provider of [studio, vertex]) {
    const f = fixture()
    const upstream = { id: 'metadata-complete-model', name: 'Complete metadata', contextWindow: 65536, maxTokens: 8192,
      inputTypes: ['text', 'image', 'audio', 'video', 'pdf'], outputTypes: ['text', 'image', 'audio'], supportsGenerateContent: true }
    f.discovery(async () => [upstream])
    const discovered = await f.service.discover({ provider, connection: f.connection(provider) }, signal())
    assert.deepEqual(discovered.models, [upstream])
    assert.equal(f.operations.length, 0)
    const result = await f.service.save({ provider, connection: f.connection(provider), models: discovered.models, expectedRevision: 4 }, signal())
    const model = f.profiles[provider].models[0]
    assert.equal(model.contextWindow, upstream.contextWindow)
    assert.equal(model.maxTokens, upstream.maxTokens)
    assert.deepEqual(model.inputTypes, upstream.inputTypes)
    assert.deepEqual(model.outputTypes, upstream.outputTypes)
    assert.equal(model.generationConfig?.responseModalities, undefined, 'support is not a request to generate every declared format')
    const view = result.profiles.find(profile => profile.provider === provider).models[0]
    assert.deepEqual(view.outputTypes, upstream.outputTypes)
    assert.deepEqual(view.advanced.outputTypes, upstream.outputTypes)
    assert.equal(view.advanced.responseModalities, undefined)
    assert.doesNotThrow(() => providerSettingsSchema.parse(result))
  }
})

test('explicit upstream metadata fills only missing saved fields and retains manual native limits and requested formats', async () => {
  for (const nativeLimit of [
    { maxOutputTokens: 2048 },
    { httpOptions: { extraBody: { generationConfig: { maxOutputTokens: 2048 } } } },
    { httpOptions: { extraBody: { generation_config: { max_output_tokens: 2048 } } } },
  ]) {
    const f = fixture()
    const model = f.profiles[studio].models[0]
    model.name = 'Manually named model'
    model.inputTypes = ['text', 'pdf']
    model.generationConfig = { ...nativeLimit, responseModalities: ['AUDIO'],
      httpOptions: { ...nativeLimit.httpOptions, headers: { 'x-private': 'retain-secret' } } }
    const original = structuredClone(model)
    const result = await f.service.save({ provider: studio, connection: f.connection(studio), models: [{
      id: model.id, name: 'Upstream name', contextWindow: 2097152, maxTokens: 65536,
      inputTypes: ['text', 'image'], outputTypes: ['text', 'image'],
    }], expectedRevision: 4 }, signal())
    const saved = f.profiles[studio].models[0]
    assert.equal(saved.name, original.name)
    assert.equal(saved.contextWindow, original.contextWindow)
    assert.equal(saved.maxTokens, undefined)
    assert.deepEqual(saved.inputTypes, original.inputTypes)
    assert.deepEqual(saved.outputTypes, ['text', 'image'])
    assert.deepEqual(saved.generationConfig, original.generationConfig)
    assert.deepEqual(saved.reasoning, original.reasoning)
    assert.doesNotMatch(JSON.stringify(result), /retain-secret/)
  }
})

test('missing saved model defaults are filled from carried metadata and explicit advanced edits or clears take priority', async () => {
  const f = fixture()
  f.profiles[studio].models = [{ id: 'saved-partial', generationConfig: { temperature: 0.5 } }]
  const metadata = { id: 'saved-partial', contextWindow: 65536, maxTokens: 4096,
    inputTypes: ['text', 'pdf'], outputTypes: ['image'] }
  let result = await f.service.save({ provider: studio, connection: f.connection(studio), models: [metadata], expectedRevision: 4 }, signal())
  assert.deepEqual(f.profiles[studio].models[0], { ...metadata, generationConfig: { temperature: 0.5 } })
  assert.deepEqual(result.profiles[0].models[0].advanced.outputTypes, ['image'])
  result = await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ ...metadata,
    advanced: { contextWindow: 131072, maxTokens: 8192, inputTypes: null, outputTypes: null },
  }], expectedRevision: 5 }, signal())
  assert.equal(f.profiles[studio].models[0].contextWindow, 131072)
  assert.equal(f.profiles[studio].models[0].maxTokens, 8192)
  assert.equal(f.profiles[studio].models[0].inputTypes, undefined)
  assert.equal(f.profiles[studio].models[0].outputTypes, undefined)
  assert.equal(result.profiles[0].models[0].advanced.outputTypes, undefined)
  assert.equal(f.profiles[studio].models[0].generationConfig.temperature, 0.5)
})

test('invalid supported output declarations fail before host writes while absent catalog metadata stays unconfigured', async () => {
  for (const outputTypes of [[], ['TEXT'], ['text', 'image', 'image'], ['video']]) {
    const f = fixture()
    assert.throws(() => validateProfile(studio, { ...f.profiles[studio], models: [{ id: 'invalid-output', outputTypes }] }))
    await assert.rejects(f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: 'invalid-output', outputTypes }], expectedRevision: 4 }, signal()),
      error => error.code === 'gateway/bad-request')
    assert.equal(f.operations.length, 0)
  }
  const f = fixture()
  await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: 'metadata-absent' }], expectedRevision: 4 }, signal())
  assert.deepEqual(f.profiles[studio].models, [{ id: 'metadata-absent' }])
})

test('safe native output-limit views preserve SDK and REST overrides during catalog autofill and expose opaque overrides only as null', async () => {
  const cases = [
    [{ maxOutputTokens: 500 }, 500],
    [{ httpOptions: { extraBody: { generationConfig: { maxOutputTokens: 500 } } } }, 500],
    [{ httpOptions: { extraBody: { generation_config: { max_output_tokens: 500 } } } }, 500],
    [{ maxOutputTokens: 800, httpOptions: { extraBody: { generationConfig: { maxOutputTokens: 500 } } } }, 500],
    [{ httpOptions: { extraBody: { generation_config: { max_output_tokens: 800 }, generationConfig: { maxOutputTokens: 500 } } } }, 500],
    [{ httpOptions: { extraBody: { generationConfig: { maxOutputTokens: 'private-dynamic-limit' } } } }, null],
    [{ maxOutputTokens: 0 }, null],
    [{ maxOutputTokens: null }, null],
  ]
  for (const [generationConfig, expectedMax] of cases) {
    const f = fixture()
    const model = f.profiles[studio].models[0]
    delete model.maxTokens
    model.generationConfig = generationConfig
    const original = structuredClone(model)
    const snapshot = await f.service.get({}, signal())
    const view = snapshot.profiles[0].models[0]
    assert.equal(view.advanced.maxTokens, expectedMax)
    assert.equal(view.maxTokens, undefined)
    assert.doesNotThrow(() => providerSettingsSchema.parse(snapshot))
    assert.doesNotMatch(JSON.stringify(snapshot), /private-dynamic-limit/)
    assert.deepEqual(model, original, 'metadata reads never rewrite or promote private native options')
    // The browser carries discovered metadata, while its unchanged safe value
    // produces no advanced max-token patch. Other explicit edits remain valid.
    await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: model.id,
      maxTokens: 1000, advanced: { name: 'Unrelated name edit' },
    }], expectedRevision: 4 }, signal())
    assert.equal(f.profiles[studio].models[0].maxTokens, undefined)
    assert.deepEqual(f.profiles[studio].models[0].generationConfig, generationConfig)
    await f.service.save({ provider: studio, connection: f.connection(studio), models: [{ id: model.id,
      maxTokens: 1000, advanced: { maxTokens: 750 },
    }], expectedRevision: 5 }, signal())
    assert.equal(f.profiles[studio].models[0].maxTokens, 750, 'a direct user edit can replace the native default')
    assert.equal(f.profiles[studio].models[0].generationConfig.maxOutputTokens, undefined)
    for (const raw of Object.values(f.profiles[studio].models[0].generationConfig.httpOptions?.extraBody ?? {})) {
      assert.equal(raw?.maxOutputTokens, undefined)
      assert.equal(raw?.max_output_tokens, undefined)
    }
  }
})
