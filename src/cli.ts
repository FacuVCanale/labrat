import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  createAgentSession,
  InteractiveMode,
  runPrintMode,
  runRpcMode,
} from '@gsd/pi-coding-agent'
import { existsSync, readdirSync, renameSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentDir, sessionsDir, authFilePath } from './app-paths.js'
import { initResources, buildResourceLoader } from './resource-loader.js'
import { ensureManagedTools } from './tool-bootstrap.js'
import { loadStoredEnvKeys } from './wizard.js'
import { getPiDefaultModelAndProvider, migratePiCredentials } from './pi-migration.js'
import { shouldRunOnboarding, runOnboarding } from './onboarding.js'
import { checkForUpdates } from './update-check.js'

// ---------------------------------------------------------------------------
// Minimal CLI arg parser — detects print/subagent mode flags
// ---------------------------------------------------------------------------
interface CliFlags {
  mode?: 'text' | 'json' | 'rpc'
  print?: boolean
  continue?: boolean
  noSession?: boolean
  model?: string
  extensions: string[]
  appendSystemPrompt?: string
  tools?: string[]
  messages: string[]
  // Research campaign flags (for `start` subcommand)
  targets: string[]
  eval?: string
  metrics: string[]
  maxExperiments: number
  budgetPerExperiment: number
  researchQuestion?: string
  // Sync flags (for `sync` subcommand)
  noFetch?: boolean
  includeEvaluated?: boolean
  applyHash?: string
}

function parseCliArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { extensions: [], messages: [], targets: [], metrics: [], maxExperiments: 20, budgetPerExperiment: 1.0 }
  const args = argv.slice(2) // skip node + script
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--mode' && i + 1 < args.length) {
      const m = args[++i]
      if (m === 'text' || m === 'json' || m === 'rpc') flags.mode = m
    } else if (arg === '--print' || arg === '-p') {
      flags.print = true
    } else if (arg === '--continue' || arg === '-c') {
      flags.continue = true
    } else if (arg === '--no-session') {
      flags.noSession = true
    } else if (arg === '--model' && i + 1 < args.length) {
      flags.model = args[++i]
    } else if (arg === '--extension' && i + 1 < args.length) {
      flags.extensions.push(args[++i])
    } else if (arg === '--append-system-prompt' && i + 1 < args.length) {
      flags.appendSystemPrompt = args[++i]
    } else if (arg === '--tools' && i + 1 < args.length) {
      flags.tools = args[++i].split(',')
    } else if (arg === '--target' && i + 1 < args.length) {
      flags.targets.push(args[++i])
    } else if (arg === '--eval' && i + 1 < args.length) {
      flags.eval = args[++i]
    } else if (arg === '--metric' && i + 1 < args.length) {
      flags.metrics.push(args[++i])
    } else if (arg === '--max-experiments' && i + 1 < args.length) {
      flags.maxExperiments = parseInt(args[++i], 10) || 20
    } else if (arg === '--budget-per-experiment' && i + 1 < args.length) {
      flags.budgetPerExperiment = parseFloat(args[++i]) || 1.0
    } else if (arg === '--research-question' && i + 1 < args.length) {
      flags.researchQuestion = args[++i]
    } else if (arg === '--no-fetch') {
      flags.noFetch = true
    } else if (arg === '--include-evaluated') {
      flags.includeEvaluated = true
    } else if (arg === '--apply' && i + 1 < args.length) {
      flags.applyHash = args[++i]
    } else if (arg === '--version' || arg === '-v') {
      process.stdout.write((process.env.LABRAT_VERSION || '0.0.0') + '\n')
      process.exit(0)
    } else if (arg === '--help' || arg === '-h') {
      // Defer help to subcommand handler if `start` or `sync` is the first positional arg
      if (flags.messages[0] === 'start' || args.some((a, idx) => a === 'start' && idx < i) ||
          flags.messages[0] === 'sync' || args.some((a, idx) => a === 'sync' && idx < i)) {
        // Will be handled by the subcommand
        flags.messages.push('--help')
      } else {
      process.stdout.write(`Labrat v${process.env.LABRAT_VERSION || '0.0.0'}\n\n`)
      process.stdout.write('Usage: labrat [options] [message...]\n\n')
      process.stdout.write('Options:\n')
      process.stdout.write('  --mode <text|json|rpc>   Output mode (default: interactive)\n')
      process.stdout.write('  --print, -p              Single-shot print mode\n')
      process.stdout.write('  --continue, -c           Resume the most recent session\n')
      process.stdout.write('  --model <id>             Override model (e.g. claude-opus-4-6)\n')
      process.stdout.write('  --no-session             Disable session persistence\n')
      process.stdout.write('  --extension <path>       Load additional extension\n')
      process.stdout.write('  --tools <a,b,c>          Restrict available tools\n')
      process.stdout.write('  --version, -v            Print version and exit\n')
      process.stdout.write('  --help, -h               Print this help and exit\n')
      process.stdout.write('\nSubcommands:\n')
      process.stdout.write('  config                   Re-run the setup wizard\n')
      process.stdout.write('  update                   Update Labrat to the latest version\n')
      process.stdout.write('  report                   Print campaign morning report to stdout\n')
      process.stdout.write('  sync                     Show categorized upstream changes since fork\n')
      process.stdout.write('  start                    Bootstrap a research campaign and launch interactive mode\n')
      process.stdout.write('\nStart flags:\n')
      process.stdout.write('  --target <path>          Target file(s) to optimize (required, repeatable)\n')
      process.stdout.write('  --eval <command>         Evaluation command (required)\n')
      process.stdout.write('  --metric <name:dir:wt>   Metric definition name:min|max:weight (required, repeatable)\n')
      process.stdout.write('  --max-experiments <N>    Maximum experiments (default: 20)\n')
      process.stdout.write('  --budget-per-experiment <USD>  Budget per experiment in USD (default: 1.0)\n')
      process.stdout.write('  --research-question <text>     Research question (optional)\n')
      process.exit(0)
      }
    } else if (!arg.startsWith('--') && !arg.startsWith('-')) {
      flags.messages.push(arg)
    }
  }
  return flags
}

