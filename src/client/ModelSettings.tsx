import { useId } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MAX_REQUEST_TIMEOUT_MS, modelAdvancedSchema,
  type GoogleProviderModel, type GoogleModelAdvanced, type GoogleModelReasoning,
} from '../provider-remote.js'
import type {} from './provider-locales.js'

type InputType = NonNullable<GoogleModelAdvanced['inputTypes']>[number]
type OutputType = NonNullable<GoogleModelAdvanced['responseModalities']>[number]
type Format = 'inherit' | 'budget' | 'level' | 'custom'
interface EffortDraft {
  id: string
  name: string
  format: 'default' | 'budget' | 'level'
  value: string
  includeThoughts?: boolean
}
export interface ModelSettingsDraft {
  name: string
  contextWindow: string
  maxTokens: string
  inputMode: 'inherit' | 'custom'
  inputTypes: InputType[]
  outputMode: 'inherit' | 'custom'
  responseModalities: OutputType[]
  timeoutSeconds: string
  includeThoughts: 'inherit' | 'on' | 'off'
  thinkingFormat: Format
  efforts: EffortDraft[]
  defaultReasoning: string
  fallbackFormat: 'inherit' | 'budget' | 'level'
  fallbackBudget: string
  fallbackLevel: string
  badInputs: string[]
}
type Translate = PropsLocale<'googleProviderSettings'>['t']

const inputTypes: InputType[] = ['text', 'image', 'audio', 'video', 'pdf']
const outputTypes: OutputType[] = ['TEXT', 'IMAGE', 'AUDIO']
const numberText = (value: number | null | undefined) => value == null ? '' : String(value)

export function initialModelSettings(model: GoogleProviderModel): ModelSettingsDraft {
  const advanced = model.advanced ?? {}
  const thinking = advanced.thinkingConfig ?? {}
  const efforts: EffortDraft[] = (advanced.reasoning ?? []).map(row => ({
    id: row.id, name: row.name,
    format: row.thinkingBudget !== undefined ? 'budget' : row.thinkingLevel !== undefined ? 'level' : 'default',
    value: row.thinkingBudget !== undefined ? String(row.thinkingBudget) : row.thinkingLevel ?? '',
    ...(row.includeThoughts === undefined ? {} : { includeThoughts: row.includeThoughts }),
  }))
  const formats = new Set(efforts.map(row => row.format))
  const fallbackFormat = thinking.thinkingBudget != null ? 'budget' : thinking.thinkingLevel != null ? 'level' : 'inherit'
  const thinkingFormat: Format = efforts.length ? formats.size === 1 && !formats.has('default')
    ? efforts[0].format as 'budget' | 'level' : 'custom' : fallbackFormat
  return {
    name: advanced.name === null ? '' : advanced.name ?? model.name ?? '',
    contextWindow: numberText(advanced.contextWindow === undefined ? model.contextWindow : advanced.contextWindow),
    maxTokens: numberText(advanced.maxTokens === undefined ? model.maxTokens : advanced.maxTokens),
    inputMode: advanced.inputTypes == null ? 'inherit' : 'custom',
    inputTypes: [...(advanced.inputTypes ?? inputTypes)],
    outputMode: advanced.responseModalities == null ? 'inherit' : 'custom',
    responseModalities: [...(advanced.responseModalities ?? ['TEXT'])],
    timeoutSeconds: advanced.requestTimeoutMs == null ? '' : String(advanced.requestTimeoutMs / 1000),
    includeThoughts: thinking.includeThoughts == null ? 'inherit' : thinking.includeThoughts ? 'on' : 'off',
    thinkingFormat, efforts, defaultReasoning: advanced.defaultReasoning ?? '', fallbackFormat,
    fallbackBudget: numberText(thinking.thinkingBudget), fallbackLevel: thinking.thinkingLevel ?? '', badInputs: [],
  }
}

function integer(text: string, minimum: number, empty: null | undefined = null): number | null | undefined {
  if (!text.trim()) return empty
  if (!/^-?\d+$/.test(text.trim())) return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined
}

function timeout(text: string): number | null | undefined {
  if (!text.trim()) return null
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim())
  if (!match) return undefined
  const value = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
  return Number.isSafeInteger(value) && value <= MAX_REQUEST_TIMEOUT_MS ? value : undefined
}

