# Typed Event Factories Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Make `ctx.emit` payloads type-safe by adding a typed event factory that is checked against the thread event discriminated union.

## Non-goals

- Do not remove raw `{ type, payload }` compatibility yet.
- Do not add custom user-defined event schemas yet.
- Do not change persisted event shapes.

## User Outcome

As a Weave app author, I can write:

```ts
await ctx.emit("final", event("agent.response.produced", { message }));
```

and have TypeScript check that the payload matches `agent.response.produced`.

## Architecture Impact

- `AgentEventInput` is now discriminated by event type.
- Adds `event` / `defineEvent` helpers.
- Existing `ctx.emit` reconciliation behavior is unchanged.
- SRE and Steel examples use `event(...)` for emitted domain facts.

## Acceptance Criteria

- [x] `event(type, payload)` is exported from root `weave`.
- [x] `AgentEventInput` ties `type` to the corresponding payload type.
- [x] Existing raw event input compatibility remains.
- [x] SRE emits use typed factories.
- [x] Steel emits use typed factories.
- [x] Replay tests cover the factory.

## Completion Notes

Changed modules:

- `src/agent-contract.ts`: typed `AgentEventInput`, `event`, and `defineEvent`.
- `src/weave-interface.ts`: public boundary sketch for event factories.
- `examples/sre-demo/src/agent.ts`: typed emitted events.
- `examples/steel-docs-sync/src/agent.ts`: typed emitted events.
- `src/tests/replay-authoring.test.ts`: factory coverage and migrated emit tests.
- `docs/declarative-api.md`: documents `event(...)`.

Known follow-ups:

- User-defined custom event schemas.
- Dedicated event modules if event taxonomy grows large.
- Consider requiring typed factories once migration is complete.
