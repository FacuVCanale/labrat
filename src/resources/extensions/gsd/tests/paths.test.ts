/**
 * Tests for GSD paths: name builders, directory/file resolvers,
 * full-path builders, relative-path builders, and dirCache behaviour.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	buildDirName,
	buildMilestoneFileName,
	buildSliceFileName,
	buildTaskFileName,
	resolveDir,
	resolveFile,
	resolveTaskFiles,
	gsdRoot,
	milestonesDir,
	resolveGsdRootFile,
	relGsdRootFile,
	resolveMilestonePath,
	resolveMilestoneFile,
	resolveSlicePath,
	resolveSliceFile,
	resolveTasksDir,
	resolveTaskFile,
	relMilestonePath,
	relMilestoneFile,
	relSlicePath,
	relSliceFile,
	relTaskFile,
	GSD_ROOT_FILES,
} from '../paths.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'gsd-paths-test-'))
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Create a full GSD hierarchy in a temp dir and return the base path. */
function buildGsdTree(base: string, opts?: {
	legacyMilestoneDirName?: string
	legacySliceDirName?: string
	legacyFileNames?: boolean
}) {
	const root = join(base, '.gsd')
	mkdirSync(root, { recursive: true })
	writeFileSync(join(root, 'PROJECT.md'), '# Project')
	writeFileSync(join(root, 'DECISIONS.md'), '# Decisions')

	const mDirName = opts?.legacyMilestoneDirName ?? 'M001'
	const mDir = join(root, 'milestones', mDirName)
	mkdirSync(mDir, { recursive: true })

	if (opts?.legacyFileNames) {
		writeFileSync(join(mDir, 'M001-FLIGHT-SIM-ROADMAP.md'), '# Roadmap')
		writeFileSync(join(mDir, 'M001-FLIGHT-SIM-CONTEXT.md'), '# Context')
	} else {
		writeFileSync(join(mDir, 'M001-ROADMAP.md'), '# Roadmap')
		writeFileSync(join(mDir, 'M001-CONTEXT.md'), '# Context')
	}

	const sDirName = opts?.legacySliceDirName ?? 'S01'
	const sDir = join(mDir, 'slices', sDirName)
	mkdirSync(sDir, { recursive: true })
	writeFileSync(join(sDir, 'S01-PLAN.md'), '# Plan')

	const tDir = join(sDir, 'tasks')
	mkdirSync(tDir, { recursive: true })
	writeFileSync(join(tDir, 'T01-PLAN.md'), '# T01')
	writeFileSync(join(tDir, 'T02-PLAN.md'), '# T02')
	writeFileSync(join(tDir, 'T03-PLAN.md'), '# T03')
}

// ═══════════════════════════════════════════════════════════════════════════
// Name Builders
// ═══════════════════════════════════════════════════════════════════════════

test('buildDirName returns the ID unchanged', () => {
	assert.equal(buildDirName('M001'), 'M001')
	assert.equal(buildDirName('S05'), 'S05')
	assert.equal(buildDirName('T12'), 'T12')
})

test('buildMilestoneFileName produces ID-SUFFIX.md', () => {
	assert.equal(buildMilestoneFileName('M001', 'CONTEXT'), 'M001-CONTEXT.md')
	assert.equal(buildMilestoneFileName('M002', 'ROADMAP'), 'M002-ROADMAP.md')
	assert.equal(buildMilestoneFileName('M010', 'RESEARCH'), 'M010-RESEARCH.md')
})

test('buildSliceFileName produces ID-SUFFIX.md', () => {
	assert.equal(buildSliceFileName('S01', 'PLAN'), 'S01-PLAN.md')
	assert.equal(buildSliceFileName('S03', 'SUMMARY'), 'S03-SUMMARY.md')
	assert.equal(buildSliceFileName('S12', 'CONTEXT'), 'S12-CONTEXT.md')
})

test('buildTaskFileName produces ID-SUFFIX.md', () => {
	assert.equal(buildTaskFileName('T03', 'PLAN'), 'T03-PLAN.md')
	assert.equal(buildTaskFileName('T01', 'SUMMARY'), 'T01-SUMMARY.md')
	assert.equal(buildTaskFileName('T99', 'RESEARCH'), 'T99-RESEARCH.md')
})

