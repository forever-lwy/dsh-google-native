import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerStyles } from '../lib/client/provider-styles.js'
import { NATIVE_ROW_ATTRIBUTE } from '../lib/client/ProviderSettings.js'

// A `:has()` in front of a combinator made Chromium restyle large parts of the
// page on every DOM insertion (measured on 0.2.2-rc.1: ~28 ms per style
// recalculation with the rule, ~13 ms without). The host row is marked by the
// card component instead.
test('the provider stylesheet keeps :has() off the parent side of a combinator', () => {
  const selectors = providerStyles.split('}').map(rule => rule.split('{')[0].trim()).filter(Boolean)
  for (const selector of selectors) {
    let flat = selector
    for (let previous = ''; previous !== flat;) { previous = flat; flat = flat.replace(/\([^()]*\)/g, '') }
    for (const part of flat.split(',')) assert.doesNotMatch(part, /:has[^\s>~+]*\s*[\s>~+]\s*\S/, selector)
  }
  assert.ok(providerStyles.includes(`[${NATIVE_ROW_ATTRIBUTE}]>.zGbnIq_editor{display:none}`))
})
