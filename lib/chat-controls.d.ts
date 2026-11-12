import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type UserMessage } from '@deepseek-ai/dsh-llm';
import { type Session } from '@deepseek-ai/dsh-session';
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import type { Profiles } from './config.js';
import { type GoogleChatChoices, type GoogleChatRequest, type GoogleChatSetRequest, type GoogleChatSnapshot, type GoogleChatSourceSnapshot } from './chat-remote.js';
declare const preferenceSchema: z.ZodObject<{
    revision: z.ZodNumber;
    selections: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        choices: z.ZodObject<{
            nativeFiles: z.ZodBoolean;
            search: z.ZodBoolean;
            urlContext: z.ZodBoolean;
            codeExecution: z.ZodBoolean;
            maps: z.ZodBoolean;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type Preferences = z.infer<typeof preferenceSchema>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        nativeGoogleChat: GoogleChatControls;
    }
}
declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:dsh-google-native/chat-controls': Preferences;
    }
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'google-native-user': {
            kind: 'user';
            googleNative: GoogleChatSourceSnapshot;
        };
    }
}
export declare class GoogleChatControls extends TypertRemoteService {
    private readonly profiles;
    private readonly preferences;
    constructor(ctx: Context, profiles: () => Profiles, preferences: ProjectionHandle<Preferences>);
    private state;
    private profile;
    private snapshotState;
    private snapshot;
    /** Read a persisted log through a read-only handle: no Agent, no ownership. */
    private persistedEvents;
    private agent;
    get(request: GoogleChatRequest, signal: AbortSignal): Promise<GoogleChatSnapshot>;
    set(request: GoogleChatSetRequest, signal: AbortSignal): Promise<GoogleChatSnapshot>;
    /** Current switches of one model in this session, used when the active route is known. */
    choicesFor(session: Session, provider: string, model: string): GoogleChatChoices;
    capture(session: Session): GoogleChatSourceSnapshot;
    stamp(agent: Agent, message: UserMessage): void;
}
/** Mount only when the normal chat/session assembly is present. */
export declare function registerGoogleChatControls(ctx: Context, profiles: () => Profiles): Promise<GoogleChatControls>;
export {};
