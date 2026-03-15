/**
 * Tests for AsyncJobManager: registration, cancellation, limits,
 * delivery acknowledgement, and shutdown.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { AsyncJobManager, type Job } from '../resources/extensions/async-jobs/job-manager.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a deferred promise that can be resolved/rejected externally. */
function deferred<T = string>(): {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason: unknown) => void
} {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/** Wait for a job to leave the "running" state. */
async function waitForJobDone(mgr: AsyncJobManager, id: string, timeoutMs = 2000): Promise<Job> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const job = mgr.getJob(id)
		if (job && job.status !== 'running') return job
		await new Promise(r => setTimeout(r, 10))
	}
	throw new Error(`Job ${id} did not finish within ${timeoutMs}ms`)
}

// ═══════════════════════════════════════════════════════════════════════════
// register — success path
// ═══════════════════════════════════════════════════════════════════════════

test('register: job that completes has status "completed" and resultText set', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id = mgr.register('bash', 'echo hello', async () => 'hello world')
		assert.ok(id.startsWith('bg_'))

		const job = await waitForJobDone(mgr, id)
		assert.equal(job.status, 'completed')
		assert.equal(job.resultText, 'hello world')
		assert.equal(job.errorText, undefined)
	} finally {
		mgr.shutdown()
	}
})

test('register: job ID starts with bg_ prefix', async () => {
	const mgr = new AsyncJobManager()
	try {
		const id = mgr.register('bash', 'test', async () => 'ok')
		assert.ok(id.startsWith('bg_'))
		assert.ok(id.length > 3)
		await waitForJobDone(mgr, id)
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// register — failure path
// ═══════════════════════════════════════════════════════════════════════════

test('register: job that fails has status "failed" and errorText set', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id = mgr.register('bash', 'will fail', async () => {
			throw new Error('command not found')
		})

		const job = await waitForJobDone(mgr, id)
		assert.equal(job.status, 'failed')
		assert.equal(job.errorText, 'command not found')
		assert.equal(job.resultText, undefined)
	} finally {
		mgr.shutdown()
	}
})

test('register: job that throws non-Error has errorText as string', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id = mgr.register('bash', 'string throw', async () => {
			throw 'raw string error'
		})

		const job = await waitForJobDone(mgr, id)
		assert.equal(job.status, 'failed')
		assert.equal(job.errorText, 'raw string error')
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// cancel
// ═══════════════════════════════════════════════════════════════════════════

test('cancel: running job returns "cancelled" and sets status', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const { promise, resolve } = deferred()
		const id = mgr.register('bash', 'long running', async (signal) => {
			await promise
			return 'done'
		})

		const result = mgr.cancel(id)
		assert.equal(result, 'cancelled')

		const job = mgr.getJob(id)!
		assert.equal(job.status, 'cancelled')
		assert.equal(job.errorText, 'Cancelled by user')

		// Resolve promise and wait for handlers to settle before shutdown
		resolve('unused')
		await Promise.allSettled([job.promise])
	} finally {
		mgr.shutdown()
	}
})

test('cancel: non-existent job returns "not_found"', () => {
	const mgr = new AsyncJobManager()
	try {
		assert.equal(mgr.cancel('bg_nonexistent'), 'not_found')
	} finally {
		mgr.shutdown()
	}
})

test('cancel: already completed job returns "already_completed"', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id = mgr.register('bash', 'quick', async () => 'done')
		await waitForJobDone(mgr, id)

		assert.equal(mgr.cancel(id), 'already_completed')
	} finally {
		mgr.shutdown()
	}
})