// ═══════════════════════════════════════════════════════════════════════════
// resolveDir
// ═══════════════════════════════════════════════════════════════════════════

test('resolveDir returns exact match when directory name equals ID', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, 'M001'))
		assert.equal(resolveDir(dir, 'M001'), 'M001')
	} finally {
		cleanup()
	}
})

test('resolveDir returns prefix match for legacy descriptor dirs', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, 'M001-FLIGHT-SIMULATOR'))
		assert.equal(resolveDir(dir, 'M001'), 'M001-FLIGHT-SIMULATOR')
	} finally {
		cleanup()
	}
})

test('resolveDir prefers exact match over prefix match', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, 'M001'))
		mkdirSync(join(dir, 'M001-LEGACY-DESCRIPTOR'))
		assert.equal(resolveDir(dir, 'M001'), 'M001')
	} finally {
		cleanup()
	}
})

test('resolveDir returns null when no matching directory exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, 'M002'))
		assert.equal(resolveDir(dir, 'M001'), null)
	} finally {
		cleanup()
	}
})

test('resolveDir returns null for non-existent parent directory', () => {
	assert.equal(resolveDir('/tmp/does-not-exist-xyz-abc-123', 'M001'), null)
})

test('resolveDir ignores files (only matches directories)', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'M001'), 'this is a file not a dir')
		assert.equal(resolveDir(dir, 'M001'), null)
	} finally {
		cleanup()
	}
})

test('resolveDir does not match a directory that merely contains the prefix mid-name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// "XM001" should not match prefix "M001"
		mkdirSync(join(dir, 'XM001'))
		assert.equal(resolveDir(dir, 'M001'), null)
	} finally {
		cleanup()
	}
})

test('resolveDir uses dirCache and does not re-read the directory', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		mkdirSync(join(dir, 'M001'))
		const cache = new Map<string, string[]>()

		// First call populates the cache
		const result1 = resolveDir(dir, 'M001', cache)
		assert.equal(result1, 'M001')
		assert.ok(cache.has(dir))
		assert.deepEqual(cache.get(dir), ['M001'])

		// Add another dir on disk — cache should still be used, so M002 is invisible
		mkdirSync(join(dir, 'M002'))
		const result2 = resolveDir(dir, 'M002', cache)
		assert.equal(result2, null) // Cache doesn't include M002
	} finally {
		cleanup()
	}
})

test('resolveDir with pre-populated dirCache returns from cache', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Do NOT create anything on disk — put entries in cache only
		mkdirSync(dir, { recursive: true })
		const cache = new Map<string, string[]>()
		cache.set(dir, ['S05-LEGACY'])

		assert.equal(resolveDir(dir, 'S05', cache), 'S05-LEGACY')
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// resolveFile
// ═══════════════════════════════════════════════════════════════════════════

test('resolveFile finds direct match (ID-SUFFIX.md)', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'M001-ROADMAP.md'), '')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), 'M001-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('resolveFile is case-insensitive for direct match', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'm001-roadmap.md'), '')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), 'm001-roadmap.md')
	} finally {
		cleanup()
	}
})

test('resolveFile finds legacy descriptor pattern (ID-DESCRIPTOR-SUFFIX.md)', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T03-INSTALL-PACKAGES-PLAN.md'), '')
		assert.equal(resolveFile(dir, 'T03', 'PLAN'), 'T03-INSTALL-PACKAGES-PLAN.md')
	} finally {
		cleanup()
	}
})

test('resolveFile finds legacy bare fallback (suffix.md)', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'roadmap.md'), '')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), 'roadmap.md')
	} finally {
		cleanup()
	}
})

test('resolveFile prefers direct match over legacy pattern', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'M001-ROADMAP.md'), 'direct')
		writeFileSync(join(dir, 'M001-OLD-DESCRIPTOR-ROADMAP.md'), 'legacy')
		writeFileSync(join(dir, 'roadmap.md'), 'bare')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), 'M001-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('resolveFile prefers legacy pattern over bare fallback', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'M001-SOMETHING-ROADMAP.md'), 'legacy')
		writeFileSync(join(dir, 'roadmap.md'), 'bare')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), 'M001-SOMETHING-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('resolveFile returns null when nothing matches', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'M001-CONTEXT.md'), '')
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), null)
	} finally {
		cleanup()
	}
})

