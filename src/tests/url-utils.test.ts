/**
 * Tests for URL normalization and query utilities in search-the-web/url-utils.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
	normalizeQuery,
	toDedupeKey,
	extractDomain,
	detectFreshness,
	detectDomainHints,
} from '../resources/extensions/search-the-web/url-utils.ts'

// =============================================================================
// normalizeQuery
// =============================================================================

test('normalizeQuery trims leading and trailing whitespace', () => {
	assert.equal(normalizeQuery('  hello world  '), 'hello world')
})

test('normalizeQuery lowercases the input', () => {
	assert.equal(normalizeQuery('Hello WORLD'), 'hello world')
})

test('normalizeQuery collapses multiple spaces into one', () => {
	assert.equal(normalizeQuery('hello   world   foo'), 'hello world foo')
})

test('normalizeQuery applies NFC normalization', () => {
	// e + combining acute accent (NFD) vs e-acute (NFC)
	const nfd = 'caf\u0065\u0301'
	const nfc = 'caf\u00e9'
	assert.equal(normalizeQuery(nfd), nfc)
})

test('normalizeQuery handles empty string', () => {
	assert.equal(normalizeQuery(''), '')
})

test('normalizeQuery handles string of only whitespace', () => {
	assert.equal(normalizeQuery('   '), '')
})

test('normalizeQuery combines trim, lowercase, collapse, and NFC', () => {
	assert.equal(normalizeQuery('  Hello    WORLD  '), 'hello world')
})

// =============================================================================
// toDedupeKey
// =============================================================================

test('toDedupeKey lowercases hostname', () => {
	const result = toDedupeKey('https://Example.COM/path')
	assert.equal(result, 'https://example.com/path')
})

test('toDedupeKey strips fragment', () => {
	const result = toDedupeKey('https://example.com/page#section')
	assert.equal(result, 'https://example.com/page')
})

test('toDedupeKey strips utm_ tracking params', () => {
	const result = toDedupeKey('https://example.com/page?utm_source=google&utm_medium=cpc&q=test')
	assert.equal(result, 'https://example.com/page?q=test')
})

test('toDedupeKey strips fbclid and gclid params', () => {
	const result = toDedupeKey('https://example.com/page?fbclid=abc&gclid=def&q=test')
	assert.equal(result, 'https://example.com/page?q=test')
})

test('toDedupeKey sorts query params alphabetically', () => {
	const result = toDedupeKey('https://example.com/page?z=1&a=2&m=3')
	assert.equal(result, 'https://example.com/page?a=2&m=3&z=1')
})

test('toDedupeKey strips trailing / on root paths without query', () => {
	const result = toDedupeKey('https://example.com/')
	assert.equal(result, 'https://example.com')
})

test('toDedupeKey does not strip trailing / on non-root paths', () => {
	const result = toDedupeKey('https://example.com/path/')
	assert.equal(result, 'https://example.com/path/')
})

test('toDedupeKey returns null for invalid URL', () => {
	assert.equal(toDedupeKey('not a url'), null)
})

test('toDedupeKey keeps non-tracking params', () => {
	const result = toDedupeKey('https://example.com/search?q=test&page=2')
	assert.equal(result, 'https://example.com/search?page=2&q=test')
})

test('toDedupeKey handles URL with only tracking params', () => {
	const result = toDedupeKey('https://example.com/page?utm_source=google&fbclid=abc')
	assert.equal(result, 'https://example.com/page')
})

// =============================================================================
// extractDomain
// =============================================================================

test('extractDomain returns hostname from URL', () => {
	assert.equal(extractDomain('https://docs.python.org/3/library/asyncio.html'), 'docs.python.org')
})

test('extractDomain strips www. prefix', () => {
	assert.equal(extractDomain('https://www.example.com/page'), 'example.com')
})

test('extractDomain returns raw string for invalid URL', () => {
	assert.equal(extractDomain('not-a-url'), 'not-a-url')
})

test('extractDomain handles URLs with ports', () => {
	assert.equal(extractDomain('https://localhost:3000/api'), 'localhost')
})

test('extractDomain handles subdomains beyond www', () => {
	assert.equal(extractDomain('https://blog.example.com/post'), 'blog.example.com')
})

// =============================================================================
// detectFreshness
// =============================================================================

test('detectFreshness returns py for current year', () => {
	const currentYear = new Date().getFullYear()
	const result = detectFreshness(`best laptops ${currentYear}`)
	assert.equal(result, 'py')
})

test('detectFreshness returns py for previous year', () => {
	const lastYear = new Date().getFullYear() - 1
	const result = detectFreshness(`events ${lastYear}`)
	assert.equal(result, 'py')
})

test('detectFreshness returns pm for "latest"', () => {
	assert.equal(detectFreshness('latest news on AI'), 'pm')
})

test('detectFreshness returns pm for "today"', () => {
	assert.equal(detectFreshness('weather today'), 'pm')
})

test('detectFreshness returns pm for "this week"', () => {
	assert.equal(detectFreshness('events this week'), 'pm')
})

test('detectFreshness returns pm for "breaking"', () => {
	assert.equal(detectFreshness('breaking news'), 'pm')
})

test('detectFreshness returns pm for "release notes"', () => {
	assert.equal(detectFreshness('node.js release notes'), 'pm')
})

test('detectFreshness returns pm for "what\'s new"', () => {
	assert.equal(detectFreshness("what's new in python"), 'pm')
})

test('detectFreshness returns null for timeless queries', () => {
	assert.equal(detectFreshness('how to sort an array in javascript'), null)
})

test('detectFreshness is case insensitive', () => {
	assert.equal(detectFreshness('LATEST NEWS'), 'pm')
})

// =============================================================================
// detectDomainHints
// =============================================================================

test('detectDomainHints extracts single site: pattern', () => {
	const result = detectDomainHints('python tutorial site:docs.python.org')
	assert.deepEqual(result, ['docs.python.org'])
})

test('detectDomainHints extracts multiple site: patterns', () => {
	const result = detectDomainHints('react hooks site:reactjs.org site:github.com')
	assert.deepEqual(result, ['reactjs.org', 'github.com'])
})

test('detectDomainHints returns null when no site: pattern', () => {
	assert.equal(detectDomainHints('python tutorial'), null)
})

test('detectDomainHints is case insensitive for site: prefix', () => {
	const result = detectDomainHints('test SITE:Example.com')
	assert.deepEqual(result, ['Example.com'])
})

test('detectDomainHints handles site: at beginning of query', () => {
	const result = detectDomainHints('site:stackoverflow.com javascript closures')
	assert.deepEqual(result, ['stackoverflow.com'])
})
