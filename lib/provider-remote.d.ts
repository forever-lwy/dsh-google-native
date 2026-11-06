import { z } from 'zod';
import type { RemoteResult, TypertClientRemote, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol';
export declare const providerIdSchema: z.ZodEnum<{
    "google-ai-studio": "google-ai-studio";
    "google-vertex-native": "google-vertex-native";
}>;
/** Largest delay Node's timers can represent without clamping to one millisecond. */
export declare const MAX_REQUEST_TIMEOUT_MS = 2147483647;
export declare const DEFAULT_PROVIDER_FILE_LIMITS: {
    readonly inlineThresholdBytes: number;
    readonly inlineMaxBytes: number;
    readonly maxFileBytes: number;
};
export declare const providerFileSettingsSchema: z.ZodObject<{
    inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
    inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
    maxFileBytes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const providerConnectionSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    apiKeyEnv: z.ZodString;
    vertexAuth: z.ZodEnum<{
        adc: "adc";
        "api-key": "api-key";
    }>;
    project: z.ZodOptional<z.ZodString>;
    location: z.ZodOptional<z.ZodString>;
    keyFile: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    apiVersion: z.ZodOptional<z.ZodString>;
    requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
    files: z.ZodOptional<z.ZodObject<{
        inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
        inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
        maxFileBytes: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleProviderConnection = z.infer<typeof providerConnectionSchema>;
export declare const modelThinkingSchema: z.ZodObject<{
    includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type GoogleModelThinking = z.infer<typeof modelThinkingSchema>;
export declare const modelReasoningSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingLevel: z.ZodOptional<z.ZodString>;
    includeThoughts: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type GoogleModelReasoning = z.infer<typeof modelReasoningSchema>;
/** Safe editable fields. Capacity relationships are checked after merging a save,
 * so legacy native defaults can remain readable and be corrected in the UI. */
export declare const modelAdvancedSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        text: "text";
        image: "image";
        audio: "audio";
        video: "video";
        pdf: "pdf";
    }>>>>;
    outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        text: "text";
        image: "image";
        audio: "audio";
    }>>>>;
    responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        TEXT: "TEXT";
        IMAGE: "IMAGE";
        AUDIO: "AUDIO";
    }>>>>;
    requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingLevel: z.ZodOptional<z.ZodString>;
        includeThoughts: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>>;
    defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type GoogleModelAdvanced = z.infer<typeof modelAdvancedSchema>;
export declare const providerModelSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    contextWindow: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    inputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        text: "text";
        image: "image";
        audio: "audio";
        video: "video";
        pdf: "pdf";
    }>>>;
    outputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        text: "text";
        image: "image";
        audio: "audio";
    }>>>;
    supportsGenerateContent: z.ZodOptional<z.ZodBoolean>;
    advanced: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
            video: "video";
            pdf: "pdf";
        }>>>>;
        outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
        }>>>>;
        responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
            TEXT: "TEXT";
            IMAGE: "IMAGE";
            AUDIO: "AUDIO";
        }>>>>;
        requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            thinkingBudget: z.ZodOptional<z.ZodNumber>;
            thinkingLevel: z.ZodOptional<z.ZodString>;
            includeThoughts: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>>>;
        defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleProviderModel = z.infer<typeof providerModelSchema>;
export declare const providerProfileViewSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        "google-ai-studio": "google-ai-studio";
        "google-vertex-native": "google-vertex-native";
    }>;
    connection: z.ZodObject<{
        enabled: z.ZodBoolean;
        apiKeyEnv: z.ZodString;
        vertexAuth: z.ZodEnum<{
            adc: "adc";
            "api-key": "api-key";
        }>;
        project: z.ZodOptional<z.ZodString>;
        location: z.ZodOptional<z.ZodString>;
        keyFile: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        apiVersion: z.ZodOptional<z.ZodString>;
        requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
        files: z.ZodOptional<z.ZodObject<{
            inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
            inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
            maxFileBytes: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    credential: z.ZodObject<{
        configured: z.ZodBoolean;
        writable: z.ZodBoolean;
        source: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        inputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
            video: "video";
            pdf: "pdf";
        }>>>;
        outputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
        }>>>;
        supportsGenerateContent: z.ZodOptional<z.ZodBoolean>;
        advanced: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
                video: "video";
                pdf: "pdf";
            }>>>>;
            outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
            }>>>>;
            responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                TEXT: "TEXT";
                IMAGE: "IMAGE";
                AUDIO: "AUDIO";
            }>>>>;
            requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                thinkingBudget: z.ZodOptional<z.ZodNumber>;
                thinkingLevel: z.ZodOptional<z.ZodString>;
                includeThoughts: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>>>;
            defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
                thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleProviderProfileView = z.infer<typeof providerProfileViewSchema>;
