# Workflow Contracts And Events

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
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
- Adds typed development event definitions for the workflow if an event registry exists; otherwise keeps them example-local until promoted.
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

- [ ] Initiative, slice, implementation, verification, review, repair, and PR result schemas exist.
- [ ] Development event payloads are schema-validated.
- [ ] Checkpoint keys are documented and stable.
- [ ] The contracts support the MVP workflow without requiring OpenCode execution.
- [ ] Invalid role outputs fail clearly rather than being coerced.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Define schemas.
- [ ] Define event payloads.
- [ ] Add fixtures.
- [ ] Add validation tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `../../event-taxonomy.md` if events are promoted beyond the example/app boundary
- [ ] `../../architecture.md` if new reusable primitives are added
