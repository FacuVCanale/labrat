/**
 * Tests for output formatting functions in search-the-web/format.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
	formatSearchResults,
	formatPageContent,
	formatLLMContext,
	formatMultiplePages,
	type SearchResultFormatted,
	type FormatSearchOptions,
	type FormatPageOptions,
	type LLMContextSnippet,
	type LLMContextSource,
} from '../resources/extensions/search-the-web/format.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<SearchResultFormatted> = {}): SearchResultFormatted {
	return {
		title: 'Test Title',
		url: 'https://example.com/page',
		description: 'A test description.',
		...overrides,
	}
}

// =============================================================================
// formatSearchResults
// =============================================================================

test('formatSearchResults includes query in header', () => {
	const output = formatSearchResults('test query', [])
	assert.ok(output.includes('Search: "test query"'))
})

test('formatSearchResults shows (cached) tag when option set', () => {
	const output = formatSearchResults('test', [], { cached: true })
	assert.ok(output.includes('(cached)'))
})

test('formatSearchResults shows "No results found." for empty array', () => {
	const output = formatSearchResults('test', [])
	assert.ok(output.includes('No results found.'))
})

test('formatSearchResults formats a single result with index, title, domain', () => {
	const result = makeResult({ title: 'My Page', url: 'https://docs.python.org/foo' })
	const output = formatSearchResults('python', [result])
	assert.ok(output.includes('[1] My Page'))
	assert.ok(output.includes('docs.python.org'))
	assert.ok(output.includes('https://docs.python.org/foo'))
})

test('formatSearchResults includes age when present', () => {
	const result = makeResult({ age: '2024-11' })
	const output = formatSearchResults('test', [result])
	assert.ok(output.includes('(2024-11)'))
})

test('formatSearchResults includes description', () => {
	const result = makeResult({ description: 'This is a great page.' })
	const output = formatSearchResults('test', [result])
	assert.ok(output.includes('This is a great page.'))
})

test('formatSearchResults includes extra_snippets for few results', () => {
	const result = makeResult({
		extra_snippets: ['Snippet one', 'Snippet two'],
	})
	const output = formatSearchResults('test', [result])
	assert.ok(output.includes('+ Snippet one'))
	assert.ok(output.includes('+ Snippet two'))
})

test('formatSearchResults limits extra_snippets based on result count', () => {
	// With 9+ results, maxSnippets = 0
	const results = Array.from({ length: 10 }, (_, i) =>
		makeResult({
			title: `Result ${i}`,
			url: `https://example.com/${i}`,
			extra_snippets: ['Should not appear'],
		})
	)
	const output = formatSearchResults('test', results)
	assert.ok(!output.includes('+ Should not appear'))
})

test('formatSearchResults shows more results hint', () => {
	const result = makeResult()
	const output = formatSearchResults('test', [result], { moreResultsAvailable: true })
	assert.ok(output.includes('[More results available'))
})

test('formatSearchResults shows query correction notice', () => {
	const result = makeResult()
	const output = formatSearchResults('pythn', [result], {
		queryCorrected: true,
		correctedQuery: 'python',
		originalQuery: 'pythn',
	})
	assert.ok(output.includes('corrected to "python"'))
	assert.ok(output.includes('original: "pythn"'))
})

test('formatSearchResults shows summary when provided', () => {
	const result = makeResult()
	const output = formatSearchResults('test', [result], { summary: 'AI-generated summary here.' })
	assert.ok(output.includes('Summary: AI-generated summary here.'))
})

test('formatSearchResults numbers multiple results sequentially', () => {
	const r1 = makeResult({ title: 'First', url: 'https://a.com/1' })
	const r2 = makeResult({ title: 'Second', url: 'https://b.com/2' })
	const r3 = makeResult({ title: 'Third', url: 'https://c.com/3' })
	const output = formatSearchResults('test', [r1, r2, r3])
	assert.ok(output.includes('[1] First'))
	assert.ok(output.includes('[2] Second'))
	assert.ok(output.includes('[3] Third'))
})

test('formatSearchResults cleans newlines from extra_snippets', () => {
	const result = makeResult({
		extra_snippets: ['line1\nline2\nline3'],
	})
	const output = formatSearchResults('test', [result])
	assert.ok(output.includes('+ line1 line2 line3'))
	assert.ok(!output.includes('+ line1\n'))
})

test('formatSearchResults strips www from domain in header line', () => {
	const result = makeResult({ url: 'https://www.example.com/page' })
	const output = formatSearchResults('test', [result])
	// The header line "[1] Title — domain" should use extractDomain which strips www.
	const headerLine = output.split('\n').find((l) => l.startsWith('[1]'))!
	assert.ok(headerLine.includes('example.com'))
	assert.ok(!headerLine.includes('www.example.com'))
})

// =============================================================================
// formatPageContent
// =============================================================================

test('formatPageContent includes domain and char count', () => {
	const output = formatPageContent('https://example.com/page', 'Page body', {
		charCount: 1000,
		truncated: false,
	})
	assert.ok(output.includes('example.com'))
	assert.ok(output.includes('1,000 chars'))
})

test('formatPageContent includes title when provided', () => {
	const output = formatPageContent('https://example.com/page', 'Body', {
		title: 'My Page Title',
		charCount: 500,
		truncated: false,
	})
	assert.ok(output.includes('My Page Title'))
})

test('formatPageContent shows truncation notice', () => {
	const output = formatPageContent('https://example.com/page', 'Body', {
		charCount: 5000,
		truncated: true,
		originalChars: 25000,
	})
	assert.ok(output.includes('[truncated from 25,000 chars]'))
})

test('formatPageContent shows continuation hint', () => {
	const output = formatPageContent('https://example.com/page', 'Body', {
		charCount: 5000,
		truncated: false,
		hasMore: true,
		nextOffset: 5000,
	})
	assert.ok(output.includes('[use offset:5000 to continue reading]'))
})

test('formatPageContent includes the URL on its own line', () => {
	const output = formatPageContent('https://example.com/page', 'Body text', {
		charCount: 100,
		truncated: false,
	})
	assert.ok(output.includes('https://example.com/page'))
})

test('formatPageContent includes the page body after separator', () => {
	const output = formatPageContent('https://example.com/page', 'Hello world content', {
		charCount: 19,
		truncated: false,
	})
	assert.ok(output.includes('---'))
	assert.ok(output.includes('Hello world content'))
})

test('formatPageContent omits title portion when no title given', () => {
	const output = formatPageContent('https://example.com/page', 'Body', {
		charCount: 4,
		truncated: false,
	})
	// Header should be "Page: example.com (4 chars)" without any " — "
	const headerLine = output.split('\n')[0]
	assert.ok(!headerLine.includes(' \u2014 '))
})

test('formatPageContent omits truncation note when not truncated', () => {
	const output = formatPageContent('https://example.com/page', 'Body', {
		charCount: 100,
		truncated: false,
	})
	assert.ok(!output.includes('[truncated'))
})

// =============================================================================
// formatLLMContext
// =============================================================================

test('formatLLMContext includes query and source count in header', () => {
	const output = formatLLMContext('test query', [], {})
	assert.ok(output.includes('Context: "test query" (0 sources)'))
})

test('formatLLMContext shows "No relevant content found." for empty grounding', () => {
	const output = formatLLMContext('test', [], {})
	assert.ok(output.includes('No relevant content found.'))
})

test('formatLLMContext shows cached tag', () => {
	const output = formatLLMContext('test', [], {}, { cached: true })
	assert.ok(output.includes('(cached)'))
})

test('formatLLMContext shows token count', () => {
	const output = formatLLMContext('test', [], {}, { tokenCount: 5000 })
	assert.ok(output.includes('~5k tokens'))
})

test('formatLLMContext formats grounding snippets with index', () => {
	const grounding: LLMContextSnippet[] = [
		{
			url: 'https://example.com/doc',
			title: 'My Doc',
			snippets: ['Snippet content here.'],
		},
	]
	const sources: Record<string, LLMContextSource> = {
		'https://example.com/doc': {
			title: 'My Doc',
			hostname: 'example.com',
			age: ['2024-01-01', '30', '30 days ago'],
		},
	}
	const output = formatLLMContext('test', grounding, sources)
	assert.ok(output.includes('[1] My Doc'))
	assert.ok(output.includes('example.com'))
	assert.ok(output.includes('30 days ago'))
	assert.ok(output.includes('Snippet content here.'))
})

test('formatLLMContext uses extractDomain fallback when source missing', () => {
	const grounding: LLMContextSnippet[] = [
		{
			url: 'https://docs.python.org/page',
			title: 'Python Docs',
			snippets: ['Some snippet'],
		},
	]
	const output = formatLLMContext('test', grounding, {})
	assert.ok(output.includes('docs.python.org'))
})

test('formatLLMContext handles multiple grounding entries', () => {
	const grounding: LLMContextSnippet[] = [
		{ url: 'https://a.com/1', title: 'First', snippets: ['s1'] },
		{ url: 'https://b.com/2', title: 'Second', snippets: ['s2'] },
	]
	const output = formatLLMContext('test', grounding, {})
	assert.ok(output.includes('[1] First'))
	assert.ok(output.includes('[2] Second'))
})

test('formatLLMContext uses "(untitled)" when no title available', () => {
	const grounding: LLMContextSnippet[] = [
		{ url: 'https://example.com/x', title: '', snippets: ['data'] },
	]
	const output = formatLLMContext('test', grounding, {})
	assert.ok(output.includes('(untitled)'))
})

test('formatLLMContext omits age when source has no age data', () => {
	const grounding: LLMContextSnippet[] = [
		{ url: 'https://example.com/y', title: 'Page', snippets: ['text'] },
	]
	const sources: Record<string, LLMContextSource> = {
		'https://example.com/y': {
			title: 'Page',
			hostname: 'example.com',
			age: null,
		},
	}
	const output = formatLLMContext('test', grounding, sources)
	// No parenthesized age
	const headerLine = output.split('\n').find((l) => l.startsWith('[1]'))!
	assert.ok(!headerLine.includes('(') || headerLine.includes('example.com'))
})

// =============================================================================
// formatMultiplePages
// =============================================================================

test('formatMultiplePages formats successful page', () => {
	const output = formatMultiplePages([
		{
			url: 'https://example.com/page',
			title: 'Example Page',
			content: 'Full page content here.',
			charCount: 22,
		},
	])
	assert.ok(output.includes('[✓] example.com'))
	assert.ok(output.includes('Example Page'))
	assert.ok(output.includes('22 chars'))
	assert.ok(output.includes('Full page content here.'))
})

test('formatMultiplePages formats error page', () => {
	const output = formatMultiplePages([
		{
			url: 'https://broken.com/page',
			content: '',
			charCount: 0,
			error: 'Connection refused',
		},
	])
	assert.ok(output.includes('[✗] broken.com'))
	assert.ok(output.includes('Connection refused'))
})

test('formatMultiplePages handles mix of success and error', () => {
	const output = formatMultiplePages([
		{
			url: 'https://good.com/page',
			title: 'Good',
			content: 'Content',
			charCount: 7,
		},
		{
			url: 'https://bad.com/page',
			content: '',
			charCount: 0,
			error: 'Timeout',
		},
	])
	assert.ok(output.includes('[✓] good.com'))
	assert.ok(output.includes('[✗] bad.com'))
})

test('formatMultiplePages omits title for page without title', () => {
	const output = formatMultiplePages([
		{
			url: 'https://example.com/page',
			content: 'Body',
			charCount: 4,
		},
	])
	// Should have domain but not " — "
	const successLine = output.split('\n').find((l) => l.includes('[✓]'))!
	assert.ok(successLine.includes('example.com'))
	assert.ok(!successLine.includes(' \u2014 '))
})

test('formatMultiplePages includes URL and separator for success pages', () => {
	const output = formatMultiplePages([
		{
			url: 'https://example.com/page',
			title: 'Title',
			content: 'Body text',
			charCount: 9,
		},
	])
	assert.ok(output.includes('https://example.com/page'))
	assert.ok(output.includes('---'))
	assert.ok(output.includes('Body text'))
})

test('formatMultiplePages does not include URL line for error pages', () => {
	const output = formatMultiplePages([
		{
			url: 'https://err.com/page',
			content: '',
			charCount: 0,
			error: 'Failed',
		},
	])
	// Error format is just "[✗] domain: error" — no URL line
	assert.ok(!output.includes('https://err.com/page'))
})
