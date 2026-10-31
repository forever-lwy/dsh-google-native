import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from './provider-locales.js'
import {
  MAX_REQUEST_TIMEOUT_MS,
  type GoogleProviderConnection, type GoogleProviderModel, type GoogleProviderProfileView, type GoogleProviderSettings,
  type GoogleProviderDiscoverRequest, type GoogleProviderSaveRequest,
} from '../provider-remote.js'

export type ProviderConnection = GoogleProviderConnection
export type ProviderModel = GoogleProviderModel
export type ProviderProfile = GoogleProviderProfileView
export type ProviderSettingsSnapshot = GoogleProviderSettings
export interface ProviderSettingsFace {
  read: (signal: AbortSignal) => Promise<ProviderSettingsSnapshot>
  discover: (request: GoogleProviderDiscoverRequest, signal: AbortSignal) => Promise<{ models: ProviderModel[] }>
  save: (request: GoogleProviderSaveRequest, signal: AbortSignal) => Promise<ProviderSettingsSnapshot>
}
interface Draft {
  connection: ProviderConnection
  models: ProviderModel[]
  selected: string[]
  apiKey: string
  filter: string
  manual: string
  discovered: boolean
  timeoutSeconds: string
  timeoutBadInput: boolean
}
type Props = PropsRuntime<'settings.models.provider-card'> & PropsLocale<'googleProviderSettings'> & ProviderSettingsFace
type FormProps = Pick<Props, 'read' | 'discover' | 'save' | 'useRemoteAccess' | 't'> & {
  providerId: ProviderProfile['provider']
}

function initialDraft(profile: ProviderProfile): Draft {
  return { connection: { ...profile.connection }, models: profile.models.map(model => ({ ...model })),
    selected: profile.models.map(model => model.id), apiKey: '', filter: '', manual: '', discovered: false,
    timeoutSeconds: String((profile.connection.requestTimeoutMs ?? 0) / 1000), timeoutBadInput: false }
}

/** Decimal seconds preserve existing millisecond precision without floating-point rounding. */
function requestTimeoutMs(seconds: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(seconds.trim())
  if (!match) return undefined
  const milliseconds = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= MAX_REQUEST_TIMEOUT_MS ? milliseconds : undefined
}

function selectedModels(draft: Draft): ProviderModel[] {
  const selected = new Set(draft.selected)
  return draft.models.filter(model => selected.has(model.id)).map(({ id, name, contextWindow, maxTokens }) => ({
    id, ...(name ? { name } : {}), ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxTokens === undefined ? {} : { maxTokens }),
  }))
}

/** Each Models-page provider card owns one route's configuration form. */
export function ProviderSettings(props: Props) {
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
  const panelId = useId()
  const providerId = props.provider.provider
  if (providerId !== 'google-ai-studio' && providerId !== 'google-vertex-native') return null
  return <div className="dsh-google-provider-card" data-google-provider-card={providerId}>
    <button type="button" className="dsh-google-provider-button" aria-expanded={open} aria-controls={panelId}
      onClick={() => { setOpen(value => !value); setVisited(true) }}>{props.t(open ? 'closeConfiguration' : 'configure')}</button>
    <div id={panelId} hidden={!open} className="dsh-google-provider-card-panel">
      {visited && <ProviderSettingsPage key={providerId} {...props} providerId={providerId}/>}
    </div>
  </div>
}