const cliFlags = parseCliArgs(process.argv)
const isPrintMode = cliFlags.print || cliFlags.mode !== undefined

// `gsd config` — replay the setup wizard and exit
if (cliFlags.messages[0] === 'config') {
  const authStorage = AuthStorage.create(authFilePath)
  await runOnboarding(authStorage)
  process.exit(0)
}

// `gsd update` — update to the latest version via npm
if (cliFlags.messages[0] === 'update') {
  const { runUpdate } = await import('./update-cmd.js')
  await runUpdate()
  process.exit(0)
}

// `labrat report` — print morning report to stdout and exit
if (cliFlags.messages[0] === 'report') {
  const { findActiveCampaignDir, generateMorningReport } = await import('./resources/extensions/gsd/morning-report.js')
  const { parseCampaignConfig } = await import('./resources/extensions/gsd/state.js')
  const { readAllExperiments } = await import('./resources/extensions/gsd/eval-runner.js')
  const { createMLOpsClient } = await import('./resources/extensions/gsd/mlops-integration.js')

  const campaignDir = findActiveCampaignDir(process.cwd())
  if (!campaignDir) {
    process.stdout.write('No active campaign found.\n')
    process.exit(0)
  }

  const campaign = parseCampaignConfig(campaignDir)
  if (!campaign) {
    process.stdout.write('No active campaign found.\n')
    process.exit(0)
  }

  const experiments = readAllExperiments(campaignDir)

  // Read metrics ledger from .gsd/metrics.json
  let ledgerUnits: import('./resources/extensions/gsd/metrics.js').UnitMetrics[] | null = null
  const metricsPath = join(process.cwd(), '.gsd', 'metrics.json')
  if (existsSync(metricsPath)) {
    try {
      const raw = readFileSync(metricsPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.units)) {
        ledgerUnits = parsed.units
      }
    } catch {
      // Non-fatal — report without cost data
    }
  }

  const dashboardUrl = createMLOpsClient(campaign.mlops)?.getDashboardUrl() ?? null
  const useColor = !!(process.stdout.isTTY && !process.env.NO_COLOR)

  const report = generateMorningReport({
    experiments,
    campaign,
    ledgerUnits,
    dashboardUrl,
    useColor,
  })

  process.stdout.write(report + '\n')
  process.exit(0)
}

