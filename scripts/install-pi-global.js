#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resourcesDir = resolve(__dirname, '..', 'src', 'resources')
const labratRoot = join(os.homedir(), '.labrat')
const labratAgentDir = join(labratRoot, 'agent')

const copyDir = (name) => {
  const src = join(resourcesDir, name)
  const dest = join(labratAgentDir, name)
  if (!existsSync(src)) return false
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, force: true })
  return true
}

mkdirSync(labratAgentDir, { recursive: true })

const copied = []
if (copyDir('extensions')) copied.push('extensions')
if (copyDir('skills')) copied.push('skills')
if (copyDir('agents')) copied.push('agents')

const agentsMdSrc = join(resourcesDir, 'AGENTS.md')
if (existsSync(agentsMdSrc)) {
  writeFileSync(join(labratAgentDir, 'AGENTS.md'), readFileSync(agentsMdSrc))
  copied.push('AGENTS.md')
}

const workflowSrc = join(resourcesDir, 'GSD-WORKFLOW.md')
if (existsSync(workflowSrc)) {
  writeFileSync(join(labratRoot, 'GSD-WORKFLOW.md'), readFileSync(workflowSrc))
  copied.push('GSD-WORKFLOW.md')
}

process.stdout.write(
  `Installed labrat resources in ${labratRoot}\n` +
  `Copied: ${copied.join(', ')}\n` +
  `Extensions are now available under ${join(labratAgentDir, 'extensions')}\n`
)