export function ProviderSettingsPage({ read, discover, save, useRemoteAccess, t, providerId: provider }: FormProps) {
  const canRead = useRemoteAccess('nativeGoogleSettings/get')
  const canDiscover = useRemoteAccess('nativeGoogleSettings/discover')
  const canSave = useRemoteAccess('nativeGoogleSettings/save')
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot>()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loadError, setLoadError] = useState(false)
  const [status, setStatus] = useState<'idle' | 'discovering' | 'saving' | 'saved' | 'discover-error' | 'save-error' | 'credential-error' | 'conflict-error'>('idle')
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const operation = useRef<AbortController>()
  const baseId = useId()

  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    operation.current?.abort()
    setSnapshot(undefined)
    setDrafts({})
    setLoadError(false)
    setStatus('idle')
    if (canRead) void read(controller.signal).then(value => {
      if (controller.signal.aborted || current !== generation.current) return
      setSnapshot(value)
      setDrafts(Object.fromEntries(value.profiles.map(profile => [profile.provider, initialDraft(profile)])))
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) setLoadError(true) })
    return () => { controller.abort(); operation.current?.abort(); generation.current++ }
    // Each card addresses one route; an explicit reload discards its draft.
  }, [canRead, read, reload, provider])

  const profile = snapshot?.profiles.find(item => item.provider === provider)
  const draft = drafts[provider]
  const busy = status === 'saving' || status === 'discovering'
  const editable = canSave && snapshot?.writable === true && !busy
  const needsKey = provider === 'google-ai-studio' || draft?.connection.vertexAuth === 'api-key'
  const keyEditable = editable && profile?.credential.writable === true
  const savedIds = new Set(profile?.models.map(model => model.id) ?? [])
  const filter = draft?.filter.trim().toLocaleLowerCase() ?? ''
  const visible = draft?.models.filter(model => [model.id, model.name ?? '', model.description ?? ''].join(' ').toLocaleLowerCase().includes(filter)) ?? []
  const selected = new Set(draft?.selected ?? [])
  const timeoutMs = draft ? requestTimeoutMs(draft.timeoutSeconds) : undefined
  const validTimeout = timeoutMs !== undefined && draft?.timeoutBadInput === false
  const dirty = draft !== undefined && profile !== undefined && (draft.apiKey.trim().length > 0
    || !validTimeout || timeoutMs !== (profile.connection.requestTimeoutMs ?? 0)
    || JSON.stringify(draft.connection) !== JSON.stringify(profile.connection)
    || JSON.stringify([...draft.selected].sort()) !== JSON.stringify(profile.models.map(model => model.id).sort()))

  const patchDraft = (update: (old: Draft) => Draft) => {
    setDrafts(previous => previous[provider] ? { ...previous, [provider]: update(previous[provider]) } : previous)
    setStatus(old => old === 'saving' || old === 'discovering' ? old : 'idle')
  }
  const connection = <Key extends keyof ProviderConnection>(key: Key, value: ProviderConnection[Key]) => patchDraft(old => ({ ...old, connection: { ...old.connection, [key]: value } }))
  const select = (ids: string[], checked: boolean) => patchDraft(old => ({ ...old,
    selected: checked ? [...new Set([...old.selected, ...ids])] : old.selected.filter(id => !ids.includes(id)),
  }))

  const fetchModels = async () => {
    if (!draft || busy || !canDiscover || !validTimeout) return
    const current = ++generation.current
    const target = provider
    const controller = new AbortController()
    operation.current = controller
    setStatus('discovering')
    try {
      const value = await discover({ provider: target, connection: { ...draft.connection, requestTimeoutMs: timeoutMs }, ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) }, controller.signal)
      if (controller.signal.aborted || current !== generation.current) return
      setDrafts(previous => {
        const old = previous[target]
        if (!old) return previous
        // Saved or selected entries remain available even when a listing omits them.
        const models = new Map(old.models.filter(model => old.selected.includes(model.id) || savedIds.has(model.id)).map(model => [model.id, model]))
        for (const model of value.models) models.set(model.id, { ...model, ...models.get(model.id) })
        return { ...previous, [target]: { ...old, models: [...models.values()], discovered: true } }
      })
      setStatus('idle')
    } catch { if (!controller.signal.aborted && current === generation.current) setStatus('discover-error') }
    finally { if (operation.current === controller) operation.current = undefined }
  }

  const saveSettings = async () => {
    if (!draft || !snapshot || !editable || !dirty || !validTimeout) return
    const current = ++generation.current
    const target = provider
    const controller = new AbortController()
    operation.current = controller
    setStatus('saving')
    try {
      const value = await save({ provider: target, connection: { ...draft.connection, requestTimeoutMs: timeoutMs }, models: selectedModels(draft),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}), expectedRevision: snapshot.revision }, controller.signal)
      if (controller.signal.aborted || current !== generation.current) return
      setSnapshot(value)
      const accepted = value.profiles.find(item => item.provider === target)
      if (accepted) setDrafts(previous => ({ ...previous, [target]: initialDraft(accepted) }))
      setStatus('saved')
    } catch (error) {
      if (!controller.signal.aborted && current === generation.current) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        const recoverable = code === 'native-google/credential-save-failed' || code === 'native-google/settings-conflict'
        if (recoverable) {
          try {
            const fresh = await read(controller.signal)
            if (controller.signal.aborted || current !== generation.current) return
            // Keep the entered key and unsaved edits; only refresh their revision
            // and baseline, so a second explicit Save can safely retry.
            setSnapshot(fresh)
          } catch {
            const revision = typeof error === 'object' && error !== null && 'revision' in error ? error.revision : undefined
            if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) setSnapshot(old => old ? { ...old, revision } : old)
          }
          if (!controller.signal.aborted && current === generation.current) setStatus(code === 'native-google/credential-save-failed' ? 'credential-error' : 'conflict-error')
        } else setStatus('save-error')
      }
    }
    finally { if (operation.current === controller) operation.current = undefined }
  }

  if (!canRead) return <p>{t('noRead')}</p>
  if (loadError) return <div><p role="alert">{t('loadError')}</p><button type="button" className="dsh-google-provider-button" onClick={() => setReload(value => value + 1)}>{t('retry')}</button></div>
  if (!snapshot || !draft || !profile) return <p role="status">{t('loading')}</p>

  const field = (key: 'baseURL' | 'apiVersion' | 'project' | 'location' | 'keyFile' | 'apiKeyEnv', label: Parameters<typeof t>[0], hint?: Parameters<typeof t>[0], wide = false) => <label className={`dsh-google-provider-field${wide ? ' wide' : ''}`}>
    <span>{t(label)}</span>
    <input value={draft.connection[key] ?? ''} disabled={!editable} autoComplete="off" spellCheck={false}
      onChange={event => connection(key, key === 'apiKeyEnv' ? event.currentTarget.value : event.currentTarget.value || undefined)}
      type={key === 'baseURL' ? 'url' : 'text'} data-google-setting={key}/>
    {hint && <span className="dsh-google-provider-hint">{t(hint)}</span>}
  </label>

  return <div className="dsh-google-provider-settings" data-google-provider-settings>
    <div id={`${baseId}-panel`} role="region" aria-label={provider === 'google-ai-studio' ? t('aiStudio') : t('vertex')}>
      {(!canSave || !snapshot.writable) && <p className="dsh-google-provider-hint">{t('readOnly')}</p>}
      <label className="dsh-google-provider-check"><input type="checkbox" checked={draft.connection.enabled} disabled={!editable}
        onChange={event => connection('enabled', event.currentTarget.checked)}/><span>{t('enabled')}</span></label>
      <div className="dsh-google-provider-grid">
        {field('baseURL', 'baseURL', 'baseURLHint', true)}
        {field('apiVersion', 'apiVersion', 'apiVersionHint')}
        <label className="dsh-google-provider-field"><span>{t('requestTimeout')}</span>
          <input type="number" value={draft.timeoutSeconds} disabled={!editable} min="0" max={MAX_REQUEST_TIMEOUT_MS / 1000} step="0.001"
            aria-invalid={!validTimeout} aria-describedby={`${baseId}-timeout-hint${validTimeout ? '' : ` ${baseId}-timeout-error`}`}
            data-google-setting="requestTimeoutSeconds" onChange={event => {
              const timeoutSeconds = event.currentTarget.value
              const timeoutBadInput = event.currentTarget.validity.badInput
              patchDraft(old => ({ ...old, timeoutSeconds, timeoutBadInput }))
            }}/>
          <span id={`${baseId}-timeout-hint`} className="dsh-google-provider-hint">{t('requestTimeoutHint')}</span>
          {!validTimeout && <span id={`${baseId}-timeout-error`} role="alert" className="dsh-google-provider-hint dsh-google-provider-error">{t('requestTimeoutError')}</span>}
        </label>
        {provider === 'google-vertex-native' && <label className="dsh-google-provider-field"><span>{t('auth')}</span>
          <select value={draft.connection.vertexAuth} disabled={!editable} onChange={event => connection('vertexAuth', event.currentTarget.value as 'adc' | 'api-key')} data-google-setting="vertexAuth">
            <option value="adc">{t('adc')}</option><option value="api-key">{t('express')}</option>
          </select>
        </label>}
        {provider === 'google-vertex-native' && draft.connection.vertexAuth === 'adc' && <>
          {field('project', 'project')}{field('location', 'location')}{field('keyFile', 'keyFile', 'keyFileHint', true)}
        </>}
        {needsKey && <>
          {field('apiKeyEnv', 'keyRef', 'keyRefHint')}
          <label className="dsh-google-provider-field"><span>{t('apiKey')}</span>
            <input type="password" value={draft.apiKey} autoComplete="new-password" placeholder={t('apiKeyPlaceholder')} disabled={!keyEditable}
              onChange={event => { const apiKey = event.currentTarget.value; patchDraft(old => ({ ...old, apiKey })) }} data-google-setting="apiKey"/>
            <span className="dsh-google-provider-hint">{draft.connection.apiKeyEnv === profile.connection.apiKeyEnv && profile.credential.configured ? t('keyConfigured') : t('keyNotConfigured')}</span>
            {!profile.credential.writable && <span className="dsh-google-provider-hint">{t('credentialReadOnly')}</span>}
          </label>
        </>}
      </div>
      <div className="dsh-google-provider-discover"><button type="button" className="dsh-google-provider-button" disabled={busy || !canDiscover || !validTimeout} onClick={() => { void fetchModels() }}>
        {status === 'discovering' ? t('discovering') : t('discover')}
      </button><span className="dsh-google-provider-hint">{t('discoverHint')}</span></div>
      {status === 'discover-error' && <p role="alert" className="dsh-google-provider-status dsh-google-provider-error">{t('discoverError')}</p>}
      <section className="dsh-google-provider-model-section" aria-label={t('models')}>
        <div className="dsh-google-provider-model-heading"><h3>{t('models')}</h3><span className="dsh-google-provider-hint">{t('selectedCount')} {selected.size}</span></div>
        <input type="search" className="dsh-google-provider-filter" value={draft.filter} aria-label={t('search')} placeholder={t('search')}
          onChange={event => { const filter = event.currentTarget.value; patchDraft(old => ({ ...old, filter })) }}/>
        <div className="dsh-google-provider-actions">
          <button type="button" className="dsh-google-provider-button" disabled={!editable || !visible.length} onClick={() => select(visible.map(model => model.id), true)}>{t('selectAll')}</button>
          <button type="button" className="dsh-google-provider-button" disabled={!editable || !visible.length} onClick={() => select(visible.map(model => model.id), false)}>{t('clearShown')}</button>
        </div>
        <div className="dsh-google-provider-model-list">
          {visible.map(model => <label key={model.id} className="dsh-google-provider-model">
            <input type="checkbox" checked={selected.has(model.id)} disabled={!editable} data-google-model={model.id}
              onChange={event => select([model.id], event.currentTarget.checked)}/>
            <span className="dsh-google-provider-model-content"><span className="dsh-google-provider-model-name">{model.name ?? model.id}</span>
              {model.name && model.name !== model.id && <span className="dsh-google-provider-model-id">{model.id}</span>}
              {model.description && <span className="dsh-google-provider-model-id">{model.description}</span>}
            </span>
            {savedIds.has(model.id) && <span className="dsh-google-provider-model-badge">{t('savedModel')}</span>}
          </label>)}
          {!visible.length && <p className="dsh-google-provider-empty">{draft.models.length ? t('noMatches') : t('noModels')}</p>}
        </div>
        <div className="dsh-google-provider-manual">
          <input type="text" value={draft.manual} disabled={!editable} aria-label={t('manual')} placeholder={t('manualPlaceholder')} spellCheck={false}
            onChange={event => { const manual = event.currentTarget.value; patchDraft(old => ({ ...old, manual })) }}/>
          <button type="button" className="dsh-google-provider-button" disabled={!editable || !draft.manual.trim()} onClick={() => {
            const id = draft.manual.trim()
            patchDraft(old => ({ ...old, manual: '', filter: '',
              models: old.models.some(model => model.id === id) ? old.models : [...old.models, { id, name: id }],
              selected: [...new Set([...old.selected, id])],
            }))
          }}>{t('add')}</button>
        </div>
        <p className="dsh-google-provider-hint">{t('modelsHint')}</p>
      </section>
      <div className="dsh-google-provider-footer">
        <button type="button" className="dsh-google-provider-button dsh-google-provider-primary" disabled={!editable || !dirty || !validTimeout} onClick={() => { void saveSettings() }}>{status === 'saving' ? t('saving') : t('save')}</button>
        {dirty && <span className="dsh-google-provider-hint">{t('unsaved')}</span>}
        {(status === 'save-error' || status === 'credential-error' || status === 'conflict-error') && <button type="button" className="dsh-google-provider-button" onClick={() => setReload(value => value + 1)}>{t('retry')}</button>}
      </div>
      <div aria-live="polite">
        {status === 'saved' && <p role="status" className="dsh-google-provider-status">{t('saved')}</p>}
        {status === 'save-error' && <p role="alert" className="dsh-google-provider-status dsh-google-provider-error">{t('saveError')}</p>}
        {status === 'credential-error' && <p role="alert" className="dsh-google-provider-status dsh-google-provider-error">{t('credentialError')}</p>}
        {status === 'conflict-error' && <p role="alert" className="dsh-google-provider-status dsh-google-provider-error">{t('conflictError')}</p>}
      </div>
    </div>
  </div>
}