test('resolveFile returns null for non-existent directory', () => {
	assert.equal(resolveFile('/tmp/does-not-exist-xyz-abc-123', 'M001', 'ROADMAP'), null)
})

test('resolveFile uses dirCache', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		const cache = new Map<string, string[]>()

		const result1 = resolveFile(dir, 'T01', 'PLAN', cache)
		assert.equal(result1, 'T01-PLAN.md')
		assert.ok(cache.has(dir))

		// Write a new file — cache should prevent finding it
		writeFileSync(join(dir, 'T02-PLAN.md'), '')
		const result2 = resolveFile(dir, 'T02', 'PLAN', cache)
		assert.equal(result2, null) // Not in cache
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// resolveTaskFiles
// ═══════════════════════════════════════════════════════════════════════════

test('resolveTaskFiles finds current-convention files', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		writeFileSync(join(dir, 'T02-PLAN.md'), '')
		writeFileSync(join(dir, 'T03-PLAN.md'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.deepEqual(files, ['T01-PLAN.md', 'T02-PLAN.md', 'T03-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles finds legacy-convention files', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-INSTALL-DEPS-PLAN.md'), '')
		writeFileSync(join(dir, 'T02-SETUP-DB-PLAN.md'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.deepEqual(files, ['T01-INSTALL-DEPS-PLAN.md', 'T02-SETUP-DB-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles finds mixed current and legacy files', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		writeFileSync(join(dir, 'T02-SETUP-DB-PLAN.md'), '')
		writeFileSync(join(dir, 'T03-PLAN.md'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.deepEqual(files, ['T01-PLAN.md', 'T02-SETUP-DB-PLAN.md', 'T03-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles returns sorted results', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Write in reverse order
		writeFileSync(join(dir, 'T03-PLAN.md'), '')
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		writeFileSync(join(dir, 'T02-PLAN.md'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.deepEqual(files, ['T01-PLAN.md', 'T02-PLAN.md', 'T03-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles excludes non-matching files', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		writeFileSync(join(dir, 'T02-SUMMARY.md'), '')
		writeFileSync(join(dir, 'README.md'), '')
		writeFileSync(join(dir, 'notes.txt'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.deepEqual(files, ['T01-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles returns empty array for non-existent directory', () => {
	assert.deepEqual(resolveTaskFiles('/tmp/does-not-exist-xyz-abc-123', 'PLAN'), [])
})

test('resolveTaskFiles returns empty array when no tasks match', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'README.md'), '')
		assert.deepEqual(resolveTaskFiles(dir, 'PLAN'), [])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles uses dirCache', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-PLAN.md'), '')
		const cache = new Map<string, string[]>()
		const files1 = resolveTaskFiles(dir, 'PLAN', cache)
		assert.deepEqual(files1, ['T01-PLAN.md'])
		assert.ok(cache.has(dir))

		// Write new file — cache prevents finding it
		writeFileSync(join(dir, 'T02-PLAN.md'), '')
		const files2 = resolveTaskFiles(dir, 'PLAN', cache)
		assert.deepEqual(files2, ['T01-PLAN.md'])
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles with SUMMARY suffix', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-SUMMARY.md'), '')
		writeFileSync(join(dir, 'T02-BUILD-WIDGET-SUMMARY.md'), '')
		writeFileSync(join(dir, 'T01-PLAN.md'), '') // should not match SUMMARY
		const files = resolveTaskFiles(dir, 'SUMMARY')
		assert.deepEqual(files, ['T01-SUMMARY.md', 'T02-BUILD-WIDGET-SUMMARY.md'])
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// gsdRoot / milestonesDir
// ═══════════════════════════════════════════════════════════════════════════

test('gsdRoot appends .gsd to base path', () => {
	assert.equal(gsdRoot('/home/user/project'), join('/home/user/project', '.gsd'))
})

test('milestonesDir appends .gsd/milestones to base path', () => {
	assert.equal(milestonesDir('/home/user/project'), join('/home/user/project', '.gsd', 'milestones'))
})

// ═══════════════════════════════════════════════════════════════════════════
// resolveGsdRootFile
// ═══════════════════════════════════════════════════════════════════════════

test('resolveGsdRootFile returns canonical path when canonical file exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const root = join(dir, '.gsd')
		mkdirSync(root, { recursive: true })
		writeFileSync(join(root, 'PROJECT.md'), '')
		const result = resolveGsdRootFile(dir, 'PROJECT')
		assert.equal(result, join(root, 'PROJECT.md'))
	} finally {
		cleanup()
	}
})

test('resolveGsdRootFile returns legacy path when only legacy file exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const root = join(dir, '.gsd')
		mkdirSync(root, { recursive: true })
		writeFileSync(join(root, 'project.md'), '')
		const result = resolveGsdRootFile(dir, 'PROJECT')
		assert.equal(result, join(root, 'project.md'))
	} finally {
		cleanup()
	}
})

test('resolveGsdRootFile returns canonical path when neither exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const root = join(dir, '.gsd')
		mkdirSync(root, { recursive: true })
		const result = resolveGsdRootFile(dir, 'PROJECT')
		assert.equal(result, join(root, 'PROJECT.md'))
	} finally {
		cleanup()
	}
})

test('resolveGsdRootFile prefers canonical over legacy when both exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const root = join(dir, '.gsd')
		mkdirSync(root, { recursive: true })
		writeFileSync(join(root, 'PROJECT.md'), 'canonical')
		writeFileSync(join(root, 'project.md'), 'legacy')
		const result = resolveGsdRootFile(dir, 'PROJECT')
		assert.equal(result, join(root, 'PROJECT.md'))
	} finally {
		cleanup()
	}
})

test('resolveGsdRootFile works for all root file keys', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const root = join(dir, '.gsd')
		mkdirSync(root, { recursive: true })
		for (const key of Object.keys(GSD_ROOT_FILES) as Array<keyof typeof GSD_ROOT_FILES>) {
			writeFileSync(join(root, GSD_ROOT_FILES[key]), '')
		}
		assert.equal(resolveGsdRootFile(dir, 'DECISIONS'), join(root, 'DECISIONS.md'))
		assert.equal(resolveGsdRootFile(dir, 'QUEUE'), join(root, 'QUEUE.md'))
		assert.equal(resolveGsdRootFile(dir, 'STATE'), join(root, 'STATE.md'))
		assert.equal(resolveGsdRootFile(dir, 'REQUIREMENTS'), join(root, 'REQUIREMENTS.md'))
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// relGsdRootFile
// ═══════════════════════════════════════════════════════════════════════════

test('relGsdRootFile returns .gsd/FILENAME.md', () => {
	assert.equal(relGsdRootFile('PROJECT'), '.gsd/PROJECT.md')
	assert.equal(relGsdRootFile('DECISIONS'), '.gsd/DECISIONS.md')
})

// ═══════════════════════════════════════════════════════════════════════════
// Full hierarchy resolution — milestone → slice → task
// ═══════════════════════════════════════════════════════════════════════════

test('resolveMilestonePath returns full path for existing milestone', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveMilestonePath(dir, 'M001')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001'))
	} finally {
		cleanup()
	}
})

test('resolveMilestonePath returns null for missing milestone', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveMilestonePath(dir, 'M999'), null)
	} finally {
		cleanup()
	}
})

test('resolveMilestonePath resolves legacy descriptor directory', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacyMilestoneDirName: 'M001-FLIGHT-SIMULATOR' })
		const result = resolveMilestonePath(dir, 'M001')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001-FLIGHT-SIMULATOR'))
	} finally {
		cleanup()
	}
})

