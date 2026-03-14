You are resolving a conflict that occurred when cherry-picking an upstream commit into the Labrat fork.

The cherry-pick failed because the upstream changes overlap with Labrat-specific modifications. Your job is to produce adapted versions of the conflicting files that incorporate the upstream fix while preserving Labrat's additions.

## Upstream Commit

- **Hash:** `{{upstreamHash}}`
- **Subject:** {{upstreamSubject}}

## Conflict Details

{{conflictDetails}}

## Output Format

{{outputFormat}}

## Instructions

1. **Preserve Labrat additions** — any functions, imports, types, constants, or logic blocks that exist only in Labrat's version must remain intact.
2. **Apply the upstream fix intent** — understand what the upstream patch is trying to accomplish and integrate that intent into each file, even if the exact diff cannot apply cleanly.
3. **Produce complete file contents** — output the entire file, not a patch or diff. Every line of the adapted file must be present.
4. **Do not invent new functionality** — only merge what exists in Labrat's version with the upstream change. Do not add features, refactor, or "improve" code beyond what is necessary for the merge.
5. **Maintain style consistency** — follow the existing code style (indentation, naming conventions, import order) of the Labrat version.
