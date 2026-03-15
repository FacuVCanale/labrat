/**
 * Tests for observability-validator: pure content validators and formatValidationIssues.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
	validateSlicePlanContent,
	validateTaskPlanContent,
	validateTaskSummaryContent,
	validateSliceSummaryContent,
	formatValidationIssues,
	type ValidationIssue,
} from '../observability-validator.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a slice plan that includes a runtime-relevant keyword so observability checks fire. */
function slicePlan(opts: {
	observability?: string | false
	verification?: string | false
	tasks?: string | false
} = {}): string {
	const parts: string[] = ['# Slice Plan', '', 'This slice implements the API server route.']
	if (opts.tasks !== false) {
		parts.push('', '## Tasks', opts.tasks ?? '- [ ] **T01: Create handler**\n  Why: needed\n  Files: handler.ts\n  Do: implement\n  Verify: test')
	}
	if (opts.observability !== false) {
		parts.push('', '## Observability / Diagnostics', opts.observability ?? 'Health endpoint returns 200 when service is up.\nStructured JSON error responses with correlation IDs.')
	}
	if (opts.verification !== false) {
		parts.push('', '## Verification', opts.verification ?? '- Check health endpoint returns 200\n- Verify error responses include diagnostic info')
	}
	return parts.join('\n')
}

/** Build a task plan with optional sections and frontmatter. */
function taskPlan(opts: {
	steps?: string | false
	verification?: string | false
	observabilityImpact?: string | false
	frontmatter?: string | false
	runtimeRelevant?: boolean
} = {}): string {
	const parts: string[] = []
	if (opts.frontmatter !== false) {
		parts.push('---', opts.frontmatter ?? 'estimated_steps: 3\nestimated_files: 2', '---')
	}
	parts.push('# Task Plan', '')
	if (opts.runtimeRelevant !== false) {
		parts.push('Implement the API route handler for the service endpoint.')
	} else {
		parts.push('Update the readme with typo fixes.')
	}
	if (opts.steps !== false) {
		parts.push('', '## Steps', opts.steps ?? '1. Create handler file\n2. Add route\n3. Write tests')
	}
	if (opts.verification !== false) {
		parts.push('', '## Verification', opts.verification ?? '- Run test suite\n- Check error responses')
	}
	if (opts.observabilityImpact !== false) {
		parts.push('', '## Observability Impact', opts.observabilityImpact ?? 'Adds structured logging for request failures.\nHealth endpoint gains readiness check.')
	}
	return parts.join('\n')
}

/** Build a task summary with optional sections and frontmatter. */
function taskSummary(opts: {
	frontmatter?: string | false
	diagnostics?: string | false
} = {}): string {
	const parts: string[] = []
	if (opts.frontmatter !== false) {
		parts.push('---', opts.frontmatter ?? 'observability_surfaces: health-endpoint, structured-errors', '---')
	}
	parts.push('# Task Summary', '', 'Completed the API handler implementation.')
	if (opts.diagnostics !== false) {
		parts.push('', '## Diagnostics', opts.diagnostics ?? 'Run `curl /health` to check status.\nErrors include correlation ID in JSON response.')
	}
	return parts.join('\n')
}

