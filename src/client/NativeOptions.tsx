import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoogleCapabilityKey, ResolvedGoogleCapabilities } from '../capabilities.js'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.js'

export interface NativeRoute { provider: string; model: string }
export type NativeChoices = Record<GoogleCapabilityKey, boolean>
export interface NativeOptionsState extends NativeRoute {
  capabilities: ResolvedGoogleCapabilities
  choices: NativeChoices
  revision: number
}

export interface NativeOptionsFace {
  available: boolean
  directory: ObservableSnapshot<ModelDirectoryState>
  loadDirectory: () => void
  read: (route: NativeRoute, signal: AbortSignal) => Promise<NativeOptionsState>
  save: (route: NativeRoute, choices: NativeChoices, expectedRevision: number, signal: AbortSignal) => Promise<NativeOptionsState>
  beginSave: (reason: string) => () => void
}

const choices = ['nativeFiles', 'search', 'urlContext', 'codeExecution', 'maps'] as const
const toolKeys = ['search', 'urlContext', 'codeExecution', 'maps'] as const
const ownRoute = (route: NativeRoute | null | undefined) => route?.provider === 'google-ai-studio' || route?.provider === 'google-vertex-native'
const sameRoute = (a: NativeRoute | undefined, b: NativeRoute | undefined) => a?.provider === b?.provider && a?.model === b?.model

/** Selection changes suppress old controls synchronously, before async effects run. */
export function nativeOptionsVisible(route: NativeRoute | undefined, state: NativeOptionsState | undefined): boolean {
  return ownRoute(route) && state !== undefined && sameRoute(route, state) && choices.some(key => state.capabilities[key])
}

interface ViewState {
  route?: NativeRoute
  value?: NativeOptionsState
  error?: boolean
  saving?: boolean
}

type Props = PropsRuntime<'conversation.input.left'> & PropsLocale<'googleNative'> & NativeOptionsFace

