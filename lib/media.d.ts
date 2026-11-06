/**
 * Save generated media with a usable file type, while callers retain the raw
 * native Part separately for protocol replay. Gemini's audio/L16 streaming
 * payload is signed little-endian PCM (not RFC L16 network byte order):
 * https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
 */
export declare function nativeMediaFile(data: Buffer, mime: string): {
    data: Buffer;
    extension: string;
};
