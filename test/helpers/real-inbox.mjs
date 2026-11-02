import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

// rc.5 does not export its Inbox class. Evaluate the unchanged published Inbox
// region in memory, so tests exercise the real splice/claim/discard semantics
// without copying a replacement implementation or editing an installed package.
const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-agent-loop')), 'utf8')
const start = source.indexOf('//#region lib/types/inbox.js')
const end = source.indexOf('//#endregion', start)
assert.ok(start >= 0 && end > start, 'published rc.5 Inbox region must remain available')
export const { ReactLoopInbox, inboxProjectionDefinition } = new Function('z$1',
  `${source.slice(start, end)}\nreturn {ReactLoopInbox,inboxProjectionDefinition}`)(z)
