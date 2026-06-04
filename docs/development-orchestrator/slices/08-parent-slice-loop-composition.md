# Parent Slice Loop Composition

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Implement `weave.sliceRunner` as the durable coordinator for one approved development slice using explicit execution state and deterministic next-action decisions.

The parent loop should remain inspectable:

```txt
events/results -> SliceExecutionState -> decideNextSliceAction(...) -> one durable action
```

## Non-goals

- Do not add the real OpenCode CLI runner in this slice.
- Do not add initiative-level multi-slice sequencing.
- Do not create or update GitHub PRs.
- Do not implement auth gateway slices `51` through `56`.
- Do not put implementation, verification, review, repair, or workspace internals directly inside the slice runner.

## User Outcome

As a maintainer, I can run one approved slice through implementation, verification, review, bounded repair, and completion with durable replay semantics and no hidden in-memory control loop.

## Architecture Impact

- Adds an explicit `SliceExecutionState` projection for one slice.
- Adds `SliceExecutionPhase` and `SliceAction` contracts.
- Adds a pure `decideNextSliceAction(...)` helper.
- Changes `weave.sliceRunner` from branch-readiness only into a coordinator over existing child boundaries.
- Keeps child agents responsible for their own work.
- Keeps parent orchestration deterministic and replay-friendly.

## Proposed State Shape

```ts
type SliceExecutionPhase =
  | "approved"
  | "workspace-ready"
  | "implementation-running"
  | "implementation-completed"
  | "verification-running"
  | "verification-completed"
  | "review-running"
  | "review-completed"
  | "repair-running"
  | "repair-completed"
  | "blocked"
  | "completed"
  | "failed";

interface SliceExecutionState {
  sliceId: string;
  phase: SliceExecutionPhase;
  branch: string;
  workspace?: WorkspaceRef;
  implementation?: OpenCodeImplementerOutput;
  verification?: VerificationResult;
  reviews: ReviewResult[];
  repairs: RepairResult[];
  repairAttempts: number;
  maxRepairAttempts: number;
  blockers: DevReviewFinding[];
  finalSummary?: string;
}
```

## Proposed Action Shape

```ts
type SliceAction =
  | { type: "allocate-workspace" }
  | { type: "run-implementation" }
  | { type: "run-verification" }
  | { type: "run-reviewers"; reviewers: DevelopmentReviewerRole[] }
  | { type: "run-repair"; attempt: number; findings: DevReviewFinding[] }
  | { type: "require-human-stop"; reason: string; findings: DevReviewFinding[] }
  | { type: "complete-slice"; summary: string }
  | { type: "fail-slice"; reason: string; findings: DevReviewFinding[] };
```

## Durable Child Keys

Use stable keys only:

- implementation child: `implement`
- verification child: `verify:<attempt>`
- reviewer child: `review:<reviewer>:<attempt>`
- repair child: `repair:<attempt>`
- repair wait: `wait-repair:<attempt>`
- completion event: `slice-completed:<sliceId>`
- failure event: `slice-failed:<sliceId>`

Do not use timestamps, random IDs, or mutable counters for child keys.

## Implementation Plan

1. Add `SliceExecutionPhaseSchema`, `SliceExecutionStateSchema`, and `SliceActionSchema`.
2. Add a projection helper that builds `SliceExecutionState` from known child outputs/checkpoints.
3. Add `decideNextSliceAction(state)` as a pure deterministic helper.
4. Extend `SliceRunnerInputSchema` with child boundary dependencies or agent options needed for fake-runner tests.
5. Make `weave.sliceRunner` coordinate existing child agents using `ctx.spawn(...)` and `ctx.join(...)`.
6. Spawn implementation with key `implement` and wait with a deterministic key.
7. Spawn verification with attempt-scoped keys.
8. Spawn required reviewers with attempt-scoped keys.
9. Evaluate verification/review results through existing completion and repair decision helpers.
10. Spawn repair with deterministic `repair:<attempt>` keys when repair is allowed.
11. Rerun verification and review after each repair attempt.
12. Open a human stop gate when max repair attempts are exhausted or high-risk findings remain.
13. Emit `dev.slice.completed` only once after final pass.
14. Emit `dev.slice.failed` or a human gate when progression stops.

## Test Plan

- Unit test `decideNextSliceAction(...)` for every phase transition.
- Unit test repeated decisions are stable for identical state.
- Replay test happy path: implementation passes, verification passes, reviews pass, slice completes.
- Replay test repair path: verification fails, repair runs, verification passes, reviews pass, slice completes.
- Replay test max repair attempts opens a human gate.
- Replay test high-risk reviewer finding opens a human gate.
- Replay test child failure maps to deterministic blocked or failed output.
- Replay test no duplicate implementation child after replay.
- Replay test no duplicate verifier child after replay.
- Replay test no duplicate reviewer child after replay.
- Replay test no duplicate repair child after replay.
- Replay test no duplicate completion event after replay.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] `SliceExecutionState` is explicit, schema-validated, and durably projectable.
- [x] `decideNextSliceAction(...)` is pure and covered by unit tests.
- [x] `weave.sliceRunner` coordinates child agents but does not perform child work inline.
- [x] A slice can complete after implementation, verification, and reviews pass.
- [x] A slice can repair after failed verification and complete after rerun checks pass.
- [x] A slice opens a human gate when max repair attempts are exceeded.
- [x] A slice opens a human gate when high-risk reviewer findings remain.
- [x] Replay does not duplicate child threads, repair attempts, or completion events.
- [x] Child failure is handled deterministically.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Add execution state schemas.
- [x] Add action schemas.
- [x] Add next-action decision helper.
- [x] Add state projection helper.
- [x] Wire child spawn/join coordination.
- [x] Add repair rerun loop.
- [x] Add human stop gates.
- [x] Add replay tests.
- [x] Update docs.

## Completion Notes

- Added `SliceExecutionPhaseSchema`, `SliceExecutionStateSchema`, and `SliceActionSchema`.
- Added `createInitialSliceExecutionState(...)`, `requiredReviewersForSlice(...)`, and pure `decideNextSliceAction(...)` helpers.
- Added `createSliceRunnerAgent(...)` so tests and future runtime wiring can supply implementation, verification, reviewer, and repair child agents.
- Kept exported `weaveSliceRunner` backward-compatible as the default branch/workspace readiness runner when no child agents are configured.
- Extended composed slice execution to coordinate existing child boundaries with deterministic keys: `implement`, `verify:<attempt>`, `review:<reviewer>:<attempt>`, `repair:<attempt>`, and matching wait keys.
- The composed runner emits `dev.slice.completed` once after implementation, verification, and reviews pass.
- The composed runner can run repair after failed verification, then rerun verification and review before completion.
- The composed runner opens a `repair-stop` human gate when repair attempts are exhausted or high-risk reviewer findings remain.
- Added replay tests for pure next-action decisions, happy-path composed completion, repair-rerun completion, and exhausted-repair human gate creation.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm exec -- tsx src/tests/public-api-exports.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gaps: workspace allocation remains explicit input for composed execution until slice 10. Initiative-level sequencing remains slice 09. Real OpenCode execution remains slice 11.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [ ] architecture docs if `SliceExecutionState` becomes a reusable workflow primitive
