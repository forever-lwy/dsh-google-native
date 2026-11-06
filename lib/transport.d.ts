/** SDK 2.32.0 drops UploadFileConfig.abortSignal; scope it across both HTTP upload stages. */
export declare function withGoogleAbort<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T>;
export declare const googleFetch: typeof globalThis.fetch;
