# Auth Context Runtime Policy

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Flow the auth context from session start into runtime policy checks so capability and tool decisions can answer who initiated the work.

## User Outcome

As an app author, I can allow a principal to start an agent but deny specific capabilities during execution based on the same principal.

## Non-goals

- Do not add new provider-specific adapters.
- Do not replace existing runtime request policies.
- Do not make tool workers re-run auth checks.
- Do not add a full principal or organization database.
- Do not expand HTTP route coverage beyond what is needed for the runtime test path.

## Runtime Flow

The intended path is:

```txt
POST /threads
  -> AuthGateway.authenticate
  -> AuthGateway.authorize(thread.start)
  -> ThreadService.startSession(auth context)
  -> agent.run
  -> ctx.tool / capability request
  -> runtime policy sees auth principal
  -> allow, deny, or approval_required
```

Capability authorization should use the same Weave action model:

```ts
authorize({
  auth: thread.auth,
  action: "capability.request",
  resource: {
    type: "capability",
    name: "github.repo.read",
  },
  input: {
    params,
    toolName,
    threadId,
  },
});
```

## Architecture Impact

- Extends thread state reconstruction to expose the safe `AuthContext` for the current thread.
- Extends runtime policy context with the thread auth context.
- Extends capability request policy evaluation to support auth-aware decisions.
- Keeps the runtime policy layer as the durable execution guardrail; Auth Gateway feeds it rather than replacing it.
- Keeps tool workers unaware of raw provider tokens and provider claims.

## Implementation Plan

1. Persist enough safe auth context in `session.started` metadata to reconstruct principal, source, and access summary.
2. Add a typed accessor on reconstructed thread/session state for `auth`.
3. Pass auth context into agent runner request policy evaluation.
4. Pass auth context into capability request evaluation for tools that declare or request capabilities.
5. Add access policy helpers for `toUseCapability(...)` and any minimal resource shape needed by tests.
6. Add a demo policy where the same principal can start an agent but cannot request `github.repo.write`.
7. Ensure replay uses recorded policy decisions and recorded auth metadata rather than re-authenticating ingress requests.

## Test Plan

- Integration test a bearer-authenticated principal starts a thread and the agent requests an allowed capability.
- Integration test a bearer-authenticated principal starts a thread and the agent is denied a disallowed capability.
- Replay test denied and allowed capability decisions do not re-run ingress authentication.
- Unit test runtime policy context includes `auth.principal`, `auth.source`, groups, roles, and scopes where present.
- Unit test missing auth context is represented explicitly as anonymous or system according to the configured path.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Thread state reconstruction exposes safe auth context from `session.started`.
- [ ] Runtime policy checks receive auth context.
- [ ] Capability request authorization can inspect principal id, kind, provider, groups, roles, scopes, and source.
- [ ] A principal can be allowed for `thread.start` while denied for a later `capability.request`.
- [ ] Replay remains deterministic and does not call identity providers again.
- [ ] Raw tokens and full provider claims are not persisted.

## Progress

- [ ] Reconstruct safe auth context.
- [ ] Thread auth into runner state.
- [ ] Runtime policy context wiring.
- [ ] Capability authorization helper coverage.
- [ ] Replay tests.
- [ ] Docs updates.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/architecture.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/declarative-api.md`
