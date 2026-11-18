export declare const en: {
    readonly title: "Native capabilities";
    readonly dialogLabel: "Google native capabilities";
    readonly scope: "Options for this conversation";
    readonly nativeFiles: "Use native file input";
    readonly nativeFilesHint: "Shared across models in this conversation. Supported files go directly to the model. Other files use local file tools. Turning this off also applies to files in the conversation history.";
    readonly search: "Google Search";
    readonly urlContext: "URL context";
    readonly codeExecution: "Code execution";
    readonly maps: "Google Maps";
    readonly tools: "Native tools";
    readonly toolsHint: "Availability and charges depend on the selected model.";
    readonly localToolsHint: "This connection does not call local tools in the same request while native tools are enabled.";
    readonly saving: "Saving native options…";
    readonly error: "Could not load or save native options.";
    readonly retry: "Retry";
    readonly busy: "Available after the current submission finishes";
    readonly readOnly: "View only";
    readonly close: "Close";
};
export declare const zh: Record<keyof typeof en, string>;
export type NativeLocaleKey = keyof typeof en;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        googleNative: NativeLocaleKey;
    }
}
