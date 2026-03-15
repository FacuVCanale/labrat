/**
 * Comprehensive tests for the GSD files.ts module.
 * Covers all pure parsing/formatting functions with happy paths,
 * edge cases, round-trip tests, and malformed input handling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  splitFrontmatter,
  parseFrontmatterMap,
  extractSection,
  extractAllSections,
  parseBullets,
  extractBoldField,
  parseRoadmap,
  parsePlan,
  parseSummary,
  parseContinue,
  formatContinue,
  parseSecretsManifest,
  formatSecretsManifest,
  parseRequirementCounts,
  parseTaskPlanMustHaves,
  countMustHavesMentionedInSummary,
  extractUatType,
  parseContextDependsOn,
  loadFile,
  saveFile,
} from '../files.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gsd-files-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ═══════════════════════════════════════════════════════════════════════════
// splitFrontmatter
// ═══════════════════════════════════════════════════════════════════════════

test('splitFrontmatter: extracts frontmatter and body from valid content', () => {
  const content = `---
key: value
another: data
---

# Title

Body text here.`;
  const [fm, body] = splitFrontmatter(content);
  assert.ok(fm);
  assert.equal(fm.length, 2);
  assert.equal(fm[0], 'key: value');
  assert.equal(fm[1], 'another: data');
  assert.ok(body.includes('# Title'));
  assert.ok(body.includes('Body text here.'));
});

test('splitFrontmatter: returns null frontmatter when no --- prefix', () => {
  const content = '# Just a heading\n\nSome body text.';
  const [fm, body] = splitFrontmatter(content);
  assert.equal(fm, null);
  assert.equal(body, content);
});

test('splitFrontmatter: returns null when only opening --- with no closing', () => {
  const content = '---\nkey: value\nno closing fence';
  const [fm, body] = splitFrontmatter(content);
  assert.equal(fm, null);
  assert.equal(body, content);
});

test('splitFrontmatter: returns null when --- is alone on one line with no newline', () => {
  const content = '---';
  const [fm, body] = splitFrontmatter(content);
  assert.equal(fm, null);
  assert.equal(body, content);
});

test('splitFrontmatter: handles empty frontmatter block (needs newline between fences)', () => {
  // The parser requires at least one line between --- fences.
  // An empty line between the fences produces a single empty-string element.
  const content = `---

---

Body only.`;
  const [fm, body] = splitFrontmatter(content);
  assert.ok(fm);
  assert.equal(fm.length, 1);
  assert.equal(fm[0], '');
  assert.ok(body.includes('Body only.'));
});

test('splitFrontmatter: adjacent --- fences with no gap returns null frontmatter', () => {
  // When the two --- are adjacent (no content between), the parser cannot
  // find the closing \n--- pattern, so it returns null frontmatter.
  const content = `---
---

Body only.`;
  const [fm, body] = splitFrontmatter(content);
  assert.equal(fm, null);
  assert.equal(body, content);
});

test('splitFrontmatter: handles leading whitespace before ---', () => {
  const content = `  \n---
key: value
---

Body.`;
  const [fm, body] = splitFrontmatter(content);
  assert.ok(fm);
  assert.equal(fm[0], 'key: value');
});

test('splitFrontmatter: handles empty string input', () => {
  const [fm, body] = splitFrontmatter('');
  assert.equal(fm, null);
  assert.equal(body, '');
});

// ═══════════════════════════════════════════════════════════════════════════
// parseFrontmatterMap
// ═══════════════════════════════════════════════════════════════════════════

test('parseFrontmatterMap: parses simple key-value pairs', () => {
  const lines = ['id: S01', 'parent: M001', 'status: active'];
  const result = parseFrontmatterMap(lines);
  assert.equal(result.id, 'S01');
  assert.equal(result.parent, 'M001');
  assert.equal(result.status, 'active');
});

test('parseFrontmatterMap: parses array items (multi-line)', () => {
  const lines = [
    'provides:',
    '  - types.ts',
    '  - files.ts',
    '  - state.ts',
  ];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.provides, ['types.ts', 'files.ts', 'state.ts']);
});

test('parseFrontmatterMap: parses inline arrays with brackets', () => {
  const lines = ['tags: [foo, bar, baz]'];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.tags, ['foo', 'bar', 'baz']);
});

test('parseFrontmatterMap: parses empty inline array', () => {
  const lines = ['depends: []'];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.depends, []);
});

test('parseFrontmatterMap: parses empty multi-line array key with no items', () => {
  const lines = ['items:', 'next_key: value'];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.items, []);
  assert.equal(result.next_key, 'value');
});

test('parseFrontmatterMap: parses nested objects in arrays', () => {
  const lines = [
    'requires:',
    '  - slice: S01',
    '    provides: types.ts',
    '  - slice: S02',
    '    provides: state.ts',
  ];
  const result = parseFrontmatterMap(lines);
  const requires = result.requires as Array<Record<string, string>>;
  assert.equal(requires.length, 2);
  assert.equal(requires[0].slice, 'S01');
  assert.equal(requires[0].provides, 'types.ts');
  assert.equal(requires[1].slice, 'S02');
  assert.equal(requires[1].provides, 'state.ts');
});

test('parseFrontmatterMap: handles empty lines array', () => {
  const result = parseFrontmatterMap([]);
  assert.deepEqual(result, {});
});

test('parseFrontmatterMap: handles inline empty bracket array with spaces', () => {
  const lines = ['empty: [  ]'];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.empty, []);
});

test('parseFrontmatterMap: key with empty value starts an array', () => {
  const lines = [
    'list:',
    '  - alpha',
    '  - beta',
  ];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.list, ['alpha', 'beta']);
});

// ═══════════════════════════════════════════════════════════════════════════
// extractSection
// ═══════════════════════════════════════════════════════════════════════════

test('extractSection: extracts content after a level-2 heading', () => {
  const body = `## Introduction

This is the intro.

## Details

Here are details.

## Conclusion

Final words.`;
  const result = extractSection(body, 'Details');
  assert.ok(result);
  assert.ok(result.includes('Here are details.'));
  assert.ok(!result.includes('Final words.'));
  assert.ok(!result.includes('This is the intro.'));
});

test('extractSection: returns null when heading not found', () => {
  const body = '## Existing\n\nSome text.';
  const result = extractSection(body, 'NonExistent');
  assert.equal(result, null);
});

test('extractSection: extracts level-3 heading', () => {
  const body = `### Sub Section

Sub content here.

### Another Sub

More content.`;
  const result = extractSection(body, 'Sub Section', 3);
  assert.ok(result);
  assert.ok(result.includes('Sub content here.'));
  assert.ok(!result.includes('More content.'));
});

test('extractSection: extracts last section (no following heading)', () => {
  const body = `## First

First content.

## Last

Last content here.`;
  const result = extractSection(body, 'Last');
  assert.ok(result);
  assert.ok(result.includes('Last content here.'));
});

test('extractSection: handles heading with special regex characters', () => {
  const body = `## What (happened)?

Content after special heading.

## Next`;
  const result = extractSection(body, 'What (happened)?');
  assert.ok(result);
  assert.ok(result.includes('Content after special heading.'));
});

test('extractSection: empty body returns null', () => {
  assert.equal(extractSection('', 'Missing'), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// extractAllSections
// ═══════════════════════════════════════════════════════════════════════════

test('extractAllSections: extracts all level-2 sections', () => {
  const body = `## Alpha

Alpha content.

## Beta

Beta content.

## Gamma

Gamma content.`;
  const sections = extractAllSections(body, 2);
  assert.equal(sections.size, 3);
  assert.ok(sections.get('Alpha')?.includes('Alpha content.'));
  assert.ok(sections.get('Beta')?.includes('Beta content.'));
  assert.ok(sections.get('Gamma')?.includes('Gamma content.'));
});

test('extractAllSections: returns empty map when no headings present', () => {
  const body = 'Just plain text with no headings.';
  const sections = extractAllSections(body, 2);
  assert.equal(sections.size, 0);
});

test('extractAllSections: extracts level-3 sections', () => {
  const body = `### First

One.

### Second

Two.`;
  const sections = extractAllSections(body, 3);
  assert.equal(sections.size, 2);
  assert.ok(sections.has('First'));
  assert.ok(sections.has('Second'));
});

test('extractAllSections: handles empty body', () => {
  const sections = extractAllSections('', 2);
  assert.equal(sections.size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// parseBullets
// ═══════════════════════════════════════════════════════════════════════════

test('parseBullets: parses dash bullets', () => {
  const text = '- First item\n- Second item\n- Third item';
  const result = parseBullets(text);
  assert.deepEqual(result, ['First item', 'Second item', 'Third item']);
});

test('parseBullets: parses asterisk bullets', () => {
  const text = '* Alpha\n* Beta';
  const result = parseBullets(text);
  assert.deepEqual(result, ['Alpha', 'Beta']);
});

test('parseBullets: filters out heading lines', () => {
  const text = '- Item one\n# Heading\n- Item two';
  const result = parseBullets(text);
  assert.deepEqual(result, ['Item one', 'Item two']);
});

test('parseBullets: filters out empty lines', () => {
  const text = '- Item\n\n\n- Another';
  const result = parseBullets(text);
  assert.deepEqual(result, ['Item', 'Another']);
});

test('parseBullets: handles empty string', () => {
  const result = parseBullets('');
  assert.deepEqual(result, []);
});

test('parseBullets: handles indented bullets', () => {
  const text = '  - Indented item\n  * Another';
  const result = parseBullets(text);
  assert.deepEqual(result, ['Indented item', 'Another']);
});

// ═══════════════════════════════════════════════════════════════════════════
// extractBoldField
// ═══════════════════════════════════════════════════════════════════════════

test('extractBoldField: extracts value from bold field', () => {
  const text = '**Vision:** Build something great.\n**Status:** active';
  assert.equal(extractBoldField(text, 'Vision'), 'Build something great.');
  assert.equal(extractBoldField(text, 'Status'), 'active');
});

test('extractBoldField: returns null when field not found', () => {
  const text = '**Name:** Foo';
  assert.equal(extractBoldField(text, 'Missing'), null);
});

test('extractBoldField: handles field with special characters in key', () => {
  const text = '**Format hint:** starts with sk-';
  assert.equal(extractBoldField(text, 'Format hint'), 'starts with sk-');
});

test('extractBoldField: handles empty text', () => {
  assert.equal(extractBoldField('', 'Key'), null);
});

test('extractBoldField: handles multiline with field in middle', () => {
  const text = 'Some intro text\n**Goal:** Ship the feature\nSome trailing text';
  assert.equal(extractBoldField(text, 'Goal'), 'Ship the feature');
});

// ═══════════════════════════════════════════════════════════════════════════
// parseRoadmap
// ═══════════════════════════════════════════════════════════════════════════

test('parseRoadmap: parses a full roadmap', () => {
  const content = `# M001: GSD Extension

**Vision:** Build a structured planning system.

**Success Criteria:**
- Parsers have test coverage
- State derivation works

---

## Slices

- [x] **S01: Types + IO** \`risk:low\` \`depends:[]\`
  > After this: Types are defined.

- [ ] **S02: State** \`risk:medium\` \`depends:[S01]\`
  > After this: Dashboard shows state.

---

## Boundary Map

### S01 → S02
\`\`\`
Produces:
  types.ts

Consumes from S02:
  nothing
\`\`\`
`;
  const roadmap = parseRoadmap(content);
  assert.equal(roadmap.title, 'M001: GSD Extension');
  assert.equal(roadmap.vision, 'Build a structured planning system.');
  assert.equal(roadmap.successCriteria.length, 2);
  assert.equal(roadmap.slices.length, 2);
  assert.equal(roadmap.slices[0].id, 'S01');
  assert.equal(roadmap.slices[0].done, true);
  assert.equal(roadmap.slices[1].id, 'S02');
  assert.equal(roadmap.slices[1].done, false);
  assert.deepEqual(roadmap.slices[1].depends, ['S01']);
});

test('parseRoadmap: handles empty content', () => {
  const roadmap = parseRoadmap('');
  assert.equal(roadmap.title, '');
  assert.equal(roadmap.vision, '');
  assert.deepEqual(roadmap.successCriteria, []);
  assert.deepEqual(roadmap.slices, []);
  assert.deepEqual(roadmap.boundaryMap, []);
});

test('parseRoadmap: handles content with no slices section', () => {
  const content = `# M001: Simple Roadmap

**Vision:** Something simple.
`;
  const roadmap = parseRoadmap(content);
  assert.equal(roadmap.title, 'M001: Simple Roadmap');
  assert.equal(roadmap.vision, 'Something simple.');
  assert.deepEqual(roadmap.slices, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// parsePlan
// ═══════════════════════════════════════════════════════════════════════════

test('parsePlan: parses a complete slice plan', () => {
  const content = `# S01: Types and File I/O

**Goal:** Define all types and parsers.
**Demo:** Run the test suite.

## Must-Haves

- Type definitions complete
- Parser functions exported

## Tasks

- [ ] **T01: Core Types** \`est:30m\`
  Define all TypeScript interfaces.
  - Files: \`types.ts\`, \`files.ts\`
  - Verify: run tests

- [x] **T02: Parser Functions** \`est:1h\`
  Implement all parser functions.

## Files Likely Touched

- types.ts
- files.ts
`;
  const plan = parsePlan(content);
  assert.equal(plan.id, 'S01');
  assert.equal(plan.title, 'Types and File I/O');
  assert.equal(plan.goal, 'Define all types and parsers.');
  assert.equal(plan.demo, 'Run the test suite.');
  assert.equal(plan.mustHaves.length, 2);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].id, 'T01');
  assert.equal(plan.tasks[0].done, false);
  assert.equal(plan.tasks[0].estimate, '30m');
  assert.deepEqual(plan.tasks[0].files, ['types.ts', 'files.ts']);
  assert.equal(plan.tasks[0].verify, 'run tests');
  assert.equal(plan.tasks[1].id, 'T02');
  assert.equal(plan.tasks[1].done, true);
  assert.equal(plan.filesLikelyTouched.length, 2);
});

test('parsePlan: handles plan with no tasks section', () => {
  const content = `# S01: Minimal Plan

**Goal:** Something.
**Demo:** Show it.

## Must-Haves

- One thing
`;
  const plan = parsePlan(content);
  assert.equal(plan.id, 'S01');
  assert.equal(plan.title, 'Minimal Plan');
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.mustHaves.length, 1);
});

test('parsePlan: handles empty content', () => {
  const plan = parsePlan('');
  assert.equal(plan.id, '');
  assert.equal(plan.title, '');
  assert.equal(plan.goal, '');
  assert.deepEqual(plan.tasks, []);
  assert.deepEqual(plan.mustHaves, []);
});

test('parsePlan: handles H1 without id:title format', () => {
  const content = '# Just a Title\n\n**Goal:** Something.';
  const plan = parsePlan(content);
  assert.equal(plan.id, '');
  assert.equal(plan.title, 'Just a Title');
});

// ═══════════════════════════════════════════════════════════════════════════
// parseSummary
// ═══════════════════════════════════════════════════════════════════════════

test('parseSummary: parses a complete summary with frontmatter', () => {
  const content = `---
id: S01
parent: M001
milestone: M001
provides:
  - types.ts
  - files.ts
requires:
  - slice: S00
    provides: bootstrap
affects:
  - state.ts
key_files:
  - types.ts
key_decisions:
  - Use pure functions
patterns_established:
  - Split frontmatter pattern
drill_down_paths: []
observability_surfaces:
  - Dashboard
duration: 2h
verification_result: pass
completed_at: 2025-01-01T12:00:00Z
blocker_discovered: false
---

# S01: Types and File I/O

**Established types and parser functions.**

## What Happened

Built all the type definitions and parsers.

## Deviations

None - stuck to the plan.

## Files Created/Modified

- \`types.ts\` — Core type definitions
- \`files.ts\` — Parser and formatter functions
`;
  const summary = parseSummary(content);
  assert.equal(summary.frontmatter.id, 'S01');
  assert.equal(summary.frontmatter.parent, 'M001');
  assert.equal(summary.frontmatter.milestone, 'M001');
  assert.deepEqual(summary.frontmatter.provides, ['types.ts', 'files.ts']);
  assert.equal(summary.frontmatter.requires.length, 1);
  assert.equal(summary.frontmatter.requires[0].slice, 'S00');
  assert.equal(summary.frontmatter.requires[0].provides, 'bootstrap');
  assert.deepEqual(summary.frontmatter.affects, ['state.ts']);
  assert.deepEqual(summary.frontmatter.key_files, ['types.ts']);
  assert.deepEqual(summary.frontmatter.key_decisions, ['Use pure functions']);
  assert.deepEqual(summary.frontmatter.drill_down_paths, []);
  assert.equal(summary.frontmatter.duration, '2h');
  assert.equal(summary.frontmatter.verification_result, 'pass');
  assert.equal(summary.frontmatter.completed_at, '2025-01-01T12:00:00Z');
  assert.equal(summary.frontmatter.blocker_discovered, false);
  assert.equal(summary.title, 'S01: Types and File I/O');
  assert.equal(summary.oneLiner, 'Established types and parser functions.');
  assert.ok(summary.whatHappened.includes('Built all the type definitions'));
  assert.ok(summary.deviations.includes('None'));
  assert.equal(summary.filesModified.length, 2);
  assert.equal(summary.filesModified[0].path, 'types.ts');
  assert.equal(summary.filesModified[0].description, 'Core type definitions');
});

test('parseSummary: handles content with no frontmatter', () => {
  const content = `# Summary Title

**One liner here**

## What Happened

Something happened.
`;
  const summary = parseSummary(content);
  assert.equal(summary.frontmatter.id, '');
  assert.equal(summary.frontmatter.milestone, '');
  assert.equal(summary.frontmatter.verification_result, 'untested');
  assert.equal(summary.frontmatter.blocker_discovered, false);
  assert.equal(summary.title, 'Summary Title');
  assert.equal(summary.oneLiner, 'One liner here');
});

test('parseSummary: handles empty content', () => {
  const summary = parseSummary('');
  assert.equal(summary.frontmatter.id, '');
  assert.equal(summary.title, '');
  assert.equal(summary.oneLiner, '');
  assert.equal(summary.whatHappened, '');
  assert.deepEqual(summary.filesModified, []);
});

test('parseSummary: blocker_discovered true parses correctly', () => {
  const content = `---
id: S01
blocker_discovered: true
---

# Blocked Summary
`;
  const summary = parseSummary(content);
  assert.equal(summary.frontmatter.blocker_discovered, true);
});

test('parseSummary: handles Files Modified alternative heading', () => {
  const content = `# Title

## Files Modified

- \`app.ts\` — Main app file
`;
  const summary = parseSummary(content);
  assert.equal(summary.filesModified.length, 1);
  assert.equal(summary.filesModified[0].path, 'app.ts');
});

// ═══════════════════════════════════════════════════════════════════════════
// parseContinue
// ═══════════════════════════════════════════════════════════════════════════

test('parseContinue: parses a complete continue file', () => {
  const content = `---
milestone: M001
slice: S01
task: T01
step: 3
total_steps: 5
status: in_progress
saved_at: 2025-01-01T12:00:00Z
---

## Completed Work

Finished steps 1-3.

## Remaining Work

Steps 4 and 5 still pending.

## Decisions Made

Chose approach A over B.

## Context

Working on the parser module.

## Next Action

Implement step 4.`;
  const cont = parseContinue(content);
  assert.equal(cont.frontmatter.milestone, 'M001');
  assert.equal(cont.frontmatter.slice, 'S01');
  assert.equal(cont.frontmatter.task, 'T01');
  assert.equal(cont.frontmatter.step, 3);
  assert.equal(cont.frontmatter.totalSteps, 5);
  assert.equal(cont.frontmatter.status, 'in_progress');
  assert.equal(cont.frontmatter.savedAt, '2025-01-01T12:00:00Z');
  assert.ok(cont.completedWork.includes('Finished steps 1-3'));
  assert.ok(cont.remainingWork.includes('Steps 4 and 5'));
  assert.ok(cont.decisions.includes('Chose approach A'));
  assert.ok(cont.context.includes('Working on the parser'));
  assert.ok(cont.nextAction.includes('Implement step 4'));
});

test('parseContinue: handles missing frontmatter', () => {
  const content = `## Completed Work

Some work done.

## Remaining Work

Nothing left.`;
  const cont = parseContinue(content);
  assert.equal(cont.frontmatter.milestone, '');
  assert.equal(cont.frontmatter.step, 0);
  assert.equal(cont.frontmatter.totalSteps, 0);
  assert.equal(cont.frontmatter.status, 'in_progress');
  assert.ok(cont.completedWork.includes('Some work done'));
});

test('parseContinue: handles empty content', () => {
  const cont = parseContinue('');
  assert.equal(cont.frontmatter.milestone, '');
  assert.equal(cont.frontmatter.slice, '');
  assert.equal(cont.completedWork, '');
  assert.equal(cont.remainingWork, '');
  assert.equal(cont.decisions, '');
  assert.equal(cont.context, '');
  assert.equal(cont.nextAction, '');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatContinue
// ═══════════════════════════════════════════════════════════════════════════

test('formatContinue: formats a continue object to markdown', () => {
  const cont = {
    frontmatter: {
      milestone: 'M001',
      slice: 'S01',
      task: 'T01',
      step: 2,
      totalSteps: 4,
      status: 'in_progress' as const,
      savedAt: '2025-06-01T10:00:00Z',
    },
    completedWork: 'Did step 1 and 2.',
    remainingWork: 'Steps 3 and 4.',
    decisions: 'Used approach X.',
    context: 'Parser module.',
    nextAction: 'Start step 3.',
  };
  const formatted = formatContinue(cont);
  assert.ok(formatted.includes('---'));
  assert.ok(formatted.includes('milestone: M001'));
  assert.ok(formatted.includes('slice: S01'));
  assert.ok(formatted.includes('task: T01'));
  assert.ok(formatted.includes('step: 2'));
  assert.ok(formatted.includes('total_steps: 4'));
  assert.ok(formatted.includes('status: in_progress'));
  assert.ok(formatted.includes('saved_at: 2025-06-01T10:00:00Z'));
  assert.ok(formatted.includes('## Completed Work'));
  assert.ok(formatted.includes('Did step 1 and 2.'));
  assert.ok(formatted.includes('## Remaining Work'));
  assert.ok(formatted.includes('## Decisions Made'));
  assert.ok(formatted.includes('## Context'));
  assert.ok(formatted.includes('## Next Action'));
  assert.ok(formatted.includes('Start step 3.'));
});

test('formatContinue: round-trip parse -> format -> parse preserves data', () => {
  const content = `---
milestone: M002
slice: S03
task: T02
step: 1
total_steps: 3
status: interrupted
saved_at: 2025-02-15T08:30:00Z
---

## Completed Work

Initial setup done.

## Remaining Work

Core logic and tests.

## Decisions Made

No major decisions yet.

## Context

Starting fresh on this task.

## Next Action

Write the core function.`;
  const parsed = parseContinue(content);
  const formatted = formatContinue(parsed);
  const reparsed = parseContinue(formatted);

  assert.equal(reparsed.frontmatter.milestone, parsed.frontmatter.milestone);
  assert.equal(reparsed.frontmatter.slice, parsed.frontmatter.slice);
  assert.equal(reparsed.frontmatter.task, parsed.frontmatter.task);
  assert.equal(reparsed.frontmatter.step, parsed.frontmatter.step);
  assert.equal(reparsed.frontmatter.totalSteps, parsed.frontmatter.totalSteps);
  assert.equal(reparsed.frontmatter.status, parsed.frontmatter.status);
  assert.equal(reparsed.frontmatter.savedAt, parsed.frontmatter.savedAt);
  assert.ok(reparsed.completedWork.includes('Initial setup done'));
  assert.ok(reparsed.remainingWork.includes('Core logic and tests'));
  assert.ok(reparsed.nextAction.includes('Write the core function'));
});

// ═══════════════════════════════════════════════════════════════════════════
// parseSecretsManifest / formatSecretsManifest
// ═══════════════════════════════════════════════════════════════════════════

test('parseSecretsManifest: parses a complete manifest', () => {
  const content = `# Secrets Manifest

**Milestone:** M001
**Generated:** 2025-01-01T12:00:00Z

### OPENAI_API_KEY

**Service:** OpenAI
**Dashboard:** https://platform.openai.com/api-keys
**Format hint:** starts with sk-
**Status:** pending
**Destination:** dotenv

1. Go to OpenAI dashboard
2. Create new API key
3. Copy the key

### DATABASE_URL

**Service:** PostgreSQL
**Status:** collected
**Destination:** dotenv

1. Set up PostgreSQL
2. Get connection string
`;
  const manifest = parseSecretsManifest(content);
  assert.equal(manifest.milestone, 'M001');
  assert.equal(manifest.generatedAt, '2025-01-01T12:00:00Z');
  assert.equal(manifest.entries.length, 2);

  assert.equal(manifest.entries[0].key, 'OPENAI_API_KEY');
  assert.equal(manifest.entries[0].service, 'OpenAI');
  assert.equal(manifest.entries[0].dashboardUrl, 'https://platform.openai.com/api-keys');
  assert.equal(manifest.entries[0].formatHint, 'starts with sk-');
  assert.equal(manifest.entries[0].status, 'pending');
  assert.equal(manifest.entries[0].destination, 'dotenv');
  assert.equal(manifest.entries[0].guidance.length, 3);

  assert.equal(manifest.entries[1].key, 'DATABASE_URL');
  assert.equal(manifest.entries[1].service, 'PostgreSQL');
  assert.equal(manifest.entries[1].status, 'collected');
  assert.equal(manifest.entries[1].guidance.length, 2);
});

test('parseSecretsManifest: handles invalid status, defaults to pending', () => {
  const content = `# Secrets Manifest

**Milestone:** M001
**Generated:** now

### SOME_KEY

**Service:** SomeService
**Status:** invalid_status
**Destination:** dotenv
`;
  const manifest = parseSecretsManifest(content);
  assert.equal(manifest.entries[0].status, 'pending');
});

test('parseSecretsManifest: handles missing optional fields', () => {
  const content = `# Secrets Manifest

**Milestone:** M001
**Generated:** now

### MINIMAL_KEY

**Service:** Minimal
**Status:** pending
`;
  const manifest = parseSecretsManifest(content);
  assert.equal(manifest.entries[0].key, 'MINIMAL_KEY');
  assert.equal(manifest.entries[0].dashboardUrl, '');
  assert.equal(manifest.entries[0].formatHint, '');
  assert.equal(manifest.entries[0].destination, 'dotenv');
  assert.deepEqual(manifest.entries[0].guidance, []);
});

test('formatSecretsManifest: formats a manifest to markdown', () => {
  const manifest = {
    milestone: 'M002',
    generatedAt: '2025-03-01T00:00:00Z',
    entries: [
      {
        key: 'API_KEY',
        service: 'TestService',
        dashboardUrl: 'https://example.com',
        formatHint: 'starts with tk-',
        status: 'pending' as const,
        destination: 'dotenv',
        guidance: ['Step one', 'Step two'],
      },
    ],
  };
  const formatted = formatSecretsManifest(manifest);
  assert.ok(formatted.includes('# Secrets Manifest'));
  assert.ok(formatted.includes('**Milestone:** M002'));
  assert.ok(formatted.includes('**Generated:** 2025-03-01T00:00:00Z'));
  assert.ok(formatted.includes('### API_KEY'));
  assert.ok(formatted.includes('**Service:** TestService'));
  assert.ok(formatted.includes('**Dashboard:** https://example.com'));
  assert.ok(formatted.includes('**Format hint:** starts with tk-'));
  assert.ok(formatted.includes('**Status:** pending'));
  assert.ok(formatted.includes('**Destination:** dotenv'));
  assert.ok(formatted.includes('1. Step one'));
  assert.ok(formatted.includes('2. Step two'));
});

test('formatSecretsManifest: omits dashboard and format hint when empty', () => {
  const manifest = {
    milestone: 'M001',
    generatedAt: 'now',
    entries: [
      {
        key: 'KEY',
        service: 'Svc',
        dashboardUrl: '',
        formatHint: '',
        status: 'collected' as const,
        destination: 'dotenv',
        guidance: [],
      },
    ],
  };
  const formatted = formatSecretsManifest(manifest);
  assert.ok(!formatted.includes('**Dashboard:**'));
  assert.ok(!formatted.includes('**Format hint:**'));
});

test('parseSecretsManifest + formatSecretsManifest: round-trip preserves data', () => {
  const manifest = {
    milestone: 'M003',
    generatedAt: '2025-06-15T09:00:00Z',
    entries: [
      {
        key: 'SECRET_A',
        service: 'ServiceA',
        dashboardUrl: 'https://a.example.com',
        formatHint: 'hex string',
        status: 'pending' as const,
        destination: 'dotenv',
        guidance: ['Do thing A', 'Do thing B'],
      },
      {
        key: 'SECRET_B',
        service: 'ServiceB',
        dashboardUrl: '',
        formatHint: '',
        status: 'skipped' as const,
        destination: 'vercel',
        guidance: ['Single step'],
      },
    ],
  };
  const formatted = formatSecretsManifest(manifest);
  const reparsed = parseSecretsManifest(formatted);

  assert.equal(reparsed.milestone, manifest.milestone);
  assert.equal(reparsed.generatedAt, manifest.generatedAt);
  assert.equal(reparsed.entries.length, manifest.entries.length);

  for (let i = 0; i < manifest.entries.length; i++) {
    assert.equal(reparsed.entries[i].key, manifest.entries[i].key);
    assert.equal(reparsed.entries[i].service, manifest.entries[i].service);
    assert.equal(reparsed.entries[i].status, manifest.entries[i].status);
    assert.equal(reparsed.entries[i].destination, manifest.entries[i].destination);
    assert.deepEqual(reparsed.entries[i].guidance, manifest.entries[i].guidance);
  }
});

test('parseSecretsManifest: handles empty content', () => {
  const manifest = parseSecretsManifest('');
  assert.equal(manifest.milestone, '');
  assert.equal(manifest.generatedAt, '');
  assert.deepEqual(manifest.entries, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// parseRequirementCounts
// ═══════════════════════════════════════════════════════════════════════════

test('parseRequirementCounts: counts requirements in each section', () => {
  const content = `## Active

### REQ01 — First requirement
Details here.

### REQ02 — Second requirement
More details.

## Validated

### VAL01 — Validated one
Done.

## Deferred

### DEF01 — Deferred one
Not now.

## Out of Scope

### OUT01 — Out of scope one
Nope.
### OUT02 — Out of scope two
Also nope.
`;
  const counts = parseRequirementCounts(content);
  assert.equal(counts.active, 2);
  assert.equal(counts.validated, 1);
  assert.equal(counts.deferred, 1);
  assert.equal(counts.outOfScope, 2);
  assert.equal(counts.total, 6);
});

test('parseRequirementCounts: returns zeros for null content', () => {
  const counts = parseRequirementCounts(null);
  assert.equal(counts.active, 0);
  assert.equal(counts.validated, 0);
  assert.equal(counts.deferred, 0);
  assert.equal(counts.outOfScope, 0);
  assert.equal(counts.blocked, 0);
  assert.equal(counts.total, 0);
});

test('parseRequirementCounts: returns zeros for empty content', () => {
  const counts = parseRequirementCounts('');
  assert.equal(counts.total, 0);
});

test('parseRequirementCounts: counts blocked status lines', () => {
  const content = `## Active

### REQ01 — Something

- Status: blocked

### REQ02 — Something else

- Status: blocked

### REQ03 — Not blocked

- Status: active
`;
  const counts = parseRequirementCounts(content);
  assert.equal(counts.blocked, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// parseTaskPlanMustHaves
// ═══════════════════════════════════════════════════════════════════════════

test('parseTaskPlanMustHaves: parses unchecked checkboxes', () => {
  const content = `## Must-Haves

- [ ] First item
- [ ] Second item
`;
  const result = parseTaskPlanMustHaves(content);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'First item');
  assert.equal(result[0].checked, false);
  assert.equal(result[1].text, 'Second item');
  assert.equal(result[1].checked, false);
});

test('parseTaskPlanMustHaves: parses checked checkboxes (x and X)', () => {
  const content = `## Must-Haves

- [x] Lowercase x
- [X] Uppercase X
`;
  const result = parseTaskPlanMustHaves(content);
  assert.equal(result.length, 2);
  assert.equal(result[0].checked, true);
  assert.equal(result[1].checked, true);
});

test('parseTaskPlanMustHaves: handles plain bullets without checkboxes', () => {
  const content = `## Must-Haves

- Plain item
`;
  const result = parseTaskPlanMustHaves(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'Plain item');
  assert.equal(result[0].checked, false);
});

test('parseTaskPlanMustHaves: returns empty array when section missing', () => {
  const content = `# Task

## Description

Some stuff.
`;
  const result = parseTaskPlanMustHaves(content);
  assert.equal(result.length, 0);
});

test('parseTaskPlanMustHaves: returns empty array for empty string', () => {
  assert.equal(parseTaskPlanMustHaves('').length, 0);
});

test('parseTaskPlanMustHaves: handles frontmatter before Must-Haves', () => {
  const content = `---
estimated_steps: 3
---

## Must-Haves

- [ ] After frontmatter
`;
  const result = parseTaskPlanMustHaves(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'After frontmatter');
});

// ═══════════════════════════════════════════════════════════════════════════
// countMustHavesMentionedInSummary
// ═══════════════════════════════════════════════════════════════════════════

test('countMustHavesMentionedInSummary: matches code tokens in summary', () => {
  const mustHaves = [
    { text: 'Function `parseRoadmap` is exported', checked: false },
    { text: 'Function `formatContinue` works correctly', checked: false },
  ];
  const summary = 'We implemented parseRoadmap and tested it thoroughly. The formatContinue function was also added.';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 2);
});

test('countMustHavesMentionedInSummary: matches significant words when no code tokens', () => {
  const mustHaves = [
    { text: 'Dashboard state derivation works', checked: false },
    { text: 'All parsers have coverage', checked: false },
  ];
  const summary = 'Built the dashboard with state derivation. Parsers now have full coverage.';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 2);
});

test('countMustHavesMentionedInSummary: returns 0 for empty inputs', () => {
  assert.equal(countMustHavesMentionedInSummary([], 'some summary'), 0);
  assert.equal(countMustHavesMentionedInSummary([{ text: 'hi', checked: false }], ''), 0);
});

test('countMustHavesMentionedInSummary: ignores common/short words', () => {
  const mustHaves = [
    { text: 'the file test has new add', checked: false },
  ];
  const summary = 'the file test has new add';
  // All words are either < 4 chars or common words, so no match
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 0);
});

test('countMustHavesMentionedInSummary: case insensitive matching for code tokens', () => {
  const mustHaves = [
    { text: 'The `ParseRoadmap` function works', checked: true },
  ];
  const summary = 'parseroadmap is implemented';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 1);
});

test('countMustHavesMentionedInSummary: partial match via significant word', () => {
  const mustHaves = [
    { text: 'Kubernetes deployment configured', checked: false },
  ];
  const summary = 'The kubernetes cluster is up.';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 1);
});

test('countMustHavesMentionedInSummary: no match when words are too short', () => {
  const mustHaves = [
    { text: 'Do it now', checked: false },
  ];
  const summary = 'Do it now immediately.';
  // 'Do' (2), 'it' (2), 'now' (3) are all < 4 chars
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// extractUatType
// ═══════════════════════════════════════════════════════════════════════════

test('extractUatType: extracts artifact-driven type', () => {
  const content = `## UAT Type

- UAT mode: artifact-driven
- Details: Check generated files
`;
  assert.equal(extractUatType(content), 'artifact-driven');
});

test('extractUatType: extracts live-runtime type', () => {
  const content = `## UAT Type

- UAT mode: live-runtime
`;
  assert.equal(extractUatType(content), 'live-runtime');
});

test('extractUatType: extracts human-experience type', () => {
  const content = `## UAT Type

- UAT mode: human-experience
`;
  assert.equal(extractUatType(content), 'human-experience');
});

test('extractUatType: extracts mixed type with parenthetical', () => {
  const content = `## UAT Type

- UAT mode: mixed (artifact-driven + live-runtime)
`;
  assert.equal(extractUatType(content), 'mixed');
});

test('extractUatType: returns undefined when section is missing', () => {
  const content = `## Other Section

Some content.
`;
  assert.equal(extractUatType(content), undefined);
});

test('extractUatType: returns undefined when UAT mode bullet is missing', () => {
  const content = `## UAT Type

- Some other bullet: value
`;
  assert.equal(extractUatType(content), undefined);
});

test('extractUatType: returns undefined for unrecognized type', () => {
  const content = `## UAT Type

- UAT mode: unknown-type
`;
  assert.equal(extractUatType(content), undefined);
});

test('extractUatType: handles empty content', () => {
  assert.equal(extractUatType(''), undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// parseContextDependsOn
// ═══════════════════════════════════════════════════════════════════════════

test('parseContextDependsOn: extracts depends_on list from frontmatter', () => {
  const content = `---
milestone: M003
depends_on:
  - M001
  - M002
---

# M003 Context
`;
  const deps = parseContextDependsOn(content);
  assert.deepEqual(deps, ['M001', 'M002']);
});

test('parseContextDependsOn: normalizes to uppercase', () => {
  const content = `---
depends_on:
  - m001
  - m002
---

Body.
`;
  const deps = parseContextDependsOn(content);
  assert.deepEqual(deps, ['M001', 'M002']);
});

test('parseContextDependsOn: returns empty array for null content', () => {
  assert.deepEqual(parseContextDependsOn(null), []);
});

test('parseContextDependsOn: returns empty array when no frontmatter', () => {
  assert.deepEqual(parseContextDependsOn('# No frontmatter here'), []);
});

test('parseContextDependsOn: returns empty array when depends_on absent', () => {
  const content = `---
milestone: M001
---

Body.
`;
  assert.deepEqual(parseContextDependsOn(content), []);
});

test('parseContextDependsOn: returns empty array for empty depends_on list', () => {
  const content = `---
depends_on: []
---

Body.
`;
  assert.deepEqual(parseContextDependsOn(content), []);
});

test('parseContextDependsOn: returns empty array for empty string', () => {
  assert.deepEqual(parseContextDependsOn(''), []);
});

// ═══════════════════════════════════════════════════════════════════════════
// loadFile / saveFile
// ═══════════════════════════════════════════════════════════════════════════

test('loadFile: returns null for nonexistent file', async () => {
  const result = await loadFile('/tmp/nonexistent-gsd-test-file-' + Date.now() + '.md');
  assert.equal(result, null);
});

test('saveFile + loadFile: round-trip write and read', async () => {
  const { dir, cleanup } = makeTmpDir();
  try {
    const filePath = join(dir, 'test.md');
    const content = '# Test\n\nContent here.\n';
    await saveFile(filePath, content);
    const loaded = await loadFile(filePath);
    assert.equal(loaded, content);
  } finally {
    cleanup();
  }
});

test('saveFile: creates parent directories', async () => {
  const { dir, cleanup } = makeTmpDir();
  try {
    const filePath = join(dir, 'nested', 'deep', 'file.md');
    await saveFile(filePath, 'nested content');
    const loaded = await loadFile(filePath);
    assert.equal(loaded, 'nested content');
  } finally {
    cleanup();
  }
});

test('saveFile: overwrites existing file atomically', async () => {
  const { dir, cleanup } = makeTmpDir();
  try {
    const filePath = join(dir, 'overwrite.md');
    await saveFile(filePath, 'original');
    await saveFile(filePath, 'updated');
    const loaded = await loadFile(filePath);
    assert.equal(loaded, 'updated');
  } finally {
    cleanup();
  }
});

test('saveFile: no leftover .tmp file after successful write', async () => {
  const { dir, cleanup } = makeTmpDir();
  try {
    const filePath = join(dir, 'clean.md');
    await saveFile(filePath, 'content');
    const tmpExists = await loadFile(filePath + '.tmp');
    assert.equal(tmpExists, null);
  } finally {
    cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Additional edge cases and boundary conditions
// ═══════════════════════════════════════════════════════════════════════════

test('splitFrontmatter: frontmatter with only whitespace lines', () => {
  const content = `---

---

Body.`;
  const [fm, body] = splitFrontmatter(content);
  assert.ok(fm);
  assert.equal(fm.length, 1);
  assert.ok(body.includes('Body.'));
});

test('parseFrontmatterMap: single inline array element', () => {
  const lines = ['tags: [solo]'];
  const result = parseFrontmatterMap(lines);
  assert.deepEqual(result.tags, ['solo']);
});

test('extractSection: section at very beginning of body', () => {
  const body = `## First

Content of first.`;
  const result = extractSection(body, 'First');
  assert.ok(result);
  assert.ok(result.includes('Content of first.'));
});

test('extractSection: respects heading level boundary (higher level stops extraction)', () => {
  const body = `## Section

Content.

# Higher Level Heading

Should not be included.`;
  const result = extractSection(body, 'Section');
  assert.ok(result);
  assert.ok(result.includes('Content.'));
  assert.ok(!result.includes('Should not be included.'));
});

test('parseBullets: handles text with no bullet markers', () => {
  const text = 'plain text without bullets';
  const result = parseBullets(text);
  assert.deepEqual(result, ['plain text without bullets']);
});

test('parsePlan: task with description accumulated across lines', () => {
  const content = `# S01: Plan

## Tasks

- [ ] **T01: Multi-line** \`est:1h\`
  First line of description.
  Second line of description.
`;
  const plan = parsePlan(content);
  assert.equal(plan.tasks.length, 1);
  assert.ok(plan.tasks[0].description.includes('First line'));
  assert.ok(plan.tasks[0].description.includes('Second line'));
});

test('parseSummary: handles en-dash and em-dash in file paths', () => {
  const content = `# Title

## Files Created/Modified

- \`path/to/file.ts\` \u2014 Description with em-dash
- \`other/file.ts\` \u2013 Description with en-dash
`;
  const summary = parseSummary(content);
  assert.equal(summary.filesModified.length, 2);
  assert.equal(summary.filesModified[0].path, 'path/to/file.ts');
  assert.equal(summary.filesModified[1].path, 'other/file.ts');
});

test('parseSummary: provides defaults as empty array for missing array fields', () => {
  const content = `---
id: S01
---

# Title
`;
  const summary = parseSummary(content);
  assert.deepEqual(summary.frontmatter.provides, []);
  assert.deepEqual(summary.frontmatter.requires, []);
  assert.deepEqual(summary.frontmatter.affects, []);
  assert.deepEqual(summary.frontmatter.key_files, []);
  assert.deepEqual(summary.frontmatter.key_decisions, []);
  assert.deepEqual(summary.frontmatter.patterns_established, []);
  assert.deepEqual(summary.frontmatter.drill_down_paths, []);
  assert.deepEqual(summary.frontmatter.observability_surfaces, []);
});

test('parseContinue: handles savedAt with underscore format in frontmatter', () => {
  const content = `---
milestone: M001
slice: S01
task: T01
step: 1
total_steps: 2
status: in_progress
saved_at: 2025-12-25T00:00:00Z
---

## Completed Work

Work.`;
  const cont = parseContinue(content);
  assert.equal(cont.frontmatter.savedAt, '2025-12-25T00:00:00Z');
});

test('extractAllSections: handles section with empty content between headings', () => {
  const body = `## Empty

## NonEmpty

Has content.`;
  const sections = extractAllSections(body, 2);
  assert.equal(sections.size, 2);
  assert.equal(sections.get('Empty'), '');
  assert.ok(sections.get('NonEmpty')?.includes('Has content.'));
});

test('countMustHavesMentionedInSummary: multiple code tokens, only one needs to match', () => {
  const mustHaves = [
    { text: 'Both `funcA` and `funcB` are implemented', checked: false },
  ];
  const summary = 'We only implemented funcA so far.';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 1);
});

test('countMustHavesMentionedInSummary: no code tokens and no significant words yields 0', () => {
  const mustHaves = [
    { text: 'do it!', checked: false },
  ];
  const summary = 'do it now please!';
  const count = countMustHavesMentionedInSummary(mustHaves, summary);
  assert.equal(count, 0);
});

test('parseRequirementCounts: total is sum of active, validated, deferred, outOfScope', () => {
  const content = `## Active

### REQ01 — One

## Validated

### VAL01 — Two
### VAL02 — Three
`;
  const counts = parseRequirementCounts(content);
  assert.equal(counts.total, counts.active + counts.validated + counts.deferred + counts.outOfScope);
  assert.equal(counts.total, 3);
});

test('parsePlan: handles tasks with no estimate', () => {
  const content = `# S01: Plan

## Tasks

- [ ] **T01: No Estimate**
  Some description.
`;
  const plan = parsePlan(content);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].estimate, '');
});

test('splitFrontmatter: body strips leading newlines after frontmatter', () => {
  const content = `---
key: val
---


# Title`;
  const [fm, body] = splitFrontmatter(content);
  assert.ok(fm);
  assert.ok(body.startsWith('# Title'));
});

test('parseFrontmatterMap: handles value with colons in it', () => {
  const lines = ['url: https://example.com:8080/path'];
  const result = parseFrontmatterMap(lines);
  assert.equal(result.url, 'https://example.com:8080/path');
});

test('extractBoldField: trims whitespace from value', () => {
  const text = '**Key:**   value with spaces   ';
  assert.equal(extractBoldField(text, 'Key'), 'value with spaces');
});

test('formatContinue: handles empty body sections gracefully', () => {
  const cont = {
    frontmatter: {
      milestone: 'M001',
      slice: 'S01',
      task: 'T01',
      step: 0,
      totalSteps: 0,
      status: 'in_progress' as const,
      savedAt: '',
    },
    completedWork: '',
    remainingWork: '',
    decisions: '',
    context: '',
    nextAction: '',
  };
  const formatted = formatContinue(cont);
  assert.ok(formatted.includes('## Completed Work'));
  assert.ok(formatted.includes('## Next Action'));
  // Should not throw
});

test('parseContextDependsOn: single dependency', () => {
  const content = `---
depends_on:
  - M001
---

Body.
`;
  const deps = parseContextDependsOn(content);
  assert.deepEqual(deps, ['M001']);
});

test('extractUatType: case insensitive value matching', () => {
  const content = `## UAT Type

- UAT mode: Artifact-Driven
`;
  // The function lowercases the value, so "artifact-driven" should match startsWith
  assert.equal(extractUatType(content), 'artifact-driven');
});

test('parseSecretsManifest: handles multiple guidance steps', () => {
  const content = `# Secrets Manifest

**Milestone:** M001
**Generated:** now

### MY_KEY

**Service:** Svc
**Status:** pending
**Destination:** dotenv

1. First step
2. Second step
3. Third step
4. Fourth step
5. Fifth step
`;
  const manifest = parseSecretsManifest(content);
  assert.equal(manifest.entries[0].guidance.length, 5);
  assert.equal(manifest.entries[0].guidance[0], 'First step');
  assert.equal(manifest.entries[0].guidance[4], 'Fifth step');
});

test('parsePlan: multiple tasks are parsed in order', () => {
  const content = `# S01: Multi-task

## Tasks

- [x] **T01: First** \`est:15m\`
  Description one.

- [ ] **T02: Second** \`est:30m\`
  Description two.

- [x] **T03: Third** \`est:45m\`
  Description three.
`;
  const plan = parsePlan(content);
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[0].id, 'T01');
  assert.equal(plan.tasks[0].done, true);
  assert.equal(plan.tasks[1].id, 'T02');
  assert.equal(plan.tasks[1].done, false);
  assert.equal(plan.tasks[2].id, 'T03');
  assert.equal(plan.tasks[2].done, true);
});

test('parseSummary: single provides string is wrapped in array', () => {
  const content = `---
provides: types.ts
---

# Title
`;
  const summary = parseSummary(content);
  assert.deepEqual(summary.frontmatter.provides, ['types.ts']);
});