test('cancel: already failed job returns "already_completed"', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id = mgr.register('bash', 'fail', async () => {
			throw new Error('boom')
		})
		await waitForJobDone(mgr, id)

		assert.equal(mgr.cancel(id), 'already_completed')
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// Max limits
// ═══════════════════════════════════════════════════════════════════════════

test('register: exceeding maxRunning throws error', async () => {
	const mgr = new AsyncJobManager({ maxRunning: 2, evictionMs: 60_000 })
	try {
		const deferreds = [deferred(), deferred(), deferred()]
		const id1 = mgr.register('bash', 'job1', async () => { await deferreds[0].promise; return 'a' })
		const id2 = mgr.register('bash', 'job2', async () => { await deferreds[1].promise; return 'b' })

		assert.throws(
			() => mgr.register('bash', 'job3', async () => { await deferreds[2].promise; return 'c' }),
			/Maximum concurrent background jobs reached/,
		)

		// Resolve and wait for all promises to settle before shutdown
		deferreds.forEach(d => d.resolve('x'))
		await waitForJobDone(mgr, id1)
		await waitForJobDone(mgr, id2)
	} finally {
		mgr.shutdown()
	}
})

test('register: exceeding maxTotal evicts oldest completed job', async () => {
	const mgr = new AsyncJobManager({ maxTotal: 3, maxRunning: 10, evictionMs: 60_000 })
	try {
		// Fill with completed jobs
		const id1 = mgr.register('bash', 'first', async () => 'r1')
		const id2 = mgr.register('bash', 'second', async () => 'r2')
		const id3 = mgr.register('bash', 'third', async () => 'r3')

		await waitForJobDone(mgr, id1)
		await waitForJobDone(mgr, id2)
		await waitForJobDone(mgr, id3)

		assert.equal(mgr.getAllJobs().length, 3)

		// Adding a 4th should evict the oldest completed
		const id4 = mgr.register('bash', 'fourth', async () => 'r4')
		await waitForJobDone(mgr, id4)

		// id1 (oldest) should have been evicted
		assert.equal(mgr.getJob(id1), undefined)
		assert.ok(mgr.getJob(id4))
	} finally {
		mgr.shutdown()
	}
})

test('register: maxTotal with all running throws when no evictable jobs', async () => {
	const mgr = new AsyncJobManager({ maxTotal: 2, maxRunning: 5, evictionMs: 60_000 })
	try {
		const deferreds = [deferred(), deferred(), deferred()]
		const id1 = mgr.register('bash', 'j1', async () => { await deferreds[0].promise; return 'a' })
		const id2 = mgr.register('bash', 'j2', async () => { await deferreds[1].promise; return 'b' })

		assert.throws(
			() => mgr.register('bash', 'j3', async () => { await deferreds[2].promise; return 'c' }),
			/Maximum total background jobs reached/,
		)

		// Resolve and wait for all promises to settle before shutdown
		deferreds.forEach(d => d.resolve('x'))
		await waitForJobDone(mgr, id1)
		await waitForJobDone(mgr, id2)
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// getRunningJobs / getRecentJobs / getAllJobs / getJob
// ═══════════════════════════════════════════════════════════════════════════

test('getRunningJobs: returns only running jobs', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const { promise, resolve } = deferred()
		const runningId = mgr.register('bash', 'still running', async () => { await promise; return 'ok' })
		const doneId = mgr.register('bash', 'quick', async () => 'done')

		await waitForJobDone(mgr, doneId)

		const running = mgr.getRunningJobs()
		assert.equal(running.length, 1)
		assert.equal(running[0].id, runningId)

		// Resolve and wait for promise to settle before shutdown
		resolve('cleanup')
		await waitForJobDone(mgr, runningId)
	} finally {
		mgr.shutdown()
	}
})

test('getRecentJobs: respects limit parameter', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const ids: string[] = []
		for (let i = 0; i < 5; i++) {
			ids.push(mgr.register('bash', `job${i}`, async () => `result${i}`))
		}
		for (const id of ids) await waitForJobDone(mgr, id)

		const recent = mgr.getRecentJobs(3)
		assert.equal(recent.length, 3)
	} finally {
		mgr.shutdown()
	}
})

test('getRecentJobs: returns jobs sorted by startTime descending', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id1 = mgr.register('bash', 'first', async () => 'a')
		const id2 = mgr.register('bash', 'second', async () => 'b')
		await waitForJobDone(mgr, id1)
		await waitForJobDone(mgr, id2)

		const recent = mgr.getRecentJobs(10)
		assert.ok(recent.length >= 2)
		// Most recent first
		assert.ok(recent[0].startTime >= recent[1].startTime)
	} finally {
		mgr.shutdown()
	}
})

test('getJob: returns undefined for unknown id', () => {
	const mgr = new AsyncJobManager()
	try {
		assert.equal(mgr.getJob('bg_unknown'), undefined)
	} finally {
		mgr.shutdown()
	}
})

