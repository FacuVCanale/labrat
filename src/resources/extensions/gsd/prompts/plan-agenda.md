You are planning a structured research agenda for the campaign **"{{campaignName}}"**.

## Research Question

> {{researchQuestion}}

## Campaign Configuration

**Target files:**
{{targetFileList}}

**Evaluation metrics:**
{{metricDefinitions}}

**Maximum experiments:** {{maxExperiments}}

{{existingContext}}

---

## Your Task

Decompose the research question into a structured **agenda** — an ordered sequence of phases where each phase explores one dimension of the problem. The agenda tells the experiment runner what to focus on in each phase.

### How to Plan

1. **Analyze the research question.** What are the key dimensions to explore? (e.g., model architecture, hyperparameters, data preprocessing, prompt engineering, algorithmic approaches)

2. **Order the dimensions.** Put foundational explorations first — later phases can build on earlier results. Common orderings:
   - Broad exploration → focused refinement → combination/integration
   - Architecture → hyperparameters → fine-tuning
   - Data quality → model selection → optimization

3. **Allocate experiments per phase.** The sum across all phases must equal exactly {{maxExperiments}}. Give more experiments to high-uncertainty phases. Each phase needs at least 2 experiments.

4. **Write concrete experiment plans.** For each phase, describe specific experiments the runner should try, with hypotheses and target focus areas.

### AgendaConfig JSON Schema

The agenda must conform to this structure when written to `CAMPAIGN.json`:

```json
{
  "agenda": {
    "researchQuestion": "string — the research question being investigated",
    "totalExperiments": "number — must equal campaign maxExperiments ({{maxExperiments}})",
    "phases": [
      {
        "name": "string — short phase name (e.g. 'Baseline Approaches')",
        "dimension": "string — what dimension this phase explores",
        "experimentsPerPhase": "number — experiments allocated to this phase (≥2)",
        "goal": "string — what this phase aims to discover",
        "experimentPlans": [
          {
            "description": "string — what this specific experiment does",
            "hypothesis": "string — expected outcome or what we're testing",
            "targetFocus": "string — which target file(s) or area to modify"
          }
        ]
      }
    ]
  }
}
```

### Example Agenda (3 phases, 10 experiments)

```json
{
  "agenda": {
    "researchQuestion": "What prompt structure maximizes code generation accuracy?",
    "totalExperiments": 10,
    "phases": [
      {
        "name": "Prompt Structure Exploration",
        "dimension": "prompt_format",
        "experimentsPerPhase": 4,
        "goal": "Identify which prompt structure patterns yield the highest accuracy",
        "experimentPlans": [
          {
            "description": "Chain-of-thought prompting with step-by-step reasoning",
            "hypothesis": "Explicit reasoning steps improve code correctness",
            "targetFocus": "prompt-template.md"
          },
          {
            "description": "Few-shot examples with input/output pairs",
            "hypothesis": "Concrete examples outperform abstract instructions",
            "targetFocus": "prompt-template.md"
          },
          {
            "description": "Role-based prompting with expert persona",
            "hypothesis": "Expert persona framing improves solution quality",
            "targetFocus": "prompt-template.md"
          },
          {
            "description": "Structured output format with schema constraints",
            "hypothesis": "Output structure constraints reduce parsing errors",
            "targetFocus": "prompt-template.md"
          }
        ]
      },
      {
        "name": "Context Window Optimization",
        "dimension": "context_strategy",
        "experimentsPerPhase": 3,
        "goal": "Determine optimal context inclusion strategy using best prompt structure from Phase 1",
        "experimentPlans": [
          {
            "description": "Minimal context — only function signature and docstring",
            "hypothesis": "Less context reduces noise and improves focus",
            "targetFocus": "context-builder.ts"
          },
          {
            "description": "Full file context with dependency graph",
            "hypothesis": "Full context enables better cross-reference understanding",
            "targetFocus": "context-builder.ts"
          },
          {
            "description": "Selective context — related functions and types only",
            "hypothesis": "Curated context balances signal-to-noise ratio",
            "targetFocus": "context-builder.ts"
          }
        ]
      },
      {
        "name": "Combined Refinement",
        "dimension": "integration",
        "experimentsPerPhase": 3,
        "goal": "Combine best prompt structure and context strategy, then fine-tune",
        "experimentPlans": [
          {
            "description": "Best prompt + best context with temperature tuning",
            "hypothesis": "Lower temperature improves consistency of winning combination",
            "targetFocus": "prompt-template.md, context-builder.ts"
          },
          {
            "description": "Add validation step with retry on failure",
            "hypothesis": "Self-correction loop catches remaining errors",
            "targetFocus": "pipeline.ts"
          },
          {
            "description": "Ensemble approach — generate multiple candidates and rank",
            "hypothesis": "Multiple attempts with ranking outperform single-shot",
            "targetFocus": "pipeline.ts"
          }
        ]
      }
    ]
  }
}
```

---

## Interview Protocol

### Before writing the agenda

1. **Review the research question, metrics, and target files** from the campaign config above.
2. **Ask the user 1–2 clarifying questions** using `ask_user_questions` to understand:
   - Which dimensions they consider most important to explore
   - Any constraints on the ordering (e.g., "we must try X before Y")
   - Any specific approaches they want to include or exclude
3. Based on answers, sketch a phase plan and **confirm it** with the user before writing.

### Writing the agenda

Once the user approves the plan:

1. Read the current `{{sliceDir}}/CAMPAIGN.json`
2. Add the `agenda` field with the planned `AgendaConfig` structure
3. Write the updated `CAMPAIGN.json` back — preserve all existing fields
4. Verify: the `agenda.totalExperiments` equals `maxExperiments` ({{maxExperiments}}) and all `experimentsPerPhase` values sum to the same total

### Validation rules

- `agenda.totalExperiments` must equal the campaign `maxExperiments` ({{maxExperiments}})
- Sum of all `experimentsPerPhase` must equal `totalExperiments`
- Each phase must have `experimentsPerPhase >= 2`
- Each phase must have a non-empty `name`, `dimension`, and `goal`
- `experimentPlans` array should have at least one entry per phase (ideally one per experiment)
- `agenda.researchQuestion` should match or elaborate on the campaign research question

After writing CAMPAIGN.json with the agenda, say exactly: `"Agenda written to CAMPAIGN.json."` — nothing else.