/** Validate the complete visible state before deriving its safe-field patch. */
export function parseModelSettings(draft: ModelSettingsDraft): GoogleModelAdvanced | undefined {
  if (draft.badInputs.length) return undefined
  const contextWindow = integer(draft.contextWindow, 1)
  const maxTokens = integer(draft.maxTokens, 1)
  const requestTimeoutMs = timeout(draft.timeoutSeconds)
  if (contextWindow === undefined || maxTokens === undefined || requestTimeoutMs === undefined) return undefined
  if (contextWindow !== null && maxTokens !== null && maxTokens >= contextWindow) return undefined
  const reasoning: GoogleModelReasoning[] = []
  for (const row of draft.thinkingFormat === 'inherit' ? [] : draft.efforts) {
    const format = draft.thinkingFormat === 'custom' ? row.format : draft.thinkingFormat
    const budget = format === 'budget' ? integer(row.value, -1, undefined) : undefined
    if (format === 'budget' && budget == null) return undefined
    reasoning.push({ id: row.id.trim(), name: row.name.trim(),
      ...(format === 'budget' ? { thinkingBudget: budget as number } : {}),
      ...(format === 'level' ? { thinkingLevel: row.value.trim() } : {}),
      ...(row.includeThoughts === undefined ? {} : { includeThoughts: row.includeThoughts }),
    })
  }
  const defaultReasoning = draft.thinkingFormat === 'inherit' ? null : draft.defaultReasoning.trim() || null
  if (defaultReasoning !== null && !reasoning.some(row => row.id === defaultReasoning)) return undefined
  const fallbackBudget = draft.fallbackFormat === 'budget' ? integer(draft.fallbackBudget, -1, undefined) : null
  if (draft.fallbackFormat === 'budget' && fallbackBudget == null) return undefined
  const advanced = {
    name: draft.name.trim() || null, contextWindow, maxTokens, requestTimeoutMs,
    inputTypes: draft.inputMode === 'inherit' ? null : inputTypes.filter(type => draft.inputTypes.includes(type)),
    responseModalities: draft.outputMode === 'inherit' ? null : outputTypes.filter(type => draft.responseModalities.includes(type)),
    reasoning: reasoning.length ? reasoning : null, defaultReasoning,
    thinkingConfig: {
      includeThoughts: draft.includeThoughts === 'inherit' ? null : draft.includeThoughts === 'on',
      thinkingBudget: fallbackBudget,
      thinkingLevel: draft.fallbackFormat === 'level' ? draft.fallbackLevel.trim() : null,
    },
  }
  const result = modelAdvancedSchema.safeParse(advanced)
  return result.success ? result.data : undefined
}

/** Preserve hidden or future native fields by sending only visible values the user changed. */
export function modelSettingsPatch(model: GoogleProviderModel, draft: ModelSettingsDraft): GoogleModelAdvanced | undefined {
  const value = parseModelSettings(draft)
  if (!value) return undefined
  const initial = initialModelSettings(model)
  const baseline = parseModelSettings(initial)
  const directlyChanged = {
    name: draft.name.trim() !== initial.name.trim(), contextWindow: draft.contextWindow.trim() !== initial.contextWindow.trim(),
    maxTokens: draft.maxTokens.trim() !== initial.maxTokens.trim(), requestTimeoutMs: draft.timeoutSeconds.trim() !== initial.timeoutSeconds.trim(),
    inputTypes: draft.inputMode !== initial.inputMode || JSON.stringify(draft.inputTypes) !== JSON.stringify(initial.inputTypes),
    responseModalities: draft.outputMode !== initial.outputMode || JSON.stringify(draft.responseModalities) !== JSON.stringify(initial.responseModalities),
    reasoning: draft.thinkingFormat !== initial.thinkingFormat || JSON.stringify(draft.efforts) !== JSON.stringify(initial.efforts),
    defaultReasoning: draft.defaultReasoning.trim() !== initial.defaultReasoning.trim(),
  }
  const patch: GoogleModelAdvanced = {}
  for (const key of ['name', 'contextWindow', 'maxTokens', 'inputTypes', 'responseModalities', 'requestTimeoutMs', 'reasoning', 'defaultReasoning'] as const) {
    if (baseline ? JSON.stringify(value[key]) !== JSON.stringify(baseline[key]) : directlyChanged[key]) Object.assign(patch, { [key]: value[key] })
  }
  const thinking: NonNullable<GoogleModelAdvanced['thinkingConfig']> = {}
  for (const key of ['includeThoughts', 'thinkingBudget', 'thinkingLevel'] as const) {
    const original = key === 'includeThoughts' ? initial.includeThoughts === 'inherit' ? null : initial.includeThoughts === 'on'
      : key === 'thinkingBudget' ? initial.fallbackFormat === 'budget' ? integer(initial.fallbackBudget, -1, undefined) : null
        : initial.fallbackFormat === 'level' ? initial.fallbackLevel.trim() : null
    if (value.thinkingConfig?.[key] !== (baseline ? baseline.thinkingConfig?.[key] : original)) Object.assign(thinking, { [key]: value.thinkingConfig?.[key] })
  }
  if (Object.keys(thinking).length) patch.thinkingConfig = thinking
  return patch
}