/** Build a slice summary with optional sections and frontmatter. */
function sliceSummary(opts: {
	frontmatter?: string | false
	authoritativeDiagnostics?: string | false
} = {}): string {
	const parts: string[] = []
	if (opts.frontmatter !== false) {
		parts.push('---', opts.frontmatter ?? 'observability_surfaces: health-endpoint', '---')
	}
	parts.push('# Slice Summary', '', 'API route implementation complete.')
	if (opts.authoritativeDiagnostics !== false) {
		parts.push('', '## Forward Intelligence', '', '### Authoritative diagnostics', opts.authoritativeDiagnostics ?? 'Health endpoint at /health returns 200.\nErrors include request-id for correlation.')
	}
	return parts.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// validateSlicePlanContent
// ═══════════════════════════════════════════════════════════════════════════

test('validateSlicePlanContent: all sections present yields no issues', () => {
	const content = slicePlan()
	const issues = validateSlicePlanContent('plan.md', content)
	assert.equal(issues.length, 0)
})

test('validateSlicePlanContent: missing observability section yields warning', () => {
	const content = slicePlan({ observability: false })
	const issues = validateSlicePlanContent('plan.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_observability_section')
	assert.ok(rule, 'expected missing_observability_section warning')
	assert.equal(rule.severity, 'warning')
	assert.equal(rule.scope, 'slice-plan')
})

test('validateSlicePlanContent: placeholder-only observability section yields warning', () => {
	const content = slicePlan({ observability: '- {{placeholder}}\n- None' })
	const issues = validateSlicePlanContent('plan.md', content)
	const rule = issues.find(i => i.ruleId === 'observability_section_placeholder_only')
	assert.ok(rule, 'expected observability_section_placeholder_only warning')
})

test('validateSlicePlanContent: verification without diagnostic mention yields warning', () => {
	const content = slicePlan({ verification: '- Run unit tests\n- Check output looks correct' })
	const issues = validateSlicePlanContent('plan.md', content)
	const rule = issues.find(i => i.ruleId === 'verification_missing_diagnostic_check')
	assert.ok(rule, 'expected verification_missing_diagnostic_check warning')
})

test('validateSlicePlanContent: non-runtime-relevant content skips observability checks', () => {
	// No runtime keywords like "api", "server", "route", etc.
	const content = '# Slice Plan\n\nUpdate the readme with typo fixes.\n\n## Tasks\n- [ ] **T01: Fix typos**\n  Why: clarity\n  Files: README.md\n  Do: fix typos\n  Verify: read'
	const issues = validateSlicePlanContent('plan.md', content)
	// Should have no observability-related issues (missing_observability_section, etc.)
	const obsIssues = issues.filter(i =>
		i.ruleId === 'missing_observability_section' ||
		i.ruleId === 'observability_section_placeholder_only' ||
		i.ruleId === 'verification_missing_diagnostic_check'
	)
	assert.equal(obsIssues.length, 0, 'non-runtime content should skip observability rules')
})

test('validateSlicePlanContent: empty task entry yields warning', () => {
	const content = slicePlan({ tasks: '- [ ] **T01: Create handler**\n\n- [ ] **T02: Empty task**\n\n- [ ] **T03: Another task**\n  Why: needed' })
	const issues = validateSlicePlanContent('plan.md', content)
	const emptyTaskRules = issues.filter(i => i.ruleId === 'empty_task_entry')
	assert.ok(emptyTaskRules.length >= 1, 'expected at least one empty_task_entry warning')
})

test('validateSlicePlanContent: file path is preserved in issues', () => {
	const content = slicePlan({ observability: false })
	const issues = validateSlicePlanContent('/path/to/my-plan.md', content)
	assert.ok(issues.length > 0)
	assert.equal(issues[0].file, '/path/to/my-plan.md')
})

// ═══════════════════════════════════════════════════════════════════════════
// validateTaskPlanContent
// ═══════════════════════════════════════════════════════════════════════════

test('validateTaskPlanContent: all sections present yields no issues', () => {
	const content = taskPlan()
	const issues = validateTaskPlanContent('task.md', content)
	assert.equal(issues.length, 0)
})

test('validateTaskPlanContent: empty steps section yields warning', () => {
	const content = taskPlan({ steps: false })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'empty_steps_section')
	assert.ok(rule, 'expected empty_steps_section warning')
	assert.equal(rule.severity, 'warning')
})

test('validateTaskPlanContent: placeholder-only steps section yields warning', () => {
	const content = taskPlan({ steps: '- {{step_placeholder}}\n- None' })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'empty_steps_section')
	assert.ok(rule, 'expected empty_steps_section warning for placeholder steps')
})

test('validateTaskPlanContent: high scope estimate (steps >= 10) yields warning', () => {
	const content = taskPlan({ frontmatter: 'estimated_steps: 15\nestimated_files: 3' })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'scope_estimate_steps_high')
	assert.ok(rule, 'expected scope_estimate_steps_high warning')
	assert.ok(rule.message.includes('15'))
})

