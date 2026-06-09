# Auth Provider Adapter Boundary

## Purpose

This document defines the adapter boundary between Weave core and external auth providers. Weave core remains provider-neutral: it does not depend on Better Auth, OpenAuth, Okta, Clerk, Slack, or any other provider SDK. Provider-specific adapters implement a stable contract and adapt their native semantics into normalized Weave identity types.

## Core Interfaces

Weave core exposes three auth interfaces that provider adapters must satisfy:

```ts
interface IdentityProvider {
  authenticate(request: AuthRequest): Promise<AuthResult>;
}

interface AccessController {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

interface AuthGateway {
  authenticate(input: AuthRequest): Promise<AuthResult>;
  authorize(input: AuthorizationRequest): Promise<AuthorizationDecision>;
}
```

Provider adapters produce an `IdentityProvider`. Access control remains in Weave core as `AccessController` via `weaveAccessPolicy(...)`.

## Normalized Identity Model

### Principal

The `Principal` is the provider-neutral identity record:

```ts
type Principal = {
  id: string;                    // Stable, provider-prefixed immutable identifier
  provider: string;              // Provider name or issuer
  aliases: readonly IdentityAlias[];  // Cross-provider identity links
  groups: readonly string[];     // Group memberships
  roles?: readonly string[];     // Role assignments
  scopes?: readonly string[];    // OAuth-style scopes
  tenantId?: string;             // Multi-tenant identifier
  organizationId?: string;       // Organization identifier
  displayName?: string;          // Human-readable name
};
```

### Identity Aliases

Emails and usernames are **aliases**, not preferred immutable identifiers. They appear in `principal.aliases` with `provider: "email"` or `provider: "username"`. The `principal.id` must be a stable provider-prefixed subject (e.g., `jwt:sub-123`, `okta:00u1abc`), not an email or username.

### Access Context

The `AuthContext` carries a normalized `access` field for authorization decisions:

```ts
type AccessContext = {
  groups: readonly string[];
  roles: readonly string[];
  scopes: readonly string[];
  tenantId?: string;
  organizationId?: string;
};

type AuthContext = {
  principal: Principal;
  access?: AccessContext;
  source: string;
  authenticatedAt: string;
};
```

## Adapter Contract

### AuthProviderAdapter

Third-party adapter packages implement the `AuthProviderAdapter` contract:

```ts
type AuthProviderAdapter = {
  providerName: string;
  normalize: ClaimNormalizer;
  createIdentityProvider(
    verify: (token: string) => Promise<Record<string, unknown> | null>
  ): IdentityProvider;
  claimsToPrincipal(claims: Record<string, unknown>): Principal;
};
```

### ClaimNormalizer

The `ClaimNormalizer` maps raw provider claims to normalized claims:

```ts
type NormalizedClaims = {
  subject: string;
  provider: string;
  groups?: readonly string[];
  roles?: readonly string[];
  scopes?: readonly string[];
  tenantId?: string;
  organizationId?: string;
  email?: string;
  username?: string;
  displayName?: string;
};

type ClaimNormalizer = (rawClaims: Record<string, unknown>) => NormalizedClaims;
```

### Creating an Adapter

```ts
import { createAuthProviderAdapter, type ClaimNormalizer } from "weave/auth";

const normalizer: ClaimNormalizer = (raw) => ({
  subject: String(raw["user_id"]),
  provider: "my-sso",
  groups: Array.isArray(raw["teams"]) ? raw["teams"] : [],
  roles: Array.isArray(raw["permissions"]) ? raw["permissions"] : [],
  scopes: [],
  email: raw["email"] ? String(raw["email"]) : undefined,
  displayName: raw["name"] ? String(raw["name"]) : undefined,
});

const adapter = createAuthProviderAdapter({
  providerName: "my-sso",
  normalize: normalizer,
});

const identity = adapter.createIdentityProvider(async (token) => {
  // Call your provider's token verification here
  return await mySsoVerify(token);
});
```

## Built-in Dependency-Light Adapters

### jwtAuth

Core provides a dependency-light HS256 JWT adapter using only Node.js built-in `crypto`:

```ts
import { jwtAuth, authGateway, weaveAccessPolicy, allowGroup } from "weave/auth";

const auth = authGateway({
  identity: jwtAuth({
    secret: process.env.JWT_SECRET,
    issuer: "https://auth.example.com",
    audience: "weave-api",
  }),
  access: weaveAccessPolicy({
    rules: [allowGroup("approvers").toResolveGate()],
  }),
});
```

`jwtAuth` supports:
- HS256 signature verification (HMAC-SHA256 via Node `crypto`)
- Issuer and audience validation
- Expiration (`exp`) and not-before (`nbf`) checks
- Default claim mapping for `sub`, `iss`, `groups`, `roles`, `scope`/`scopes`, `tid`/`tenant_id`, `org_id`/`organization_id`, `email`, `preferred_username`/`username`, `name`

Custom claim mapping is supported via the `normalize` option.

## Access Control Rules

Weave core access rules can match on normalized access context fields:

| Rule Builder | Matches On |
| --- | --- |
| `allowGroup(group)` | `principal.groups` |
| `allowRole(role)` | `access.roles` or `principal.roles` |
| `allowScope(scope)` | `access.scopes` or `principal.scopes` |
| `allowTenant(tenantId)` | `access.tenantId` or `principal.tenantId` |
| `allowOrganization(orgId)` | `access.organizationId` or `principal.organizationId` |
| `allowUser(id)` | `principal.id` |
| `allowService(id)` | `principal.id` |

## Adapter Contract Tests

Core provides reusable contract tests that any adapter can run to prove boundary compliance:

```ts
import { createIdentityAdapterContractTests } from "weave/auth";

const tests = createIdentityAdapterContractTests("my-sso", () => myAdapter, {
  validToken: "...",
  invalidToken: "...",
  expectedPrincipalId: "my-sso:sub-123",
  expectedProvider: "my-sso",
  expectedGroups: ["team-a"],
  expectedEmail: "user@example.com",
});

for (const test of tests) {
  await test.run();
}
```

Contract tests verify:
1. Valid tokens produce stable `Principal` values
2. Invalid tokens are rejected
3. Missing authorization headers are rejected
4. Groups, roles, scopes, tenant, and organization populate `AuthContext.access`
5. Emails and usernames appear only as aliases, not as `principal.id`
6. Access context mirrors principal groups

## Provider Package Layout

Provider-specific adapters live outside core:

```
weave/auth              # Core: interfaces, bearerTokenAuth, jwtAuth, policy rules
weave/auth/better-auth  # Future: Better Auth adapter
weave/auth/clerk        # Future: Clerk adapter
weave/auth/okta         # Future: Okta adapter
@weave-auth/slack       # Future: Slack adapter
```

Each adapter package:
1. Depends on `weave/auth` for core types
2. Implements `AuthProviderAdapter` or `IdentityProvider`
3. Runs the adapter contract tests
4. Does not leak provider SDK types into the Weave core interface

## What Core Does Not Do

- Core does not import or depend on Better Auth, OpenAuth, Okta, Clerk, or Slack SDKs
- Core does not persist raw access tokens, ID tokens, refresh tokens, or full provider claims
- Core does not treat emails or usernames as immutable identifiers
- Core does not couple provider-specific group semantics to runtime policy internals
- Core does not implement OIDC discovery, JWKS rotation, or OAuth flows (these belong in adapter packages)