test('resolveMilestoneFile returns full path for direct match', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveMilestoneFile(dir, 'M001', 'ROADMAP')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'M001-ROADMAP.md'))
	} finally {
		cleanup()
	}
})

test('resolveMilestoneFile resolves legacy descriptor file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacyFileNames: true })
		const result = resolveMilestoneFile(dir, 'M001', 'ROADMAP')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'M001-FLIGHT-SIM-ROADMAP.md'))
	} finally {
		cleanup()
	}
})

test('resolveMilestoneFile returns null for missing file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveMilestoneFile(dir, 'M001', 'NONEXISTENT'), null)
	} finally {
		cleanup()
	}
})

test('resolveMilestoneFile returns null for missing milestone', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveMilestoneFile(dir, 'M999', 'ROADMAP'), null)
	} finally {
		cleanup()
	}
})

test('resolveSlicePath returns full path for existing slice', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveSlicePath(dir, 'M001', 'S01')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01'))
	} finally {
		cleanup()
	}
})

test('resolveSlicePath returns null for missing slice', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveSlicePath(dir, 'M001', 'S99'), null)
	} finally {
		cleanup()
	}
})

test('resolveSlicePath resolves legacy slice directory', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacySliceDirName: 'S01-AUTH-MODULE' })
		const result = resolveSlicePath(dir, 'M001', 'S01')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01-AUTH-MODULE'))
	} finally {
		cleanup()
	}
})

