var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { freezeMessage } from '@deepseek-ai/dsh-llm';
import { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { CAPABILITY_KEYS, configuredToolChoices, resolveCapabilities, unsupportedChoices } from './capabilities.js';
import { chatRemoteInfo, chatRequestSchema, chatSetRequestSchema, chatSelectionSchema, } from './chat-remote.js';
const RECORD = 'plugin:dsh-google-native/chat-controls';
const PROJECTION = 'googleNativeChat';
const preferenceSchema = z.object({ revision: z.number().int().nonnegative(), selections: z.array(chatSelectionSchema) }).strict();
function foldPreferences(state, event) {
    const record = pluginRecordOf(event);
    if (record?.type !== RECORD)
        return state;
    const parsed = preferenceSchema.safeParse(record.data);
    // These are replaceable UI preferences; accepted prompt sources carry the
    // authoritative immutable choices even if an old preference record is lost.
    return parsed.success ? parsed.data : state;
}
let GoogleChatControls = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _get_decorators;
    let _set_decorators;
    return class GoogleChatControls extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _get_decorators = [Remote({ resources: { session: (request) => SessionId(request.sessionId) } })];
            _set_decorators = [Remote({ resources: { session: (request) => SessionId(request.sessionId) } })];
            __esDecorate(this, null, _get_decorators, { kind: "method", name: "get", static: false, private: false, access: { has: obj => "get" in obj, get: obj => obj.get }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _set_decorators, { kind: "method", name: "set", static: false, private: false, access: { has: obj => "set" in obj, get: obj => obj.set }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        profiles = __runInitializers(this, _instanceExtraInitializers);
        preferences;
        constructor(ctx, profiles, preferences) {
            super(ctx, 'nativeGoogleChat');
            this.profiles = profiles;
            this.preferences = preferences;
        }
        state(session) {
            const state = this.preferences.stateOf(session);
            if (!state)
                throw new RemoteError('gateway/internal', 'Google 聊天选项投影不可用。', {});
            return state;
        }
        profile(provider) { return this.profiles()[provider]; }
        snapshotState(state, request) {
            const profile = this.profile(request.provider);
            const model = profile?.enabled ? profile.models.find(model => model.id === request.model) : undefined;
            const capabilities = resolveCapabilities(request.provider, model);
            const defaults = profile && model ? { nativeFiles: capabilities.nativeFiles, ...configuredToolChoices(profile, model) }
                : { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false };
            const remembered = state.selections.find(selection => selection.provider === request.provider && selection.model === request.model)?.choices;
            const choices = { ...defaults, ...remembered };
            for (const key of CAPABILITY_KEYS)
                choices[key] = choices[key] && capabilities[key];
            return { provider: request.provider, model: request.model, capabilities, choices, revision: state.revision };
        }
        snapshot(session, request) {
            return this.snapshotState(this.state(session), request);
        }
        /** Read a persisted log through a read-only handle: no Agent, no ownership. */
        async persistedEvents(id, signal) {
            const handle = await this.ctx.sessionPersistence.open(id, 'read', { signal });
            try {
                return (await handle.read(0, undefined, { signal })).events;
            }
            finally {
                await handle.close();
            }
        }
        async agent(sessionId, signal) {
            signal.throwIfAborted();
            const result = await this.ctx.sessionController.resolveAgent(SessionId(sessionId));
            signal.throwIfAborted();
            if ('error' in result)
                throw result.error;
            return result.agent;
        }
        async get(request, signal) {
            request = chatRequestSchema.parse(request);
            signal.throwIfAborted();
            const id = SessionId(request.sessionId);
            const live = this.ctx.sessions.get(id);
            if (live)
                return this.snapshot(live, request);
            // Merely opening the native-options UI must never resume an Agent or
            // release pending inbox work. A persistence read handle is cold-safe.
            const persisted = await this.persistedEvents(id, signal);
            signal.throwIfAborted();
            const raced = this.ctx.sessions.get(id);
            if (raced)
                return this.snapshot(raced, request);
            let state = { revision: 0, selections: [] };
            for (const event of persisted) {
                signal.throwIfAborted();
                state = foldPreferences(state, event);
            }
            return this.snapshotState(state, request);
        }
        async set(request, signal) {
            request = chatSetRequestSchema.parse(request);
            const agent = await this.agent(request.sessionId, signal);
            if (agent.status === 'running')
                throw new RemoteError('session/agent-busy', '请等待当前回复完成后修改原生功能。', { reason: 'GOOGLE_CHAT_OPTIONS_BUSY' });
            const before = this.snapshot(agent.session, request);
            if (before.revision !== request.expectedRevision)
                throw new RemoteError('native-google/conflict', '聊天选项已在其他窗口变化，请重试。', { revision: before.revision });
            if (unsupportedChoices(before.capabilities, request.choices).length)
                throw new RemoteError('gateway/bad-request', '当前模型不支持选中的原生功能。', {});
            const profile = this.profile(request.provider);
            if (!profile?.enabled || !profile.models.some(model => model.id === request.model))
                throw new RemoteError('gateway/bad-request', '当前 Google 模型不可用。', {});
            const state = this.state(agent.session);
            const selection = { provider: request.provider, model: request.model, choices: request.choices };
            const selections = state.selections.filter(item => item.provider !== request.provider || item.model !== request.model);
            selections.push(selection);
            signal.throwIfAborted();
            appendPluginRecord(agent.session, RECORD, { revision: state.revision + 1, selections });
            // Acknowledgement means preferences reached the normal durability checkpoint.
            await this.ctx.sessions.flush(agent.session);
            signal.throwIfAborted();
            return this.snapshot(agent.session, request);
        }
        capture(session) {
            const selections = [];
            for (const profile of Object.values(this.profiles())) {
                if (!profile.enabled)
                    continue;
                for (const model of profile.models) {
                    let choices;
                    try {
                        choices = this.snapshot(session, { provider: profile.provider, model: model.id }).choices;
                    }
                    catch {
                        // A malformed unrelated model must not prevent stamping this prompt
                        // and accidentally restore legacy grants. The selected malformed
                        // configuration still fails normally at the adapter boundary.
                        choices = { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false };
                    }
                    selections.push({ provider: profile.provider, model: model.id, choices });
                }
            }
            return { version: 1, selections };
        }
        stamp(agent, message) {
            if (message.source.kind !== 'user' || 'googleNative' in message.source)
                return;
            for (const [target, pending] of [['next-turn', agent.inbox.nextTurn], ['next-step', agent.inbox.nextStep]]) {
                const index = pending.findIndex(candidate => candidate.id === message.id);
                if (index < 0)
                    continue;
                const current = pending[index];
                if (current.source.kind !== 'user' || 'googleNative' in current.source)
                    return;
                const source = { ...current.source, googleNative: this.capture(agent.session) };
                const stamped = freezeMessage({ ...current, source });
                // rc.5 Inbox.replace()/splice() describe deletion as cancellation and
                // emit inbox/discarded. That retires the composer's image submission as
                // failed, restoring a draft the Agent actually accepted. This is an
                // annotation of the same pending identity, not cancellation: append the
                // native atomic splice without its optional canceled outcome. The normal
                // durable Inbox projection updates in place; rpcId, order and attachment
                // references remain intact for observed retirement and file receipts.
                agent.session.append('agent/inbox/spliced', { target, start: index, removedCount: 1, inserted: [stamped] });
                return;
            }
        }
    };
})();
export { GoogleChatControls };
/** Mount only when the normal chat/session assembly is present. */
export async function registerGoogleChatControls(ctx, profiles) {
    const preferences = await ctx.sessionProjections.register({
        key: PROJECTION, stateVersion: 1, stateSchema: preferenceSchema,
        init: () => ({ revision: 0, selections: [] }), apply: foldPreferences,
    });
    const service = new GoogleChatControls(ctx, profiles, preferences);
    ctx.typert.remotes.register(chatRemoteInfo);
    ctx.on('agent/inbox/inserted', ({ agent, message }) => service.stamp(agent, message));
    return service;
}
