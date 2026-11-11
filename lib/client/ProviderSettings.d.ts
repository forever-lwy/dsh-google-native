import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type GoogleProviderConnection, type GoogleProviderModel, type GoogleProviderProfileView, type GoogleProviderSettings, type GoogleProviderDiscoverRequest, type GoogleProviderSaveRequest } from '../provider-remote.js';
export type ProviderConnection = GoogleProviderConnection;
export type ProviderModel = GoogleProviderModel;
export type ProviderProfile = GoogleProviderProfileView;
export type ProviderSettingsSnapshot = GoogleProviderSettings;
export interface ProviderSettingsFace {
    read: (signal: AbortSignal) => Promise<ProviderSettingsSnapshot>;
    discover: (request: GoogleProviderDiscoverRequest, signal: AbortSignal) => Promise<{
        models: ProviderModel[];
    }>;
    save: (request: GoogleProviderSaveRequest, signal: AbortSignal) => Promise<ProviderSettingsSnapshot>;
}
type Props = PropsRuntime<'settings.models.provider-card'> & PropsLocale<'googleProviderSettings'> & ProviderSettingsFace;
type FormProps = Pick<Props, 'read' | 'discover' | 'save' | 'useRemoteAccess' | 't'> & {
    providerId: ProviderProfile['provider'];
};
/** Each Models-page provider card owns one route's configuration form. */
/** Set on the host's `<li>` provider row that holds one of this plugin's cards. */
export declare const NATIVE_ROW_ATTRIBUTE = "data-dsh-google-native-row";
export declare function ProviderSettings(props: Props): import("react").JSX.Element | null;
export declare function ProviderSettingsPage({ read, discover, save, useRemoteAccess, t, providerId: provider }: FormProps): import("react").JSX.Element;
export {};
