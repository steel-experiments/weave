# Slice Runner Branch Control

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
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

- [ ] Slice runner accepts one approved slice.
- [ ] Slice runner confirms or creates the configured working branch through policy-mediated tooling.
- [ ] Writes to `main` are denied.
- [ ] Branch identity is checkpointed.
- [ ] Slice runner emits slice-started events only after branch checks pass.
- [ ] Invalid branch state returns a structured blocked result.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Add slice runner contract.
- [ ] Add branch/worktree checks.
- [ ] Add branch policy enforcement.
- [ ] Add lifecycle events.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] capability or policy docs if new reusable capabilities are introduced
