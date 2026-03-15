import { DefaultResourceLoader } from '@gsd/pi-coding-agent'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolves to the bundled src/resources/ inside the npm package at runtime:
//   dist/resource-loader.js → .. → package root → src/resources/
const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'resources')
const bundledExtensionsDir = join(resourcesDir, 'extensions')

function isExtensionFile(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.js')
}

function resolveExtensionEntries(dir: string): string[] {
  const packageJsonPath = join(dir, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const declared = pkg?.pi?.extensions
      if (Array.isArray(declared)) {
        const resolved = declared
          .filter((entry: unknown): entry is string => typeof entry === 'string')
          .map((entry: string) => resolve(dir, entry))
          .filter((entry: string) => existsSync(entry))
        if (resolved.length > 0) {
          return resolved
        }
      }
    } catch {
      // Ignore malformed manifests and fall back to index.ts/index.js discovery.
    }
  }

  const indexTs = join(dir, 'index.ts')
  if (existsSync(indexTs)) {
    return [indexTs]
  }

  const indexJs = join(dir, 'index.js')
  if (existsSync(indexJs)) {
    return [indexJs]
  }

  return []
}

export function discoverExtensionEntryPaths(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) {
    return []
  }

  const discovered: string[] = []
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    const entryPath = join(extensionsDir, entry.name)

    if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
      discovered.push(entryPath)
      continue
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      discovered.push(...resolveExtensionEntries(entryPath))
    }
  }

  return discovered
}

/**
 * Syncs all bundled resources to agentDir (~/.labrat/agent/) on every launch.
 *
 * - extensions/ → ~/.labrat/agent/extensions/   (always overwrite — ensures updates ship on next launch)
 * - agents/     → ~/.labrat/agent/agents/        (always overwrite)
 * - skills/     → ~/.labrat/agent/skills/        (always overwrite)
 * - AGENTS.md   → ~/.labrat/agent/AGENTS.md      (always overwrite)
 * - GSD-WORKFLOW.md is read directly from bundled path via LABRAT_WORKFLOW_PATH env var
 *
 * Always-overwrite ensures `npm update -g labrat` takes effect immediately.
 * User customizations should go in ~/.labrat/agent/extensions/ subdirs with unique names,
 * not by editing the labrat-managed files.
 *
 * Inspectable: `ls ~/.labrat/agent/extensions/`
 */
export function initResources(agentDir: string): void {
  const destExtensions = join(agentDir, 'extensions')
  const versionFile = join(destExtensions, '.labrat-version')
  const currentVersion = process.env.LABRAT_VERSION || ''

  // Skip sync if version matches — avoids expensive cpSync on every launch
  try {
    if (currentVersion && existsSync(versionFile) && readFileSync(versionFile, 'utf-8').trim() === currentVersion) {
      return
    }
  } catch { /* proceed with sync on any read error */ }

  mkdirSync(agentDir, { recursive: true })

  // Sync extensions — always overwrite so updates land on next launch
  cpSync(bundledExtensionsDir, destExtensions, { recursive: true, force: true })

  // Sync agents
  const destAgents = join(agentDir, 'agents')
  const srcAgents = join(resourcesDir, 'agents')
  if (existsSync(srcAgents)) {
    cpSync(srcAgents, destAgents, { recursive: true, force: true })
  }

  // Sync skills — always overwrite so updates land on next launch
  const destSkills = join(agentDir, 'skills')
  const srcSkills = join(resourcesDir, 'skills')
  if (existsSync(srcSkills)) {
    cpSync(srcSkills, destSkills, { recursive: true, force: true })
  }

  // Sync AGENTS.md
  const srcAgentsMd = join(resourcesDir, 'AGENTS.md')
  const destAgentsMd = join(agentDir, 'AGENTS.md')
  if (existsSync(srcAgentsMd)) {
    writeFileSync(destAgentsMd, readFileSync(srcAgentsMd))
  }

  // Write version marker after successful sync
  try {
    writeFileSync(versionFile, currentVersion, 'utf-8')
  } catch { /* non-fatal — sync still succeeded */ }
}

/**
 * Constructs a DefaultResourceLoader that loads extensions from ~/.labrat/agent/extensions/.
 * Labrat's extensions are fully independent from pi's ~/.pi/ directory.
 */
export function buildResourceLoader(agentDir: string): DefaultResourceLoader {
  return new DefaultResourceLoader({
    agentDir,
  })
}