export declare const providerSettingsSchema: z.ZodObject<{
    settingsNs: z.ZodString;
    revision: z.ZodNumber;
    writable: z.ZodBoolean;
    profiles: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<{
            "google-ai-studio": "google-ai-studio";
            "google-vertex-native": "google-vertex-native";
        }>;
        connection: z.ZodObject<{
            enabled: z.ZodBoolean;
            apiKeyEnv: z.ZodString;
            vertexAuth: z.ZodEnum<{
                adc: "adc";
                "api-key": "api-key";
            }>;
            project: z.ZodOptional<z.ZodString>;
            location: z.ZodOptional<z.ZodString>;
            keyFile: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodString>;
            apiVersion: z.ZodOptional<z.ZodString>;
            requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
            files: z.ZodOptional<z.ZodObject<{
                inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
                inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
                maxFileBytes: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        credential: z.ZodObject<{
            configured: z.ZodBoolean;
            writable: z.ZodBoolean;
            source: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        models: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            contextWindow: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            inputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
                video: "video";
                pdf: "pdf";
            }>>>;
            outputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
            }>>>;
            supportsGenerateContent: z.ZodOptional<z.ZodBoolean>;
            advanced: z.ZodOptional<z.ZodObject<{
                name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    text: "text";
                    image: "image";
                    audio: "audio";
                    video: "video";
                    pdf: "pdf";
                }>>>>;
                outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    text: "text";
                    image: "image";
                    audio: "audio";
                }>>>>;
                responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    TEXT: "TEXT";
                    IMAGE: "IMAGE";
                    AUDIO: "AUDIO";
                }>>>>;
                requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    thinkingBudget: z.ZodOptional<z.ZodNumber>;
                    thinkingLevel: z.ZodOptional<z.ZodString>;
                    includeThoughts: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>>>>;
                defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
                    thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                    thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                }, z.core.$strict>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleProviderSettings = z.infer<typeof providerSettingsSchema>;
export declare const providerReadRequestSchema: z.ZodObject<{}, z.core.$strict>;
export type GoogleProviderReadRequest = z.infer<typeof providerReadRequestSchema>;
export declare const providerDiscoverRequestSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        "google-ai-studio": "google-ai-studio";
        "google-vertex-native": "google-vertex-native";
    }>;
    connection: z.ZodObject<{
        enabled: z.ZodBoolean;
        apiKeyEnv: z.ZodString;
        vertexAuth: z.ZodEnum<{
            adc: "adc";
            "api-key": "api-key";
        }>;
        project: z.ZodOptional<z.ZodString>;
        location: z.ZodOptional<z.ZodString>;
        keyFile: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        apiVersion: z.ZodOptional<z.ZodString>;
        requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
        files: z.ZodOptional<z.ZodObject<{
            inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
            inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
            maxFileBytes: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    apiKey: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type GoogleProviderDiscoverRequest = z.infer<typeof providerDiscoverRequestSchema>;
export declare const providerDiscoverySchema: z.ZodObject<{
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        inputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
            video: "video";
            pdf: "pdf";
        }>>>;
        outputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
        }>>>;
        supportsGenerateContent: z.ZodOptional<z.ZodBoolean>;
        advanced: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
                video: "video";
                pdf: "pdf";
            }>>>>;
            outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
            }>>>>;
            responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                TEXT: "TEXT";
                IMAGE: "IMAGE";
                AUDIO: "AUDIO";
            }>>>>;
            requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                thinkingBudget: z.ZodOptional<z.ZodNumber>;
                thinkingLevel: z.ZodOptional<z.ZodString>;
                includeThoughts: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>>>;
            defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
                thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
