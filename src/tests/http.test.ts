/**
 * Tests for HTTP utilities in search-the-web/http.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
	HttpError,
	classifyError,
	extractRateLimitInfo,
	anySignal,
} from '../resources/extensions/search-the-web/http.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal mock Response with headers. */
function mockResponse(headers: Record<string, string> = {}, status = 200): Response {
	return {
		headers: new Headers(headers),
		ok: status >= 200 && status < 300,
		status,
		statusText: 'OK',
	} as unknown as Response
}

// =============================================================================
// HttpError
// =============================================================================

test('HttpError stores statusCode and message', () => {
	const err = new HttpError('Not Found', 404)
	assert.equal(err.message, 'Not Found')
	assert.equal(err.statusCode, 404)
	assert.equal(err.name, 'HttpError')
})

test('HttpError is an instance of Error', () => {
	const err = new HttpError('Server Error', 500)
	assert.ok(err instanceof Error)
})

test('HttpError is an instance of HttpError (prototype chain)', () => {
	const err = new HttpError('Bad Request', 400)
	assert.ok(err instanceof HttpError)
})

test('HttpError stores optional response', () => {
	const res = mockResponse()
	const err = new HttpError('OK', 200, res)
	assert.equal(err.response, res)
})

test('HttpError has no response when not provided', () => {
	const err = new HttpError('Error', 500)
	assert.equal(err.response, undefined)
})

// =============================================================================
// classifyError
// =============================================================================

test('classifyError returns auth_error for 401', () => {
	const err = new HttpError('Unauthorized', 401)
	const result = classifyError(err)
	assert.equal(result.kind, 'auth_error')
	assert.ok(result.message.includes('401'))
})

test('classifyError returns auth_error for 403', () => {
	const err = new HttpError('Forbidden', 403)
	const result = classifyError(err)
	assert.equal(result.kind, 'auth_error')
	assert.ok(result.message.includes('403'))
})

test('classifyError returns rate_limited for 429', () => {
	const err = new HttpError('Too Many Requests', 429)
	const result = classifyError(err)
	assert.equal(result.kind, 'rate_limited')
})

test('classifyError extracts retryAfterMs from Retry-After header on 429', () => {
	const res = mockResponse({ 'Retry-After': '30' }, 429)
	const err = new HttpError('Too Many Requests', 429, res)
	const result = classifyError(err)
	assert.equal(result.kind, 'rate_limited')
	assert.equal(result.retryAfterMs, 30_000)
})

test('classifyError returns rate_limited without retryAfterMs when no header', () => {
	const res = mockResponse({}, 429)
	const err = new HttpError('Too Many Requests', 429, res)
	const result = classifyError(err)
	assert.equal(result.kind, 'rate_limited')
	assert.equal(result.retryAfterMs, undefined)
})

test('classifyError returns invalid_request for 400', () => {
	const err = new HttpError('Bad params', 400)
	const result = classifyError(err)
	assert.equal(result.kind, 'invalid_request')
	assert.ok(result.message.includes('400'))
})

test('classifyError returns not_found for 404', () => {
	const err = new HttpError('Not Found', 404)
	const result = classifyError(err)
	assert.equal(result.kind, 'not_found')
})

test('classifyError returns server_error for 500', () => {
	const err = new HttpError('Internal Server Error', 500)
	const result = classifyError(err)
	assert.equal(result.kind, 'server_error')
	assert.ok(result.message.includes('500'))
})

test('classifyError returns server_error for 503', () => {
	const err = new HttpError('Service Unavailable', 503)
	const result = classifyError(err)
	assert.equal(result.kind, 'server_error')
})

test('classifyError returns unknown for unhandled HTTP code (418)', () => {
	const err = new HttpError("I'm a teapot", 418)
	const result = classifyError(err)
	assert.equal(result.kind, 'unknown')
	assert.ok(result.message.includes('418'))
})

test('classifyError returns network_error for TypeError', () => {
	const err = new TypeError('fetch failed')
	const result = classifyError(err)
	assert.equal(result.kind, 'network_error')
	assert.ok(result.message.includes('fetch failed'))
})

