import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type GoogleProfile, type Profiles } from './config.js';
import { type GoogleProviderModel, type GoogleProviderSettings, type GoogleProviderReadRequest, type GoogleProviderDiscoverRequest, type GoogleProviderSaveRequest } from './provider-remote.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        nativeGoogleSettings: GoogleProviderSettingsService;
    }
}
export interface GoogleProviderSettingsOptions {
    settingsNs: string;
    profiles: () => Profiles;
    discover: (profile: GoogleProfile, apiKey: string | undefined, signal: AbortSignal) => Promise<GoogleProviderModel[]>;
}
export declare class GoogleProviderSettingsService extends TypertRemoteService {
    private readonly options;
    private saves;
    constructor(ctx: Context, options: GoogleProviderSettingsOptions);
    private descriptor;
    private credentialInfo;
    get(request: GoogleProviderReadRequest, signal: AbortSignal): Promise<GoogleProviderSettings>;
    private read;
    private draft;
    private apiKey;
    discover(request: GoogleProviderDiscoverRequest, signal: AbortSignal): Promise<{
        models: GoogleProviderModel[];
    }>;
    save(request: GoogleProviderSaveRequest, signal: AbortSignal): Promise<GoogleProviderSettings>;
    private saveExclusive;
}
export declare function registerGoogleProviderSettings(ctx: Context, options: GoogleProviderSettingsOptions): GoogleProviderSettingsService;
