# Typed Integration Event Handlers Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Add typed integration event handlers so integrations can subscribe to and handle known thread events through schema-backed contracts.

## Non-goals

- Do not add arbitrary external event subscriptions.
- Do not build a full event bus.
- Do not add event version migration machinery.
- Do not change core replay semantics.
- Do not add capability-mediated credentials in this slice.

## User Outcome

As an integration author, I can declare handlers for specific Weave event types and get typed payloads without manually narrowing raw `ThreadEvent` objects everywhere.

## Architecture Impact

- Extends `IntegrationContract.eventHandlers` from loose handler definitions to typed event contracts.
- Builds on the typed event taxonomy and `event({...})` factories.
- May add testing utilities for invoking integration handlers with typed events.
- Does not change event storage or runner behavior.

## Implementation Plan

1. Audit current `IntegrationContract.eventHandlers` shape.
2. Define a typed handler helper for known `ThreadEvent["type"]` values.
3. Infer payload type from event type.
4. Add runtime schema validation or reuse `ThreadEventSchema` parsing at handler boundaries.
5. Preserve compatibility with existing integration handlers.
6. Add public API smoke coverage.
7. Update docs and examples.

## Test Plan

- Handler for `agent.response.produced` receives typed payload.
- Handler for `tool.completed` receives normalized payload.
- Invalid event payload is rejected before handler execution where practical.
- Existing integration event handlers continue to typecheck.
- Public export smoke test covers the helper if exported.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Typed integration event handler API exists.
- [x] Handler payload type is inferred from event type.
- [x] Runtime validation behavior is documented.
- [x] Existing integrations remain compatible.
- [x] Docs explain how typed handlers relate to typed event factories.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Audit current integration event handling.
- [x] Design helper and types.
- [x] Implement compatibility path.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `integrationEvent({ type, handle })` typed event handler helper.
- Handler payload type is inferred from the selected `ThreadEvent["type"]`.
- The helper validates events with `ThreadEventSchema` before invoking handler logic.
- Existing raw `IntegrationEventHandler` objects remain compatible in `integration({ eventHandlers })`.
- Added tests for typed `agent.response.produced` payloads, legacy `tool.completed` normalization, invalid payload rejection, wrong event type rejection, and public exports.
- Updated `docs/declarative-api.md` and `docs/event-taxonomy.md`.
- Verified with `npm test` and `npm run typecheck`.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] integration examples if public guidance changes
