# Slice Runner Branch Control

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Add a slice runner that owns one durable unit of implementation progress and enforces explicit branch/worktree state before spawning implementation work.

## Non-goals

- Do not implement OpenCode patching in this slice.
- Do not add repair loops yet.
- Do not open PRs.
- Do not support parallel slice execution in the first version.

## User Outcome

As a maintainer, I can see one slice move through durable states on the intended working branch, without accidental writes to `main` or the wrong worktree.

## Architecture Impact

- Adds `weave.sliceRunner` or equivalent child agent.
- Adds branch/worktree confirmation tooling under policy control.
- Emits slice lifecycle events.
- Establishes the parent-child thread shape for each implementation slice.

## Implementation Plan

1. Add a slice runner input contract containing branch, base commit, initiative metadata, slice data, and policy constraints.
2. Add or wrap read-only git state tooling to confirm current branch, worktree root, and base commit.
3. Add a branch creation/confirmation path gated by `repo.createBranch` and `repo.write.branch` capabilities.
4. Deny writes to `main` and branch mismatches before implementation starts.
5. Emit `dev.slice.started` when the branch state is valid.
6. Return a structured blocked result if branch state cannot be confirmed.

## Test Plan

- Unit test branch policy decisions.
- Integration test slice runner blocks on `main` when writes would be required.
- Integration test slice runner accepts a configured working branch.
- Replay test branch identity is checkpointed under `working-branch`.
- Failure test for changed base commit if the policy requires a human gate.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Slice runner accepts one approved slice.
- [x] Slice runner confirms the configured working branch through policy-mediated tooling.
- [x] Writes to `main` are denied.
- [x] Branch identity is checkpointed.
- [x] Slice runner emits slice-started events only after branch checks pass.
- [x] Invalid branch state returns a structured blocked result.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Add slice runner contract.
- [x] Add branch/worktree checks.
- [x] Add branch policy enforcement.
- [x] Add lifecycle events.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `weaveSliceRunner`, which accepts `SliceRunnerInputSchema`, checkpoints the intended `working-branch`, reads branch state through a normal tool request, evaluates branch safety, and emits `dev.slice.started` only when the current branch matches the intended branch.
- Added `developmentBranchStateReadTool` as `dev.branchState.read` with a `repo.read` capability request over `.git`, returning repo root, current branch, head commit, and detached-HEAD status.
- Added `SliceRunnerOutputSchema`, `DevelopmentBranchStateSchema`, `DevelopmentBranchStateReadInputSchema`, `readDevelopmentBranchState`, and `evaluateSliceBranchState`.
- Branch policy blocks `main`, detached HEAD, and branch mismatches with structured `blocked` outputs instead of throwing.
- Added tests for ready state, `main` blocking, branch mismatch blocking, detached-HEAD blocking, and replay behavior where branch state is requested before `dev.slice.started` is emitted.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: this slice confirms branch state but does not create branches or switch worktrees. Mutating branch creation should land later behind explicit `repo.createBranch` and `repo.write.branch` capability policies.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [ ] capability or policy docs if new reusable capabilities are introduced
