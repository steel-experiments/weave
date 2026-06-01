# Agent Failure Events Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Convert non-tool agent exceptions into durable failure events so runner inbox work can complete without crash loops.

## Non-goals

- Do not add `thread.failed` as a separate aggregate event yet.
- Do not add agent-level recovery semantics yet.
- Do not change terminal `tool.failed` behavior.

## User Outcome

As an operator, if an agent crashes while planning or replaying, the thread records `agent.failed`, the summary shows the error, and the runner does not repeatedly crash on the same inbox item.

## Architecture Impact

- Adds `agent.failed` to the thread event taxonomy.
- `agent.failed.payload` contains `errorCode` and `message`.
- `agent.failed` marks the thread projection `failed`.
- `buildThreadSummary` reads `agent.failed` as failed execution metadata.
- `ThreadRunner.runOnce` catches planner errors, appends `agent.failed`, and returns `{ acted: true, reason: "agent-failed" }`.
- `WeaveError.code` is preserved as `errorCode`; generic errors use `AGENT_FAILED`.

## Acceptance Criteria

- [x] Planner exceptions append `agent.failed` instead of escaping `runOnce`.
- [x] `agent.failed` marks the thread failed in projections.
- [x] Thread summaries expose `agent.failed` error code and message.
- [x] Existing tool failure behavior remains unchanged.
- [x] Replay tests cover durable `agent.failed` creation.

## Completion Notes

Changed modules:

- `src/events.ts`: `agent.failed` schema and union member.
- `src/runner.ts`: planner error conversion to durable `agent.failed`.
- `src/postgres-engine.ts`: projection and inbox handling for `agent.failed`.
- `src/summary.ts`: failed execution metadata from `agent.failed`.
- `src/tests/replay-authoring.test.ts`: in-memory runner test for agent failure.
- `docs/declarative-api.md` and `docs/event-taxonomy.md`: failure semantics docs.

Known follow-ups:

- Optional `thread.failed` aggregate event.
- Recovery APIs for agents that can compensate after non-tool failures.
- Redaction rules if future failure payloads include structured details.
