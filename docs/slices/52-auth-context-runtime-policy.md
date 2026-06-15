# Auth Context Runtime Policy

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-15`
- Owner: `weave-core`

## Goal

Flow safe auth context from session start into runtime policy checks so capability and tool decisions can answer who initiated the work.

## User Outcome

As an app author, I can allow a principal to start an agent but deny specific capabilities during execution based on the same recorded principal context.

## Non-goals

- Do not add new provider-specific adapters.
- Do not replace existing runtime request policies.
- Do not make tool workers re-run auth checks.
- Do not add a full principal or organization database.
- Do not persist raw provider tokens or full provider claims.
- Do not re-authenticate ingress requests during replay.

## Runtime Flow

The shipped path is:

```txt
POST /threads or integration route
  -> AuthGateway.authenticate
  -> AuthGateway.authorize(thread.start or integration.trigger)
  -> ThreadService.startSession(metadata.auth = safe summary)
  -> agent.run
  -> ctx.tool / capability request
  -> runtime policy sees request.auth
  -> allow, deny, or approval_required
```

`request.auth` is reconstructed only from durable `session.started.payload.metadata.auth`. Replay does not call the identity provider again.

Runtime policy receives this safe shape when a thread has auth metadata:

```ts
type PolicyAuthContext = {
  principalId: string;
  provider: string;
  source: string;
  groups: readonly string[];
  roles: readonly string[];
  scopes: readonly string[];
  tenantId?: string;
  organizationId?: string;
};
```

Raw access tokens, refresh tokens, ID tokens, provider secrets, aliases, display names, and full provider claims are not copied into policy requests.

## Architecture Impact

- Extends the safe auth summary stored in `session.started.payload.metadata.auth` to include optional groups, roles, scopes, tenant, and organization fields.
- Extends `PolicyRequest` / `ToolPolicyRequest` with optional `auth?: PolicyAuthContext`.
- Reconstructs policy auth context in the agent runner from durable session metadata only.
- Includes safe auth context in the current policy request hash while accepting the previous no-auth hash for existing policy evidence.
- Keeps runtime policy as the durable execution guardrail; Auth Gateway feeds it rather than replacing it.
- Keeps tool workers unaware of raw provider tokens and provider claims.

## Implementation Notes

- `toAuthSummary(...)` now whitelists `principalId`, `provider`, `source`, and safe access fields only.
- `createApiServer` continues to merge the safe summary into `metadata.auth` for authenticated HTTP thread starts.
- Integration authors can use `toAuthSummary(...)`; the Slack-shaped integration test now does this before starting a thread.
- `agent-runner` reconstructs `PolicyAuthContext` from `session.started` metadata and attaches it to runtime policy requests.
- The runner ignores unknown auth metadata keys, so raw tokens or full claims in metadata are not surfaced to policy code.

## Acceptance Criteria

- [x] Thread state reconstruction exposes safe auth context from `session.started`.
- [x] Runtime policy checks receive auth context.
- [x] Capability/tool request authorization can inspect principal id, provider, source, groups, roles, scopes, tenant, and organization where present.
- [x] A principal can be allowed for `thread.start` while denied for a later capability/tool request.
- [x] Replay remains deterministic and does not call identity providers again.
- [x] Raw tokens and full provider claims are not persisted by auth helpers or exposed on policy requests.

## Progress

- [x] Reconstruct safe auth context.
- [x] Thread auth into runner state.
- [x] Runtime policy context wiring.
- [x] Capability/tool authorization coverage.
- [x] Replay/no-reauth coverage.
- [x] Docs updates.

## Test Evidence

- `src/tests/auth-gateway.test.ts`: HTTP-authenticated thread start records safe auth metadata, runtime policy receives it, and an allowed starter is denied for a later protected tool/capability request without another bearer verification call.
- `src/tests/authenticated-integration-ingress.test.ts`: Slack-shaped integration ingress records safe auth metadata with groups, roles, scopes, tenant, and organization, then runtime policy receives it for the started thread.
- `npm run typecheck`: passed on `2026-06-15`.

## Completion Notes

Slice 52 is shipped. The repo now matches later Auth Gateway PRDs that treat auth context propagation to runtime policy as existing behavior.

## Remaining Gaps

- Runtime policy currently covers the existing `ctx.tool` boundary; it does not add a separate Auth Gateway `capability.request` action.
- Threads without `metadata.auth` produce no `request.auth`; there is no synthetic anonymous context at the runner layer.
- Child-thread auth inheritance remains app/service-specific and was not expanded in this slice.

## Docs Updated On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/architecture.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/declarative-api.md`
