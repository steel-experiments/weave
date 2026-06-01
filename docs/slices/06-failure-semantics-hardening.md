# Failure Semantics Hardening Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Make failed tool execution deterministic, terminal, and easy to diagnose without leaving transient claimed inbox items in normal failed-thread diagnostics.

## Non-goals

- Do not add `agent.failed` or `thread.failed` events yet.
- Do not implement agent-level recovery from failed tools yet.
- Do not change retry semantics beyond existing worker retries.

## User Outcome

As an operator, when a tool fails, the thread ends in `failed`, the summary exposes the tool error, and the inbox clearly shows the failed tool-worker item as dead-lettered.

## Architecture Impact

- `tool.failed` remains the canonical terminal event for failed tool execution.
- `tool.failed` marks the thread projection `failed` immediately.
- `tool.failed` no longer routes a runner inbox item in V1.
- Replaying a failed tool in `agent.run` still produces no new plan, preventing crash loops if `runOnce` is called manually.
- Tool-worker inbox items that produce `tool.failed` are dead-lettered with the tool error metadata.

## Acceptance Criteria

- [x] Replaying a failed `ctx.tool` produces no plan and does not throw out of the planner.
- [x] `tool.failed` is terminal and does not enqueue runner work.
- [x] Steel webhook failure path asserts no inbox item remains `claimed` after terminal failure.
- [x] Steel webhook failure path reports the dead-lettered tool-worker item.
- [x] Failure semantics are documented.

## Completion Notes

Changed modules:

- `src/postgres-engine.ts`: `tool.failed` no longer routes to the runner inbox.
- `src/tests/replay-authoring.test.ts`: adds failed-tool replay coverage.
- `examples/steel-docs-sync/src/webhook-demo.ts`: asserts failed-thread inbox diagnostics are stable and prints the dead-letter item state.
- `docs/declarative-api.md` and `docs/event-taxonomy.md`: document terminal failed-tool semantics.

Known follow-ups:

- First-class `agent.failed` was added by `09-agent-failure-events.md`; `thread.failed` remains a possible future aggregate event.
- Decide whether future agents can opt into catching tool failures and producing recovery plans.
- Split worker retry policy and dead-letter policy into configurable runtime options.
