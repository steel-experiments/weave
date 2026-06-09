# Workflow Contracts And Events

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Define the durable contracts for a Weave-managed development initiative before implementing orchestration behavior.

## Non-goals

- Do not run OpenCode.
- Do not create branches or PRs.
- Do not implement reviewer prompts beyond schema placeholders.
- Do not change auth gateway slices `51` through `56`.

## User Outcome

As a Weave maintainer, I can describe an implementation initiative, its slices, required checks, reviewer roles, policies, and expected outputs with stable schemas that future workflow agents can use.

## Architecture Impact

- Adds development-orchestrator domain contracts for initiatives, slices, role inputs, verification results, review findings, repair attempts, and PR draft summaries.
- Adds typed development event definitions to the core event registry so `ctx.emit`, `event(...)`, replay, and integration handlers can type-check the development workflow.
- Adds checkpoint names for initiative context, slice plan, approvals, branch identity, test results, review findings, repair attempt count, and PR URL.
- Does not require new core replay primitives.

## Proposed Contracts

Core input shape:

```ts
type DevelopmentInitiativeInput = {
  initiative: string;
  repo: string;
  baseBranch: string;
  workingBranch: string;
  contextFiles: string[];
  slices?: DevelopmentSliceInput[];
};
```

Important event types:

- `dev.initiative.started`
- `dev.slice.proposed`
- `dev.slice.approved`
- `dev.slice.started`
- `dev.slice.completed`
- `dev.slice.failed`
- `dev.implementation.started`
- `dev.implementation.completed`
- `dev.verification.completed`
- `dev.review.completed`
- `dev.repair.started`
- `dev.repair.completed`
- `dev.pr.opened`
- `dev.pr.updated`
- `dev.pr.ready_for_review`

Important checkpoint names:

- `initiative-context`
- `slice-plan`
- `approved-slice-plan`
- `working-branch`
- `base-commit`
- `slice-acceptance-criteria`
- `implementation-summary`
- `test-results`
- `review-findings`
- `repair-attempt-count`
- `pr-url`

## Implementation Plan

1. Add schema definitions for initiative input, slice plan, slice result, verification result, review result, repair result, and PR draft result.
2. Add event factory definitions or example-local event descriptors for development workflow events.
3. Add checkpoint naming helpers if the existing codebase has a stable place for reusable checkpoint keys.
4. Add fixture data for a tiny two-slice initiative.
5. Document the role contracts in the development-orchestrator overview.

## Test Plan

- Unit test valid and invalid initiative inputs.
- Unit test valid and invalid slice plans.
- Unit test review finding severity and verdict validation.
- Unit test verification result parsing fixture shapes.
- Unit test event payload validation for slice completion and review completion.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Initiative, slice, implementation, verification, review, repair, and PR result schemas exist.
- [x] Development event payloads are schema-validated.
- [x] Checkpoint keys are documented and stable.
- [x] The contracts support the MVP workflow without requiring OpenCode execution.
- [x] Invalid role outputs fail clearly rather than being coerced.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Define schemas.
- [x] Define event payloads.
- [x] Add fixtures.
- [x] Add validation tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `examples/weave-maintainer/src/development-orchestrator.ts` with schemas for initiative inputs, slice plans, slice runner inputs, OpenCode implementation inputs, implementation summaries, verification results, review results, repair results, PR draft results, development capabilities, reviewer roles, and stable checkpoint keys.
- Added `developmentEvents` factories for the development workflow events.
- Promoted `dev.*` payload schemas into `src/events.ts` and added them to `ThreadEventSchema`.
- Updated Postgres inbox routing so `dev.*` events are durable audit facts but do not wake runners or tool workers by default.
- Added `src/tests/development-orchestrator-contracts.test.ts` and included it in `npm test`.
- Updated the public API smoke test to cover the exported orchestrator contracts and event factories.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`.
- Known gap: this slice defines contracts only; planner, branch control, OpenCode implementation, verification/review orchestration, repair, and PR handoff remain follow-up slices.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `../../event-taxonomy.md` if events are promoted beyond the example/app boundary
- [ ] `../../architecture.md` if new reusable primitives are added
