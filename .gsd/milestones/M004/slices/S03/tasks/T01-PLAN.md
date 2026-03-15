---
estimated_steps: 6
estimated_files: 3
---

# T01: Implement SSHBackend class and wire into factory

**Slice:** S03 — SSH Compute Backend
**Milestone:** M004

## Description

Create the `SSHBackend` class that implements `ComputeBackend.runEval()` using native `ssh` binary via `spawnSync`. The class connects to a remote host, syncs code via `pushExperimentBranch()`, builds a remote command (env exports → cd workDir → git fetch+reset → timeout eval), executes via SSH, and maps the result to `RunEvalResult`. Wire the new backend into the existing `resolveBackend()` factory and extend `ComputeConfig` with the SSH variant.

## Steps

1. Add `SSHBackendConfig` to `ComputeConfig` union in `types.ts`: `| { type: 'ssh'; host: string; workDir: string; controlPath?: string }`
2. Create `ssh-backend.ts` with `SSHBackend` class implementing `ComputeBackend`:
   - Constructor takes `SSHBackendConfig`
   - `runEval(opts)` flow: push experiment branch → get current branch → build env prefix → build remote command (cd, git fetch+reset, timeout eval) → spawnSync('ssh', args) with safety-net timeout → map result
   - SSH args: `-o BatchMode=yes`, `-o ControlMaster=auto`, `-o ControlPath=<path>`, `-o ControlPersist=60`, `-o ConnectTimeout=10`, `-o StrictHostKeyChecking=accept-new`
   - Result mapping: exit 124 → timedOut:true; exit 255 without spawnSync ETIMEDOUT → connection error; spawnSync error.code ETIMEDOUT → timedOut:true; else forward exitCode
   - Push failure → return early with error in stderr field
3. Fix pre-existing import in `compute-backend.ts`: change `RunEvalResult` import from `./types.js` to `./eval-runner.js`
4. Add `case 'ssh'` to `resolveBackend()` in `compute-backend.ts`, importing `SSHBackend` from `./ssh-backend.js`
5. Verify existing compute-backend tests still pass
6. Verify `resolveBackend({ type: 'ssh', ... })` returns SSHBackend instance

## Must-Haves

- [ ] SSHBackend class implements ComputeBackend interface with synchronous runEval()
- [ ] Calls pushExperimentBranch() before SSH — push failure returns structured error, not throw
- [ ] Remote timeout via `timeout` command; exit 124 → timedOut:true
- [ ] SpawnSync safety-net timeout (+30s buffer); ETIMEDOUT → timedOut:true
- [ ] SSH exit 255 mapped to connection error (stderr preserved)
- [ ] Env vars forwarded as `export KEY=VALUE;` prefix in remote command
- [ ] ControlMaster/ControlPersist/ControlPath for connection reuse
- [ ] ComputeConfig union extended with SSH variant
- [ ] resolveBackend() routes 'ssh' type to SSHBackend
- [ ] Existing compute-backend tests unchanged and passing

## Verification

- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 pass, 0 fail (unchanged)
- `npx tsx -e "import { resolveBackend } from './src/resources/extensions/gsd/compute-backend.ts'; const b = resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp' }); console.log(b.constructor.name)"` → prints `SSHBackend`

## Observability Impact

- Signals added/changed: SSH stderr forwarded in RunEvalResult.stderr on connection failure; push errors surfaced in stderr
- How a future agent inspects this: `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' src/resources/extensions/gsd/ssh-backend.ts`
- Failure state exposed: exit code mapping is explicit in code — 124=timeout, 255=connection, ETIMEDOUT=safety-net

## Inputs

- `src/resources/extensions/gsd/compute-backend.ts` — ComputeBackend interface, resolveBackend factory, LocalBackend pattern
- `src/resources/extensions/gsd/code-sync.ts` — pushExperimentBranch() for code sync
- `src/resources/extensions/gsd/types.ts` — ComputeConfig union to extend
- `src/resources/extensions/gsd/eval-runner.ts` — RunEvalResult type definition

## Expected Output

- `src/resources/extensions/gsd/ssh-backend.ts` — SSHBackend class, fully implemented
- `src/resources/extensions/gsd/types.ts` — ComputeConfig union with SSH variant
- `src/resources/extensions/gsd/compute-backend.ts` — fixed import, SSH case in resolveBackend()
