import { chatRemoteInfo, getChatOptions, setChatOptions } from '../chat-remote.js';
import { NativeOptions } from './NativeOptions.js';
import { en, zh } from './locales.js';
import { nativeStyles } from './styles.js';
import { blockWhileSaving } from './save-block.js';
import { providerRemoteInfo, getProviderSettings, discoverProviderModels, saveProviderSettings } from '../provider-remote.js';
import { ProviderSettings } from './ProviderSettings.js';
import { providerEn, providerZh } from './provider-locales.js';
import { providerStyles } from './provider-styles.js';
export const name = 'dsh-google-native-client';
export const inject = ['slots', 'locale', 'conversation', 'modelDirectories', 'remote', 'sessions'];
/** Add controls beside file upload, preserving the built-in upload and attachment rail. */
export async function apply(ctx) {
    const unmountRemote = await ctx.remote.$mount(chatRemoteInfo);
    let unmountSettings;
    try {
        unmountSettings = await ctx.remote.$mount(providerRemoteInfo);
        ctx.effect(() => unmountRemote, 'google-native: remote schema');
        ctx.effect(() => unmountSettings, 'google-native: settings remote schema');
        ctx.effect(() => ctx.locale.register('googleNative', 'en', { ...en }), 'google-native: English');
        ctx.effect(() => ctx.locale.register('googleNative', 'zh', zh), 'google-native: Chinese');
        ctx.effect(() => ctx.locale.register('googleProviderSettings', 'en', { ...providerEn }), 'google-native: provider English');
        ctx.effect(() => ctx.locale.register('googleProviderSettings', 'zh', providerZh), 'google-native: provider Chinese');
        ctx.effect(() => {
            const style = document.createElement('style');
            style.dataset.plugin = 'dsh-google-native';
            style.textContent = nativeStyles + providerStyles;
            document.head.appendChild(style);
            return () => style.remove();
        }, 'google-native: styles');
        // $mount publishes separate Cordis namespace services. Bind callbacks in
        // their injected scope: access through the parent plugin's `remote` alone
        // is forbidden once that plugin runs in its real loader-created fiber.
        ctx.inject(['remote.nativeGoogleChat', 'remote.nativeGoogleSettings'], remoteCtx => {
            remoteCtx.slots.inject('conversation.input.left', () => remoteCtx.slots.register({
                name: 'conversation.input.left', id: 'google-native-options', order: 15, locale: 'googleNative',
                inject: (sessionId) => {
                    const directory = remoteCtx.modelDirectories.directoryFor(sessionId);
                    // Host and browser Context declarations share this package's build;
                    // bind the browser service face explicitly at this boundary.
                    const sessions = remoteCtx.get('sessions');
                    const available = sessions.subagentAddress(sessionId) === undefined;
                    return {
                        available, directory: directory.store,
                        loadDirectory: () => { if (available)
                            void directory.load().catch(() => { }); },
                        read: (route, signal) => getChatOptions(remoteCtx.remote, { sessionId, ...route }, signal),
                        save: (route, choices, expectedRevision, signal) => setChatOptions(remoteCtx.remote, { sessionId, ...route, choices, expectedRevision }, signal),
                        beginSave: reason => blockWhileSaving(remoteCtx.conversation.blocks, sessionId, reason),
                    };
                },
            }, NativeOptions));
            const settingsFace = {
                read: signal => getProviderSettings(remoteCtx.remote, signal),
                discover: (request, signal) => discoverProviderModels(remoteCtx.remote, request, signal),
                save: (request, signal) => saveProviderSettings(remoteCtx.remote, request, signal),
            };
            remoteCtx.slots.inject('settings.models.provider-card', () => remoteCtx.slots.register({
                name: 'settings.models.provider-card', key: 'dsh-google-native', locale: 'googleProviderSettings', inject: () => settingsFace,
            }, ProviderSettings));
        });
    }
    catch (error) {
        await unmountSettings?.();
        await unmountRemote();
        throw error;
    }
}
export { NativeOptions, nativeOptionsVisible } from './NativeOptions.js';
export { ProviderSettings, ProviderSettingsPage } from './ProviderSettings.js';
