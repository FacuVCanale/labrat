/**
 * Tests for GSD gitignore bootstrapper: .gitignore creation/update
 * and PREFERENCES.md template generation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	ensureGitignore,
	ensurePreferences,
} from '../gitignore.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'gitignore-test-'))
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** All the baseline patterns ensureGitignore writes. */
const EXPECTED_PATTERNS = [
	'.gsd/activity/',
	'.gsd/runtime/',
	'.gsd/worktrees/',
	'.gsd/auto.lock',
	'.gsd/metrics.json',
	'.gsd/completed-units.json',
	'.gsd/STATE.md',
	'.DS_Store',
	'Thumbs.db',
	'*.swp',
	'*.swo',
	'*~',
	'.idea/',
	'.vscode/',
	'*.code-workspace',
	'.env',
	'.env.*',
	'!.env.example',
	'node_modules/',
	'.next/',
	'dist/',
	'build/',
	'__pycache__/',
	'*.pyc',
	'.venv/',
	'venv/',
	'target/',
	'vendor/',
	'*.log',
	'coverage/',
	'.cache/',
	'tmp/',
]

// ═══════════════════════════════════════════════════════════════════════════
// ensureGitignore — creation
// ═══════════════════════════════════════════════════════════════════════════

test('ensureGitignore creates .gitignore when it does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const result = ensureGitignore(dir)
		assert.equal(result, true, 'should return true when file is created')
		assert.ok(existsSync(join(dir, '.gitignore')))
	} finally {
		cleanup()
	}
})

test('new .gitignore contains all baseline patterns', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		ensureGitignore(dir)
		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')

		for (const pattern of EXPECTED_PATTERNS) {
			assert.ok(
				content.includes(pattern),
				`should contain pattern: ${pattern}`,
			)
		}
	} finally {
		cleanup()
	}
})

test('new .gitignore contains the auto-generated header comment', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		ensureGitignore(dir)
		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
		assert.ok(content.includes('GSD baseline (auto-generated)'))
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// ensureGitignore — appending
// ═══════════════════════════════════════════════════════════════════════════

test('ensureGitignore appends missing patterns to existing .gitignore', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Pre-populate with a few patterns
		writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.DS_Store\n', 'utf-8')

		const result = ensureGitignore(dir)
		assert.equal(result, true, 'should return true when patterns are appended')

		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
		// Original content preserved
		assert.ok(content.startsWith('node_modules/\n.DS_Store\n'))
		// Missing patterns added
		assert.ok(content.includes('.gsd/activity/'))
		assert.ok(content.includes('target/'))
	} finally {
		cleanup()
	}
})

test('ensureGitignore does not duplicate patterns already present', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.DS_Store\n', 'utf-8')
		ensureGitignore(dir)
		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')

		// Count occurrences of node_modules/
		const matches = content.match(/node_modules\//g)
		assert.equal(matches?.length, 1, 'node_modules/ should appear exactly once')
	} finally {
		cleanup()
	}
})

test('ensureGitignore returns false when all patterns already present', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// First call writes them all
		ensureGitignore(dir)
		// Second call should find everything present
		const result = ensureGitignore(dir)
		assert.equal(result, false, 'should return false when nothing to add')
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// ensureGitignore — idempotency
// ═══════════════════════════════════════════════════════════════════════════

test('ensureGitignore is idempotent — running twice produces same content', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		ensureGitignore(dir)
		const contentAfterFirst = readFileSync(join(dir, '.gitignore'), 'utf-8')

		ensureGitignore(dir)
		const contentAfterSecond = readFileSync(join(dir, '.gitignore'), 'utf-8')

		assert.equal(contentAfterFirst, contentAfterSecond)
	} finally {
		cleanup()
	}
})

