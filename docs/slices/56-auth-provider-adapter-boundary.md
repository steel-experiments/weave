# Auth Provider Adapter Boundary

## Status

- Vertical: `weave-core`
- Status: `Completed`
- Last updated: `2026-06-09`
- Owner: `weave-core`

## Goal

Stabilize the adapter boundary for external auth providers without hardcoding Better Auth, OpenAuth, Okta, Clerk, or Slack semantics into Weave core.

## User Outcome

As an app author, I can plug in a provider-backed identity adapter and keep Weave authorization rules independent from that provider.

## Non-goals

- Do not vendor provider SDKs into core.
- Do not implement every named provider package in this slice.
- Do not add a principal persistence service.
- Do not make emails or usernames immutable access keys.
- Do not couple provider group semantics directly to Weave runtime policy internals.

## Adapter Shape

The stable core should remain provider-neutral:

```ts
const auth = authGateway({
  identity: oidcAuth({
    issuer: process.env.OIDC_ISSUER,
    audience: "weave-api",
  }),
  access: weaveAccessPolicy({ rules }),
});
```

Provider-specific adapters can live outside the core subpath once the interface is stable:

- `weave/auth/better-auth`
- `weave/auth/openauth`
- `weave/auth/clerk`
- `weave/auth/okta`
- `@weave-auth/clerk`
- `@weave-auth/okta`

Core may provide dependency-light adapters such as `jwtAuth(...)` or `oidcAuth(...)` only if they do not force heavyweight provider assumptions into all users.

## Architecture Impact

- Clarifies package boundaries for provider adapters.
- Adds adapter contract tests that third-party packages can copy.
- Adds normalized claim mapping rules for principal kind, provider, provider subject, aliases, groups, roles, scopes, tenant, and organization.
- Keeps access control as `AccessController`, not a provider-specific authorization object.

## Implementation Plan

1. Document adapter authoring rules in the auth docs.
2. Add contract tests for any identity provider implementation: success, denied, anonymous where applicable, stable provider subject, safe claims, and no raw token persistence.
3. Add a minimal `jwtAuth(...)` or `oidcAuth(...)` only if it can be dependency-light and testable with local keys or injected verification.
4. Add normalized claim mapping for groups, roles, scopes, organization id, and tenant id.
5. Add alias examples that show usernames and emails as aliases only.
6. Add one end-to-end API example where JWT/OIDC groups authorize `gate.resolve` while Weave policy still controls runtime capabilities.

## Test Plan

- Contract test identity adapters produce stable `Principal` values.
- Contract test usernames and emails appear only as aliases unless the app explicitly chooses otherwise.
- Contract test groups, roles, scopes, tenant, and organization flow into `AuthContext.access`.
- Integration test a JWT/OIDC-authenticated principal with an allowed group resolves a gate.
- Integration test a JWT/OIDC-authenticated principal without the group is denied.
- Export test confirms provider-neutral core auth exports stay available from `weave/auth`.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Provider adapter boundaries are documented.
- [x] Core auth interfaces do not depend on Better Auth, OpenAuth, Okta, Clerk, or Slack SDKs.
- [x] At least one dependency-light token identity adapter or adapter contract test proves the boundary.
- [x] Provider groups, roles, scopes, tenant, and organization can populate normalized auth context.
- [x] Usernames and emails are documented as aliases, not preferred immutable identifiers.
- [x] Third-party adapter packages have a clear contract to implement.

## Progress

- [x] Adapter boundary docs.
- [x] Identity adapter contract tests.
- [x] Optional dependency-light token adapter.
- [x] Group/role/scope mapping.
- [x] End-to-end gate example.
- [x] Docs updates.

## Completion Notes

Completed 2026-06-09. Added `AuthProviderAdapter` contract, `ClaimNormalizer`, and dependency-light `jwtAuth()` (HS256 via Node `crypto`). Extended `Principal` with optional `roles`, `scopes`, `tenantId`, `organizationId`. Added `AccessContext` to `AuthContext` for normalized access claims. Added `allowRole`, `allowScope`, `allowTenant`, `allowOrganization` access rule builders. Added reusable `createIdentityAdapterContractTests` suite. Documented adapter boundary in `docs/auth-provider-adapters.md`. All existing tests continue to pass.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/declarative-api.md`
- [x] `docs/architecture.md`
- [x] package export docs
- [x] `docs/auth-provider-adapters.md` (new)
