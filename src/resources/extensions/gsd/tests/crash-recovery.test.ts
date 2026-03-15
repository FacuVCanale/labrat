/**
 * Tests for GSD crash-recovery: lock file write/read/clear round-trips
 * and formatCrashInfo display output.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	writeLock,
	clearLock,
	readCrashLock,
	formatCrashInfo,
	type LockData,
} from '../crash-recovery.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'crash-recovery-test-'))
	// crash-recovery writes into <basePath>/.gsd/
	mkdirSync(join(dir, '.gsd'), { recursive: true })
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ═══════════════════════════════════════════════════════════════════════════
// writeLock / readCrashLock round-trip
// ═══════════════════════════════════════════════════════════════════════════

test('writeLock creates a lock file that readCrashLock can read', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'slice', 'S01', 3)
		const lock = readCrashLock(dir)

		assert.ok(lock, 'readCrashLock should return non-null after writeLock')
		assert.equal(lock.unitType, 'slice')
		assert.equal(lock.unitId, 'S01')
		assert.equal(lock.completedUnits, 3)
		assert.equal(lock.pid, process.pid)
	} finally {
		cleanup()
	}
})

test('writeLock stores sessionFile when provided', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'task', 'T02', 1, '/tmp/session.jsonl')
		const lock = readCrashLock(dir)

		assert.ok(lock)
		assert.equal(lock.sessionFile, '/tmp/session.jsonl')
	} finally {
		cleanup()
	}
})

test('writeLock stores undefined sessionFile when omitted', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'task', 'T03', 0)
		const lock = readCrashLock(dir)

		assert.ok(lock)
		assert.equal(lock.sessionFile, undefined)
	} finally {
		cleanup()
	}
})

test('writeLock records valid ISO timestamps', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const before = new Date().toISOString()
		writeLock(dir, 'slice', 'S10', 0)
		const after = new Date().toISOString()
		const lock = readCrashLock(dir)

		assert.ok(lock)
		assert.ok(lock.startedAt >= before, 'startedAt should be >= test start')
		assert.ok(lock.startedAt <= after, 'startedAt should be <= test end')
		assert.ok(lock.unitStartedAt >= before)
		assert.ok(lock.unitStartedAt <= after)
	} finally {
		cleanup()
	}
})

test('writeLock overwrites previous lock file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'slice', 'S01', 0)
		writeLock(dir, 'task', 'T99', 5, '/tmp/new-session.jsonl')
		const lock = readCrashLock(dir)

		assert.ok(lock)
		assert.equal(lock.unitType, 'task')
		assert.equal(lock.unitId, 'T99')
		assert.equal(lock.completedUnits, 5)
		assert.equal(lock.sessionFile, '/tmp/new-session.jsonl')
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// clearLock
// ═══════════════════════════════════════════════════════════════════════════

test('clearLock removes the lock file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'slice', 'S01', 2)
		assert.ok(readCrashLock(dir), 'lock should exist before clear')

		clearLock(dir)
		assert.equal(readCrashLock(dir), null, 'lock should be null after clear')
	} finally {
		cleanup()
	}
})

test('clearLock is idempotent — calling twice does not throw', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		writeLock(dir, 'slice', 'S01', 0)
		clearLock(dir)
		clearLock(dir) // second call should not throw
		assert.equal(readCrashLock(dir), null)
	} finally {
		cleanup()
	}
})

test('clearLock on directory with no lock file does not throw', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		// No writeLock call — .gsd exists but no auto.lock
		clearLock(dir) // should not throw
		assert.equal(readCrashLock(dir), null)
	} finally {
		cleanup()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// readCrashLock edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('readCrashLock returns null when no lock file exists', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const lock = readCrashLock(dir)
		assert.equal(lock, null)
	} finally {
		cleanup()
	}
})

test('readCrashLock returns null for corrupt JSON', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const lockFile = join(dir, '.gsd', 'auto.lock')
		writeFileSync(lockFile, '{not valid json!!!', 'utf-8')
		const lock = readCrashLock(dir)
		assert.equal(lock, null)
	} finally {
		cleanup()
	}
})

test('readCrashLock returns null for empty file', () => {
	const { dir, cleanup } = makeTmpDir()
	try {
		const lockFile = join(dir, '.gsd', 'auto.lock')
		writeFileSync(lockFile, '', 'utf-8')
		const lock = readCrashLock(dir)
		assert.equal(lock, null)
	} finally {
		cleanup()
	}
})

test('readCrashLock returns null when .gsd directory does not exist', () => {
	const bare = mkdtempSync(join(tmpdir(), 'crash-recovery-bare-'))
	try {
		// No .gsd subdirectory at all
		const lock = readCrashLock(bare)
		assert.equal(lock, null)
	} finally {
		rmSync(bare, { recursive: true, force: true })
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// formatCrashInfo
// ═══════════════════════════════════════════════════════════════════════════

test('formatCrashInfo includes all standard fields', () => {
	const lock: LockData = {
		pid: 12345,
		startedAt: '2025-06-01T10:00:00.000Z',
		unitType: 'slice',
		unitId: 'S03',
		unitStartedAt: '2025-06-01T10:05:00.000Z',
		completedUnits: 7,
	}
	const out = formatCrashInfo(lock)

	assert.ok(out.includes('Previous auto-mode session was interrupted'))
	assert.ok(out.includes('slice'))
	assert.ok(out.includes('S03'))
	assert.ok(out.includes('2025-06-01T10:05:00.000Z'))
	assert.ok(out.includes('7'))
	assert.ok(out.includes('12345'))
})

test('formatCrashInfo includes experimentNumber when present', () => {
	const lock: LockData = {
		pid: 99,
		startedAt: '2025-06-01T10:00:00.000Z',
		unitType: 'run-experiment',
		unitId: 'E01',
		unitStartedAt: '2025-06-01T10:05:00.000Z',
		completedUnits: 2,
		experimentNumber: 4,
	}
	const out = formatCrashInfo(lock)

	assert.ok(out.includes('Experiment number: 4'))
})

test('formatCrashInfo omits experimentNumber line when absent', () => {
	const lock: LockData = {
		pid: 99,
		startedAt: '2025-06-01T10:00:00.000Z',
		unitType: 'slice',
		unitId: 'S01',
		unitStartedAt: '2025-06-01T10:05:00.000Z',
		completedUnits: 0,
	}
	const out = formatCrashInfo(lock)

	assert.ok(!out.includes('Experiment number'))
})

test('formatCrashInfo output has correct line structure', () => {
	const lock: LockData = {
		pid: 1,
		startedAt: '2025-01-01T00:00:00.000Z',
		unitType: 'task',
		unitId: 'T01',
		unitStartedAt: '2025-01-01T00:01:00.000Z',
		completedUnits: 0,
	}
	const lines = formatCrashInfo(lock).split('\n')

	assert.equal(lines.length, 5, 'should have exactly 5 lines without experimentNumber')
	assert.ok(lines[0].startsWith('Previous auto-mode session'))
	assert.ok(lines[1].includes('Was executing'))
	assert.ok(lines[2].includes('Started at'))
	assert.ok(lines[3].includes('Units completed before crash'))
	assert.ok(lines[4].includes('PID'))
})

test('formatCrashInfo with experimentNumber has 6 lines', () => {
	const lock: LockData = {
		pid: 1,
		startedAt: '2025-01-01T00:00:00.000Z',
		unitType: 'run-experiment',
		unitId: 'E01',
		unitStartedAt: '2025-01-01T00:01:00.000Z',
		completedUnits: 0,
		experimentNumber: 1,
	}
	const lines = formatCrashInfo(lock).split('\n')

	assert.equal(lines.length, 6, 'should have 6 lines with experimentNumber')
	assert.ok(lines[5].includes('Experiment number: 1'))
})

test('formatCrashInfo formats unitType and unitId in parentheses', () => {
	const lock: LockData = {
		pid: 1,
		startedAt: '2025-01-01T00:00:00.000Z',
		unitType: 'my-type',
		unitId: 'my-id',
		unitStartedAt: '2025-01-01T00:01:00.000Z',
		completedUnits: 0,
	}
	const out = formatCrashInfo(lock)

	assert.ok(out.includes('my-type (my-id)'))
})