// `labrat sync` — show categorized upstream changes and exit
if (cliFlags.messages[0] === 'sync') {
  // Show sync-specific help
  if (cliFlags.messages.includes('--help') || cliFlags.messages.includes('-h') ||
      process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`Labrat v${process.env.LABRAT_VERSION || '0.0.0'} — sync\n\n`)
    process.stdout.write('Usage: labrat sync [options]\n\n')
    process.stdout.write('Show categorized upstream (GSD-2) changes since fork point.\n\n')
    process.stdout.write('Options:\n')
    process.stdout.write('  --no-fetch               Skip `git fetch upstream` (use cached refs)\n')
    process.stdout.write('  --include-evaluated       Re-show already-evaluated commits\n')
    process.stdout.write('  --apply <hash>            Cherry-pick a specific upstream commit and verify build+tests\n')
    process.stdout.write('  --help, -h               Print this help and exit\n')
    process.exit(0)
  }

  // --apply <hash>: cherry-pick a specific upstream commit
  if (cliFlags.applyHash) {
    const { applyUpstreamCommit } = await import('./resources/extensions/gsd/upstream-sync.js')
    const basePath = process.cwd()
    const result = applyUpstreamCommit(basePath, cliFlags.applyHash)

    if (result.success) {
      process.stdout.write(`✓ Applied upstream commit ${cliFlags.applyHash}\n`)
      if (result.verifyResult) {
        process.stdout.write(`  Build: ${result.verifyResult.buildPassed ? 'passed' : 'FAILED'}\n`)
        process.stdout.write(`  Tests: ${result.verifyResult.testsPassed ? 'passed' : 'FAILED'}\n`)
      }
    } else if (result.conflicted && result.conflictContext) {
      process.stderr.write(`✗ Conflict applying ${cliFlags.applyHash}: ${result.conflictContext.subject}\n`)
      process.stderr.write(`  Conflicting files:\n`)
      for (const f of result.conflictContext.conflictingFiles) {
        process.stderr.write(`    - ${f.path}\n`)
      }
      process.stderr.write(`  Cherry-pick aborted — repo is clean.\n`)
    } else {
      process.stderr.write(`✗ Failed to apply ${cliFlags.applyHash}: ${result.error || 'unknown error'}\n`)
      if (result.verifyResult) {
        process.stderr.write(`  Build: ${result.verifyResult.buildPassed ? 'passed' : 'FAILED'}\n`)
        process.stderr.write(`  Tests: ${result.verifyResult.testsPassed ? 'passed' : 'FAILED'}\n`)
      }
    }

    process.exit(result.success ? 0 : 1)
  }

  const {
    fetchUpstreamCommits,
    readSyncState,
    writeSyncState,
    filterNewCommits,
    getConflictFiles,
    generateSyncReport,
  } = await import('./resources/extensions/gsd/upstream-sync.js')

  const basePath = process.cwd()

  // Optionally fetch upstream refs first
  if (!cliFlags.noFetch) {
    try {
      const { execSync } = await import('node:child_process')
      execSync('git fetch upstream', { cwd: basePath, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      process.stderr.write(`[labrat sync] Warning: git fetch upstream failed — using cached refs\n`)
    }
  }

  // Read persisted sync state
  const state = readSyncState(basePath)

  // Fetch all upstream commits
  const allCommits = fetchUpstreamCommits(basePath)

  // Annotate conflict files
  for (const commit of allCommits) {
    commit.conflictFiles = getConflictFiles(basePath, commit.filesChanged)
  }

  // Filter to new commits only (unless --include-evaluated)
  const commits = cliFlags.includeEvaluated ? allCommits : filterNewCommits(allCommits, state)

  // Generate and print report
  const useColor = !!(process.stdout.isTTY && !process.env.NO_COLOR)
  const report = generateSyncReport(commits, { useColor })
  process.stdout.write(report + '\n')

  // Persist: mark all fetched commits as evaluated
  if (allCommits.length > 0) {
    const newHashes = allCommits.map(c => c.hash)
    const existingSet = new Set(state.evaluatedCommits)
    for (const h of newHashes) existingSet.add(h)
    state.evaluatedCommits = [...existingSet]
    state.lastFetchedUpstream = allCommits[0]!.hash
    writeSyncState(basePath, state)
  }

  process.exit(0)
}

// `labrat start` — bootstrap research campaign and fall through to interactive mode
if (cliFlags.messages[0] === 'start') {
  // Show start-specific help
  if (cliFlags.messages.includes('--help') || cliFlags.messages.includes('-h') ||
      process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`Labrat v${process.env.LABRAT_VERSION || '0.0.0'} — start\n\n`)
    process.stdout.write('Usage: labrat start --target <path> --eval <command> --metric <name:dir:weight> [options]\n\n')
    process.stdout.write('Required flags:\n')
    process.stdout.write('  --target <path>          Target file(s) to optimize (repeatable)\n')
    process.stdout.write('  --eval <command>          Evaluation command\n')
    process.stdout.write('  --metric <name:dir:wt>    Metric definition name:min|max:weight (repeatable)\n')
    process.stdout.write('\nOptional flags:\n')
    process.stdout.write('  --max-experiments <N>     Maximum experiments (default: 20)\n')
    process.stdout.write('  --budget-per-experiment <USD>  Budget per experiment in USD (default: 1.0)\n')
    process.stdout.write('  --research-question <text>     Research question\n')
    process.exit(0)
  }

  // Validate required flags
  const missingFlags: string[] = []
  if (cliFlags.targets.length === 0) missingFlags.push('--target')
  if (!cliFlags.eval) missingFlags.push('--eval')
  if (cliFlags.metrics.length === 0) missingFlags.push('--metric')

  if (missingFlags.length > 0) {
    process.stderr.write(`[labrat] Error: Missing required flag(s): ${missingFlags.join(', ')}\n`)
    process.stderr.write('[labrat] Usage: labrat start --target <path> --eval <command> --metric <name:dir:weight>\n')
    process.stderr.write('[labrat] Run "labrat start --help" for details.\n')
    process.exit(1)
  }

  // Parse metric definitions from "name:direction:weight" format
  const metricDefs: Array<{ name: string; direction: 'min' | 'max'; weight: number }> = []
  for (const m of cliFlags.metrics) {
    const parts = m.split(':')
    if (parts.length !== 3) {
      process.stderr.write(`[labrat] Error: Invalid metric format "${m}". Expected name:min|max:weight\n`)
      process.exit(1)
    }
    const [name, dir, wt] = parts
    if (dir !== 'min' && dir !== 'max') {
      process.stderr.write(`[labrat] Error: Invalid metric direction "${dir}" in "${m}". Must be "min" or "max".\n`)
      process.exit(1)
    }
    const weight = parseFloat(wt)
    if (isNaN(weight) || weight <= 0) {
      process.stderr.write(`[labrat] Error: Invalid metric weight "${wt}" in "${m}". Must be a positive number.\n`)
      process.exit(1)
    }
    metricDefs.push({ name, direction: dir, weight })
  }

  // Build CAMPAIGN.json
  const campaignConfig = {
    name: cliFlags.researchQuestion
      ? cliFlags.researchQuestion.slice(0, 60)
      : `Research campaign — ${new Date().toISOString().slice(0, 10)}`,
    researchQuestion: cliFlags.researchQuestion,
    targetFiles: cliFlags.targets,
    evalConfig: {
      command: cliFlags.eval!,
      timeout: 120,
      metrics: metricDefs,
      runs: 1,
    },
    maxExperiments: cliFlags.maxExperiments,
    budgetPerExperiment: cliFlags.budgetPerExperiment,
  }

  // Create GSD scaffold (idempotent — only write files that don't exist)
  const gsdDir = join(process.cwd(), '.gsd')
  const milestoneDir = join(gsdDir, 'milestones', 'M001')
  const sliceDir = join(milestoneDir, 'slices', 'S01')

  mkdirSync(sliceDir, { recursive: true })

  const roadmapPath = join(milestoneDir, 'M001-ROADMAP.md')
  if (!existsSync(roadmapPath)) {
    writeFileSync(roadmapPath, [
      '# M001 Roadmap',
      '',
      '## Slices',
      '',
      '- [ ] S01 — Research campaign',
      '',
    ].join('\n'))
  }

  const planPath = join(sliceDir, 'S01-PLAN.md')
  if (!existsSync(planPath)) {
    writeFileSync(planPath, [
      '---',
      'status: in_progress',
      '---',
      '',
      '# S01 — Research Campaign',
      '',
      `**Goal:** ${cliFlags.researchQuestion || 'Optimize target files via automated experimentation.'}`,
      '',
      '## Tasks',
      '',
      '- [ ] T01 — Run experiments',
      '',
    ].join('\n'))
  }

  const campaignPath = join(sliceDir, 'CAMPAIGN.json')
  if (!existsSync(campaignPath)) {
    writeFileSync(campaignPath, JSON.stringify(campaignConfig, null, 2) + '\n')
  }

  // Set auto-start env var — session_start hook will pick this up
  process.env.LABRAT_AUTO_START = '1'
  // Fall through to interactive mode (no process.exit)
}

