# Replay Authoring API Slice

## Status

- Vertical: `weave-core`
- Status: `Planned`
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

- [ ] Existing examples still typecheck.
- [ ] Existing planner-first agents still run.
- [ ] Existing tool-worker flow still works.
- [ ] Existing gate resolution still works.
- [ ] Existing Postgres migration still works.
- [ ] One example uses `agent({ async run(ctx, input) { ... } })`.
- [ ] The migrated example does not manually import `ThreadEvent`, `AgentPlan`, `eventKey`, `deterministicUuid`, or tool request event constructors.
- [ ] `ctx.tool("some-key", tool, input)` appends exactly one `tool.requested` event when missing.
- [ ] Re-running the runner before tool completion appends no duplicate `tool.requested` event.
- [ ] A pending tool request exits the runner pass and does not hold a Promise open waiting for the worker.
- [ ] After `tool.completed`, the same `ctx.tool()` returns decoded output.
- [ ] If stored output fails the tool output schema, the runner records or throws a structured replay/decode error.
- [ ] Changing a durable effect kind while reusing the same key throws `ReplayMismatchError`.

## Progress

- [ ] Add authoring aliases and types.
- [ ] Add optional `scopeKey` and `stepKey` fields.
- [ ] Make planner execution async-compatible.
- [ ] Implement run-to-planner adapter.
- [ ] Implement replay-based `ctx.tool`.
- [ ] Verify tool waits are durable thread suspension, not in-memory waiting.
- [ ] Migrate Steel docs sync agent.
- [ ] Add replay and compatibility tests.
- [ ] Run typecheck and relevant demos/tests.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/declarative-api.md`
- [ ] `docs/interface.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/engine-contracts.md` if storage contracts changed
- [ ] `docs/glossary.md` if terminology changed during implementation
- [ ] `docs/README.md` if status or doc links changed
