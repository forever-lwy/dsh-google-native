import type { GenerateContentConfig } from '@google/genai';
import type { GoogleInputType, GoogleModelConfig, GoogleProfile } from './config.js';
/** Explicit model capabilities used to decide which chat controls may be shown. */
export interface GoogleModelCapabilities {
    nativeFiles?: boolean;
    search?: boolean;
    urlContext?: boolean;
    codeExecution?: boolean;
    maps?: boolean;
    /** Whether this connection can retain local function tools alongside native tools. */
    functionCallingWithNativeTools?: boolean;
}
export declare const CAPABILITY_KEYS: readonly ["nativeFiles", "search", "urlContext", "codeExecution", "maps"];
export type GoogleCapabilityKey = typeof CAPABILITY_KEYS[number];
export type ResolvedGoogleCapabilities = Required<GoogleModelCapabilities>;
export type NativeToolKey = Exclude<GoogleCapabilityKey, 'nativeFiles'>;
export type NativeToolChoices = Partial<Record<NativeToolKey, boolean>>;
export declare const NATIVE_TOOL_FIELDS: {
    readonly search: "googleSearch";
    readonly urlContext: "urlContext";
    readonly codeExecution: "codeExecution";
    readonly maps: "googleMaps";
};
/** No family/prefix matching: an unknown ID only exposes explicitly declared capabilities. */
export declare function resolveCapabilities(provider: string, model: {
    id: string;
    capabilities?: GoogleModelCapabilities;
    inputTypes?: GoogleInputType[];
} | undefined): ResolvedGoogleCapabilities;
/** The host rejects these selections before any upload or model API request. */
export declare function unsupportedChoices(capabilities: ResolvedGoogleCapabilities, choices: GoogleModelCapabilities): GoogleCapabilityKey[];
/** The final raw REST tools list takes precedence over SDK-shaped tools. */
export declare function activeNativeToolChoices(config: GenerateContentConfig): Record<NativeToolKey, boolean>;
/** Actual configured tool defaults, before any explicit per-conversation choices. */
export declare function configuredToolChoices(profile: GoogleProfile, model: GoogleModelConfig | undefined): Record<NativeToolKey, boolean>;
/**
 * Apply only explicit chat choices. Omission retains configured defaults; false
 * removes the tool even when it came from a model setting or a raw REST body.
 * Other config and Tool keys, including functionDeclarations, remain intact.
 */
export declare function applyNativeToolChoices(config: GenerateContentConfig, choices: NativeToolChoices): GenerateContentConfig;