test('validateTaskPlanContent: high scope estimate (files >= 12) yields warning', () => {
	const content = taskPlan({ frontmatter: 'estimated_steps: 3\nestimated_files: 20' })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'scope_estimate_files_high')
	assert.ok(rule, 'expected scope_estimate_files_high warning')
	assert.ok(rule.message.includes('20'))
})

test('validateTaskPlanContent: missing observability impact on runtime-relevant task yields warning', () => {
	const content = taskPlan({ observabilityImpact: false })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_observability_impact')
	assert.ok(rule, 'expected missing_observability_impact warning')
})

test('validateTaskPlanContent: placeholder-only observability impact yields warning', () => {
	const content = taskPlan({ observabilityImpact: '- None\n- {{describe}}' })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'observability_impact_placeholder_only')
	assert.ok(rule, 'expected observability_impact_placeholder_only warning')
})

test('validateTaskPlanContent: non-runtime-relevant content skips observability checks', () => {
	const content = taskPlan({
		runtimeRelevant: false,
		observabilityImpact: false,
		steps: '1. Fix typos in chapter 1\n2. Fix typos in chapter 2',
		verification: '- Read through the text',
	})
	const issues = validateTaskPlanContent('task.md', content)
	const obsIssues = issues.filter(i =>
		i.ruleId === 'missing_observability_impact' ||
		i.ruleId === 'observability_impact_placeholder_only'
	)
	assert.equal(obsIssues.length, 0, 'non-runtime content should skip observability impact rules')
})

test('validateTaskPlanContent: placeholder verification section yields warning', () => {
	const content = taskPlan({ verification: '- {{verify_placeholder}}\n- None' })
	const issues = validateTaskPlanContent('task.md', content)
	const rule = issues.find(i => i.ruleId === 'placeholder_verification')
	assert.ok(rule, 'expected placeholder_verification warning')
})

test('validateTaskPlanContent: scope estimates below threshold yield no warnings', () => {
	const content = taskPlan({ frontmatter: 'estimated_steps: 5\nestimated_files: 4' })
	const issues = validateTaskPlanContent('task.md', content)
	const scopeIssues = issues.filter(i =>
		i.ruleId === 'scope_estimate_steps_high' ||
		i.ruleId === 'scope_estimate_files_high'
	)
	assert.equal(scopeIssues.length, 0, 'under-threshold estimates should not warn')
})

// ═══════════════════════════════════════════════════════════════════════════
// validateTaskSummaryContent
// ═══════════════════════════════════════════════════════════════════════════

test('validateTaskSummaryContent: all sections present yields no issues', () => {
	const content = taskSummary()
	const issues = validateTaskSummaryContent('summary.md', content)
	assert.equal(issues.length, 0)
})

test('validateTaskSummaryContent: missing observability_surfaces frontmatter yields warning', () => {
	const content = taskSummary({ frontmatter: 'status: complete' })
	const issues = validateTaskSummaryContent('summary.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_observability_frontmatter')
	assert.ok(rule, 'expected missing_observability_frontmatter warning')
	assert.equal(rule.scope, 'task-summary')
})

test('validateTaskSummaryContent: missing diagnostics section yields warning', () => {
	const content = taskSummary({ diagnostics: false })
	const issues = validateTaskSummaryContent('summary.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_diagnostics_section')
	assert.ok(rule, 'expected missing_diagnostics_section warning')
})

test('validateTaskSummaryContent: placeholder-only diagnostics yields warning', () => {
	const content = taskSummary({ diagnostics: '- None\n- {{placeholder}}' })
	const issues = validateTaskSummaryContent('summary.md', content)
	const rule = issues.find(i => i.ruleId === 'diagnostics_placeholder_only')
	assert.ok(rule, 'expected diagnostics_placeholder_only warning')
})

test('validateTaskSummaryContent: missing frontmatter entirely yields warning', () => {
	const content = taskSummary({ frontmatter: false })
	const issues = validateTaskSummaryContent('summary.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_observability_frontmatter')
	assert.ok(rule, 'expected missing_observability_frontmatter when no frontmatter at all')
})

