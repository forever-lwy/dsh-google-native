import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-google-native-client";
export declare const inject: string[];
/** Add controls beside file upload, preserving the built-in upload and attachment rail. */
export declare function apply(ctx: Context): Promise<void>;
export { NativeOptions, nativeOptionsVisible } from './NativeOptions.js';
export type { NativeOptionsFace, NativeOptionsState } from './NativeOptions.js';
export { ProviderSettings, ProviderSettingsPage } from './ProviderSettings.js';
export type { ProviderSettingsFace } from './ProviderSettings.js';
