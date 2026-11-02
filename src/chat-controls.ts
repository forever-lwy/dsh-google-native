import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { freezeMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, pluginRecordOf, type Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { GoogleProfile, Profiles } from './config.js'
import { CAPABILITY_KEYS, configuredToolChoices, resolveCapabilities, unsupportedChoices } from './capabilities.js'
import {
  chatRemoteInfo, chatRequestSchema, chatSetRequestSchema, chatSelectionSchema,
  type GoogleChatRequest, type GoogleChatSetRequest,
  type GoogleChatSnapshot, type GoogleChatSourceSnapshot,
} from './chat-remote.js'

const RECORD = 'plugin:dsh-google-native/chat-controls' as const
const PROJECTION = 'googleNativeChat' as const
const preferenceSchema = z.object({ revision: z.number().int().nonnegative(), selections: z.array(chatSelectionSchema) }).strict()
type Preferences = z.infer<typeof preferenceSchema>

declare module '@deepseek-ai/cordis' { interface Context { nativeGoogleChat: GoogleChatControls } }
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap { 'plugin:dsh-google-native/chat-controls': Preferences }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { googleNativeChat: Preferences }
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'google-native-user': { kind: 'user'; googleNative: GoogleChatSourceSnapshot }
  }
}

function foldPreferences(state: Preferences, event: Parameters<typeof pluginRecordOf>[0]): Preferences {
  const record = pluginRecordOf(event)
  if (record?.type !== RECORD) return state
  const parsed = preferenceSchema.safeParse(record.data)
  // These are replaceable UI preferences; accepted prompt sources carry the
  // authoritative immutable choices even if an old preference record is lost.
  return parsed.success ? parsed.data : state
}

export class GoogleChatControls extends TypertRemoteService {
  constructor(ctx: Context, private readonly profiles: () => Profiles) { super(ctx, 'nativeGoogleChat') }

  private state(session: Session): Preferences {
    const state = this.ctx.sessionProjections.stateOf(session, PROJECTION)
    if (!state) throw new RemoteError('gateway/internal', 'Google 聊天选项投影不可用。', {})
    return state
  }

  private profile(provider: string): GoogleProfile | undefined { return this.profiles()[provider as keyof Profiles] }

  private snapshotState(state: Preferences, request: Pick<GoogleChatRequest, 'provider' | 'model'>): GoogleChatSnapshot {
    const profile = this.profile(request.provider)
    const model = profile?.enabled ? profile.models.find(model => model.id === request.model) : undefined
    const capabilities = resolveCapabilities(request.provider, model)
    const defaults = profile && model ? { nativeFiles: capabilities.nativeFiles, ...configuredToolChoices(profile, model) }
      : { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false }
    const remembered = state.selections.find(selection => selection.provider === request.provider && selection.model === request.model)?.choices
    const choices = { ...defaults, ...remembered }
    for (const key of CAPABILITY_KEYS) choices[key] = choices[key] && capabilities[key]
    return { provider: request.provider, model: request.model, capabilities, choices, revision: state.revision }
  }

  private snapshot(session: Session, request: Pick<GoogleChatRequest, 'provider' | 'model'>): GoogleChatSnapshot {
    return this.snapshotState(this.state(session), request)
  }

  private async agent(sessionId: string, signal: AbortSignal): Promise<Agent> {
    signal.throwIfAborted()
    const result = await this.ctx.sessionController.resolveAgent(SessionId(sessionId))
    signal.throwIfAborted()
    if ('error' in result) throw result.error
    return result.agent
  }

  @Remote({ resources: { session: (request: GoogleChatRequest) => SessionId(request.sessionId) } })
  async get(request: GoogleChatRequest, signal: AbortSignal): Promise<GoogleChatSnapshot> {
    request = chatRequestSchema.parse(request)
    signal.throwIfAborted()
    const id = SessionId(request.sessionId)
    const live = this.ctx.sessions.get(id)
    if (live) return this.snapshot(live, request)
    // Merely opening the native-options UI must never resume an Agent or
    // release pending inbox work. The controller's inspection path is cold-safe.
    const inspected = await this.ctx.sessionController.inspect(id, signal)
    signal.throwIfAborted()
    const raced = this.ctx.sessions.get(id)
    if (raced) return this.snapshot(raced, request)
    let state: Preferences = { revision: 0, selections: [] }
    for (const event of inspected.events) {
      signal.throwIfAborted()
      state = foldPreferences(state, event)
    }
    return this.snapshotState(state, request)
  }