export declare const providerSaveRequestSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        "google-ai-studio": "google-ai-studio";
        "google-vertex-native": "google-vertex-native";
    }>;
    connection: z.ZodObject<{
        enabled: z.ZodBoolean;
        apiKeyEnv: z.ZodString;
        vertexAuth: z.ZodEnum<{
            adc: "adc";
            "api-key": "api-key";
        }>;
        project: z.ZodOptional<z.ZodString>;
        location: z.ZodOptional<z.ZodString>;
        keyFile: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        apiVersion: z.ZodOptional<z.ZodString>;
        requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
        files: z.ZodOptional<z.ZodObject<{
            inlineThresholdBytes: z.ZodOptional<z.ZodNumber>;
            inlineMaxBytes: z.ZodOptional<z.ZodNumber>;
            maxFileBytes: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    apiKey: z.ZodOptional<z.ZodString>;
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        inputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
            video: "video";
            pdf: "pdf";
        }>>>;
        outputTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            text: "text";
            image: "image";
            audio: "audio";
        }>>>;
        supportsGenerateContent: z.ZodOptional<z.ZodBoolean>;
        advanced: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            inputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
                video: "video";
                pdf: "pdf";
            }>>>>;
            outputTypes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                text: "text";
                image: "image";
                audio: "audio";
            }>>>>;
            responseModalities: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                TEXT: "TEXT";
                IMAGE: "IMAGE";
                AUDIO: "AUDIO";
            }>>>>;
            requestTimeoutMs: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                thinkingBudget: z.ZodOptional<z.ZodNumber>;
                thinkingLevel: z.ZodOptional<z.ZodString>;
                includeThoughts: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>>>;
            defaultReasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            thinkingConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                includeThoughts: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
                thinkingBudget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export type GoogleProviderSaveRequest = z.infer<typeof providerSaveRequestSchema>;
type GetMethod = TypertRemoteMethod<{
    request: GoogleProviderReadRequest;
}, GoogleProviderSettings>;
type DiscoverMethod = TypertRemoteMethod<{
    request: GoogleProviderDiscoverRequest;
}, GoogleProviderDiscovery>;
type SaveMethod = TypertRemoteMethod<{
    request: GoogleProviderSaveRequest;
}, GoogleProviderSettings>;
/** Settings calls touch the global deployment, never a user-supplied Session resource. */
export declare const providerRemoteInfo: TypertRemoteInfo<{
    "nativeGoogleSettings/get": GetMethod;
    "nativeGoogleSettings/discover": DiscoverMethod;
    "nativeGoogleSettings/save": SaveMethod;
}>;
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteMap {
        'nativeGoogleSettings/get': (request: GoogleProviderReadRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderSettings>>;
        'nativeGoogleSettings/discover': (request: GoogleProviderDiscoverRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderDiscovery>>;
        'nativeGoogleSettings/save': (request: GoogleProviderSaveRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderSettings>>;
    }
    interface TypertRemoteNamespaceMap {
        nativeGoogleSettings: {
            get(request: GoogleProviderReadRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderSettings>>;
            discover(request: GoogleProviderDiscoverRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderDiscovery>>;
            save(request: GoogleProviderSaveRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderSettings>>;
        };
    }
    interface RemoteErrorDetailsMap {
        'native-google/settings-conflict': {
            revision: number;
        };
        'native-google/discovery-failed': {
            status?: number;
        };
        'native-google/credential-save-failed': {
            revision: number;
        };
    }
}
/** Only safe action metadata crosses into UI recovery logic; credential payloads never do. */
export declare class ProviderSettingsRemoteError extends Error {
    readonly code: string;
    readonly revision?: number;
    constructor(error: {
        code: string;
        message: string;
        details?: unknown;
    });
}
export declare function getProviderSettings(remote: TypertClientRemote, signal?: AbortSignal): Promise<GoogleProviderSettings>;
export declare function discoverProviderModels(remote: TypertClientRemote, request: GoogleProviderDiscoverRequest, signal?: AbortSignal): Promise<GoogleProviderDiscovery>;
export declare function saveProviderSettings(remote: TypertClientRemote, request: GoogleProviderSaveRequest, signal?: AbortSignal): Promise<GoogleProviderSettings>;
export {};
