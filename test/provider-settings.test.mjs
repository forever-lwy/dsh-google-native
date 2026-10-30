import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { defaultProfile } from '../lib/config.js'
import { registerGoogleProviderSettings } from '../lib/provider-settings.js'
import { providerRemoteInfo, ProviderSettingsRemoteError, saveProviderSettings } from '../lib/provider-remote.js'
import { chatRemoteInfo } from '../lib/chat-remote.js'

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
        assert.equal(op.path.length, 2)
        target[op.path[1]] = structuredClone(op.value)
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
