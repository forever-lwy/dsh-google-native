import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId } from 'react';
import { MAX_REQUEST_TIMEOUT_MS, modelAdvancedSchema, } from '../provider-remote.js';
const inputTypes = ['text', 'image', 'audio', 'video', 'pdf'];
const supportedOutputTypes = ['text', 'image', 'audio'];
const outputTypes = ['TEXT', 'IMAGE', 'AUDIO'];
const numberText = (value) => value == null ? '' : String(value);
export function initialModelSettings(model) {
    const advanced = model.advanced ?? {};
    const declaredInputs = advanced.inputTypes === undefined ? model.inputTypes : advanced.inputTypes;
    const declaredOutputs = advanced.outputTypes === undefined ? model.outputTypes : advanced.outputTypes;
    const thinking = advanced.thinkingConfig ?? {};
    const efforts = (advanced.reasoning ?? []).map(row => ({
        id: row.id, name: row.name,
        format: row.thinkingBudget !== undefined ? 'budget' : row.thinkingLevel !== undefined ? 'level' : 'default',
        value: row.thinkingBudget !== undefined ? String(row.thinkingBudget) : row.thinkingLevel ?? '',
        ...(row.includeThoughts === undefined ? {} : { includeThoughts: row.includeThoughts }),
    }));
    const formats = new Set(efforts.map(row => row.format));
    const fallbackFormat = thinking.thinkingBudget != null ? 'budget' : thinking.thinkingLevel != null ? 'level' : 'inherit';
    const thinkingFormat = efforts.length ? formats.size === 1 && !formats.has('default')
        ? efforts[0].format : 'custom' : fallbackFormat;
    return {
        name: advanced.name === null ? '' : advanced.name ?? model.name ?? '',
        contextWindow: numberText(advanced.contextWindow === undefined ? model.contextWindow : advanced.contextWindow),
        maxTokens: numberText(advanced.maxTokens === undefined ? model.maxTokens : advanced.maxTokens),
        inputMode: declaredInputs == null ? 'inherit' : 'custom',
        inputTypes: [...(declaredInputs ?? inputTypes)],
        supportedOutputMode: declaredOutputs == null ? 'inherit' : 'custom',
        outputTypes: [...(declaredOutputs ?? ['text'])],
        outputMode: advanced.responseModalities == null ? 'inherit' : 'custom',
        responseModalities: [...(advanced.responseModalities ?? ['TEXT'])],
        timeoutSeconds: advanced.requestTimeoutMs == null ? '' : String(advanced.requestTimeoutMs / 1000),
        includeThoughts: thinking.includeThoughts == null ? 'inherit' : thinking.includeThoughts ? 'on' : 'off',
        thinkingFormat, efforts, defaultReasoning: advanced.defaultReasoning ?? '', fallbackFormat,
        fallbackBudget: numberText(thinking.thinkingBudget), fallbackLevel: thinking.thinkingLevel ?? '', badInputs: [], editedFields: [],
    };
}
function integer(text, minimum, empty = null) {
    if (!text.trim())
        return empty;
    if (!/^-?\d+$/.test(text.trim()))
        return undefined;
    const value = Number(text);
    return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}
