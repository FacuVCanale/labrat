#!/usr/bin/env node
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { agentDir, appRoot } from './app-paths.js'
import { renderLogo } from './logo.js'

// pkg/ is a shim directory: contains gsd's piConfig (package.json) and pi's
// theme assets (dist/modes/interactive/theme/) without a src/ directory.
// This allows config.js to:
//   1. Read piConfig.name → "gsd" (branding)
//   2. Resolve themes via dist/ (no src/ present → uses dist path)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pkg')

// MUST be set before any dynamic import of pi SDK fires — this is what config.js
// reads to determine APP_NAME and CONFIG_DIR_NAME
process.env.PI_PACKAGE_DIR = pkgDir
process.env.PI_SKIP_VERSION_CHECK = '1'  // Labrat runs its own update check in cli.ts — suppress pi's
process.title = 'labrat'

// Print branded banner on first launch (before ~/.gsd/ exists)
if (!existsSync(appRoot)) {
  const cyan  = '\x1b[36m'
  const green = '\x1b[32m'
  const dim   = '\x1b[2m'
  const reset = '\x1b[0m'
  const colorCyan = (s: string) => `${cyan}${s}${reset}`
  let version = ''
  try {
    const pkgJson = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'))
    version = pkgJson.version ?? ''
  } catch { /* ignore */ }
  process.stderr.write(
    renderLogo(colorCyan) +
    '\n' +
    `  Labrat ${dim}v${version}${reset}\n` +
    `  ${green}Welcome.${reset} Setting up your environment...\n\n`
  )
}

// LABRAT_CODING_AGENT_DIR — tells pi's getAgentDir() to return ~/.labrat/agent/
process.env.LABRAT_CODING_AGENT_DIR = agentDir

// NODE_PATH — make gsd's own node_modules available to extensions loaded via jiti.
// Without this, extensions (e.g. browser-tools) can't resolve dependencies like
// `playwright` because jiti resolves modules from pi-coding-agent's location, not gsd's.
// Prepending gsd's node_modules to NODE_PATH fixes this for all extensions.
const labratRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const labratNodeModules = join(labratRoot, 'node_modules')
process.env.NODE_PATH = process.env.NODE_PATH
  ? `${labratNodeModules}:${process.env.NODE_PATH}`
  : labratNodeModules
// Force Node to re-evaluate module search paths with the updated NODE_PATH.
// Must happen synchronously before cli.js imports → extension loading.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Module } = await import('module');
(Module as any)._initPaths?.()

// LABRAT_VERSION — expose package version so extensions can display it
try {
  const labratPkg = JSON.parse(readFileSync(join(labratRoot, 'package.json'), 'utf-8'))
  process.env.LABRAT_VERSION = labratPkg.version || '0.0.0'
} catch {
  process.env.LABRAT_VERSION = '0.0.0'
}

// LABRAT_BIN_PATH — absolute path to this loader (dist/loader.js), used by patched subagent
// to spawn labrat instead of pi when dispatching workflow tasks
process.env.LABRAT_BIN_PATH = process.argv[1]

// LABRAT_WORKFLOW_PATH — absolute path to bundled GSD-WORKFLOW.md, used by patched gsd extension
// when dispatching workflow prompts (dist/loader.js → ../src/resources/GSD-WORKFLOW.md)
const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'resources')
process.env.LABRAT_WORKFLOW_PATH = join(resourcesDir, 'GSD-WORKFLOW.md')

// LABRAT_BUNDLED_EXTENSION_PATHS — colon-joined list of all bundled extension entry point absolute
// paths, used by patched subagent to pass --extension <path> to spawned labrat processes.
// IMPORTANT: paths point to agentDir (~/.labrat/agent/extensions/) NOT src/resources/extensions/.
// initResources() syncs bundled extensions to agentDir before any extension loading occurs,
// so these paths are always valid at runtime. Using agentDir paths matches what buildResourceLoader
// discovers (it scans agentDir), so pi's deduplication works correctly and extensions are not
// double-loaded in subagent child processes.
// Note: shared/ is NOT included — it's a library imported by gsd and ask-user-questions, not an entry point.
process.env.LABRAT_BUNDLED_EXTENSION_PATHS = [
  join(agentDir, 'extensions', 'gsd', 'index.ts'),
  join(agentDir, 'extensions', 'bg-shell', 'index.ts'),
  join(agentDir, 'extensions', 'browser-tools', 'index.ts'),
  join(agentDir, 'extensions', 'context7', 'index.ts'),
  join(agentDir, 'extensions', 'search-the-web', 'index.ts'),
  join(agentDir, 'extensions', 'slash-commands', 'index.ts'),
  join(agentDir, 'extensions', 'subagent', 'index.ts'),
  join(agentDir, 'extensions', 'mac-tools', 'index.ts'),
  join(agentDir, 'extensions', 'async-jobs', 'index.ts'),
  join(agentDir, 'extensions', 'ask-user-questions.ts'),
  join(agentDir, 'extensions', 'get-secrets-from-user.ts'),
].join(':')

// Respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars for all outbound requests.
// pi-coding-agent's cli.ts sets this, but GSD bypasses that entry point — so we
// must set it here before any SDK clients are created.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
setGlobalDispatcher(new EnvHttpProxyAgent())

// Dynamic import defers ESM evaluation — config.js will see PI_PACKAGE_DIR above
await import('./cli.js')
