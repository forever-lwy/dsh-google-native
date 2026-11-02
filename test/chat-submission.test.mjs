import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import * as cordis from '@deepseek-ai/cordis'
import * as store from '@deepseek-ai/dsh-client-store'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as zod from 'zod'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { registerGoogleChatControls } from '../lib/chat-controls.js'
import { defaultProfile } from '../lib/config.js'
import { ReactLoopInbox, inboxProjectionDefinition } from './helpers/real-inbox.mjs'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
const deferred=()=>Promise.withResolvers()
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
async function until(predicate){for(let i=0;i<150;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2))}assert.fail('browser lifecycle did not settle')}

async function browser(t){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://dsh.test/',pretendToBeVisual:true})
  t.after(()=>dom.window.close())
  const revoked=[]
  let previews=0
  dom.window.URL.createObjectURL=()=>`blob:fixture-${++previews}`
  dom.window.URL.revokeObjectURL=url=>revoked.push(url)
  const dependencies={'@deepseek-ai/cordis':cordis,'@deepseek-ai/dsh-client-store':store,
    '@deepseek-ai/dsh-client-ui-slots':slots,'@deepseek-ai/dsh-api-gateway/client':gateway,
    '@deepseek-ai/dsh-client-ui-primitives':{},react:React,'react/jsx-runtime':jsxRuntime,'react-dom':ReactDOM,zod}
  const sandbox={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    Node:dom.window.Node,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,
    MutationObserver:dom.window.MutationObserver,DocumentFragment:dom.window.DocumentFragment,
    DOMParser:dom.window.DOMParser,FileReader:dom.window.FileReader,URL:dom.window.URL,
    requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),
    setTimeout,clearTimeout,queueMicrotask,AbortController,AbortSignal,console,crypto:globalThis.crypto,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window)}
  async function load(name,expose){
    const metadata=JSON.parse(await readFile(new URL(import.meta.resolve(`${name}/package.json`)),'utf8'))
    assert.equal(metadata.version,'0.2.1-rc.5','regression must use the deployed rc.5 protocol')
    const entry=new URL('./client.js',import.meta.resolve(name))
    let record
    sandbox.window.__ModuleLoader__={load:value=>{record=value}}
    let code=await readFile(entry,'utf8')
    // Only expose existing private constructors in memory. Their methods, the
    // actual Lexical editor, sendSession and receipt observer stay unchanged.
    if(expose)code=code.replace('return module.exports;',`exports.__test={${expose}};return module.exports;`)
    runInNewContext(code,sandbox,{filename:entry.pathname})
    assert.ok(record)
    return record.factory(name=>{assert.ok(Object.hasOwn(dependencies,name),`unseeded browser dependency ${name}`);return dependencies[name]})
  }
  const sessionModule=await load('@deepseek-ai/dsh-api-session-controller','Session')
  const conversationModule=await load('@deepseek-ai/dsh-client-ui-conversation','SessionInputShell')
  return {dom,revoked,ClientSession:sessionModule.__test.Session,
    Shell:conversationModule.__test.SessionInputShell,ConversationController:conversationModule.ConversationController}
}

async function fixture(t,{fail=false,hold=false,legacy=false}={}){
  const ui=await browser(t)
  const ctx=new cordis.Context()
  new SessionStore(ctx);new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(inboxProjectionDefinition)
  ctx.provide('typert',{remotes:{register:()=>async()=>{}}})
  const session=ctx.sessions.create(SessionId(`manual-image-${crypto.randomUUID()}`))
  const agent={id:session.id,session,status:'idle'}
  const notifications=[]
  agent.inbox=new ReactLoopInbox(ctx.sessionProjections,session,{emit:(event,data)=>{
    notifications.push({event,...data});ctx.emit(event,{agent,...data})
  }})
  const controls=registerGoogleChatControls(ctx,()=>({'google-ai-studio':defaultProfile('google-ai-studio')}))
  if(legacy)controls.stamp=(agent,message)=>{
    if(message.source.kind!=='user'||'googleNative' in message.source)return
    agent.inbox.replace(message.id,freezeMessage({...message,source:{...message.source,googleNative:controls.capture(agent.session)}}))
  }
  const gate=deferred()
  const requests=[],outcomes=[]
  const remote={session:{async prompt(request){
    requests.push(request)
    assert.equal(request.content[0].data,png.toString('base64'),'real browser FileReader sent canonical image bytes')
    if(hold)await gate.promise
    if(fail)return {ok:false,error:{code:'gateway/test-failed',message:'fixture refused admission'}}
    const content=request.content.map(block=>block.type==='image'?{type:'image',attachment:{
      attachmentId:`sha256:${createHash('sha256').update(Buffer.from(block.data,'base64')).digest('hex')}`,
      mediaType:block.mediaType,bytes:png.length,name:block.name}}:block)
    const message=createUserMessage({source:{kind:'user',rpcId:request.requestId,clientTimeZone:request.clientTimeZone},content})
    agent.inbox.append('next-turn',message)
    const [accepted]=agent.inbox.claim('next-turn','fixture-turn')
    session.append('user/message',accepted,{surfaceOp:'append'})
    return {ok:true,value:{accepted:true}}
  }}}
  const client=new ui.ClientSession(session.id,remote)
  ctx.on('session/event',(changed,event)=>{
    if(changed!==session)return
    // The real journal observer and sequenced control projection drive the real
    // Client Session's observed/failed retirement; no onRetire callback is faked.
    client.acceptEventChange({type:'append',entry:{event,inherited:false}})
    if(event.type==='agent/inbox/spliced')client.projections.apply('inbox',ctx.sessionProjections.stateOf(session,'inbox'),event.seq)
  })
  const clientCtx=new cordis.Context()
  const conversation=new ui.ConversationController(clientCtx,{input:{},blocks:{},maxConcurrentFileUploads:2})
  const shell=new ui.Shell({defaultSink:async(text,ids,mode,signal)=>{
    const result=await conversation.sendSession(client,text,ids,mode,signal)
    outcomes.push(result);return result
  },commandAttachments:{serialize:async()=>[],release:()=>{},unsupportedNotice:()=>''}})
  const addImage=(name='manual.png')=>{
    const [attachment]=conversation.createDrafts(session.id,[new ui.dom.window.File([png],name,{type:'image/png'})])
    assert.equal(shell.actions.addAttachments([attachment.id]),true)
    return attachment.id
  }
  t.after(async()=>{gate.resolve();shell.dispose();await client.dispose();await clientCtx.fiber.dispose();await ctx.fiber.dispose()})
  return {...ui,session,agent,controls,notifications,client,conversation,shell,requests,outcomes,gate,addImage,
    settled:async()=>{await until(()=>outcomes.length>0);await tick()}}
}

