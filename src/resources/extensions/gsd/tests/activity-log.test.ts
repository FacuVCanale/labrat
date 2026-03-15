/**
 * Tests for pruneActivityLogs: retention-based pruning with highest-seq preservation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pruneActivityLogs } from '../activity-log.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'activity-log-test-'))
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Create a log file with a given sequence number, unit type, and mtime days-ago. */
function createLogFile(dir: string, seq: number, daysAgo: number, unitType = 'task', unitId = 'test'): string {
	const seqStr = String(seq).padStart(3, '0')
	const fileName = `${seqStr}-${unitType}-${unitId}.jsonl`
	const filePath = join(dir, fileName)
	writeFileSync(filePath, `{"entry":"seq${seq}"}\n`, 'utf-8')

	const mtime = new Date(Date.now() - daysAgo * 86_400_000)
	utimesSync(filePath, mtime, mtime)
	return fileName
}

function listLogFiles(dir: string): string[] {
	return readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
}

// ═══════════════════════════════════════════════════════════════════════════
// pruneActivityLogs
// ═══════════════════════════════════════════════════════════════════════════

test('pruneActivityLogs: prunes files older than retention period', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 30)  // 30 days old
		createLogFile(dir, 2, 20)  // 20 days old
		createLogFile(dir, 3, 1)   // 1 day old (recent)

		pruneActivityLogs(dir, 7)  // retain 7 days

		const remaining = listLogFiles(dir)
		// seq 3 is preserved (highest seq), seq 1 and 2 are old and pruned
		// but seq 3 is within retention anyway
		assert.ok(remaining.some(f => f.startsWith('003-')), 'highest seq should be preserved')
		assert.ok(!remaining.some(f => f.startsWith('001-')), 'seq 1 (30 days old) should be pruned')
		assert.ok(!remaining.some(f => f.startsWith('002-')), 'seq 2 (20 days old) should be pruned')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: preserves highest sequence number always, even if old', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 60)  // 60 days old
		createLogFile(dir, 2, 50)  // 50 days old
		createLogFile(dir, 5, 40)  // 40 days old — highest seq

		pruneActivityLogs(dir, 7)

		const remaining = listLogFiles(dir)
		assert.ok(remaining.some(f => f.startsWith('005-')), 'highest seq must be preserved even when old')
		assert.ok(!remaining.some(f => f.startsWith('001-')), 'old non-highest seq should be pruned')
		assert.ok(!remaining.some(f => f.startsWith('002-')), 'old non-highest seq should be pruned')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: handles empty directory without error', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Should not throw on empty dir
		pruneActivityLogs(dir, 7)
		assert.equal(listLogFiles(dir).length, 0)
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: handles non-existent directory without error', () => {
	// Should not throw for a directory that does not exist
	pruneActivityLogs('/tmp/nonexistent-activity-dir-xyz-12345', 7)
})

test('pruneActivityLogs: does not prune files within retention period', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 2)  // 2 days old
		createLogFile(dir, 2, 1)  // 1 day old
		createLogFile(dir, 3, 0)  // just created

		pruneActivityLogs(dir, 7)  // retain 7 days

		const remaining = listLogFiles(dir)
		assert.equal(remaining.length, 3, 'all files within retention should be preserved')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: handles files with different sequence numbers correctly', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 100)   // very old
		createLogFile(dir, 10, 50)   // old
		createLogFile(dir, 100, 30)  // old
		createLogFile(dir, 200, 1)   // recent — highest seq

		pruneActivityLogs(dir, 7)

		const remaining = listLogFiles(dir)
		assert.ok(remaining.some(f => f.startsWith('200-')), 'highest seq preserved')
		assert.ok(!remaining.some(f => f.startsWith('001-')), 'seq 1 pruned')
		assert.ok(!remaining.some(f => f.startsWith('010-')), 'seq 10 pruned')
		assert.ok(!remaining.some(f => f.startsWith('100-')), 'seq 100 pruned')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: single file is always preserved (it is highest seq)', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 365)  // 1 year old

		pruneActivityLogs(dir, 7)

		const remaining = listLogFiles(dir)
		assert.equal(remaining.length, 1, 'single file (highest seq) must be preserved')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: ignores non-matching filenames', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// Create a file that does not match the expected pattern
		writeFileSync(join(dir, 'README.md'), 'not a log file', 'utf-8')
		writeFileSync(join(dir, 'notes.txt'), 'random notes', 'utf-8')
		createLogFile(dir, 1, 30)  // old log
		createLogFile(dir, 2, 1)   // recent log — highest seq

		pruneActivityLogs(dir, 7)

		const allFiles = readdirSync(dir).sort()
		assert.ok(allFiles.includes('README.md'), 'non-log files should be untouched')
		assert.ok(allFiles.includes('notes.txt'), 'non-log files should be untouched')
		assert.ok(allFiles.some(f => f.startsWith('002-')), 'highest seq log preserved')
		assert.ok(!allFiles.some(f => f.startsWith('001-')), 'old log pruned')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: mixed retention — some pruned, some preserved', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 20, 'task', 'old-task')    // old, prune
		createLogFile(dir, 2, 3, 'task', 'recent-task')   // within retention
		createLogFile(dir, 3, 15, 'slice', 'old-slice')   // old, prune
		createLogFile(dir, 4, 2, 'slice', 'recent-slice') // within retention
		createLogFile(dir, 5, 1, 'task', 'newest')         // highest seq, within retention

		pruneActivityLogs(dir, 7)

		const remaining = listLogFiles(dir)
		assert.ok(!remaining.some(f => f.startsWith('001-')), 'seq 1 (old) pruned')
		assert.ok(remaining.some(f => f.startsWith('002-')), 'seq 2 (recent) preserved')
		assert.ok(!remaining.some(f => f.startsWith('003-')), 'seq 3 (old) pruned')
		assert.ok(remaining.some(f => f.startsWith('004-')), 'seq 4 (recent) preserved')
		assert.ok(remaining.some(f => f.startsWith('005-')), 'seq 5 (highest) preserved')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: retention of 0 days prunes all except highest seq', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 2)
		createLogFile(dir, 2, 1)
		createLogFile(dir, 3, 0)  // highest seq — just created

		pruneActivityLogs(dir, 0)

		const remaining = listLogFiles(dir)
		// With retentionDays=0, cutoff = Date.now(), so files with mtime <= now are prunable
		// But highest seq (3) is always preserved
		assert.ok(remaining.some(f => f.startsWith('003-')), 'highest seq always preserved')
		// seq 1 and 2 should be pruned (mtime is in the past)
		assert.ok(!remaining.some(f => f.startsWith('001-')), 'seq 1 pruned with 0 retention')
		assert.ok(!remaining.some(f => f.startsWith('002-')), 'seq 2 pruned with 0 retention')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: large retention period preserves all files', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 1, 30)
		createLogFile(dir, 2, 60)
		createLogFile(dir, 3, 90)

		pruneActivityLogs(dir, 365)  // retain for a full year

		const remaining = listLogFiles(dir)
		assert.equal(remaining.length, 3, 'all files within large retention window')
	} finally {
		cleanup()
	}
})

test('pruneActivityLogs: two files with same age, different seq — only highest preserved when old', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		createLogFile(dir, 3, 20)
		createLogFile(dir, 7, 20)  // same age, higher seq

		pruneActivityLogs(dir, 7)

		const remaining = listLogFiles(dir)
		assert.ok(remaining.some(f => f.startsWith('007-')), 'highest seq preserved')
		assert.ok(!remaining.some(f => f.startsWith('003-')), 'lower seq pruned when old')
	} finally {
		cleanup()
	}
})
