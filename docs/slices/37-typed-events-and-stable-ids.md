# Typed Events And Stable IDs Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Replace provisional raw event authoring with a type-safe event contract/factory model, while preserving existing `ctx.emit(key, { type, payload })` and `event(type, payload)` compatibility.

Also introduce `ctx.id(key)` as the preferred deterministic ID helper and keep `ctx.uuid(key)` as a compatibility alias.

## Non-goals

- Do not add arbitrary custom event types outside the current `ThreadEvent` taxonomy unless the event schema is explicitly extended in this slice.
- Do not add a global app-wide event registry.
- Do not add event-handler type inference across integrations.
- Do not add event version migration machinery.
- Do not add external event subscriptions.
- Do not integrate typed events into capabilities or policy enforcement yet.
- Do not rewrite runtime internals around Effect.

## User Outcome

As an app author, I can define reusable typed event factories, emit validated event instances, and generate deterministic durable IDs with an API name that does not imply randomness.

## Architecture Impact

- Evolves the public `event` helper from only `event(type, payload, metadata?)` to also support `event({ type, payload, ...metadata })` contract definitions.
- Adds `EventContract`, `EventFactory`, and `EventInstance` types to the authoring boundary.
- Extends `ctx.emit` to accept typed event instances while preserving raw event input compatibility.
- Adds `ctx.id(key)` and keeps `ctx.uuid(key)` as an alias.
- Updates replay mismatch tests around emitted event type and payload identity.
- Does not change tool contracts, worker execution, Postgres storage, gates, or child thread semantics.

## Proposed Public API

Event contract definition:

```ts
const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
  description: "Final response shown to the user.",
});
```

Event usage:

```ts
await ctx.emit("final-response", responseProduced({
  message,
}));
```

Stable ID usage:

```ts
const findingId = ctx.id("finding:auth-docs");
```

Compatibility forms:

```ts
await ctx.emit("final-response", {
  type: "agent.response.produced",
  payload: { message },
});

await ctx.emit("final-response", event("agent.response.produced", { message }));

ctx.uuid("finding:auth-docs") === ctx.id("finding:auth-docs");
```

## Implementation Plan

1. Add event contract and factory types to the public authoring boundary.
2. Overload `event` so existing `event(type, payload, metadata?)` still works and new `event(contract)` returns an event factory.
3. Implement factory payload validation with the contract schema before returning an event instance.
4. Extend `AgentContext.emit` types to accept typed event instances and the existing raw event input shape.
5. Keep replay semantics unchanged: same key/type/payload is a no-op, different type or canonical payload throws `ReplayMismatchError`.
6. Add `ctx.id(key)` with the same deterministic implementation as `ctx.uuid(key)`.
7. Keep `ctx.uuid(key)` as an alias and update examples to prefer `ctx.id` where touched.
8. Migrate Steel docs sync event emissions to contract-based typed event factories.
9. Update docs and migration guide.

## Test Plan

- Typed event append test with `event({ type, payload })` factory and `ctx.emit`.
- Replay no-op test for same key, type, and canonical payload.
- Type mismatch test for same key but different event type.
- Payload mismatch test for same key/type but changed payload.
- Schema validation test for invalid typed event payload.
- `ctx.id` stability test within the same run, across replay, across keys, and across threads.
- `ctx.uuid` alias compatibility test.
- Raw `ctx.emit(key, { type, payload })` compatibility test remains green.
- Steel docs sync typecheck proves example migration.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] `event({...})` exists and is exported from the root package.
- [x] Existing `event(type, payload, metadata?)` still works.
- [x] `ctx.emit` accepts typed event instances.
- [x] `ctx.emit` still accepts raw event input for compatibility.
- [x] Typed event factories validate payloads before emit planning.
- [x] `ctx.emit` no-ops on same key/type/payload replay.
- [x] `ctx.emit` throws `ReplayMismatchError` on same key with different type.
- [x] `ctx.emit` throws `ReplayMismatchError` on same key/type with different canonical payload.
- [x] `ctx.id` exists and is deterministic.
- [x] `ctx.uuid` remains as an alias or compatibility helper.
- [x] Steel docs sync uses typed event factories.
- [x] Docs explain typed events and stable IDs.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Add event contract/factory API.
- [x] Add `ctx.id` and `ctx.uuid` alias behavior.
- [x] Add replay and validation tests.
- [x] Migrate Steel docs sync emissions.
- [x] Update docs and migration guide.
- [x] Run verification.

## Completion Notes

- Added contract-based typed event factories through `event({ type, payload, ...metadata })` and `defineEvent({ ... })`.
- Preserved `event(type, payload, metadata?)` and raw `ctx.emit(key, { type, payload })` compatibility.
- Added `EventContract`, `EventFactory`, and `EventInstance` to the authoring boundary.
- Added `ctx.id(key)` as the preferred deterministic ID helper and kept `ctx.uuid(key)` as an alias.
- Added replay authoring tests for typed factory append/replay, event type mismatch, canonical payload mismatch, payload schema validation, stable ID behavior, UUID alias compatibility, and raw emit compatibility.
- Added public API smoke coverage for `event({...})`.
- Migrated Steel docs sync emissions to typed event factories and `ctx.id`.
- Updated docs in `docs/declarative-api.md`, `docs/event-taxonomy.md`, and `docs/migration/api-refactor.md`.
- Verified with `npm test` and `npm run typecheck`.
- Follow-up slices remain intentionally separate: capability contracts, policy enforcement, event subscription/integration inference, event migration machinery, and Effect-backed internals.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/migration/api-refactor.md`
- [x] `README.md` if public example guidance changes
