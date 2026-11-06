import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { type GoogleProviderModel, type GoogleModelAdvanced } from '../provider-remote.js';
type InputType = NonNullable<GoogleModelAdvanced['inputTypes']>[number];
type SupportedOutputType = NonNullable<GoogleModelAdvanced['outputTypes']>[number];
type OutputType = NonNullable<GoogleModelAdvanced['responseModalities']>[number];
type Format = 'inherit' | 'budget' | 'level' | 'custom';
interface EffortDraft {
    id: string;
    name: string;
    format: 'default' | 'budget' | 'level';
    value: string;
    includeThoughts?: boolean;
}
export interface ModelSettingsDraft {
    name: string;
    contextWindow: string;
    maxTokens: string;
    inputMode: 'inherit' | 'custom';
    inputTypes: InputType[];
    supportedOutputMode: 'inherit' | 'custom';
    outputTypes: SupportedOutputType[];
    outputMode: 'inherit' | 'custom';
    responseModalities: OutputType[];
    timeoutSeconds: string;
    includeThoughts: 'inherit' | 'on' | 'off';
    thinkingFormat: Format;
    efforts: EffortDraft[];
    defaultReasoning: string;
    fallbackFormat: 'inherit' | 'budget' | 'level';
    fallbackBudget: string;
    fallbackLevel: string;
    badInputs: string[];
    editedFields: string[];
}
type Translate = PropsLocale<'googleProviderSettings'>['t'];
export declare function initialModelSettings(model: GoogleProviderModel): ModelSettingsDraft;
/** Validate the complete visible state before deriving its safe-field patch. */
export declare function parseModelSettings(draft: ModelSettingsDraft): GoogleModelAdvanced | undefined;
/** Preserve hidden or future native fields by sending only visible values the user changed. */
export declare function modelSettingsPatch(model: GoogleProviderModel, draft: ModelSettingsDraft): GoogleModelAdvanced | undefined;
export declare function ModelSettings({ model, draft, disabled, t, onChange }: {
    model: GoogleProviderModel;
    draft: ModelSettingsDraft;
    disabled: boolean;
    t: Translate;
    onChange: (draft: ModelSettingsDraft) => void;
}): import("react").JSX.Element;
export {};