test('real rc.5 composer clears an admitted manual image and text without a canceled splice',async t=>{
  const f=await fixture(t)
  const id=f.addImage()
  f.shell.actions.setDraft('请看这张图片')
  f.shell.actions.submit()
  await f.settled()
  assert.equal(f.outcomes[0].kind,'success')
  assert.equal(f.shell.snapshot.draft,'')
  assert.equal(f.shell.snapshot.attachmentIds.length,0)
  assert.equal(f.conversation.resolveDraftAttachments([id]).length,0)
  assert.equal(f.notifications.filter(item=>item.event==='agent/inbox/discarded').length,0)
  const annotations=f.session.snapshotEvents().filter(event=>event.type==='agent/inbox/spliced'&&event.data.removedCount===1&&event.data.inserted.length===1)
  assert.equal(annotations.length,1);assert.equal(annotations[0].data.outcome,undefined)
  const accepted=f.session.deriveMessages().at(-1)
  assert.ok(accepted.source.googleNative)
  assert.equal(accepted.source.rpcId,f.requests[0].requestId)
  assert.equal(accepted.content[0].attachment.mediaType,'image/png')
})

test('negative control: old Inbox.replace admits the image but makes real rc.5 composer restore the sent draft',async t=>{
  const f=await fixture(t,{legacy:true})
  const id=f.addImage()
  f.shell.actions.setDraft('old implementation')
  f.shell.actions.submit()
  await f.settled()
  assert.equal(f.session.deriveMessages().length,1,'the Agent really accepted this prompt')
  assert.equal(f.outcomes[0].kind,'error','canceled retirement cannot be repaired by later admission')
  assert.equal(f.shell.snapshot.draft,'old implementation')
  assert.equal(f.shell.snapshot.attachmentIds[0],id)
  assert.equal(f.notifications.filter(item=>item.event==='agent/inbox/discarded').length,1)
})

test('real rc.5 attachment-only send clears its rail after observed admission',async t=>{
  const f=await fixture(t)
  const id=f.addImage()
  f.shell.actions.submit()
  await f.settled()
  assert.equal(f.outcomes[0].kind,'success')
  assert.equal(f.shell.snapshot.draft,'')
  assert.equal(f.shell.snapshot.attachmentIds.length,0)
  assert.equal(f.conversation.resolveDraftAttachments([id]).length,0)
})

test('a real rejected admission retains manual image bytes and text for retry',async t=>{
  const f=await fixture(t,{fail:true})
  const id=f.addImage()
  f.shell.actions.setDraft('retry me')
  f.shell.actions.submit()
  await f.settled()
  assert.equal(f.outcomes[0].kind,'error')
  assert.equal(f.shell.snapshot.draft,'retry me')
  assert.equal(f.shell.snapshot.attachmentIds[0],id)
  assert.equal(f.conversation.resolveDraftAttachments([id]).length,1)
  assert.equal(f.session.deriveMessages().length,0)
})

for(const fail of [false,true])test(`pending ${fail?'failed':'successful'} send preserves newly typed text and newly attached images`,async t=>{
  const f=await fixture(t,{hold:true,fail})
  const sent=f.addImage('sent.png')
  f.shell.actions.setDraft('sending')
  f.shell.actions.submit()
  await until(()=>f.requests.length===1)
  assert.equal(f.shell.snapshot.draft,'')
  f.shell.actions.setDraft('new text while waiting')
  const newer=f.addImage('newer.png')
  f.gate.resolve()
  await f.settled()
  assert.equal(f.shell.snapshot.draft,'new text while waiting')
  assert.ok(f.shell.snapshot.attachmentIds.includes(newer))
  assert.equal(f.conversation.resolveDraftAttachments([newer]).length,1)
  assert.equal(f.shell.snapshot.attachmentIds.includes(sent),fail)
  assert.equal(f.conversation.resolveDraftAttachments([sent]).length,fail?1:0)
})