test('resolveSliceFile returns full path for slice file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveSliceFile(dir, 'M001', 'S01', 'PLAN')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'S01-PLAN.md'))
	} finally {
		cleanup()
	}
})

test('resolveSliceFile returns null for missing file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveSliceFile(dir, 'M001', 'S01', 'NONEXISTENT'), null)
	} finally {
		cleanup()
	}
})

test('resolveTasksDir returns tasks directory path', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveTasksDir(dir, 'M001', 'S01')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'tasks'))
	} finally {
		cleanup()
	}
})

test('resolveTasksDir returns null when tasks directory does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Build tree but remove tasks dir
		buildGsdTree(dir)
		const tDir = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'tasks')
		rmSync(tDir, { recursive: true })
		assert.equal(resolveTasksDir(dir, 'M001', 'S01'), null)
	} finally {
		cleanup()
	}
})

test('resolveTasksDir returns null for missing slice', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveTasksDir(dir, 'M001', 'S99'), null)
	} finally {
		cleanup()
	}
})

test('resolveTaskFile returns full path for a task file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const result = resolveTaskFile(dir, 'M001', 'S01', 'T02', 'PLAN')
		assert.equal(result, join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'tasks', 'T02-PLAN.md'))
	} finally {
		cleanup()
	}
})

test('resolveTaskFile returns null for missing task', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(resolveTaskFile(dir, 'M001', 'S01', 'T99', 'PLAN'), null)
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// dirCache shared across hierarchy resolution
// ═══════════════════════════════════════════════════════════════════════════

test('dirCache is populated through full hierarchy resolution', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		const cache = new Map<string, string[]>()
		const result = resolveTaskFile(dir, 'M001', 'S01', 'T01', 'PLAN', cache)
		assert.ok(result)
		// Cache should have entries for: milestones dir, slices dir, tasks dir
		assert.ok(cache.size >= 3, `Expected cache to have at least 3 entries, got ${cache.size}`)
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// Relative Path Builders
// ═══════════════════════════════════════════════════════════════════════════

test('relMilestonePath returns relative path with actual dir name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relMilestonePath(dir, 'M001'), '.gsd/milestones/M001')
	} finally {
		cleanup()
	}
})

test('relMilestonePath returns relative path with legacy dir name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacyMilestoneDirName: 'M001-FLIGHT-SIM' })
		assert.equal(relMilestonePath(dir, 'M001'), '.gsd/milestones/M001-FLIGHT-SIM')
	} finally {
		cleanup()
	}
})

test('relMilestonePath falls back to bare ID when milestone does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relMilestonePath(dir, 'M999'), '.gsd/milestones/M999')
	} finally {
		cleanup()
	}
})

test('relMilestoneFile returns relative path with actual file name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relMilestoneFile(dir, 'M001', 'ROADMAP'), '.gsd/milestones/M001/M001-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('relMilestoneFile returns relative path with legacy file name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacyFileNames: true })
		assert.equal(relMilestoneFile(dir, 'M001', 'ROADMAP'), '.gsd/milestones/M001/M001-FLIGHT-SIM-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('relMilestoneFile falls back to canonical name when file does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relMilestoneFile(dir, 'M001', 'NONEXISTENT'), '.gsd/milestones/M001/M001-NONEXISTENT.md')
	} finally {
		cleanup()
	}
})

test('relMilestoneFile falls back to canonical when milestone does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relMilestoneFile(dir, 'M999', 'ROADMAP'), '.gsd/milestones/M999/M999-ROADMAP.md')
	} finally {
		cleanup()
	}
})

test('relSlicePath returns relative path with actual slice dir name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relSlicePath(dir, 'M001', 'S01'), '.gsd/milestones/M001/slices/S01')
	} finally {
		cleanup()
	}
})

