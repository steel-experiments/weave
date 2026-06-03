# Effect Internals Runner Policy Tool Slice

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Expand the internal Effect-style adapter from slice 40 into runner and policy execution paths while keeping the public authoring API Promise-first.

## Non-goals

- Do not require app authors to write Effect code.
- Do not change `agent.run`, `ctx.tool`, `policy(...)`, or tool contract syntax.
- Do not rewrite storage or event schemas unless required by a documented bug fix.
- Do not add new policy or capability semantics.
- Do not introduce durable timers or waits.

## User Outcome

As a maintainer, I get more consistent typed failure handling across runner, policy, and tool execution internals without changing app code.

## Architecture Impact

- Extends `src/internal-effect.ts` usage beyond tool worker internals.
- Wraps policy evaluation with typed internal failures.
- May wrap `agent.run` planning execution with typed internal failures.
- Preserves durable event behavior for `agent.failed`, `policy.evaluated`, and tool events.
- Provides a migration path toward a richer external Effect runtime only if the project later chooses one.

## Implementation Plan

1. Inventory current runner and policy failure paths.
2. Identify the smallest runner/policy boundary to wrap first.
3. Model internal typed failures without changing public errors unless needed.
4. Preserve emitted event behavior and observability.
5. Add parity tests for current failure semantics.
6. Document that Effect remains internal.

## Test Plan

- Existing runner failure tests remain green.
- Invalid agent input/output still records the same failures.
- Unknown agent dispatch remains unchanged.
- Policy evaluation thrown error has documented durable behavior.
- Tool-worker parity tests from slice 40 remain green.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Runner or policy internals use the isolated Effect-style adapter.
- [ ] Public APIs remain Promise-first and unchanged.
- [ ] Existing emitted event behavior is preserved or intentionally documented.
- [ ] Existing observability behavior is preserved or intentionally documented.
- [ ] Docs state Effect is still internal.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Inventory runner and policy failure paths.
- [ ] Select minimal internal boundary.
- [ ] Refactor through adapter.
- [ ] Add parity tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/architecture.md`
- [ ] `docs/declarative-api.md` if public guidance changes
