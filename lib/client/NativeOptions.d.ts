import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { GoogleCapabilityKey, ResolvedGoogleCapabilities } from '../capabilities.js';
export interface NativeRoute {
    provider: string;
    model: string;
}
export type NativeChoices = Record<GoogleCapabilityKey, boolean>;
export interface NativeOptionsState extends NativeRoute {
    capabilities: ResolvedGoogleCapabilities;
    choices: NativeChoices;
    revision: number;
}
export interface NativeOptionsFace {
    available: boolean;
    directory: ObservableSnapshot<ModelDirectoryState>;
    loadDirectory: () => void;
    read: (route: NativeRoute, signal: AbortSignal) => Promise<NativeOptionsState>;
    save: (route: NativeRoute, choices: NativeChoices, expectedRevision: number, signal: AbortSignal) => Promise<NativeOptionsState>;
    beginSave: (reason: string) => () => void;
}
/** Selection changes suppress old controls synchronously, before async effects run. */
export declare function nativeOptionsVisible(route: NativeRoute | undefined, state: NativeOptionsState | undefined): boolean;
type Props = PropsRuntime<'conversation.input.left'> & PropsLocale<'googleNative'> & NativeOptionsFace;
export declare function NativeOptions({ available, directory, loadDirectory, read, save, beginSave, useSession, useAccess, t }: Props): import("react").JSX.Element | null;
export {};
