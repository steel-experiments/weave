# Authenticated Thread Actions

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-09`
- Owner: `weave-core`

## Goal

Use the auth gateway consistently across existing HTTP thread actions after thread creation.

## User Outcome

As an app author, I can use one auth gateway to protect thread reads, signal delivery, gate resolution, cancellation, and artifact reads instead of hand-authorizing each route.

## Non-goals

- Do not add dashboard or CLI clients in this slice.
- Do not build provider-specific SDK adapters.
- Do not build a full artifact classification system beyond the route metadata already available.
- Do not change runtime policy replay semantics.

## Covered Actions

Map existing HTTP routes to Weave actions where the route exists:

- `GET /threads/:id` -> `thread.read`
- `POST /threads/:id/signals` -> `thread.signal`
- `POST /threads/:id/gates/:gateId/resolve` -> `gate.resolve`
- `POST /threads/:id/cancel` or equivalent -> `thread.cancel`
- `GET /threads/:id/artifacts` or equivalent -> `artifact.read`

If a route does not exist yet, this slice should cover the existing closest service/API boundary and document the gap.

## Architecture Impact

- Extends API server auth mapping from `thread.start` to resource-specific thread actions.
- Adds `AuthorizationRequest.resource` population for thread, gate, signal, and artifact resources.
- Keeps authorization in terms of Weave actions, not route names.
- Creates the route-level contract later dashboard and CLI clients can share.

## Implementation Plan

1. Inventory current API routes and service methods for thread read, signal delivery, gate resolution, cancellation, and artifact read.
2. Define the smallest stable `WeaveAction` set needed by those routes.
3. Add route adapters that authenticate once per request and authorize the route action with resource metadata.
4. Add access policy helpers for `toReadThreads`, `toDeliverSignal`, `toResolveGate`, `toCancelThread`, and `toReadArtifacts` only as needed by tests.
5. Ensure denied requests do not mutate thread state.
6. Keep safe auth context available to mutation service methods that append events.
7. Add examples showing API service account and group-based gate resolution.

## Test Plan

- API integration test allowed `thread.read` returns thread state.
- API integration test denied `thread.read` does not leak thread existence beyond the chosen response semantics.
- API integration test allowed `thread.signal` appends `signal.received`.
- API integration test denied `thread.signal` appends nothing.
- API integration test allowed `gate.resolve` appends `gate.resolved` with the authenticated actor context.
- API integration test denied `gate.resolve` appends nothing.
- Unit test route-to-`WeaveAction` mapping.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Existing HTTP thread action routes authenticate through the configured auth gateway.
- [x] Each protected route authorizes a Weave action with resource metadata.
- [x] Denied mutation routes do not append thread events.
- [x] Gate resolution records who resolved the gate.
- [x] Signal delivery records who delivered the signal.
- [x] Authorization rules are expressed against Weave actions rather than HTTP route strings.

## Progress

- [x] Route inventory.
- [x] Action/resource mapping.
- [x] API auth enforcement.
- [x] Actor context for mutations.
- [x] Tests.
- [x] Docs updates.

## Completion Notes

Shipped as slice 01-authenticated-thread-actions.

- Extended `WeaveAction` with `thread.read`, `thread.signal`, `gate.resolve`, `thread.cancel`, and `artifact.read` action types.
- Added access policy helpers: `allowUserToReadThreads`, `allowUserToResolveGate`, `allowUserToDeliverSignal`, `allowUserToCancelThread`, `allowUserToReadArtifacts`, and corresponding `allowGroup*` and `allowService*` variants.
- All existing HTTP thread routes (`GET /threads/:id`, `GET /threads/:id/events`, `GET /threads/:id/summary`, `GET /threads/:id/stream`, `GET /threads/:id/artifacts`, `GET /threads/:id/diagnostics/inbox`, `GET /threads/:id/observability/spans`, `GET /threads/:id/observability/logs`) now authenticate and authorize through the configured auth gateway.
- Added `POST /threads/:id/signals` route for signal delivery with auth enforcement.
- `POST /threads/:id/gates/:gateId/resolve` now authenticates, authorizes `gate.resolve`, and passes the authenticated principal as the actor to `ThreadService.resolveGate`.
- `POST /threads/:id/signals` authenticates, authorizes `thread.signal`, and passes the authenticated principal as the actor to `ThreadService.deliverSignal`.
- Denied mutation routes return 403 before any thread events are appended.
- `ThreadService.resolveGate` now accepts an optional `actor` parameter; when called from the authenticated API route, the authenticated principal is recorded as the actor in the `gate.resolved` event.
- When auth is not configured, existing unauthenticated behavior is preserved.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/architecture.md`