// Pi's tool bootstrap can mis-detect already-installed fd/rg on some systems
// because spawnSync(..., ["--version"]) returns EPERM despite a zero exit code.
// Provision local managed binaries first so Pi sees them without probing PATH.
ensureManagedTools(join(agentDir, 'bin'))

const authStorage = AuthStorage.create(authFilePath)
loadStoredEnvKeys(authStorage)
migratePiCredentials(authStorage)

// Run onboarding wizard on first launch (no LLM provider configured)
if (!isPrintMode && shouldRunOnboarding(authStorage)) {
  await runOnboarding(authStorage)
}

// Non-blocking update check — runs at most once per 24h, fire-and-forget
if (!isPrintMode) {
  checkForUpdates().catch(() => {})
}

const modelRegistry = new ModelRegistry(authStorage)
const settingsManager = SettingsManager.create(agentDir)

// Validate configured model on startup — catches stale settings from prior installs
// (e.g. grok-2 which no longer exists) and fresh installs with no settings.
// Only resets the default when the configured model no longer exists in the registry;
// never overwrites a valid user choice.
const configuredProvider = settingsManager.getDefaultProvider()
const configuredModel = settingsManager.getDefaultModel()
const allModels = modelRegistry.getAll()
const availableModels = modelRegistry.getAvailable()
const configuredExists = configuredProvider && configuredModel &&
  allModels.some((m) => m.provider === configuredProvider && m.id === configuredModel)
