#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resourcesDir = resolve(__dirname, '..', 'src', 'resources')
const nightshiftRoot = join(os.homedir(), '.nightshift')
const nightshiftAgentDir = join(nightshiftRoot, 'agent')

const copyDir = (name) => {
  const src = join(resourcesDir, name)
  const dest = join(nightshiftAgentDir, name)
  if (!existsSync(src)) return false
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, force: true })
  return true
}

mkdirSync(nightshiftAgentDir, { recursive: true })

const copied = []
if (copyDir('extensions')) copied.push('extensions')
if (copyDir('skills')) copied.push('skills')
if (copyDir('agents')) copied.push('agents')

const agentsMdSrc = join(resourcesDir, 'AGENTS.md')
if (existsSync(agentsMdSrc)) {
  writeFileSync(join(nightshiftAgentDir, 'AGENTS.md'), readFileSync(agentsMdSrc))
  copied.push('AGENTS.md')
}

const workflowSrc = join(resourcesDir, 'GSD-WORKFLOW.md')
if (existsSync(workflowSrc)) {
  writeFileSync(join(nightshiftRoot, 'GSD-WORKFLOW.md'), readFileSync(workflowSrc))
  copied.push('GSD-WORKFLOW.md')
}

process.stdout.write(
  `Installed nightshift resources in ${nightshiftRoot}\n` +
  `Copied: ${copied.join(', ')}\n` +
  `Extensions are now available under ${join(nightshiftAgentDir, 'extensions')}\n`
)