test('getAllJobs: returns all tracked jobs', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		const id1 = mgr.register('bash', 'a', async () => 'x')
		const id2 = mgr.register('bash', 'b', async () => 'y')
		const all = mgr.getAllJobs()
		assert.equal(all.length, 2)
		await waitForJobDone(mgr, id1)
		await waitForJobDone(mgr, id2)
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// onJobComplete callback
// ═══════════════════════════════════════════════════════════════════════════

test('onJobComplete: callback fires when job completes', async () => {
	const completedJobs: Job[] = []
	const mgr = new AsyncJobManager({
		evictionMs: 60_000,
		onJobComplete: (job) => completedJobs.push(job),
	})
	try {
		const id = mgr.register('bash', 'callback test', async () => 'result')
		await waitForJobDone(mgr, id)
		// Give a moment for the callback to fire
		await new Promise(r => setTimeout(r, 50))

		assert.ok(completedJobs.length >= 1)
		assert.equal(completedJobs[0].id, id)
		assert.equal(completedJobs[0].status, 'completed')

		mgr.acknowledgeDeliveries([id])
	} finally {
		mgr.shutdown()
	}
})

test('onJobComplete: callback fires when job fails', async () => {
	const completedJobs: Job[] = []
	const mgr = new AsyncJobManager({
		evictionMs: 60_000,
		onJobComplete: (job) => completedJobs.push(job),
	})
	try {
		const id = mgr.register('bash', 'fail callback', async () => {
			throw new Error('kaboom')
		})
		await waitForJobDone(mgr, id)
		await new Promise(r => setTimeout(r, 50))

		assert.ok(completedJobs.length >= 1)
		assert.equal(completedJobs[0].status, 'failed')

		mgr.acknowledgeDeliveries([id])
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// acknowledgeDeliveries
// ═══════════════════════════════════════════════════════════════════════════

test('acknowledgeDeliveries: stops retry delivery', async () => {
	let callCount = 0
	const mgr = new AsyncJobManager({
		evictionMs: 60_000,
		onJobComplete: () => { callCount++ },
	})
	try {
		const id = mgr.register('bash', 'ack test', async () => 'done')
		await waitForJobDone(mgr, id)
		await new Promise(r => setTimeout(r, 50))

		const countBefore = callCount
		mgr.acknowledgeDeliveries([id])

		// Wait and confirm no additional calls happen
		await new Promise(r => setTimeout(r, 800))
		assert.equal(callCount, countBefore, 'no additional deliveries after acknowledgement')
	} finally {
		mgr.shutdown()
	}
})

test('acknowledgeDeliveries: handles unknown job ids gracefully', () => {
	const mgr = new AsyncJobManager()
	try {
		// Should not throw
		mgr.acknowledgeDeliveries(['bg_unknown1', 'bg_unknown2'])
	} finally {
		mgr.shutdown()
	}
})

// ═══════════════════════════════════════════════════════════════════════════
// shutdown
// ═══════════════════════════════════════════════════════════════════════════

test('shutdown: aborts all running jobs', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	const deferreds = [deferred(), deferred()]
	const id1 = mgr.register('bash', 'running1', async () => { await deferreds[0].promise; return 'a' })
	const id2 = mgr.register('bash', 'running2', async () => { await deferreds[1].promise; return 'b' })

	mgr.shutdown()

	const job1 = mgr.getJob(id1)!
	const job2 = mgr.getJob(id2)!
	assert.equal(job1.status, 'cancelled')
	assert.equal(job2.status, 'cancelled')

	// Resolve dangling promises and wait for .catch handlers to settle
	deferreds.forEach(d => d.resolve('x'))
	await Promise.allSettled([job1.promise, job2.promise])
	// Clear any timers created by post-shutdown .catch handlers
	mgr.shutdown()
})

test('shutdown: cancelled jobs do not overwrite status on rejection', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	const { promise, reject } = deferred()
	const id = mgr.register('bash', 'will cancel', async (signal) => {
		await promise
		return 'unreachable'
	})

	mgr.shutdown()
	const job = mgr.getJob(id)!
	assert.equal(job.status, 'cancelled')

	// Even if the promise rejects after shutdown, status stays 'cancelled'
	reject(new Error('aborted'))
	await Promise.allSettled([job.promise])
	assert.equal(job.status, 'cancelled')
	// Clear any timers created by post-shutdown .catch handlers
	mgr.shutdown()
})

test('register: job receives AbortSignal that is aborted on cancel', async () => {
	const mgr = new AsyncJobManager({ evictionMs: 60_000 })
	try {
		let capturedSignal: AbortSignal | undefined
		const { promise, resolve } = deferred()
		const id = mgr.register('bash', 'signal test', async (signal) => {
			capturedSignal = signal
			await promise
			return 'ok'
		})

		// Give time for runFn to start
		await new Promise(r => setTimeout(r, 20))
		assert.ok(capturedSignal)
		assert.equal(capturedSignal!.aborted, false)

		mgr.cancel(id)
		assert.equal(capturedSignal!.aborted, true)

		// Resolve and wait for promise to settle before shutdown
		resolve('cleanup')
		const job = mgr.getJob(id)!
		await Promise.allSettled([job.promise])
	} finally {
		mgr.shutdown()
	}
})