const configuredAvailable = configuredProvider && configuredModel &&
  availableModels.some((m) => m.provider === configuredProvider && m.id === configuredModel)

if (!configuredModel || !configuredExists || !configuredAvailable) {
  const piDefault = getPiDefaultModelAndProvider()
  const preferred =
    (piDefault
      ? availableModels.find((m) => m.provider === piDefault.provider && m.id === piDefault.model)
      : undefined) ||
    availableModels.find((m) => m.provider === 'openai' && m.id === 'gpt-5.4') ||
    availableModels.find((m) => m.provider === 'openai') ||
    availableModels.find((m) => m.provider === 'anthropic' && m.id === 'claude-opus-4-6') ||
    availableModels.find((m) => m.provider === 'anthropic' && m.id.includes('opus')) ||
    availableModels.find((m) => m.provider === 'anthropic') ||
    availableModels[0]
  if (preferred) {
    settingsManager.setDefaultModelAndProvider(preferred.provider, preferred.id)
  }
}

if (settingsManager.getDefaultThinkingLevel() !== 'off' && (!configuredExists || !configuredAvailable)) {
  settingsManager.setDefaultThinkingLevel('off')
}

// GSD always uses quiet startup — the gsd extension renders its own branded header
if (!settingsManager.getQuietStartup()) {
  settingsManager.setQuietStartup(true)
}

// Collapse changelog by default — avoid wall of text on updates
if (!settingsManager.getCollapseChangelog()) {
  settingsManager.setCollapseChangelog(true)
}

