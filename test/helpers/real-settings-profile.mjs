import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import { ConfigEditor } from '@deepseek-ai/dsh-config-editor'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import * as plugin from '../../lib/index.js'

/** An ephemeral profile with real rc.5 Loader, Include, ConfigEditor and SettingsForms.
 * Only attachment bytes and the credential store are replaced. No running DSH
 * profile or inherited Google credentials can be reached through this fixture.
 */
export async function realSettingsProfile(t, { credentials = true, config = {}, patches: persistedPatches } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-google-settings-profile-'))
  const home = join(dir, 'home')
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  await mkdir(home)
  const patches = persistedPatches ?? [{ insert: [{ id: 'dsh-google-native', name: 'cordis:google-under-test', config }] }]
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
  await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify(patches))
  await writeFile(join(dir, 'root.yml'), '[]\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins['google-under-test'] = plugin
  ctx.provide('profileContext', {
    name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(dir, 'package.json'),
    cwd: dir, home, startedBundles: [], overlays: [],
  })
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
  new LlmRuntime(ctx)
  new TypertRegistry(ctx)
  ctx.provide('attachments', { fileHostPath: () => undefined })
  const values = new Map()
  const credentialWrites = []
  if (credentials) ctx.provide('credentials', {
    async describe(ref) { return { configured: values.has(ref), writable: true, ...(values.has(ref) ? { source: 'file' } : {}) } },
    async resolve(ref) { return values.has(ref) ? { value: values.get(ref), source: 'file' } : undefined },
    async set(ref, value) { values.set(ref, value); credentialWrites.push({ ref, value }) },
  })
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(SettingsForms)
  await mountRootInclude(ctx, join(dir, 'root.yml'), patches)
  await ctx.loader.await()
  return { ctx, dir, values, credentialWrites, plugin }
}
