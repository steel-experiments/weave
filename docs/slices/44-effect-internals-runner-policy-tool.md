# Effect Internals Runner Policy Tool Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
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
- Wraps `agent.run` planning execution with typed internal failures.
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

- [x] Runner or policy internals use the isolated Effect-style adapter.
- [x] Public APIs remain Promise-first and unchanged.
- [x] Existing emitted event behavior is preserved or intentionally documented.
- [x] Existing observability behavior is preserved or intentionally documented.
- [x] Docs state Effect is still internal.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Inventory runner and policy failure paths.
- [x] Select minimal internal boundary.
- [x] Refactor through adapter.
- [x] Add parity tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- `RunAgentPlanner.plan(...)` now executes `agent.run` through `src/internal-effect.ts` and rethrows the original cause so existing planner and runner failure semantics stay unchanged.
- `ctx.tool(...)` policy enforcement now uses a synchronous internal policy evaluation boundary that wraps each `policy.evaluate(...)` call through `src/internal-effect.ts`.
- Policy code exceptions keep existing durable behavior: through `ThreadRunner`, they record one `agent.failed` with the existing error code mapping and do not record `policy.evaluated` or `tool.requested` for the failed evaluation.
- No public authoring API changed and app authors still do not import or write Effect code.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/architecture.md`
- [x] `docs/declarative-api.md` not updated because public guidance did not change