function timeout(text) {
    if (!text.trim())
        return null;
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
    if (!match)
        return undefined;
    const value = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
    return Number.isSafeInteger(value) && value <= MAX_REQUEST_TIMEOUT_MS ? value : undefined;
}
/** Validate the complete visible state before deriving its safe-field patch. */
export function parseModelSettings(draft) {
    if (draft.badInputs.length)
        return undefined;
    const contextWindow = integer(draft.contextWindow, 1);
    const maxTokens = integer(draft.maxTokens, 1);
    const requestTimeoutMs = timeout(draft.timeoutSeconds);
    if (contextWindow === undefined || maxTokens === undefined || requestTimeoutMs === undefined)
        return undefined;
    if (contextWindow !== null && maxTokens !== null && maxTokens >= contextWindow)
        return undefined;
    const reasoning = [];
    for (const row of draft.thinkingFormat === 'inherit' ? [] : draft.efforts) {
        const format = draft.thinkingFormat === 'custom' ? row.format : draft.thinkingFormat;
        const budget = format === 'budget' ? integer(row.value, -1, undefined) : undefined;
        if (format === 'budget' && budget == null)
            return undefined;
        reasoning.push({ id: row.id.trim(), name: row.name.trim(),
            ...(format === 'budget' ? { thinkingBudget: budget } : {}),
            ...(format === 'level' ? { thinkingLevel: row.value.trim() } : {}),
            ...(row.includeThoughts === undefined ? {} : { includeThoughts: row.includeThoughts }), });
    }
    const defaultReasoning = draft.thinkingFormat === 'inherit' ? null : draft.defaultReasoning.trim() || null;
    if (defaultReasoning !== null && !reasoning.some(row => row.id === defaultReasoning))
        return undefined;
    const fallbackBudget = draft.fallbackFormat === 'budget' ? integer(draft.fallbackBudget, -1, undefined) : null;
    if (draft.fallbackFormat === 'budget' && fallbackBudget == null)
        return undefined;
    const advanced = {
        name: draft.name.trim() || null, contextWindow, maxTokens, requestTimeoutMs,
        inputTypes: draft.inputMode === 'inherit' ? null : inputTypes.filter(type => draft.inputTypes.includes(type)),
        outputTypes: draft.supportedOutputMode === 'inherit' ? null : supportedOutputTypes.filter(type => draft.outputTypes.includes(type)),
        responseModalities: draft.outputMode === 'inherit' ? null : outputTypes.filter(type => draft.responseModalities.includes(type)),
        reasoning: reasoning.length ? reasoning : null, defaultReasoning,
        thinkingConfig: {
            includeThoughts: draft.includeThoughts === 'inherit' ? null : draft.includeThoughts === 'on',
            thinkingBudget: fallbackBudget,
            thinkingLevel: draft.fallbackFormat === 'level' ? draft.fallbackLevel.trim() : null,
        },
    };
    const result = modelAdvancedSchema.safeParse(advanced);
    return result.success ? result.data : undefined;
}
/** Preserve hidden or future native fields by sending only visible values the user changed. */
export function modelSettingsPatch(model, draft) {
    const value = parseModelSettings(draft);
    if (!value)
        return undefined;
    const initial = initialModelSettings(model);
    const baseline = parseModelSettings(initial);
    const directlyChanged = {
        name: draft.name.trim() !== initial.name.trim(), contextWindow: draft.contextWindow.trim() !== initial.contextWindow.trim(),
        maxTokens: draft.maxTokens.trim() !== initial.maxTokens.trim(), requestTimeoutMs: draft.timeoutSeconds.trim() !== initial.timeoutSeconds.trim(),
        inputTypes: draft.inputMode !== initial.inputMode || JSON.stringify(draft.inputTypes) !== JSON.stringify(initial.inputTypes),
        outputTypes: draft.supportedOutputMode !== initial.supportedOutputMode || JSON.stringify(draft.outputTypes) !== JSON.stringify(initial.outputTypes),
        responseModalities: draft.outputMode !== initial.outputMode || JSON.stringify(draft.responseModalities) !== JSON.stringify(initial.responseModalities),
        reasoning: draft.thinkingFormat !== initial.thinkingFormat || JSON.stringify(draft.efforts) !== JSON.stringify(initial.efforts),
        defaultReasoning: draft.defaultReasoning.trim() !== initial.defaultReasoning.trim(),
    };
    const patch = {};
    for (const key of ['name', 'contextWindow', 'maxTokens', 'inputTypes', 'outputTypes', 'responseModalities', 'requestTimeoutMs', 'reasoning', 'defaultReasoning']) {
        if (baseline ? JSON.stringify(value[key]) !== JSON.stringify(baseline[key]) : directlyChanged[key])
            Object.assign(patch, { [key]: value[key] });
    }
    const thinking = {};
    for (const key of ['includeThoughts', 'thinkingBudget', 'thinkingLevel']) {
        const original = key === 'includeThoughts' ? initial.includeThoughts === 'inherit' ? null : initial.includeThoughts === 'on'
            : key === 'thinkingBudget' ? initial.fallbackFormat === 'budget' ? integer(initial.fallbackBudget, -1, undefined) : null
                : initial.fallbackFormat === 'level' ? initial.fallbackLevel.trim() : null;
        if (value.thinkingConfig?.[key] !== (baseline ? baseline.thinkingConfig?.[key] : original))
            Object.assign(thinking, { [key]: value.thinkingConfig?.[key] });
    }
    if (Object.keys(thinking).length)
        patch.thinkingConfig = thinking;
    return patch;
}
function presetEfforts(format) {
    return format === 'budget'
        ? [{ id: 'dynamic', name: 'Dynamic', format, value: '-1' }, { id: 'low', name: 'Low', format, value: '1024' },
            { id: 'medium', name: 'Medium', format, value: '8192' }, { id: 'high', name: 'High', format, value: '24576' }]
        : [{ id: 'low', name: 'Low', format, value: 'LOW' }, { id: 'medium', name: 'Medium', format, value: 'MEDIUM' },
            { id: 'high', name: 'High', format, value: 'HIGH' }];
}
export function ModelSettings({ model, draft, disabled, t, onChange }) {
    const id = useId();
    const valid = parseModelSettings(draft) !== undefined;
    const patch = (next) => onChange({ ...draft, ...next,
        editedFields: [...new Set([...draft.editedFields, ...Object.keys(next).filter(key => key !== 'badInputs')])],
    });
    const numberField = (key, label, hint) => _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t(label) }), _jsx("input", { type: "number", value: draft[key], disabled: disabled, min: key === 'timeoutSeconds' ? '0' : '1', max: key === 'timeoutSeconds' ? MAX_REQUEST_TIMEOUT_MS / 1000 : Number.MAX_SAFE_INTEGER, step: key === 'timeoutSeconds' ? '0.001' : '1', "data-google-model-setting": key, onChange: event => {
                    const value = event.currentTarget.value;
                    const bad = event.currentTarget.validity.badInput;
                    patch({ [key]: value, badInputs: bad ? [...new Set([...draft.badInputs, key])] : draft.badInputs.filter(item => item !== key) });
                } }), _jsx("span", { className: "dsh-google-provider-hint", children: t(key === 'maxTokens' && model.advanced?.maxTokens === null && !draft.editedFields.includes('maxTokens') ? 'nativeMaxTokensHint' : hint) })] });
    const format = (next) => {
        if (next === 'inherit')
            return patch({ thinkingFormat: next, efforts: [], defaultReasoning: '', fallbackFormat: 'inherit', fallbackBudget: '', fallbackLevel: '' });
        const efforts = next === 'custom' ? draft.efforts : draft.efforts.length
            ? draft.efforts.map(row => ({ ...row, format: next,
                value: row.format === next ? row.value : next === 'budget' ? '-1' : 'LOW' })) : presetEfforts(next);
        patch({ thinkingFormat: next, efforts,
            ...(next !== 'custom' && draft.fallbackFormat !== 'inherit' && draft.fallbackFormat !== next ? {
                fallbackFormat: next, fallbackBudget: next === 'budget' ? '-1' : '', fallbackLevel: next === 'level' ? 'LOW' : '',
            } : {}),
        });
    };
    const row = (index, next) => patch({ efforts: draft.efforts.map((item, at) => at === index ? { ...item, ...next } : item),
        ...(next.id !== undefined && draft.defaultReasoning === draft.efforts[index].id ? { defaultReasoning: next.id } : {}),
    });
    return _jsxs("div", { className: "dsh-google-provider-model-advanced", "data-google-model-advanced": model.id, children: [_jsx("p", { className: "dsh-google-provider-hint", children: t('advancedHint') }), _jsxs("div", { className: "dsh-google-provider-grid", children: [_jsxs("label", { className: "dsh-google-provider-field wide", children: [_jsx("span", { children: t('modelName') }), _jsx("input", { value: draft.name, disabled: disabled, maxLength: 1024, "data-google-model-setting": "name", onChange: event => patch({ name: event.currentTarget.value }) })] }), numberField('contextWindow', 'contextWindow', 'contextWindowHint'), numberField('maxTokens', 'maxTokens', 'maxTokensHint'), numberField('timeoutSeconds', 'modelTimeout', 'modelTimeoutHint')] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('inputTypes') }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { className: "dsh-google-provider-hint", children: t('inputTypesHint') }), _jsxs("select", { value: draft.inputMode, disabled: disabled, "data-google-model-setting": "inputMode", onChange: event => patch({ inputMode: event.currentTarget.value }), children: [_jsx("option", { value: "inherit", children: t('inherit') }), _jsx("option", { value: "custom", children: t('custom') })] })] }), draft.inputMode === 'custom' && _jsx("div", { className: "dsh-google-provider-model-types", children: inputTypes.map(type => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: draft.inputTypes.includes(type), disabled: disabled || type === 'text', "data-google-model-input": type, onChange: event => patch({ inputTypes: event.currentTarget.checked ? [...draft.inputTypes, type] : draft.inputTypes.filter(item => item !== type) }) }), _jsx("span", { children: t(type === 'text' ? 'typeText' : type === 'image' ? 'typeImage' : type === 'audio' ? 'typeAudio' : type === 'video' ? 'typeVideo' : 'typePdf') })] }, type)) })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('supportedOutputTypes') }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { className: "dsh-google-provider-hint", children: t('supportedOutputTypesHint') }), _jsxs("select", { value: draft.supportedOutputMode, disabled: disabled, "data-google-model-setting": "supportedOutputMode", onChange: event => patch({ supportedOutputMode: event.currentTarget.value }), children: [_jsx("option", { value: "inherit", children: t('inherit') }), _jsx("option", { value: "custom", children: t('custom') })] })] }), draft.supportedOutputMode === 'custom' && _jsx("div", { className: "dsh-google-provider-model-types", children: supportedOutputTypes.map(type => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: draft.outputTypes.includes(type), disabled: disabled, "data-google-model-supported-output": type, onChange: event => patch({ outputTypes: event.currentTarget.checked ? [...draft.outputTypes, type] : draft.outputTypes.filter(item => item !== type) }) }), _jsx("span", { children: t(type === 'text' ? 'typeText' : type === 'image' ? 'typeImage' : 'typeAudio') })] }, type)) })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('outputTypes') }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { className: "dsh-google-provider-hint", children: t('outputTypesHint') }), _jsxs("select", { value: draft.outputMode, disabled: disabled, "data-google-model-setting": "outputMode", onChange: event => patch({ outputMode: event.currentTarget.value }), children: [_jsx("option", { value: "inherit", children: t('inherit') }), _jsx("option", { value: "custom", children: t('custom') })] })] }), draft.outputMode === 'custom' && _jsx("div", { className: "dsh-google-provider-model-types", children: outputTypes.map(type => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: draft.responseModalities.includes(type), disabled: disabled, "data-google-model-output": type, onChange: event => patch({ responseModalities: event.currentTarget.checked ? [...draft.responseModalities, type] : draft.responseModalities.filter(item => item !== type) }) }), _jsx("span", { children: t(type === 'TEXT' ? 'typeText' : type === 'IMAGE' ? 'typeImage' : 'typeAudio') })] }, type)) })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('thinkingSettings') }), _jsx("p", { className: "dsh-google-provider-hint", children: t('thinkingHint') }), _jsxs("div", { className: "dsh-google-provider-grid", children: [_jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('thinkingFormat') }), _jsxs("select", { value: draft.thinkingFormat, disabled: disabled, "data-google-model-setting": "thinkingFormat", onChange: event => format(event.currentTarget.value), children: [_jsx("option", { value: "inherit", children: t('thinkingDefault') }), _jsx("option", { value: "budget", children: t('thinkingBudget') }), _jsx("option", { value: "level", children: t('thinkingLevel') }), _jsx("option", { value: "custom", children: t('thinkingCustom') })] })] }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('includeThoughts') }), _jsxs("select", { value: draft.includeThoughts, disabled: disabled, "data-google-model-setting": "includeThoughts", onChange: event => patch({ includeThoughts: event.currentTarget.value }), children: [_jsx("option", { value: "inherit", children: t('inherit') }), _jsx("option", { value: "on", children: t('enabledOption') }), _jsx("option", { value: "off", children: t('disabledOption') })] })] })] }), draft.thinkingFormat !== 'inherit' && _jsxs(_Fragment, { children: [_jsx("div", { className: "dsh-google-provider-model-reasoning", children: draft.efforts.map((effort, index) => _jsxs("div", { className: "dsh-google-provider-model-effort", "data-google-model-effort": index, children: [_jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('effortId') }), _jsx("input", { value: effort.id, disabled: disabled, maxLength: 128, "data-google-effort-field": "id", onChange: event => row(index, { id: event.currentTarget.value }) })] }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('effortName') }), _jsx("input", { value: effort.name, disabled: disabled, maxLength: 512, "data-google-effort-field": "name", onChange: event => row(index, { name: event.currentTarget.value }) })] }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('effortValue') }), draft.thinkingFormat === 'custom' && _jsxs("select", { value: effort.format, disabled: disabled, "data-google-effort-field": "format", onChange: event => row(index, { format: event.currentTarget.value, value: '' }), children: [_jsx("option", { value: "budget", children: "thinkingBudget" }), _jsx("option", { value: "level", children: "thinkingLevel" }), _jsx("option", { value: "default", children: t('inherit') })] }), _jsx("input", { value: effort.value, disabled: disabled || (draft.thinkingFormat === 'custom' && effort.format === 'default'), "data-google-effort-field": "value", placeholder: draft.thinkingFormat === 'budget' || effort.format === 'budget' ? '-1' : 'LOW / MEDIUM / HIGH', onChange: event => row(index, { value: event.currentTarget.value }) })] }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('effortSummary') }), _jsxs("select", { value: effort.includeThoughts === undefined ? 'inherit' : effort.includeThoughts ? 'on' : 'off', disabled: disabled, "data-google-effort-field": "includeThoughts", onChange: event => row(index, { includeThoughts: event.currentTarget.value === 'inherit' ? undefined : event.currentTarget.value === 'on' }), children: [_jsx("option", { value: "inherit", children: t('effortSummaryInherit') }), _jsx("option", { value: "on", children: t('enabledOption') }), _jsx("option", { value: "off", children: t('disabledOption') })] })] }), _jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: disabled, "aria-label": `${t('removeEffort')} ${index + 1}`, onClick: () => patch({
                                                efforts: draft.efforts.filter((_item, at) => at !== index), defaultReasoning: draft.defaultReasoning === effort.id ? '' : draft.defaultReasoning,
                                            }), children: t('removeEffort') })] }, index)) }), _jsx("div", { className: "dsh-google-provider-actions", children: _jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: disabled || draft.efforts.length >= 64, onClick: () => patch({
                                        efforts: [...draft.efforts, { id: '', name: '', format: draft.thinkingFormat === 'level' ? 'level' : 'budget', value: draft.thinkingFormat === 'level' ? 'LOW' : '-1' }],
                                    }), children: t('addEffort') }) }), _jsxs("div", { className: "dsh-google-provider-grid", children: [_jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('defaultEffort') }), _jsxs("select", { value: draft.defaultReasoning, disabled: disabled, "data-google-model-setting": "defaultReasoning", onChange: event => patch({ defaultReasoning: event.currentTarget.value }), children: [_jsx("option", { value: "", children: t('thinkingDefault') }), draft.efforts.filter(effort => effort.id.trim()).map((effort, index) => _jsx("option", { value: effort.id, children: effort.name || effort.id }, index))] })] }), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('fallbackThinking') }), _jsxs("select", { value: draft.fallbackFormat, disabled: disabled, "data-google-model-setting": "fallbackFormat", onChange: event => patch({ fallbackFormat: event.currentTarget.value }), children: [_jsx("option", { value: "inherit", children: t('inherit') }), _jsx("option", { value: "budget", children: "thinkingBudget" }), _jsx("option", { value: "level", children: "thinkingLevel" })] })] }), draft.fallbackFormat !== 'inherit' && _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('fallbackValue') }), _jsx("input", { value: draft.fallbackFormat === 'budget' ? draft.fallbackBudget : draft.fallbackLevel, disabled: disabled, "data-google-model-setting": "fallbackValue", onChange: event => patch(draft.fallbackFormat === 'budget' ? { fallbackBudget: event.currentTarget.value } : { fallbackLevel: event.currentTarget.value }) })] })] }), _jsx("p", { className: "dsh-google-provider-hint", children: t('fallbackThinkingHint') })] })] }), !valid && _jsx("p", { id: `${id}-error`, role: "alert", className: "dsh-google-provider-model-summary-error", children: t('modelSettingsError') })] });
}
