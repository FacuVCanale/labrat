/**
 * Tests for GSD prompt-loader: template loading, variable substitution,
 * and missing-variable error handling.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPrompt } from '../prompt-loader.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

/** List all available prompt template names (without .md extension). */
function listPromptNames(): string[] {
	return readdirSync(promptsDir)
		.filter(f => f.endsWith('.md'))
		.map(f => f.replace(/\.md$/, ''))
}

/**
 * Extract all {{varName}} placeholders from a template file.
 * Returns unique variable names (without the {{ }} delimiters).
 */
function extractVars(name: string): string[] {
	const content = readFileSync(join(promptsDir, `${name}.md`), 'utf-8')
	const matches = content.match(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g)
	if (!matches) return []
	return [...new Set(matches.map(m => m.slice(2, -2)))]
}

// ═══════════════════════════════════════════════════════════════════════════
// Basic loading
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt loads the system template (no placeholders needed beyond declared ones)', () => {
	const vars = extractVars('system')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `TEST_${v}`
	}

	const result = loadPrompt('system', varsObj)
	assert.ok(result.length > 0, 'system prompt should be non-empty')
	assert.ok(result.includes('NightShift'), 'system prompt should mention NightShift')
})

test('loadPrompt returns trimmed content', () => {
	const vars = extractVars('system')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `TEST_${v}`
	}

	const result = loadPrompt('system', varsObj)
	assert.equal(result, result.trim(), 'output should be trimmed')
})

test('all prompt templates in prompts/ are loadable with stub vars', () => {
	const names = listPromptNames()
	assert.ok(names.length > 0, 'should find at least one prompt template')

	for (const name of names) {
		const vars = extractVars(name)
		const varsObj: Record<string, string> = {}
		for (const v of vars) {
			varsObj[v] = `STUB_${v}`
		}
		// Should not throw
		const result = loadPrompt(name, varsObj)
		assert.ok(result.length > 0, `${name} template should produce non-empty output`)
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// Variable substitution
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt substitutes {{varName}} placeholders with provided values', () => {
	// worktree-merge.md has well-defined variables
	const vars = extractVars('worktree-merge')
	assert.ok(vars.length > 0, 'worktree-merge should have placeholders')

	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `REPLACED_${v}`
	}

	const result = loadPrompt('worktree-merge', varsObj)

	// None of the {{varName}} placeholders should remain
	for (const v of vars) {
		assert.ok(!result.includes(`{{${v}}}`), `{{${v}}} should be replaced`)
		assert.ok(result.includes(`REPLACED_${v}`), `REPLACED_${v} should be in output`)
	}
})

test('loadPrompt replaces all occurrences of the same variable', () => {
	// worktree-merge uses {{mainBranch}} and {{worktreeBranch}} multiple times
	const vars = extractVars('worktree-merge')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `VALUE_${v}`
	}

	const result = loadPrompt('worktree-merge', varsObj)

	// Verify no leftover placeholders
	const leftover = result.match(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g)
	assert.equal(leftover, null, 'no unreplaced placeholders should remain')
})

test('loadPrompt handles substitution values containing special characters', () => {
	const vars = extractVars('worktree-merge')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `value-with-$pecial "chars" & <brackets>`
	}

	// Should not throw and should contain the special chars
	const result = loadPrompt('worktree-merge', varsObj)
	assert.ok(result.includes('$pecial'), 'special characters should be preserved')
})

test('loadPrompt handles empty string substitution values', () => {
	const vars = extractVars('worktree-merge')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = ''
	}

	// Should not throw
	const result = loadPrompt('worktree-merge', varsObj)
	assert.ok(typeof result === 'string')
})

// ═══════════════════════════════════════════════════════════════════════════
// Missing variable errors
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt throws when required variables are missing', () => {
	// worktree-merge has many required variables, providing none should throw
	const vars = extractVars('worktree-merge')
	assert.ok(vars.length > 0, 'worktree-merge needs variables')

	assert.throws(
		() => loadPrompt('worktree-merge', {}),
		(err: Error) => {
			assert.ok(err.message.includes('loadPrompt("worktree-merge")'))
			assert.ok(err.message.includes('no value was provided'))
			return true
		},
	)
})

test('loadPrompt throws when only some variables are provided', () => {
	const vars = extractVars('worktree-merge')
	assert.ok(vars.length >= 2, 'need at least 2 variables for partial test')

	// Provide only the first variable
	const partialVars: Record<string, string> = {
		[vars[0]]: 'value',
	}

	assert.throws(
		() => loadPrompt('worktree-merge', partialVars),
		(err: Error) => {
			assert.ok(err.message.includes('no value was provided'))
			return true
		},
	)
})

test('loadPrompt error message lists the missing variable names', () => {
	const vars = extractVars('worktree-merge')

	try {
		loadPrompt('worktree-merge', {})
		assert.fail('should have thrown')
	} catch (err: unknown) {
		const msg = (err as Error).message
		// At least one of the declared variables should appear in the error
		const foundAny = vars.some(v => msg.includes(v))
		assert.ok(foundAny, 'error message should list at least one missing variable name')
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// Templates with no placeholders
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt works with empty vars when template has no placeholders', () => {
	// system.md may have no placeholders; if it does, we need to find one without
	const names = listPromptNames()
	const noVarTemplate = names.find(n => extractVars(n).length === 0)

	if (noVarTemplate) {
		const result = loadPrompt(noVarTemplate, {})
		assert.ok(result.length > 0, `${noVarTemplate} should produce output with empty vars`)
	} else {
		// All templates have vars — load system with all vars provided, no extra test needed
		// Still test that providing extra vars doesn't cause issues
		const vars = extractVars('system')
		const varsObj: Record<string, string> = {}
		for (const v of vars) {
			varsObj[v] = 'VALUE'
		}
		varsObj['extraUnusedVar'] = 'should be ignored'
		const result = loadPrompt('system', varsObj)
		assert.ok(result.length > 0)
	}
})

test('loadPrompt accepts extra variables not in template without error', () => {
	const vars = extractVars('worktree-merge')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `val_${v}`
	}
	// Add extra variables that are not in the template
	varsObj['nonExistentVar'] = 'should be silently ignored'
	varsObj['anotherExtra'] = 'also ignored'

	// Should not throw
	const result = loadPrompt('worktree-merge', varsObj)
	assert.ok(result.length > 0)
})

// ═══════════════════════════════════════════════════════════════════════════
// Missing template file
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt throws when template file does not exist', () => {
	assert.throws(
		() => loadPrompt('nonexistent-template-that-does-not-exist', {}),
		(err: Error) => {
			// Node's readFileSync throws ENOENT
			assert.ok(err.message.includes('ENOENT') || err.message.includes('no such file'))
			return true
		},
	)
})

// ═══════════════════════════════════════════════════════════════════════════
// Substitution preserves template structure
// ═══════════════════════════════════════════════════════════════════════════

test('loadPrompt preserves markdown structure around substitutions', () => {
	const vars = extractVars('worktree-merge')
	const varsObj: Record<string, string> = {}
	for (const v of vars) {
		varsObj[v] = `test_${v}`
	}

	const result = loadPrompt('worktree-merge', varsObj)

	// worktree-merge.md has markdown headers and code blocks
	assert.ok(result.includes('## '), 'should preserve markdown headers')
	assert.ok(result.includes('```'), 'should preserve code block markers')
})