export function NativeOptions({ available, directory, loadDirectory, read, save, beginSave, useSession, useAccess, t }: Props) {
  const models = useSyncExternalStore(directory.subscribe.bind(directory), directory.getSnapshot.bind(directory))
  const current = models.pending ?? models.current
  const route: NativeRoute | undefined = current ? { provider: current.provider, model: current.model } : undefined
  const unavailable = useSession(session => session.running || session.awaitingFirstTurn || session.pendingSubmissions.length > 0)
  const canRead = useAccess('nativeGoogleChat/get')
  const canWrite = useAccess('nativeGoogleChat/set')
  const [view, setView] = useState<ViewState>({})
  const [open, setOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const generation = useRef(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const cleanupSave = useRef<(() => void) | undefined>(undefined)
  const saveAbort = useRef<AbortController | undefined>(undefined)
  const id = useId()

  useEffect(() => { loadDirectory() }, [loadDirectory])
  useEffect(() => {
    const sequence = ++generation.current
    const controller = new AbortController()
    setOpen(false)
    setView({ route })
    saveAbort.current?.abort()
    cleanupSave.current?.()
    cleanupSave.current = undefined
    if (available && canRead && ownRoute(route)) {
      void read(route!, controller.signal).then(value => {
        if (generation.current === sequence && !controller.signal.aborted && sameRoute(route, value)) setView({ route, value })
      }).catch(() => {
        if (generation.current === sequence && !controller.signal.aborted) setView({ route, error: true })
      })
    }
    return () => {
      controller.abort()
      generation.current++
      saveAbort.current?.abort()
      cleanupSave.current?.()
      cleanupSave.current = undefined
    }
    // Route identity, not reasoning effort, owns native options.
  }, [available, canRead, current?.provider, current?.model, read, refresh])

  useEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current || !panel.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const rect = panel.current.getBoundingClientRect()
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - rect.width - 12))
      const above = anchor.top - rect.height - 8
      const top = above >= 12 ? above : Math.min(anchor.bottom + 8, Math.max(12, window.innerHeight - rect.height - 12))
      setPosition({ top, left })
    }
    const closeOutside = (event: PointerEvent) => {
      const node = event.target as Node
      if (!panel.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    const closeOnFocusLeave = (event: FocusEvent) => {
      const node = event.target as Node
      if (!panel.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false)
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', escape)
    document.addEventListener('focusin', closeOnFocusLeave)
    panel.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('focusin', closeOnFocusLeave)
    }
  }, [open])

  const state = sameRoute(route, view.route) ? view.value : undefined
  const failed = sameRoute(route, view.route) && view.error
  const visible = nativeOptionsVisible(route, state)
  if (!available || !canRead || (!visible && !(ownRoute(route) && failed))) return null
  const locked = !canWrite || unavailable || view.saving === true || models.status === 'selecting'
  const tools = state === undefined ? [] : toolKeys.filter(key => state.capabilities[key])
  const enabledTools = state !== undefined && toolKeys.some(key => state.capabilities[key] && state.choices[key])
  const nativeToolsOnly = state !== undefined && 'functionCallingWithNativeTools' in state.capabilities && state.capabilities.functionCallingWithNativeTools === false

  const update = async (key: GoogleCapabilityKey, checked: boolean) => {
    if (!state || !route || locked || !state.capabilities[key]) return
    const sequence = generation.current
    const target = { ...route }
    const controller = new AbortController()
    saveAbort.current = controller
    const release = beginSave(t('saving'))
    cleanupSave.current = release
    setView(previous => ({ ...previous, saving: true, error: false }))
    try {
      const value = await save(target, { ...state.choices, [key]: checked }, state.revision, controller.signal)
      if (generation.current === sequence && !controller.signal.aborted && sameRoute(target, value)) setView({ route: target, value })
    } catch {
      if (generation.current === sequence && !controller.signal.aborted) setView(previous => ({ ...previous, saving: false, error: true }))
    } finally {
      release()
      if (cleanupSave.current === release) cleanupSave.current = undefined
      if (saveAbort.current === controller) saveAbort.current = undefined
    }
  }

  return <>
    <button type="button" ref={trigger} className="dsh-google-native-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => { setPosition({ visibility: 'hidden' }); setOpen(value => !value) }}
      title={!canWrite ? t('readOnly') : locked ? t('busy') : t('dialogLabel')} data-google-native-control>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20" fill="none">
        <path d="m10 2 2.3 5.7L18 10l-5.7 2.3L10 18l-2.3-5.7L2 10l5.7-2.3L10 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
      <span>{t('title')}</span>
      {enabledTools && <span className="dsh-google-native-dot" aria-hidden="true"/>}
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={t('dialogLabel')}
      className="dsh-google-native-panel" style={position} data-google-native-panel>
      <div className="dsh-google-native-heading"><span>{t('dialogLabel')}</span>
        <button type="button" className="dsh-google-native-close" aria-label={t('close')} onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button>
      </div>
      <p className="dsh-google-native-caption">{t('scope')}</p>
      {state?.capabilities.nativeFiles && <label className="dsh-google-native-option">
        <input type="checkbox" checked={state.choices.nativeFiles} disabled={locked}
          onChange={event => { void update('nativeFiles', event.currentTarget.checked) }}/>
        <span>{t('nativeFiles')}<span className="dsh-google-native-help">{t('nativeFilesHint')}</span></span>
      </label>}
      {tools.length > 0 && <>
        {state?.capabilities.nativeFiles && <div className="dsh-google-native-divider"/>}
        <p className="dsh-google-native-section">{t('tools')}</p>
        {tools.map(key => <label className="dsh-google-native-option" key={key}>
          <input type="checkbox" checked={state!.choices[key]} disabled={locked}
            onChange={event => { void update(key, event.currentTarget.checked) }}/>
          <span>{t(key)}</span>
        </label>)}
        <p className="dsh-google-native-note">{t('toolsHint')}</p>
        {enabledTools && nativeToolsOnly && <p className="dsh-google-native-note">{t('localToolsHint')}</p>}
      </>}
      <div aria-live="polite">
        {view.saving && <p className="dsh-google-native-status">{t('saving')}</p>}
        {failed && <p role="alert" className="dsh-google-native-status dsh-google-native-error">{t('error')}
          <button type="button" className="dsh-google-native-retry" disabled={view.saving} onClick={() => setRefresh(value => value + 1)}>{t('retry')}</button>
        </p>}
      </div>
    </div>, document.body)}
  </>
}