test('classifyError returns network_error for abort/timeout messages', () => {
	const err = new Error('The operation was aborted')
	const result = classifyError(err)
	assert.equal(result.kind, 'network_error')
	assert.ok(result.message.includes('timed out'))
})

test('classifyError returns network_error for timeout message', () => {
	const err = new Error('Request timeout exceeded')
	const result = classifyError(err)
	assert.equal(result.kind, 'network_error')
})

test('classifyError returns unknown for generic errors', () => {
	const err = new Error('Something weird happened')
	const result = classifyError(err)
	assert.equal(result.kind, 'unknown')
	assert.ok(result.message.includes('Something weird happened'))
})

test('classifyError handles non-Error values', () => {
	const result = classifyError('string error')
	assert.equal(result.kind, 'unknown')
	assert.ok(result.message.includes('string error'))
})

// =============================================================================
// extractRateLimitInfo
// =============================================================================

test('extractRateLimitInfo returns all rate limit headers', () => {
	const res = mockResponse({
		'x-ratelimit-remaining': '42',
		'x-ratelimit-limit': '100',
		'x-ratelimit-reset': '1700000000',
	})
	const info = extractRateLimitInfo(res)
	assert.deepEqual(info, {
		remaining: 42,
		limit: 100,
		reset: 1700000000,
	})
})

test('extractRateLimitInfo returns undefined when no rate limit headers', () => {
	const res = mockResponse({})
	assert.equal(extractRateLimitInfo(res), undefined)
})

test('extractRateLimitInfo handles partial headers (remaining only)', () => {
	const res = mockResponse({ 'x-ratelimit-remaining': '5' })
	const info = extractRateLimitInfo(res)
	assert.ok(info !== undefined)
	assert.equal(info!.remaining, 5)
	assert.equal(info!.limit, undefined)
	assert.equal(info!.reset, undefined)
})

test('extractRateLimitInfo handles partial headers (limit only)', () => {
	const res = mockResponse({ 'x-ratelimit-limit': '1000' })
	const info = extractRateLimitInfo(res)
	assert.ok(info !== undefined)
	assert.equal(info!.limit, 1000)
	assert.equal(info!.remaining, undefined)
})

test('extractRateLimitInfo parses integer values correctly', () => {
	const res = mockResponse({
		'x-ratelimit-remaining': '0',
		'x-ratelimit-limit': '60',
	})
	const info = extractRateLimitInfo(res)
	assert.equal(info!.remaining, 0)
	assert.equal(info!.limit, 60)
})

// =============================================================================
// anySignal
// =============================================================================

test('anySignal returns an AbortSignal', () => {
	const controller = new AbortController()
	const merged = anySignal([controller.signal])
	assert.ok(merged instanceof AbortSignal)
})

test('anySignal fires when any input signal aborts', () => {
	const c1 = new AbortController()
	const c2 = new AbortController()
	const merged = anySignal([c1.signal, c2.signal])
	assert.equal(merged.aborted, false)
	c1.abort('reason1')
	assert.equal(merged.aborted, true)
	assert.equal(merged.reason, 'reason1')
})

test('anySignal fires from second signal', () => {
	const c1 = new AbortController()
	const c2 = new AbortController()
	const merged = anySignal([c1.signal, c2.signal])
	c2.abort('reason2')
	assert.equal(merged.aborted, true)
	assert.equal(merged.reason, 'reason2')
})

test('anySignal is immediately aborted if input signal already aborted', () => {
	const c1 = new AbortController()
	c1.abort('pre-aborted')
	const merged = anySignal([c1.signal])
	assert.equal(merged.aborted, true)
	assert.equal(merged.reason, 'pre-aborted')
})

test('anySignal handles empty signals array', () => {
	const merged = anySignal([])
	assert.equal(merged.aborted, false)
})

test('anySignal propagates the reason of the first signal to abort', () => {
	const c1 = new AbortController()
	const c2 = new AbortController()
	const c3 = new AbortController()
	const merged = anySignal([c1.signal, c2.signal, c3.signal])
	c2.abort(new Error('custom reason'))
	assert.ok(merged.reason instanceof Error)
	assert.equal(merged.reason.message, 'custom reason')
})