function presetEfforts(format: 'budget' | 'level'): EffortDraft[] {
  return format === 'budget'
    ? [{ id: 'dynamic', name: 'Dynamic', format, value: '-1' }, { id: 'low', name: 'Low', format, value: '1024' },
      { id: 'medium', name: 'Medium', format, value: '8192' }, { id: 'high', name: 'High', format, value: '24576' }]
    : [{ id: 'low', name: 'Low', format, value: 'LOW' }, { id: 'medium', name: 'Medium', format, value: 'MEDIUM' },
      { id: 'high', name: 'High', format, value: 'HIGH' }]
}

export function ModelSettings({ model, draft, disabled, t, onChange }: {
  model: GoogleProviderModel
  draft: ModelSettingsDraft
  disabled: boolean
  t: Translate
  onChange: (draft: ModelSettingsDraft) => void
}) {
  const id = useId()
  const valid = parseModelSettings(draft) !== undefined
  const patch = (next: Partial<ModelSettingsDraft>) => onChange({ ...draft, ...next })
  const numberField = (key: 'contextWindow' | 'maxTokens' | 'timeoutSeconds', label: Parameters<Translate>[0], hint: Parameters<Translate>[0]) => <label className="dsh-google-provider-field">
    <span>{t(label)}</span><input type="number" value={draft[key]} disabled={disabled}
      min={key === 'timeoutSeconds' ? '0' : '1'} max={key === 'timeoutSeconds' ? MAX_REQUEST_TIMEOUT_MS / 1000 : Number.MAX_SAFE_INTEGER}
      step={key === 'timeoutSeconds' ? '0.001' : '1'} data-google-model-setting={key} onChange={event => {
        const value = event.currentTarget.value
        const bad = event.currentTarget.validity.badInput
        patch({ [key]: value, badInputs: bad ? [...new Set([...draft.badInputs, key])] : draft.badInputs.filter(item => item !== key) })
      }}/><span className="dsh-google-provider-hint">{t(hint)}</span>
  </label>
  const format = (next: Format) => {
    if (next === 'inherit') return patch({ thinkingFormat: next, efforts: [], defaultReasoning: '', fallbackFormat: 'inherit', fallbackBudget: '', fallbackLevel: '' })
    const efforts = next === 'custom' ? draft.efforts : draft.efforts.length
      ? draft.efforts.map(row => ({ ...row, format: next,
        value: row.format === next ? row.value : next === 'budget' ? '-1' : 'LOW' })) : presetEfforts(next)
    patch({ thinkingFormat: next, efforts,
      ...(next !== 'custom' && draft.fallbackFormat !== 'inherit' && draft.fallbackFormat !== next ? {
        fallbackFormat: next, fallbackBudget: next === 'budget' ? '-1' : '', fallbackLevel: next === 'level' ? 'LOW' : '',
      } : {}),
    })
  }
  const row = (index: number, next: Partial<EffortDraft>) => patch({ efforts: draft.efforts.map((item, at) => at === index ? { ...item, ...next } : item),
    ...(next.id !== undefined && draft.defaultReasoning === draft.efforts[index].id ? { defaultReasoning: next.id } : {}),
  })

  return <div className="dsh-google-provider-model-advanced" data-google-model-advanced={model.id}>
    <p className="dsh-google-provider-hint">{t('advancedHint')}</p>
    <div className="dsh-google-provider-grid">
      <label className="dsh-google-provider-field wide"><span>{t('modelName')}</span><input value={draft.name} disabled={disabled} maxLength={1024}
        data-google-model-setting="name" onChange={event => patch({ name: event.currentTarget.value })}/></label>
      {numberField('contextWindow', 'contextWindow', 'contextWindowHint')}
      {numberField('maxTokens', 'maxTokens', 'maxTokensHint')}
      {numberField('timeoutSeconds', 'modelTimeout', 'modelTimeoutHint')}
    </div>
    <fieldset><legend>{t('inputTypes')}</legend>
      <label className="dsh-google-provider-field"><span className="dsh-google-provider-hint">{t('inputTypesHint')}</span>
        <select value={draft.inputMode} disabled={disabled} data-google-model-setting="inputMode" onChange={event => patch({ inputMode: event.currentTarget.value as ModelSettingsDraft['inputMode'] })}>
          <option value="inherit">{t('inherit')}</option><option value="custom">{t('custom')}</option>
        </select></label>
      {draft.inputMode === 'custom' && <div className="dsh-google-provider-model-types">{inputTypes.map(type => <label key={type}>
        <input type="checkbox" checked={draft.inputTypes.includes(type)} disabled={disabled || type === 'text'} data-google-model-input={type}
          onChange={event => patch({ inputTypes: event.currentTarget.checked ? [...draft.inputTypes, type] : draft.inputTypes.filter(item => item !== type) })}/>
        <span>{t(type === 'text' ? 'typeText' : type === 'image' ? 'typeImage' : type === 'audio' ? 'typeAudio' : type === 'video' ? 'typeVideo' : 'typePdf')}</span>
      </label>)}</div>}
    </fieldset>
    <fieldset><legend>{t('outputTypes')}</legend>
      <label className="dsh-google-provider-field"><span className="dsh-google-provider-hint">{t('outputTypesHint')}</span>
        <select value={draft.outputMode} disabled={disabled} data-google-model-setting="outputMode" onChange={event => patch({ outputMode: event.currentTarget.value as ModelSettingsDraft['outputMode'] })}>
          <option value="inherit">{t('inherit')}</option><option value="custom">{t('custom')}</option>
        </select></label>
      {draft.outputMode === 'custom' && <div className="dsh-google-provider-model-types">{outputTypes.map(type => <label key={type}>
        <input type="checkbox" checked={draft.responseModalities.includes(type)} disabled={disabled} data-google-model-output={type}
          onChange={event => patch({ responseModalities: event.currentTarget.checked ? [...draft.responseModalities, type] : draft.responseModalities.filter(item => item !== type) })}/>
        <span>{t(type === 'TEXT' ? 'typeText' : type === 'IMAGE' ? 'typeImage' : 'typeAudio')}</span>
      </label>)}</div>}
    </fieldset>
    <fieldset><legend>{t('thinkingSettings')}</legend><p className="dsh-google-provider-hint">{t('thinkingHint')}</p>
      <div className="dsh-google-provider-grid">
        <label className="dsh-google-provider-field"><span>{t('thinkingFormat')}</span>
          <select value={draft.thinkingFormat} disabled={disabled} data-google-model-setting="thinkingFormat" onChange={event => format(event.currentTarget.value as Format)}>
            <option value="inherit">{t('thinkingDefault')}</option><option value="budget">{t('thinkingBudget')}</option>
            <option value="level">{t('thinkingLevel')}</option><option value="custom">{t('thinkingCustom')}</option>
          </select></label>
        <label className="dsh-google-provider-field"><span>{t('includeThoughts')}</span>
          <select value={draft.includeThoughts} disabled={disabled} data-google-model-setting="includeThoughts" onChange={event => patch({ includeThoughts: event.currentTarget.value as ModelSettingsDraft['includeThoughts'] })}>
            <option value="inherit">{t('inherit')}</option><option value="on">{t('enabledOption')}</option><option value="off">{t('disabledOption')}</option>
          </select></label>
      </div>
      {draft.thinkingFormat !== 'inherit' && <>
        <div className="dsh-google-provider-model-reasoning">{draft.efforts.map((effort, index) => <div key={index} className="dsh-google-provider-model-effort" data-google-model-effort={index}>
          <label className="dsh-google-provider-field"><span>{t('effortId')}</span><input value={effort.id} disabled={disabled} maxLength={128} data-google-effort-field="id" onChange={event => row(index, { id: event.currentTarget.value })}/></label>
          <label className="dsh-google-provider-field"><span>{t('effortName')}</span><input value={effort.name} disabled={disabled} maxLength={512} data-google-effort-field="name" onChange={event => row(index, { name: event.currentTarget.value })}/></label>
          <label className="dsh-google-provider-field"><span>{t('effortValue')}</span>
            {draft.thinkingFormat === 'custom' && <select value={effort.format} disabled={disabled} data-google-effort-field="format" onChange={event => row(index, { format: event.currentTarget.value as EffortDraft['format'], value: '' })}>
              <option value="budget">thinkingBudget</option><option value="level">thinkingLevel</option><option value="default">{t('inherit')}</option>
            </select>}
            <input value={effort.value} disabled={disabled || (draft.thinkingFormat === 'custom' && effort.format === 'default')} data-google-effort-field="value"
              placeholder={draft.thinkingFormat === 'budget' || effort.format === 'budget' ? '-1' : 'LOW / MEDIUM / HIGH'} onChange={event => row(index, { value: event.currentTarget.value })}/>
          </label>
          <label className="dsh-google-provider-field"><span>{t('effortSummary')}</span>
            <select value={effort.includeThoughts === undefined ? 'inherit' : effort.includeThoughts ? 'on' : 'off'} disabled={disabled}
              data-google-effort-field="includeThoughts" onChange={event => row(index, { includeThoughts: event.currentTarget.value === 'inherit' ? undefined : event.currentTarget.value === 'on' })}>
              <option value="inherit">{t('effortSummaryInherit')}</option><option value="on">{t('enabledOption')}</option><option value="off">{t('disabledOption')}</option>
            </select>
          </label>
          <button type="button" className="dsh-google-provider-button" disabled={disabled} aria-label={`${t('removeEffort')} ${index + 1}`} onClick={() => patch({
            efforts: draft.efforts.filter((_item, at) => at !== index), defaultReasoning: draft.defaultReasoning === effort.id ? '' : draft.defaultReasoning,
          })}>{t('removeEffort')}</button>
        </div>)}</div>
        <div className="dsh-google-provider-actions"><button type="button" className="dsh-google-provider-button" disabled={disabled || draft.efforts.length >= 64} onClick={() => patch({
          efforts: [...draft.efforts, { id: '', name: '', format: draft.thinkingFormat === 'level' ? 'level' : 'budget', value: draft.thinkingFormat === 'level' ? 'LOW' : '-1' }],
        })}>{t('addEffort')}</button></div>
        <div className="dsh-google-provider-grid">
          <label className="dsh-google-provider-field"><span>{t('defaultEffort')}</span><select value={draft.defaultReasoning} disabled={disabled} data-google-model-setting="defaultReasoning" onChange={event => patch({ defaultReasoning: event.currentTarget.value })}>
            <option value="">{t('thinkingDefault')}</option>{draft.efforts.filter(effort => effort.id.trim()).map((effort, index) => <option key={index} value={effort.id}>{effort.name || effort.id}</option>)}
          </select></label>
          <label className="dsh-google-provider-field"><span>{t('fallbackThinking')}</span><select value={draft.fallbackFormat} disabled={disabled} data-google-model-setting="fallbackFormat" onChange={event => patch({ fallbackFormat: event.currentTarget.value as ModelSettingsDraft['fallbackFormat'] })}>
            <option value="inherit">{t('inherit')}</option><option value="budget">thinkingBudget</option><option value="level">thinkingLevel</option>
          </select></label>
          {draft.fallbackFormat !== 'inherit' && <label className="dsh-google-provider-field"><span>{t('fallbackValue')}</span><input value={draft.fallbackFormat === 'budget' ? draft.fallbackBudget : draft.fallbackLevel} disabled={disabled} data-google-model-setting="fallbackValue" onChange={event => patch(draft.fallbackFormat === 'budget' ? { fallbackBudget: event.currentTarget.value } : { fallbackLevel: event.currentTarget.value })}/></label>}
        </div><p className="dsh-google-provider-hint">{t('fallbackThinkingHint')}</p>
      </>}
    </fieldset>
    {!valid && <p id={`${id}-error`} role="alert" className="dsh-google-provider-model-summary-error">{t('modelSettingsError')}</p>}
  </div>
}
