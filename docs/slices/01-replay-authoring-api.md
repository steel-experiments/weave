# Replay Authoring API Slice

## Status

- Vertical: `weave-core`
- Status: `In Progress`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Add a replay-based async authoring adapter so app authors can write `agent({ async run(ctx, input) { ... } })` and call `ctx.tool("stable-key", tool, input)` without manually constructing thread events. The slice supports durable thread suspension for tool waits, but not persisted JavaScript continuation suspension.

## Non-goals

- Do not implement persisted JavaScript continuation suspension.
- Do not add Effect internals.
- Do not add `ctx.gate`, `ctx.decide`, `ctx.capability`, `ctx.waitFor`, or `ctx.sleep`.
- Do not relax `ToolContract` output away from `ToolCompletionOutput` yet.
- Do not split package subpaths yet.
- Do not replace existing planner-first agents.

## User Outcome

As a Weave app author, I can write an agent as ordinary async TypeScript and request tools through stable step keys. Weave records tool requests durably, exits the runner while waiting for worker completion, resumes from completed events on later runner passes, and prevents duplicate tool requests during replay.

## Architecture Impact

- Weave primitives: adds `AgentContext`, replay-based durable effect semantics, and stable `scopeKey` plus `stepKey` identity.
- App-specific code: one example agent should migrate away from manual event construction.
- Event taxonomy: tool-related events gain optional `scopeKey` and `stepKey` identity.
- Tool contracts: no output-shape migration in this slice.
- Gates and policy: no first-class changes in this slice.
- Credentials: no first-class changes in this slice.
- External integrations: no changes.

## Implementation Plan

1. Add `MaybePromise` and update `AgentPlanner.plan` to allow async return values.
2. Extend `AgentContract` with optional `input`, `output`, `tools`, `run`, and `planner` fields.
3. Keep `defineAgent` compatibility, but validate that an agent provides either `run` or `planner`.
4. Add public aliases `agent`, `tool`, and `weave` while keeping `defineAgent`, `defineTool`, and `defineWeaveApp`.
5. Add optional `scopeKey` and `stepKey` fields to the TypeScript event model.
6. Implement a run-to-planner adapter that re-executes `run(ctx, input)` from the beginning on each runner pass.
7. Implement internal `AgentSuspended` control flow so `ctx.tool` suspends a runner pass instead of blocking.
8. Implement `ctx.tool` over existing `tool.requested`, `tool.completed`, and `tool.failed` events.
9. Migrate the Steel docs sync agent to the new authoring API.
10. Keep existing SRE and planner-first examples working.

## Test Plan

- Unit test the durable step lookup for missing, pending, completed, failed, and mismatched effects.
- Unit test `ctx.tool` duplicate prevention when the same runner pass is retried before tool completion.
- Integration test through real service, runner, worker, and tool contracts where practical.
- Replay test that a completed `tool.completed` event returns decoded output on the next runner pass.
- Suspension test that a pending tool request causes the runner pass to exit instead of waiting in memory.
- Failure-path test that invalid stored output causes a structured decode or replay error.
- Compatibility test that an existing planner-first agent still runs.

## Acceptance Criteria

- [x] Existing examples still typecheck.
- [x] Existing planner-first agents still run.
- [x] Existing tool-worker flow still works.
- [x] Existing gate resolution still works.
- [x] Existing Postgres migration still works.
- [x] One example uses `agent({ async run(ctx, input) { ... } })`.
- [x] The migrated example does not manually import `ThreadEvent`, `AgentPlan`, `eventKey`, `deterministicUuid`, or tool request event constructors.
- [x] `ctx.tool("some-key", tool, input)` appends exactly one `tool.requested` event when missing.
- [ ] Re-running the runner before tool completion appends no duplicate `tool.requested` event.
- [x] A pending tool request exits the runner pass and does not hold a Promise open waiting for the worker.
- [x] After `tool.completed`, the same `ctx.tool()` returns decoded output.
- [ ] If stored output fails the tool output schema, the runner records or throws a structured replay/decode error.
- [ ] Changing a durable effect kind while reusing the same key throws `ReplayMismatchError`.

## Progress

- [x] Add authoring aliases and types.
- [x] Add optional `scopeKey` and `stepKey` fields.
- [x] Make planner execution async-compatible.
- [x] Implement run-to-planner adapter.
- [x] Implement replay-based `ctx.tool`.
- [x] Verify tool waits are durable thread suspension, not in-memory waiting.
- [x] Migrate Steel docs sync agent.
- [ ] Add replay and compatibility tests.
- [x] Run typecheck and relevant demos/tests.

## Completion Notes

Initial implementation landed.

Changed modules:

- `src/agent-contract.ts`: adds run-first `AgentContract`, `AgentContext`, aliases, and validation.
- `src/agent-runner.ts`: adds replay-based run-to-planner adapter, `ctx.tool`, `ctx.emit`, and deterministic `ctx.uuid` helper.
- `src/events.ts`: adds optional `scopeKey` and `stepKey` event fields and tool request payload fields.
- `src/runner.ts`: supports async planners.
- `src/runtime.ts`: wraps run-first agents with the adapter and keeps planner-first agents compatible.
- `examples/steel-docs-sync/src/agent.ts`: migrates Steel docs sync to `agent({ async run(ctx, input) { ... } })`.

Commands run:

- `npm run typecheck`
- `npm run steel:demo`
- `npm run sre:demo`

Known gaps:

- Dedicated unit tests for duplicate-prevention, decode failure, and replay mismatch are still needed.
- `scopeKey` and `stepKey` are persisted in the `tool.requested` payload for now; real nullable event columns remain a later storage migration.
- `ctx.emit` and `ctx.uuid` were added to keep the migrated example event-producing without importing low-level event helpers. These should be folded into the public authoring docs before marking the slice shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/declarative-api.md`
- [ ] `docs/interface.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/engine-contracts.md` if storage contracts changed
- [ ] `docs/glossary.md` if terminology changed during implementation
- [ ] `docs/README.md` if status or doc links changed
