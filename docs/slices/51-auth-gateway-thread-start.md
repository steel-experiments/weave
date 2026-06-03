# Auth Gateway Thread Start

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Add the smallest first-class auth gateway path: an app can configure authentication and access control for `thread.start`, and the HTTP API uses it before starting a root session.

## User Outcome

As an app author, I can protect `POST /threads` with a swappable auth gateway and trust that accepted sessions record who started them.

## Non-goals

- Do not implement every ingress boundary in this slice.
- Do not add concrete Better Auth, Clerk, Okta, or OpenAuth SDK dependencies.
- Do not build a principal database or alias-resolution service yet.
- Do not make runtime tool and capability policy depend on auth context yet.
- Do not solve durable audit for requests denied before a thread exists.

## Public Shape

Introduce a `weave/auth` subpath with core interfaces and minimal helpers:

```ts
const auth = authGateway({
  identity: bearerTokenAuth({ verify }),
  access: weaveAccessPolicy({
    rules: [allowService("ci-bot").toStartAgent("repo.review")],
  }),
});

createApiServer(engine, service, { app, auth });
```

The first public contract should preserve the identity/access split:

```ts
export interface IdentityProvider {
  authenticate(request: AuthRequest): Promise<AuthResult>;
}

export interface AccessController {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export interface AuthGateway {
  authenticate(input: AuthRequest): Promise<AuthResult>;
  authorize(input: AuthorizationRequest): Promise<AuthorizationDecision>;
}
```

## Architecture Impact

- Adds Auth Gateway as a first-class layer above provider-specific auth libraries.
- Adds normalized `Principal` and `AuthContext` types.
- Adds `WeaveAction` and `AuthorizationRequest` for Weave-level actions, starting with `thread.start` and `agent.run` targeting.
- Extends API server options to accept `auth`.
- Extends root session start metadata with a safe auth summary.
- Keeps provider SDK dependencies outside core.

## Implementation Plan

1. Add `weave/auth` package subpath and export tests.
2. Define `Principal`, `IdentityAlias`, `AuthContext`, `AuthRequest`, `AuthResult`, `WeaveAction`, `AuthorizationRequest`, `AuthorizationDecision`, `IdentityProvider`, `AccessController`, and `AuthGateway`.
3. Implement `authGateway({ identity, access })` as composition only.
4. Implement `anonymousAuth()` for tests and local demos.
5. Implement `bearerTokenAuth({ verify })` without external dependencies.
6. Implement a minimal `weaveAccessPolicy(...)` with `allowService`, `allowUser`, `allowGroup`, `allowEveryone`, and `denyEveryone` rules for `thread.start` and target agent names.
7. Wire `createApiServer(..., { auth })` so `POST /threads` authenticates, authorizes `thread.start`, and rejects denied requests before `ThreadService.startSession(...)`.
8. Store a safe auth summary in `session.started.payload.metadata.auth`.
9. Preserve current unauthenticated local behavior by requiring explicit `auth` configuration for enforcement, or by using an explicit anonymous gateway in examples.

## Test Plan

- Unit test `authGateway` delegates authentication and authorization.
- Unit test bearer token success, missing token denial, and invalid token denial.
- Unit test access policy allow and deny rules for `thread.start` by service, user, group, and anonymous principal.
- API integration test accepted `POST /threads` starts a session and records safe auth metadata.
- API integration test denied `POST /threads` returns an auth failure and does not append `session.started`.
- Export test for `weave/auth`.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] `weave/auth` exports core auth gateway interfaces and constructors.
- [ ] Identity providers and access controllers are separate swappable parts.
- [ ] `POST /threads` can be protected by `authGateway(...)`.
- [ ] Denied `thread.start` requests do not create sessions.
- [ ] Accepted `thread.start` requests record principal id, provider, and source in safe session metadata.
- [ ] No raw access tokens, raw ID tokens, refresh tokens, or full provider claims are stored by default.
- [ ] Existing examples and tests can run with explicit anonymous or no-op auth behavior.

## Progress

- [ ] Define auth contracts.
- [ ] Implement minimal identity helpers.
- [ ] Implement minimal access policy helpers.
- [ ] Wire HTTP thread start.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/architecture.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md` if session metadata schema changes