  @Remote({ resources: { session: (request: GoogleChatSetRequest) => SessionId(request.sessionId) } })
  async set(request: GoogleChatSetRequest, signal: AbortSignal): Promise<GoogleChatSnapshot> {
    request = chatSetRequestSchema.parse(request)
    const agent = await this.agent(request.sessionId, signal)
    if (agent.status === 'running') throw new RemoteError('session/agent-busy', '请等待当前回复完成后修改原生功能。', { reason: 'GOOGLE_CHAT_OPTIONS_BUSY' })
    const before = this.snapshot(agent.session, request)
    if (before.revision !== request.expectedRevision) throw new RemoteError('native-google/conflict', '聊天选项已在其他窗口变化，请重试。', { revision: before.revision })
    if (unsupportedChoices(before.capabilities, request.choices).length) throw new RemoteError('gateway/bad-request', '当前模型不支持选中的原生功能。', {})
    const profile = this.profile(request.provider)
    if (!profile?.enabled || !profile.models.some(model => model.id === request.model)) throw new RemoteError('gateway/bad-request', '当前 Google 模型不可用。', {})
    const state = this.state(agent.session)
    const selection = { provider: request.provider, model: request.model, choices: request.choices }
    const selections = state.selections.filter(item => item.provider !== request.provider || item.model !== request.model)
    selections.push(selection)
    signal.throwIfAborted()
    appendPluginRecord(agent.session, RECORD, { revision: state.revision + 1, selections })
    // Acknowledgement means preferences reached the normal durability checkpoint.
    await this.ctx.sessions.flush(agent.session)
    signal.throwIfAborted()
    return this.snapshot(agent.session, request)
  }

  capture(session: Session): GoogleChatSourceSnapshot {
    const selections: GoogleChatSourceSnapshot['selections'] = []
    for (const profile of Object.values(this.profiles())) {
      if (!profile.enabled) continue
      for (const model of profile.models) {
        let choices
        try { choices = this.snapshot(session, { provider: profile.provider, model: model.id }).choices }
        catch {
          // A malformed unrelated model must not prevent stamping this prompt
          // and accidentally restore legacy grants. The selected malformed
          // configuration still fails normally at the adapter boundary.
          choices = { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false }
        }
        selections.push({ provider: profile.provider, model: model.id, choices })
      }
    }
    return { version: 1, selections }
  }

  stamp(agent: Agent, message: UserMessage): void {
    if (message.source.kind !== 'user' || 'googleNative' in message.source) return
    for (const [target, pending] of [['next-turn', agent.inbox.nextTurn], ['next-step', agent.inbox.nextStep]] as const) {
      const index = pending.findIndex(candidate => candidate.id === message.id)
      if (index < 0) continue
      const current = pending[index]
      if (current.source.kind !== 'user' || 'googleNative' in current.source) return
      const source = { ...current.source, googleNative: this.capture(agent.session) }
      const stamped = freezeMessage({ ...current, source })
      // rc.5 Inbox.replace()/splice() describe deletion as cancellation and
      // emit inbox/discarded. That retires the composer's image submission as
      // failed, restoring a draft the Agent actually accepted. This is an
      // annotation of the same pending identity, not cancellation: append the
      // native atomic splice without its optional canceled outcome. The normal
      // durable Inbox projection updates in place; rpcId, order and attachment
      // references remain intact for observed retirement and file receipts.
      agent.session.append('agent/inbox/spliced', { target, start: index, removedCount: 1, inserted: [stamped] })
      return
    }
  }
}

/** Mount only when the normal chat/session assembly is present. */
export function registerGoogleChatControls(ctx: Context, profiles: () => Profiles): GoogleChatControls {
  ctx.sessionProjections.register({
    key: PROJECTION, stateVersion: 1, stateSchema: preferenceSchema,
    init: () => ({ revision: 0, selections: [] }), apply: foldPreferences,
  })
  const service = new GoogleChatControls(ctx, profiles)
  ctx.typert.remotes.register(chatRemoteInfo)
  ctx.on('agent/inbox/inserted', ({ agent, message }) => service.stamp(agent, message))
  return service
}
