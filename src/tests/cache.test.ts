/**
 * Tests for LRUTTLCache in search-the-web/cache.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { LRUTTLCache } from '../resources/extensions/search-the-web/cache.ts'

// =============================================================================
// Constructor
// =============================================================================

test('cache initializes with size 0', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	assert.equal(cache.size, 0)
})

// =============================================================================
// set / get basics
// =============================================================================

test('set and get round-trip a value', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	cache.set('key1', 'value1')
	assert.equal(cache.get('key1'), 'value1')
})

test('get returns undefined for missing key', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	assert.equal(cache.get('nonexistent'), undefined)
})

test('set overwrites existing key', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	cache.set('key', 'old')
	cache.set('key', 'new')
	assert.equal(cache.get('key'), 'new')
	assert.equal(cache.size, 1)
})

test('set increments size for each new key', () => {
	const cache = new LRUTTLCache<number>({ max: 10, ttlMs: 60_000 })
	cache.set('a', 1)
	cache.set('b', 2)
	cache.set('c', 3)
	assert.equal(cache.size, 3)
})

test('cache stores various value types', () => {
	const cache = new LRUTTLCache<{ data: number[] }>({ max: 10, ttlMs: 60_000 })
	const obj = { data: [1, 2, 3] }
	cache.set('obj', obj)
	assert.deepEqual(cache.get('obj'), obj)
})

// =============================================================================
// LRU eviction
// =============================================================================

test('evicts oldest entry when max is exceeded', () => {
	const cache = new LRUTTLCache<string>({ max: 3, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.set('c', '3')
	cache.set('d', '4') // should evict 'a'
	assert.equal(cache.get('a'), undefined)
	assert.equal(cache.get('b'), '2')
	assert.equal(cache.get('d'), '4')
	assert.equal(cache.size, 3)
})

test('get refreshes entry to most-recently-used position', () => {
	const cache = new LRUTTLCache<string>({ max: 3, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.set('c', '3')
	// Access 'a' to move it to tail (most recent)
	cache.get('a')
	// Now 'b' is oldest, adding 'd' should evict 'b'
	cache.set('d', '4')
	assert.equal(cache.get('b'), undefined)
	assert.equal(cache.get('a'), '1')
	assert.equal(cache.size, 3)
})

test('set on existing key does not cause eviction', () => {
	const cache = new LRUTTLCache<string>({ max: 2, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.set('a', 'updated') // overwrite, not a new entry
	assert.equal(cache.size, 2)
	assert.equal(cache.get('a'), 'updated')
	assert.equal(cache.get('b'), '2')
})

test('eviction with max of 1', () => {
	const cache = new LRUTTLCache<string>({ max: 1, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2') // evicts 'a'
	assert.equal(cache.get('a'), undefined)
	assert.equal(cache.get('b'), '2')
	assert.equal(cache.size, 1)
})

// =============================================================================
// TTL expiration
// =============================================================================

test('get returns undefined after TTL expires', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 50 })
	cache.set('key', 'value')
	assert.equal(cache.get('key'), 'value')
	await new Promise((r) => setTimeout(r, 80))
	assert.equal(cache.get('key'), undefined)
})

test('expired entry is deleted on access', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 50 })
	cache.set('key', 'value')
	await new Promise((r) => setTimeout(r, 80))
	cache.get('key') // triggers deletion
	assert.equal(cache.size, 0)
})

test('non-expired entries remain accessible', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 5000 })
	cache.set('key', 'value')
	await new Promise((r) => setTimeout(r, 10))
	assert.equal(cache.get('key'), 'value')
})

// =============================================================================
// has()
// =============================================================================

test('has returns true for existing key', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	cache.set('key', 'value')
	assert.equal(cache.has('key'), true)
})

test('has returns false for missing key', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	assert.equal(cache.has('missing'), false)
})

test('has returns false for expired key', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 50 })
	cache.set('key', 'value')
	await new Promise((r) => setTimeout(r, 80))
	assert.equal(cache.has('key'), false)
})

// =============================================================================
// purgeStale
// =============================================================================

test('purgeStale removes all expired entries', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 50 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.set('c', '3')
	await new Promise((r) => setTimeout(r, 80))
	assert.equal(cache.size, 3) // still in store until purged
	cache.purgeStale()
	assert.equal(cache.size, 0)
})

test('purgeStale keeps non-expired entries', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 5000 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.purgeStale()
	assert.equal(cache.size, 2)
})

// =============================================================================
// startPurgeInterval / stopPurgeInterval
// =============================================================================

test('startPurgeInterval purges stale entries periodically', async () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 30 })
	cache.set('key', 'value')
	cache.startPurgeInterval(50)
	try {
		await new Promise((r) => setTimeout(r, 120))
		// TTL expired + purge interval fired -> entry should be gone
		assert.equal(cache.size, 0)
	} finally {
		cache.stopPurgeInterval()
	}
})

test('startPurgeInterval is idempotent (does not start multiple timers)', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	cache.startPurgeInterval(1000)
	cache.startPurgeInterval(1000) // second call should be no-op
	cache.stopPurgeInterval()
})

test('stopPurgeInterval is safe to call when no interval is running', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	// Should not throw
	cache.stopPurgeInterval()
})

// =============================================================================
// clear
// =============================================================================

test('clear removes all entries', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2')
	cache.set('c', '3')
	cache.clear()
	assert.equal(cache.size, 0)
	assert.equal(cache.get('a'), undefined)
	assert.equal(cache.get('b'), undefined)
	assert.equal(cache.get('c'), undefined)
})

// =============================================================================
// size property
// =============================================================================

test('size reflects current store count', () => {
	const cache = new LRUTTLCache<string>({ max: 10, ttlMs: 60_000 })
	assert.equal(cache.size, 0)
	cache.set('a', '1')
	assert.equal(cache.size, 1)
	cache.set('b', '2')
	assert.equal(cache.size, 2)
	cache.set('a', 'updated')
	assert.equal(cache.size, 2) // overwrite, not new
})

test('size decreases when entries are evicted', () => {
	const cache = new LRUTTLCache<string>({ max: 2, ttlMs: 60_000 })
	cache.set('a', '1')
	cache.set('b', '2')
	assert.equal(cache.size, 2)
	cache.set('c', '3') // evicts 'a'
	assert.equal(cache.size, 2)
})
