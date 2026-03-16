#!/usr/bin/env node

import { exec as execCb } from 'child_process'
import { createRequire } from 'module'
import os from 'os'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkg = require(resolve(__dirname, '..', 'package.json'))
const cwd = resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Async exec helper — captures stdout+stderr, never inherits to terminal
// ---------------------------------------------------------------------------
function run(cmd, options = {}) {
  return new Promise((resolve) => {
    execCb(cmd, { cwd, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, error })
    })
  })
}

// ---------------------------------------------------------------------------
// Redirect stdout → stderr so npm always shows postinstall output.
// npm ≥7 suppresses stdout from lifecycle scripts by default; stderr is
// always forwarded. Clack writes to process.stdout, so we reroute it.
// ---------------------------------------------------------------------------
process.stdout.write = process.stderr.write.bind(process.stderr)

// ---------------------------------------------------------------------------
// ASCII banner — printed before clack UI for brand recognition
// ---------------------------------------------------------------------------
const cyan    = '\x1b[36m'
const dim     = '\x1b[2m'
const reset   = '\x1b[0m'

const banner =
  '\n' +
  cyan +
  '   ██████╗ ███████╗██████╗ \n' +
  '  ██╔════╝ ██╔════╝██╔══██╗\n' +
  '  ██║  ███╗███████╗██║  ██║\n' +
  '  ██║   ██║╚════██║██║  ██║\n' +
  '  ╚██████╔╝███████║██████╔╝\n' +
  '   ╚═════╝ ╚══════╝╚═════╝ ' +
  reset + '\n' +
  '\n' +
  `  Get Shit Done ${dim}v${pkg.version}${reset}\n`

// ---------------------------------------------------------------------------
// Main — wrapped in async IIFE, with graceful fallback if clack fails
// ---------------------------------------------------------------------------
;(async () => {
  process.stderr.write(banner)

  let p, pc

  try {
    p = await import('@clack/prompts')
    pc = (await import('picocolors')).default
  } catch {
    // Clack or picocolors unavailable — fall back to minimal output
    process.stderr.write(`  Run nightshift to get started.\n\n`)
    await run('npx playwright install chromium')
    return
  }

  // --- Branded intro -------------------------------------------------------
  p.intro('Setup')

  const results = []
  const s = p.spinner()

  // --- Playwright browser --------------------------------------------------
  // Avoid --with-deps: install scripts should not block on interactive sudo
  // prompts. If Linux libs are missing, suggest the explicit follow-up.
  s.start('Setting up browser tools…')
  const pwResult = await run('npx playwright install chromium')
  if (pwResult.ok) {
    s.stop('Browser tools ready')
    results.push({ label: 'Browser tools ready', ok: true })
  } else {
    const output = `${pwResult.stdout ?? ''}${pwResult.stderr ?? ''}`
    if (os.platform() === 'linux' && output.includes('Host system is missing dependencies to run browsers.')) {
      s.stop(pc.yellow('Browser downloaded, missing Linux deps'))
      results.push({
        label: 'Run ' + pc.cyan('sudo npx playwright install-deps chromium') + ' to finish setup',
        ok: false,
      })
    } else {
      s.stop(pc.yellow('Browser tools — skipped (non-fatal)'))
      results.push({
        label: 'Browser tools unavailable — run ' + pc.cyan('npx playwright install chromium'),
        ok: false,
      })
    }
  }

  // --- Summary note --------------------------------------------------------
  const lines = results.map(
    (r) => (r.ok ? pc.green('✓') : pc.yellow('⚠')) + ' ' + r.label
  )
  lines.push('')
  lines.push('Run ' + pc.cyan('nightshift') + ' to get started.')

  p.note(lines.join('\n'), 'Installed')

  // --- Outro ---------------------------------------------------------------
  p.outro(pc.green('Done!'))
})()