test('ensureGitignore is idempotent with pre-existing content', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, '.gitignore'), '# My project\nnode_modules/\n', 'utf-8')

		ensureGitignore(dir)
		const contentAfterFirst = readFileSync(join(dir, '.gitignore'), 'utf-8')

		ensureGitignore(dir)
		const contentAfterSecond = readFileSync(join(dir, '.gitignore'), 'utf-8')

		assert.equal(contentAfterFirst, contentAfterSecond)
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// ensureGitignore — edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('ensureGitignore handles existing file without trailing newline', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// No trailing newline
		writeFileSync(join(dir, '.gitignore'), '# custom\nmy-pattern', 'utf-8')

		ensureGitignore(dir)
		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')

		// Should not have appended block directly after "my-pattern" without a newline
		assert.ok(!content.includes('my-pattern#'), 'should have newline between old and new content')
		// The original content should be present
		assert.ok(content.includes('# custom'))
		assert.ok(content.includes('my-pattern'))
	} finally {
		cleanup()
	}
})

test('ensureGitignore preserves existing comments and blank lines', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const original = '# My project rules\n\n# Dependencies\nnode_modules/\n\n# Build\ndist/\n'
		writeFileSync(join(dir, '.gitignore'), original, 'utf-8')

		ensureGitignore(dir)
		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')

		assert.ok(content.startsWith(original), 'original content should be preserved at the top')
	} finally {
		cleanup()
	}
})

test('ensureGitignore handles empty existing .gitignore', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, '.gitignore'), '', 'utf-8')

		const result = ensureGitignore(dir)
		assert.equal(result, true)

		const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
		for (const pattern of EXPECTED_PATTERNS) {
			assert.ok(content.includes(pattern), `should contain: ${pattern}`)
		}
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// ensurePreferences
// ═══════════════════════════════════════════════════════════════════════════

test('ensurePreferences creates PREFERENCES.md when it does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		const result = ensurePreferences(dir)
		assert.equal(result, true, 'should return true when file is created')
		assert.ok(existsSync(join(dir, '.gsd', 'PREFERENCES.md')))
	} finally {
		cleanup()
	}
})

test('ensurePreferences returns false when file already exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		ensurePreferences(dir)
		const result = ensurePreferences(dir)
		assert.equal(result, false, 'should return false on second call')
	} finally {
		cleanup()
	}
})

test('ensurePreferences file contains YAML frontmatter', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		ensurePreferences(dir)
		const content = readFileSync(join(dir, '.gsd', 'PREFERENCES.md'), 'utf-8')

		assert.ok(content.startsWith('---'), 'should start with YAML frontmatter')
		// Should have closing ---
		const secondDash = content.indexOf('---', 3)
		assert.ok(secondDash > 0, 'should have closing frontmatter delimiter')
	} finally {
		cleanup()
	}
})

test('ensurePreferences file contains expected fields', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		ensurePreferences(dir)
		const content = readFileSync(join(dir, '.gsd', 'PREFERENCES.md'), 'utf-8')

		assert.ok(content.includes('always_use_skills'))
		assert.ok(content.includes('prefer_skills'))
		assert.ok(content.includes('avoid_skills'))
		assert.ok(content.includes('skill_rules'))
		assert.ok(content.includes('custom_instructions'))
		assert.ok(content.includes('models'))
		assert.ok(content.includes('skill_discovery'))
		assert.ok(content.includes('auto_supervisor'))
	} finally {
		cleanup()
	}
})

test('ensurePreferences does not overwrite existing content', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		const customContent = '# Custom preferences\nprefer_skills:\n  - playwright\n'
		writeFileSync(join(dir, '.gsd', 'PREFERENCES.md'), customContent, 'utf-8')

		ensurePreferences(dir)
		const content = readFileSync(join(dir, '.gsd', 'PREFERENCES.md'), 'utf-8')
		assert.equal(content, customContent, 'should not overwrite existing file')
	} finally {
		cleanup()
	}
})

test('ensurePreferences file contains GSD Skill Preferences heading', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, '.gsd'), { recursive: true })
		ensurePreferences(dir)
		const content = readFileSync(join(dir, '.gsd', 'PREFERENCES.md'), 'utf-8')

		assert.ok(content.includes('# GSD Skill Preferences'))
	} finally {
		cleanup()
	}
})