// ---------------------------------------------------------------------------
// Print / subagent mode — single-shot execution, no TTY required
// ---------------------------------------------------------------------------
if (isPrintMode) {
  const sessionManager = cliFlags.noSession
    ? SessionManager.inMemory()
    : SessionManager.create(process.cwd())

  // Read --append-system-prompt file content (subagent writes agent system prompts to temp files)
  let appendSystemPrompt: string | undefined
  if (cliFlags.appendSystemPrompt) {
    try {
      appendSystemPrompt = readFileSync(cliFlags.appendSystemPrompt, 'utf-8')
    } catch {
      // If it's not a file path, treat it as literal text
      appendSystemPrompt = cliFlags.appendSystemPrompt
    }
  }

  initResources(agentDir)
  const resourceLoader = new DefaultResourceLoader({
    agentDir,
    additionalExtensionPaths: cliFlags.extensions.length > 0 ? cliFlags.extensions : undefined,
    appendSystemPrompt,
  })
  await resourceLoader.reload()

  const { session, extensionsResult } = await createAgentSession({
    authStorage,
    modelRegistry,
    settingsManager,
    sessionManager,
    resourceLoader,
  })

  if (extensionsResult.errors.length > 0) {
    for (const err of extensionsResult.errors) {
      process.stderr.write(`[labrat] Extension load error: ${err.error}\n`)
    }
  }

  // Apply --model override if specified
  if (cliFlags.model) {
    const available = modelRegistry.getAvailable()
    const match =
      available.find((m) => m.id === cliFlags.model) ||
      available.find((m) => `${m.provider}/${m.id}` === cliFlags.model)
    if (match) {
      session.setModel(match)
    }
  }

  const mode = cliFlags.mode || 'text'

  if (mode === 'rpc') {
    await runRpcMode(session)
    process.exit(0)
  }

  await runPrintMode(session, {
    mode,
    messages: cliFlags.messages,
  })
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Interactive mode — normal TTY session
// ---------------------------------------------------------------------------

// Per-directory session storage — same encoding as the upstream SDK so that
// /resume only shows sessions from the current working directory.
const cwd = process.cwd()
const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
const projectSessionsDir = join(sessionsDir, safePath)

// Migrate legacy flat sessions: before per-directory scoping, all .jsonl session
// files lived directly in ~/.gsd/sessions/. Move them into the correct per-cwd
// subdirectory so /resume can find them.
if (existsSync(sessionsDir)) {
  try {
    const entries = readdirSync(sessionsDir)
    const flatJsonl = entries.filter(f => f.endsWith('.jsonl'))
    if (flatJsonl.length > 0) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(projectSessionsDir, { recursive: true })
      for (const file of flatJsonl) {
        const src = join(sessionsDir, file)
        const dst = join(projectSessionsDir, file)
        if (!existsSync(dst)) {
          renameSync(src, dst)
        }
      }
    }
  } catch {
    // Non-fatal — don't block startup if migration fails
  }
}

const sessionManager = cliFlags.continue
  ? SessionManager.continueRecent(cwd, projectSessionsDir)
  : SessionManager.create(cwd, projectSessionsDir)

initResources(agentDir)
const resourceLoader = buildResourceLoader(agentDir)
await resourceLoader.reload()

const { session, extensionsResult } = await createAgentSession({
  authStorage,
  modelRegistry,
  settingsManager,
  sessionManager,
  resourceLoader,
})

if (extensionsResult.errors.length > 0) {
  for (const err of extensionsResult.errors) {
    process.stderr.write(`[labrat] Extension load error: ${err.error}\n`)
  }
}

// Restore scoped models from settings on startup.
// The upstream InteractiveMode reads enabledModels from settings when /scoped-models is opened,
// but doesn't apply them to the session at startup — so Ctrl+P cycles all models instead of
// just the saved selection until the user re-runs /scoped-models.
const enabledModelPatterns = settingsManager.getEnabledModels()
if (enabledModelPatterns && enabledModelPatterns.length > 0) {
  const availableModels = modelRegistry.getAvailable()
  const scopedModels: Array<{ model: (typeof availableModels)[number] }> = []
  const seen = new Set<string>()

  for (const pattern of enabledModelPatterns) {
    // Patterns are "provider/modelId" exact strings saved by /scoped-models
    const slashIdx = pattern.indexOf('/')
    if (slashIdx !== -1) {
      const provider = pattern.substring(0, slashIdx)
      const modelId = pattern.substring(slashIdx + 1)
      const model = availableModels.find((m) => m.provider === provider && m.id === modelId)
      if (model) {
        const key = `${model.provider}/${model.id}`
        if (!seen.has(key)) {
          seen.add(key)
          scopedModels.push({ model })
        }
      }
    } else {
      // Fallback: match by model id alone
      const model = availableModels.find((m) => m.id === pattern)
      if (model) {
        const key = `${model.provider}/${model.id}`
        if (!seen.has(key)) {
          seen.add(key)
          scopedModels.push({ model })
        }
      }
    }
  }

  // Only apply if we resolved some models and it's a genuine subset
  if (scopedModels.length > 0 && scopedModels.length < availableModels.length) {
    session.setScopedModels(scopedModels)
  }
}

if (!process.stdin.isTTY) {
  process.stderr.write('[labrat] Error: Interactive mode requires a terminal (TTY).\n')
  process.stderr.write('[labrat] Non-interactive alternatives:\n')
  process.stderr.write('[labrat]   labrat --print "your message"     Single-shot prompt\n')
  process.stderr.write('[labrat]   labrat --mode rpc                 JSON-RPC over stdin/stdout\n')
  process.stderr.write('[labrat]   labrat --mode text "message"      Text output mode\n')
  process.exit(1)
}

const interactiveMode = new InteractiveMode(session)
await interactiveMode.run()
