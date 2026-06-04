# PRD To Slices Compiler

## Status

- Vertical: `development-orchestrator`
- Status: `Planned`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Add the first compiler path that converts a pasted PRD or statement of work into a schema-valid proposed initiative plan and ordered slice list without executing any implementation work.

## Non-goals

- Do not approve generated plans automatically.
- Do not execute slices.
- Do not create branches, workspaces, commits, or PRs.
- Do not require a dashboard.
- Do not let model text bypass schema validation.

## User Outcome

As a maintainer, I can paste a large PRD/SOW and receive a proposed set of vertical implementation slices that are small enough to approve, run, verify, and review independently.

## Architecture Impact

- Adds a compiler boundary from `InitiativeSpec` to proposed `InitiativePlan`.
- May use an injected model/compiler runner, but all output must be schema validated.
- Keeps the compiler as a planning component, not an execution control plane.
- Emits durable planning events and checkpoints for inspection and revision.
- Produces slice proposals that the existing orchestrator can later execute after approval.

## Compiler Rules

The compiler should prefer:

- vertical slices over horizontal infrastructure-only phases
- independently reviewable slices
- explicit acceptance criteria per slice
- explicit verification commands or strategies per slice
- conservative allowed-file or expected-touchpoint claims
- small enough work units for bounded OpenCode implementation

The compiler should avoid:

- vague slices like `build backend`
- combining unrelated product surfaces
- assuming auth, dashboard, or PR automation behavior that is not already implemented
- starting implementation before a plan gate is approved

## Implementation Plan

1. Add a compiler interface that accepts `InitiativeSpec` and returns a proposed `InitiativePlan`.
2. Add a deterministic or fixture-backed compiler implementation for tests.
3. Add an optional model-backed compiler boundary if there is already a safe model invocation path to reuse.
4. Validate compiler output with the contracts from slice 12.
5. Record proposed plans as durable events/checkpoints.
6. Add a small dogfood fixture PRD that produces automation/dashboard-style slices.
7. Document compiler limitations and review expectations.

## Test Plan

- Unit test compiler output validation.
- Unit test invalid compiler output is rejected before checkpointing as an approved plan.
- Unit test generated slices preserve ordering and acceptance criteria.
- Unit test compiler emits no execution events.
- Contract test fixture PRD to expected slice proposal shape.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] A compiler boundary converts `InitiativeSpec` into a proposed `InitiativePlan`.
- [ ] Compiler output is schema validated before persistence.
- [ ] Invalid compiler output becomes a structured planning failure or revision-needed state.
- [ ] Generated slice proposals include objectives, constraints, acceptance criteria, and verification strategy.
- [ ] No implementation, branch, workspace, or PR side effects occur during compilation.
- [ ] Tests cover success and invalid-output paths.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Add compiler interface.
- [ ] Add test implementation or fixture runner.
- [ ] Add validation/persistence path.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] dogfood runbook docs