// ═══════════════════════════════════════════════════════════════════════════
// validateSliceSummaryContent
// ═══════════════════════════════════════════════════════════════════════════

test('validateSliceSummaryContent: all sections present yields no issues', () => {
	const content = sliceSummary()
	const issues = validateSliceSummaryContent('slice-summary.md', content)
	assert.equal(issues.length, 0)
})

test('validateSliceSummaryContent: missing observability_surfaces frontmatter yields warning', () => {
	const content = sliceSummary({ frontmatter: 'status: done' })
	const issues = validateSliceSummaryContent('slice-summary.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_observability_frontmatter')
	assert.ok(rule, 'expected missing_observability_frontmatter warning')
	assert.equal(rule.scope, 'slice-summary')
})

test('validateSliceSummaryContent: missing authoritative diagnostics yields warning', () => {
	const content = sliceSummary({ authoritativeDiagnostics: false })
	const issues = validateSliceSummaryContent('slice-summary.md', content)
	const rule = issues.find(i => i.ruleId === 'missing_authoritative_diagnostics')
	assert.ok(rule, 'expected missing_authoritative_diagnostics warning')
})

test('validateSliceSummaryContent: placeholder-only authoritative diagnostics yields warning', () => {
	const content = sliceSummary({ authoritativeDiagnostics: '- None\n- {{describe}}' })
	const issues = validateSliceSummaryContent('slice-summary.md', content)
	const rule = issues.find(i => i.ruleId === 'authoritative_diagnostics_placeholder_only')
	assert.ok(rule, 'expected authoritative_diagnostics_placeholder_only warning')
})

// ═══════════════════════════════════════════════════════════════════════════
// formatValidationIssues
// ═══════════════════════════════════════════════════════════════════════════

test('formatValidationIssues: returns empty string for no issues', () => {
	assert.equal(formatValidationIssues([]), '')
})

test('formatValidationIssues: formats issues with file basename', () => {
	const issues: ValidationIssue[] = [
		{
			severity: 'warning',
			scope: 'slice-plan',
			file: '/long/path/to/plan.md',
			ruleId: 'test_rule',
			message: 'Something is wrong.',
		},
	]
	const result = formatValidationIssues(issues)
	assert.ok(result.includes('plan.md'))
	assert.ok(result.includes('Something is wrong.'))
	assert.ok(result.startsWith('- '))
})

test('formatValidationIssues: truncates with limit', () => {
	const issues: ValidationIssue[] = Array.from({ length: 6 }, (_, i) => ({
		severity: 'warning' as const,
		scope: 'task-plan' as const,
		file: `file${i}.md`,
		ruleId: `rule_${i}`,
		message: `Issue number ${i}`,
	}))
	const result = formatValidationIssues(issues, 3)
	const lines = result.split('\n')
	assert.equal(lines.length, 4) // 3 issues + "...and N more"
	assert.ok(lines[3].includes('...and 3 more'))
})

test('formatValidationIssues: default limit is 4', () => {
	const issues: ValidationIssue[] = Array.from({ length: 7 }, (_, i) => ({
		severity: 'warning' as const,
		scope: 'task-plan' as const,
		file: `file${i}.md`,
		ruleId: `rule_${i}`,
		message: `Issue ${i}`,
	}))
	const result = formatValidationIssues(issues)
	const lines = result.split('\n')
	assert.equal(lines.length, 5) // 4 + overflow line
	assert.ok(lines[4].includes('...and 3 more'))
})

test('formatValidationIssues: no overflow line when issues <= limit', () => {
	const issues: ValidationIssue[] = [
		{
			severity: 'warning',
			scope: 'slice-plan',
			file: 'plan.md',
			ruleId: 'r1',
			message: 'Issue one.',
		},
		{
			severity: 'warning',
			scope: 'slice-plan',
			file: 'plan.md',
			ruleId: 'r2',
			message: 'Issue two.',
		},
	]
	const result = formatValidationIssues(issues, 5)
	const lines = result.split('\n')
	assert.equal(lines.length, 2)
	assert.ok(!result.includes('...and'))
})
