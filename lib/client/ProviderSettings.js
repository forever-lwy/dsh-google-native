import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_PROVIDER_FILE_LIMITS, MAX_REQUEST_TIMEOUT_MS, } from '../provider-remote.js';
import { ModelSettings, initialModelSettings, parseModelSettings, modelSettingsPatch } from './ModelSettings.js';
function initialDraft(profile) {
    return { connection: { ...profile.connection }, models: profile.models.map(model => ({ ...model })),
        savedModels: Object.fromEntries(profile.models.map(model => [model.id, model])),
        selected: profile.models.map(model => model.id), apiKey: '', filter: '', manual: '', discovered: false,
        timeoutSeconds: String((profile.connection.requestTimeoutMs ?? 0) / 1000), timeoutBadInput: false,
        fileMiB: Object.fromEntries(Object.entries(DEFAULT_PROVIDER_FILE_LIMITS).map(([key, fallback]) => [key, fileSizeMiB(profile.connection.files?.[key] ?? fallback)])),
        fileBadInput: {}, modelEdits: {} };
}
const MiB = 1_048_576;
/** MiB fractions terminate within twenty decimal places; retain every stored byte. */
function fileSizeMiB(bytes) {
    const value = BigInt(bytes);
    const fraction = ((value % BigInt(MiB)) * 5n ** 20n).toString().padStart(20, '0').replace(/0+$/, '');
    return `${value / BigInt(MiB)}${fraction ? `.${fraction}` : ''}`;
}
/** Reject fractions of a byte instead of silently rounding the user's limit. */
function fileSizeBytes(mib) {
    const value = mib.trim();
    if (value.length > 64)
        return undefined;
    const match = /^(\d+)(?:\.(\d{1,20}))?$/.exec(value);
    if (!match)
        return undefined;
    const fraction = match[2] ?? '';
    const numerator = BigInt(`${match[1]}${fraction}`) * BigInt(MiB);
    const denominator = 10n ** BigInt(fraction.length);
    if (numerator % denominator !== 0n)
        return undefined;
    const bytes = numerator / denominator;
    return bytes > 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined;
}
function connectionWithFileSizes(draft, keys, timeoutMs) {
    const updates = Object.fromEntries(keys.flatMap(key => {
        const bytes = fileSizeBytes(draft.fileMiB[key]);
        return bytes !== undefined && bytes !== (draft.connection.files?.[key] ?? DEFAULT_PROVIDER_FILE_LIMITS[key]) ? [[key, bytes]] : [];
    }));
    return { ...draft.connection, requestTimeoutMs: timeoutMs,
        ...(Object.keys(updates).length ? { files: { ...draft.connection.files, ...updates } } : {}),
    };
}
/** Decimal seconds preserve existing millisecond precision without floating-point rounding. */
function requestTimeoutMs(seconds) {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(seconds.trim());
    if (!match)
        return undefined;
    const milliseconds = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= MAX_REQUEST_TIMEOUT_MS ? milliseconds : undefined;
}
function entry(values, key) {
    return Object.hasOwn(values, key) ? values[key] : undefined;
}
function canonicalModelId(id) {
    return id.replace(/^(?:models|publishers\/google\/models)\/([^/]+)$/, '$1');
}
function modelPatch(draft, model) {
    const edit = entry(draft.modelEdits, model.id);
    // New model capacities/names already travel as ordinary discovery fields.
    // Existing models are compared with their saved state, so autofilled fields
    // count as changes even when the user has not opened the advanced editor.
    const baseline = entry(draft.savedModels, model.id) ?? { id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens };
    const advanced = modelSettingsPatch(baseline, edit ?? initialModelSettings(model));
    if (!advanced || !edit)
        return advanced;
    // An explicit blank/inherit choice must take priority over discovery defaults,
    // including fields that were empty in the original saved model.
    if (edit.editedFields.includes('contextWindow') && !edit.contextWindow.trim() && model.contextWindow !== undefined)
        advanced.contextWindow = null;
    if (edit.editedFields.includes('maxTokens') && !edit.maxTokens.trim() && (model.maxTokens !== undefined || model.advanced?.maxTokens === null))
        advanced.maxTokens = null;
    if (edit.editedFields.includes('inputMode') && edit.inputMode === 'inherit' && model.inputTypes !== undefined)
        advanced.inputTypes = null;
    if (edit.editedFields.includes('supportedOutputMode') && edit.supportedOutputMode === 'inherit' && model.outputTypes !== undefined)
        advanced.outputTypes = null;
    return advanced;
}
/** Preserve configured fields; only metadata and untouched form fields refresh. */
function discoveredModel(previous, upstream, saved) {
    const advanced = { ...previous?.advanced, ...upstream.advanced, ...saved?.advanced };
    const result = { ...previous, ...upstream, ...saved, advanced };
    for (const key of ['contextWindow', 'maxTokens', 'inputTypes', 'outputTypes']) {
        const value = saved?.advanced?.[key] !== undefined ? saved.advanced[key] : saved?.[key] !== undefined ? saved[key]
            : upstream.advanced?.[key] !== undefined ? upstream.advanced[key] : upstream[key] !== undefined ? upstream[key] : advanced[key];
        if (value !== undefined) {
            Object.assign(advanced, { [key]: value });
            if (value !== null)
                Object.assign(result, { [key]: value });
        }
    }
    return result;
}
function refreshedModelEdit(edit, model) {
    const refreshed = initialModelSettings(model);
    const result = { ...edit };
    for (const keys of [['name'], ['contextWindow'], ['maxTokens'], ['inputMode', 'inputTypes'], ['supportedOutputMode', 'outputTypes']]) {
        if (!keys.some(key => edit.editedFields.includes(key)))
            for (const key of keys)
                Object.assign(result, { [key]: refreshed[key] });
    }
    return result;
}
function selectedModels(draft) {
    const selected = new Set(draft.selected);
    return draft.models.filter(model => selected.has(model.id)).map(model => {
        const { id, name, contextWindow, maxTokens, inputTypes, outputTypes } = model;
        const advanced = modelPatch(draft, model);
        return { id, ...(name ? { name } : {}), ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxTokens === undefined ? {} : { maxTokens }),
            ...(inputTypes === undefined ? {} : { inputTypes }), ...(outputTypes === undefined ? {} : { outputTypes }),
            ...(advanced && Object.keys(advanced).length ? { advanced } : {}),
        };
    });
}
/** Each Models-page provider card owns one route's configuration form. */
export function ProviderSettings(props) {
    const [open, setOpen] = useState(false);
    const [visited, setVisited] = useState(false);
    const panelId = useId();
    const providerId = props.provider.provider;
    if (providerId !== 'google-ai-studio' && providerId !== 'google-vertex-native')
        return null;
    return _jsxs("div", { className: "dsh-google-provider-card", "data-google-provider-card": providerId, children: [_jsx("button", { type: "button", className: "dsh-google-provider-button", "aria-expanded": open, "aria-controls": panelId, onClick: () => { setOpen(value => !value); setVisited(true); }, children: props.t(open ? 'closeConfiguration' : 'configure') }), _jsx("div", { id: panelId, hidden: !open, className: "dsh-google-provider-card-panel", children: visited && _jsx(ProviderSettingsPage, { ...props, providerId: providerId }, providerId) })] });
}
export function ProviderSettingsPage({ read, discover, save, useRemoteAccess, t, providerId: provider }) {
    const canRead = useRemoteAccess('nativeGoogleSettings/get');
    const canDiscover = useRemoteAccess('nativeGoogleSettings/discover');
    const canSave = useRemoteAccess('nativeGoogleSettings/save');
    const [snapshot, setSnapshot] = useState();
    const [drafts, setDrafts] = useState({});
    const [loadError, setLoadError] = useState(false);
    const [status, setStatus] = useState('idle');
    const [reload, setReload] = useState(0);
    const generation = useRef(0);
    const operation = useRef();
    const [expandedModels, setExpandedModels] = useState([]);
    const baseId = useId();
    useEffect(() => {
        const current = ++generation.current;
        const controller = new AbortController();
        operation.current?.abort();
        setSnapshot(undefined);
        setDrafts({});
        setLoadError(false);
        setStatus('idle');
        setExpandedModels([]);
        if (canRead)
            void read(controller.signal).then(value => {
                if (controller.signal.aborted || current !== generation.current)
                    return;
                setSnapshot(value);
                setDrafts(Object.fromEntries(value.profiles.map(profile => [profile.provider, initialDraft(profile)])));
            }).catch(() => { if (!controller.signal.aborted && current === generation.current)
                setLoadError(true); });
        return () => { controller.abort(); operation.current?.abort(); generation.current++; };
        // Each card addresses one route; an explicit reload discards its draft.
    }, [canRead, read, reload, provider]);
    const profile = snapshot?.profiles.find(item => item.provider === provider);
    const draft = drafts[provider];
    const busy = status === 'saving' || status === 'discovering';
    const editable = canSave && snapshot?.writable === true && !busy;
    const needsKey = provider === 'google-ai-studio' || draft?.connection.vertexAuth === 'api-key';
    const keyEditable = editable && profile?.credential.writable === true;
    const savedIds = new Set(profile?.models.map(model => model.id) ?? []);
    const filter = draft?.filter.trim().toLocaleLowerCase() ?? '';
    const visible = draft?.models.filter(model => [model.id, model.name ?? '', model.description ?? ''].join(' ').toLocaleLowerCase().includes(filter)) ?? [];
    const selected = new Set(draft?.selected ?? []);
    const timeoutMs = draft ? requestTimeoutMs(draft.timeoutSeconds) : undefined;
    const validTimeout = timeoutMs !== undefined && draft?.timeoutBadInput === false;
    const fileSizeKeys = [provider === 'google-ai-studio' ? 'inlineThresholdBytes' : 'inlineMaxBytes', 'maxFileBytes'];
    const validFiles = draft !== undefined && fileSizeKeys.every(key => !draft.fileBadInput[key] && fileSizeBytes(draft.fileMiB[key]) !== undefined);
    const changedFiles = draft !== undefined && profile !== undefined && fileSizeKeys.some(key => fileSizeBytes(draft.fileMiB[key]) !== (profile.connection.files?.[key] ?? DEFAULT_PROVIDER_FILE_LIMITS[key]));
    const invalidModels = draft?.models.filter(model => selected.has(model.id)
        && parseModelSettings(entry(draft.modelEdits, model.id) ?? initialModelSettings(model)) === undefined) ?? [];
    const validModels = invalidModels.length === 0;
    const changedModels = draft?.models.some(model => selected.has(model.id) && Object.keys(modelPatch(draft, model) ?? {}).length > 0) ?? false;
    const dirty = draft !== undefined && profile !== undefined && (draft.apiKey.trim().length > 0
        || !validModels || changedModels || !validFiles || changedFiles
        || !validTimeout || timeoutMs !== (profile.connection.requestTimeoutMs ?? 0)
        || JSON.stringify(draft.connection) !== JSON.stringify(profile.connection)
        || JSON.stringify([...draft.selected].sort()) !== JSON.stringify(profile.models.map(model => model.id).sort()));
    const patchDraft = (update) => {
        setDrafts(previous => previous[provider] ? { ...previous, [provider]: update(previous[provider]) } : previous);
        setStatus(old => old === 'saving' || old === 'discovering' ? old : 'idle');
    };
    const connection = (key, value) => patchDraft(old => ({ ...old, connection: { ...old.connection, [key]: value } }));
    const select = (ids, checked) => patchDraft(old => ({ ...old,
        selected: checked ? [...new Set([...old.selected, ...ids])] : old.selected.filter(id => !ids.includes(id)),
    }));
    const fetchModels = async () => {
        if (!draft || busy || !canDiscover || !validTimeout || !validFiles)
            return;
        const current = ++generation.current;
        const target = provider;
        const controller = new AbortController();
        operation.current = controller;
        setStatus('discovering');
        try {
            const value = await discover({ provider: target, connection: connectionWithFileSizes(draft, fileSizeKeys, timeoutMs), ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) }, controller.signal);
            if (controller.signal.aborted || current !== generation.current)
                return;
            setDrafts(previous => {
                const old = previous[target];
                if (!old)
                    return previous;
                // Saved or selected entries remain available even when a listing omits them.
                const models = new Map(old.models.filter(model => old.selected.includes(model.id) || savedIds.has(model.id) || entry(old.modelEdits, model.id)).map(model => [model.id, model]));
                const identities = new Map();
                for (const model of [...Object.values(old.savedModels), ...old.models]) {
                    const key = canonicalModelId(model.id);
                    if (!identities.has(key))
                        identities.set(key, model);
                }
                const modelEdits = { ...old.modelEdits };
                for (const model of value.models) {
                    const key = canonicalModelId(model.id);
                    const prior = identities.get(key);
                    const id = prior?.id ?? model.id;
                    const merged = discoveredModel(models.get(id) ?? prior, { ...model, id }, entry(old.savedModels, id));
                    models.set(id, merged);
                    identities.set(key, merged);
                    const edit = entry(modelEdits, id);
                    if (edit)
                        modelEdits[id] = refreshedModelEdit(edit, merged);
                }
                return { ...previous, [target]: { ...old, models: [...models.values()], modelEdits, discovered: true } };
            });
            setStatus('idle');
        }
        catch {
            if (!controller.signal.aborted && current === generation.current)
                setStatus('discover-error');
        }
        finally {
            if (operation.current === controller)
                operation.current = undefined;
        }
    };
    const saveSettings = async () => {
        if (!draft || !snapshot || !editable || !dirty || !validTimeout || !validFiles || !validModels)
            return;
        const current = ++generation.current;
        const target = provider;
        const controller = new AbortController();
        operation.current = controller;
        setStatus('saving');
        try {
            const value = await save({ provider: target, connection: connectionWithFileSizes(draft, fileSizeKeys, timeoutMs), models: selectedModels(draft),
                ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}), expectedRevision: snapshot.revision }, controller.signal);
            if (controller.signal.aborted || current !== generation.current)
                return;
            setSnapshot(value);
            const accepted = value.profiles.find(item => item.provider === target);
            if (accepted)
                setDrafts(previous => ({ ...previous, [target]: initialDraft(accepted) }));
            setStatus('saved');
        }
        catch (error) {
            if (!controller.signal.aborted && current === generation.current) {
                const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
                const recoverable = code === 'native-google/credential-save-failed' || code === 'native-google/settings-conflict';
                if (recoverable) {
                    try {
                        const fresh = await read(controller.signal);
                        if (controller.signal.aborted || current !== generation.current)
                            return;
                        // Keep the entered key and unsaved edits; only refresh their revision
                        // and baseline, so a second explicit Save can safely retry.
                        setSnapshot(fresh);
                    }
                    catch {
                        const revision = typeof error === 'object' && error !== null && 'revision' in error ? error.revision : undefined;
                        if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0)
                            setSnapshot(old => old ? { ...old, revision } : old);
                    }
                    if (!controller.signal.aborted && current === generation.current)
                        setStatus(code === 'native-google/credential-save-failed' ? 'credential-error' : 'conflict-error');
                }
                else
                    setStatus('save-error');
            }
        }
        finally {
            if (operation.current === controller)
                operation.current = undefined;
        }
    };
    if (!canRead)
        return _jsx("p", { children: t('noRead') });
    if (loadError)
        return _jsxs("div", { children: [_jsx("p", { role: "alert", children: t('loadError') }), _jsx("button", { type: "button", className: "dsh-google-provider-button", onClick: () => setReload(value => value + 1), children: t('retry') })] });
    if (!snapshot || !draft || !profile)
        return _jsx("p", { role: "status", children: t('loading') });
    const field = (key, label, hint, wide = false) => _jsxs("label", { className: `dsh-google-provider-field${wide ? ' wide' : ''}`, children: [_jsx("span", { children: t(label) }), _jsx("input", { value: draft.connection[key] ?? '', disabled: !editable, autoComplete: "off", spellCheck: false, onChange: event => connection(key, key === 'apiKeyEnv' ? event.currentTarget.value : event.currentTarget.value || undefined), type: key === 'baseURL' ? 'url' : 'text', "data-google-setting": key }), hint && _jsx("span", { className: "dsh-google-provider-hint", children: t(hint) })] });
    const fileField = (key, label, hint) => {
        const valid = !draft.fileBadInput[key] && fileSizeBytes(draft.fileMiB[key]) !== undefined;
        return _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t(label) }), _jsx("input", { type: "number", value: draft.fileMiB[key], disabled: !editable, min: 1 / MiB, max: Number.MAX_SAFE_INTEGER / MiB, step: "any", "aria-invalid": !valid, "aria-describedby": `${baseId}-${key}-hint${valid ? '' : ` ${baseId}-${key}-error`}`, "data-google-setting": `${key}MiB`, onChange: event => {
                        const value = event.currentTarget.value;
                        const badInput = event.currentTarget.validity.badInput;
                        patchDraft(old => ({ ...old, fileMiB: { ...old.fileMiB, [key]: value }, fileBadInput: { ...old.fileBadInput, [key]: badInput } }));
                    } }), _jsx("span", { id: `${baseId}-${key}-hint`, className: "dsh-google-provider-hint", children: t(hint) }), !valid && _jsx("span", { id: `${baseId}-${key}-error`, role: "alert", className: "dsh-google-provider-hint dsh-google-provider-error", children: t('fileSizeError') })] });
    };
    return _jsx("div", { className: "dsh-google-provider-settings", "data-google-provider-settings": true, children: _jsxs("div", { id: `${baseId}-panel`, role: "region", "aria-label": provider === 'google-ai-studio' ? t('aiStudio') : t('vertex'), children: [(!canSave || !snapshot.writable) && _jsx("p", { className: "dsh-google-provider-hint", children: t('readOnly') }), _jsxs("label", { className: "dsh-google-provider-check", children: [_jsx("input", { type: "checkbox", checked: draft.connection.enabled, disabled: !editable, onChange: event => connection('enabled', event.currentTarget.checked) }), _jsx("span", { children: t('enabled') })] }), _jsxs("div", { className: "dsh-google-provider-grid", children: [field('baseURL', 'baseURL', 'baseURLHint', true), field('apiVersion', 'apiVersion', 'apiVersionHint'), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('requestTimeout') }), _jsx("input", { type: "number", value: draft.timeoutSeconds, disabled: !editable, min: "0", max: MAX_REQUEST_TIMEOUT_MS / 1000, step: "0.001", "aria-invalid": !validTimeout, "aria-describedby": `${baseId}-timeout-hint${validTimeout ? '' : ` ${baseId}-timeout-error`}`, "data-google-setting": "requestTimeoutSeconds", onChange: event => {
                                        const timeoutSeconds = event.currentTarget.value;
                                        const timeoutBadInput = event.currentTarget.validity.badInput;
                                        patchDraft(old => ({ ...old, timeoutSeconds, timeoutBadInput }));
                                    } }), _jsx("span", { id: `${baseId}-timeout-hint`, className: "dsh-google-provider-hint", children: t('requestTimeoutHint') }), !validTimeout && _jsx("span", { id: `${baseId}-timeout-error`, role: "alert", className: "dsh-google-provider-hint dsh-google-provider-error", children: t('requestTimeoutError') })] }), provider === 'google-vertex-native' && _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('auth') }), _jsxs("select", { value: draft.connection.vertexAuth, disabled: !editable, onChange: event => connection('vertexAuth', event.currentTarget.value), "data-google-setting": "vertexAuth", children: [_jsx("option", { value: "adc", children: t('adc') }), _jsx("option", { value: "api-key", children: t('express') })] })] }), provider === 'google-vertex-native' && draft.connection.vertexAuth === 'adc' && _jsxs(_Fragment, { children: [field('project', 'project'), field('location', 'location'), field('keyFile', 'keyFile', 'keyFileHint', true)] }), needsKey && _jsxs(_Fragment, { children: [field('apiKeyEnv', 'keyRef', 'keyRefHint'), _jsxs("label", { className: "dsh-google-provider-field", children: [_jsx("span", { children: t('apiKey') }), _jsx("input", { type: "password", value: draft.apiKey, autoComplete: "new-password", placeholder: t('apiKeyPlaceholder'), disabled: !keyEditable, onChange: event => { const apiKey = event.currentTarget.value; patchDraft(old => ({ ...old, apiKey })); }, "data-google-setting": "apiKey" }), _jsx("span", { className: "dsh-google-provider-hint", children: draft.connection.apiKeyEnv === profile.connection.apiKeyEnv && profile.credential.configured ? t('keyConfigured') : t('keyNotConfigured') }), !profile.credential.writable && _jsx("span", { className: "dsh-google-provider-hint", children: t('credentialReadOnly') })] })] })] }), _jsxs("section", { className: "dsh-google-provider-model-section", "aria-label": t('fileSettings'), children: [_jsx("div", { className: "dsh-google-provider-model-heading", children: _jsx("h3", { children: t('fileSettings') }) }), _jsxs("div", { className: "dsh-google-provider-grid", children: [provider === 'google-ai-studio'
                                    ? fileField('inlineThresholdBytes', 'inlineThreshold', 'inlineThresholdHint')
                                    : fileField('inlineMaxBytes', 'inlineMax', 'inlineMaxHint'), fileField('maxFileBytes', 'maxFileSize', 'maxFileSizeHint')] }), _jsx("p", { className: "dsh-google-provider-hint", children: t('fileSizeHint') })] }), _jsxs("div", { className: "dsh-google-provider-discover", children: [_jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: busy || !canDiscover || !validTimeout || !validFiles, onClick: () => { void fetchModels(); }, children: status === 'discovering' ? t('discovering') : t('discover') }), _jsx("span", { className: "dsh-google-provider-hint", children: t('discoverHint') })] }), status === 'discover-error' && _jsx("p", { role: "alert", className: "dsh-google-provider-status dsh-google-provider-error", children: t('discoverError') }), _jsxs("section", { className: "dsh-google-provider-model-section", "aria-label": t('models'), children: [_jsxs("div", { className: "dsh-google-provider-model-heading", children: [_jsx("h3", { children: t('models') }), _jsxs("span", { className: "dsh-google-provider-hint", children: [t('selectedCount'), " ", selected.size] })] }), _jsx("input", { type: "search", className: "dsh-google-provider-filter", value: draft.filter, "aria-label": t('search'), placeholder: t('search'), onChange: event => { const filter = event.currentTarget.value; patchDraft(old => ({ ...old, filter })); } }), _jsxs("div", { className: "dsh-google-provider-actions", children: [_jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: !editable || !visible.length, onClick: () => select(visible.map(model => model.id), true), children: t('selectAll') }), _jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: !editable || !visible.length, onClick: () => select(visible.map(model => model.id), false), children: t('clearShown') })] }), _jsxs("div", { className: "dsh-google-provider-model-list", children: [visible.map(model => _jsxs("div", { className: "dsh-google-provider-model-entry", children: [_jsxs("div", { className: "dsh-google-provider-model-head", children: [_jsxs("label", { className: "dsh-google-provider-model", children: [_jsx("input", { type: "checkbox", checked: selected.has(model.id), disabled: !editable, "data-google-model": model.id, onChange: event => select([model.id], event.currentTarget.checked) }), _jsxs("span", { className: "dsh-google-provider-model-content", children: [_jsx("span", { className: "dsh-google-provider-model-name", children: model.name ?? model.id }), model.name && model.name !== model.id && _jsx("span", { className: "dsh-google-provider-model-id", children: model.id }), model.description && _jsx("span", { className: "dsh-google-provider-model-id", children: model.description })] }), savedIds.has(model.id) && _jsx("span", { className: "dsh-google-provider-model-badge", children: t('savedModel') })] }), _jsx("button", { type: "button", className: "dsh-google-provider-button dsh-google-provider-model-expand", "data-google-model-expand": model.id, "aria-expanded": expandedModels.includes(model.id), "aria-label": `${t('advancedSettings')} ${model.name ?? model.id}`, onClick: () => setExpandedModels(old => old.includes(model.id) ? old.filter(id => id !== model.id) : [...old, model.id]), children: t('advancedSettings') })] }), expandedModels.includes(model.id) && _jsx(ModelSettings, { model: model, draft: entry(draft.modelEdits, model.id) ?? initialModelSettings(model), disabled: !editable, t: t, onChange: edit => patchDraft(old => ({ ...old, modelEdits: { ...old.modelEdits, [model.id]: edit } })) })] }, model.id)), !visible.length && _jsx("p", { className: "dsh-google-provider-empty", children: draft.models.length ? t('noMatches') : t('noModels') })] }), _jsxs("div", { className: "dsh-google-provider-manual", children: [_jsx("input", { type: "text", value: draft.manual, disabled: !editable, "aria-label": t('manual'), placeholder: t('manualPlaceholder'), spellCheck: false, onChange: event => { const manual = event.currentTarget.value; patchDraft(old => ({ ...old, manual })); } }), _jsx("button", { type: "button", className: "dsh-google-provider-button", disabled: !editable || !draft.manual.trim(), onClick: () => {
                                        const id = draft.manual.trim();
                                        patchDraft(old => {
                                            const existing = old.models.find(model => canonicalModelId(model.id) === canonicalModelId(id));
                                            return { ...old, manual: '', filter: '',
                                                models: existing ? old.models : [...old.models, { id, name: id }],
                                                selected: [...new Set([...old.selected, existing?.id ?? id])],
                                            };
                                        });
                                    }, children: t('add') })] }), _jsx("p", { className: "dsh-google-provider-hint", children: t('modelsHint') }), !validModels && _jsxs("p", { role: "alert", className: "dsh-google-provider-model-summary-error", children: [t('selectedModelsError'), " ", invalidModels.map(model => model.name ?? model.id).join(', ')] })] }), _jsxs("div", { className: "dsh-google-provider-footer", children: [_jsx("button", { type: "button", className: "dsh-google-provider-button dsh-google-provider-primary", disabled: !editable || !dirty || !validTimeout || !validFiles || !validModels, onClick: () => { void saveSettings(); }, children: status === 'saving' ? t('saving') : t('save') }), dirty && _jsx("span", { className: "dsh-google-provider-hint", children: t('unsaved') }), (status === 'save-error' || status === 'credential-error' || status === 'conflict-error') && _jsx("button", { type: "button", className: "dsh-google-provider-button", onClick: () => setReload(value => value + 1), children: t('retry') })] }), _jsxs("div", { "aria-live": "polite", children: [status === 'saved' && _jsx("p", { role: "status", className: "dsh-google-provider-status", children: t('saved') }), status === 'save-error' && _jsx("p", { role: "alert", className: "dsh-google-provider-status dsh-google-provider-error", children: t('saveError') }), status === 'credential-error' && _jsx("p", { role: "alert", className: "dsh-google-provider-status dsh-google-provider-error", children: t('credentialError') }), status === 'conflict-error' && _jsx("p", { role: "alert", className: "dsh-google-provider-status dsh-google-provider-error", children: t('conflictError') })] })] }) });
}