test('relSlicePath returns relative path with legacy slice dir name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, { legacySliceDirName: 'S01-AUTH' })
		assert.equal(relSlicePath(dir, 'M001', 'S01'), '.gsd/milestones/M001/slices/S01-AUTH')
	} finally {
		cleanup()
	}
})

test('relSlicePath falls back to bare ID when slice does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relSlicePath(dir, 'M001', 'S99'), '.gsd/milestones/M001/slices/S99')
	} finally {
		cleanup()
	}
})

test('relSliceFile returns relative path with actual file name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relSliceFile(dir, 'M001', 'S01', 'PLAN'), '.gsd/milestones/M001/slices/S01/S01-PLAN.md')
	} finally {
		cleanup()
	}
})

test('relSliceFile falls back to canonical when file does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relSliceFile(dir, 'M001', 'S01', 'NONEXISTENT'), '.gsd/milestones/M001/slices/S01/S01-NONEXISTENT.md')
	} finally {
		cleanup()
	}
})

test('relTaskFile returns relative path with actual file name', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relTaskFile(dir, 'M001', 'S01', 'T01', 'PLAN'), '.gsd/milestones/M001/slices/S01/tasks/T01-PLAN.md')
	} finally {
		cleanup()
	}
})

test('relTaskFile falls back to canonical when task does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		assert.equal(relTaskFile(dir, 'M001', 'S01', 'T99', 'PLAN'), '.gsd/milestones/M001/slices/S01/tasks/T99-PLAN.md')
	} finally {
		cleanup()
	}
})

test('relTaskFile falls back to canonical when tasks dir does not exist', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir)
		// Remove tasks dir
		const tDir = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'tasks')
		rmSync(tDir, { recursive: true })
		assert.equal(relTaskFile(dir, 'M001', 'S01', 'T01', 'PLAN'), '.gsd/milestones/M001/slices/S01/tasks/T01-PLAN.md')
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('resolveDir handles empty directory', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		assert.equal(resolveDir(dir, 'M001'), null)
	} finally {
		cleanup()
	}
})

test('resolveFile handles empty directory', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		assert.equal(resolveFile(dir, 'M001', 'ROADMAP'), null)
	} finally {
		cleanup()
	}
})

test('resolveTaskFiles case-insensitive matching', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeFileSync(join(dir, 'T01-plan.md'), '')
		writeFileSync(join(dir, 'T02-PLAN.md'), '')
		const files = resolveTaskFiles(dir, 'PLAN')
		assert.equal(files.length, 2)
	} finally {
		cleanup()
	}
})

test('full hierarchy with dirCache and legacy names throughout', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		buildGsdTree(dir, {
			legacyMilestoneDirName: 'M001-PROJECT-ALPHA',
			legacySliceDirName: 'S01-AUTH-MODULE',
			legacyFileNames: true,
		})
		const cache = new Map<string, string[]>()

		// Milestone path resolves through legacy dir
		const mPath = resolveMilestonePath(dir, 'M001', cache)
		assert.ok(mPath)
		assert.ok(mPath!.endsWith('M001-PROJECT-ALPHA'))

		// Milestone file resolves through legacy file name
		const mFile = resolveMilestoneFile(dir, 'M001', 'ROADMAP', cache)
		assert.ok(mFile)
		assert.ok(mFile!.endsWith('M001-FLIGHT-SIM-ROADMAP.md'))

		// Slice path resolves through legacy dir
		const sPath = resolveSlicePath(dir, 'M001', 'S01', cache)
		assert.ok(sPath)
		assert.ok(sPath!.endsWith('S01-AUTH-MODULE'))

		// Tasks dir
		const tDir = resolveTasksDir(dir, 'M001', 'S01', cache)
		assert.ok(tDir)

		// Task file
		const tFile = resolveTaskFile(dir, 'M001', 'S01', 'T01', 'PLAN', cache)
		assert.ok(tFile)
		assert.ok(tFile!.endsWith('T01-PLAN.md'))

		// Cache should have been populated
		assert.ok(cache.size >= 3)
	} finally {
		cleanup()
	}
})

test('resolveDir does not match prefix without hyphen separator', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// "M0010" starts with "M001" but is not "M001-..."
		mkdirSync(join(dir, 'M0010'))
		assert.equal(resolveDir(dir, 'M001'), null)
	} finally {
		cleanup()
	}
})
