# Auth Gateway Provider Adapter Boundary

Finish the remaining Auth Gateway work after thread actions, integration ingress, and auth decision audit trail completed on branch `auth-gateway-continuation`.

Completed context:

- Branch `auth-gateway-continuation` contains:
  - `4ec7477` Authenticated Thread Actions
  - `a1d9830` Authenticated Integration Ingress
  - `c0ba0a3` Auth Decision Audit Trail
- Start from a fresh working branch based on `auth-gateway-continuation` so the remaining slice builds on the validated auth foundation.
- Source checkpoint support must remain enabled so the final slice ends with an inspectable Git commit boundary.

Recommended command:

```sh
npm run initiative:run -- --from docs/prds/auth-gateway-provider-adapter-boundary.md --base-branch auth-gateway-continuation --working-branch auth-gateway-provider-adapter-boundary
```

Recommended validation:

- `npm test`
- `npm run typecheck`
- `git diff --check`

Global non-goals:

- Do not store raw access tokens, raw ID tokens, refresh tokens, or full provider claims.
- Do not add concrete Better Auth, Clerk, Okta, Slack, or OpenAuth SDK dependencies to core.
- Do not add a principal database, organization database, or global pre-thread audit backend.
- Do not change replay semantics by re-authenticating recorded work.
- Do not implement dashboard or CLI auth clients in this final continuation.

## Slice 56: Auth Provider Adapter Boundary

Stabilize the adapter boundary for external auth providers without hardcoding provider SDK semantics into Weave core.

### Objective

Give app authors and third-party packages a clear identity adapter contract while keeping Weave authorization provider-neutral.

### Expected Touchpoints

- `src/auth-gateway.ts`
- `src/tests/auth-gateway.test.ts`
- `src/tests/public-api-exports.test.ts`
- `docs/declarative-api.md`
- `docs/architecture.md`
- `README.md`

### Implementation Notes

- Document adapter authoring rules for provider-backed identity implementations.
- Add contract tests for identity providers: success, denied, anonymous where applicable, stable provider subject, safe claims, and no raw token persistence.
- Add a minimal dependency-light token identity adapter such as JWT or OIDC only if it stays testable without pulling provider SDKs into core.
- Normalize groups, roles, scopes, tenant id, and organization id into safe auth context.
- Show usernames and emails as aliases, not preferred immutable identifiers.
- Add one end-to-end API example where JWT or OIDC groups authorize `gate.resolve` while Weave policy still controls runtime capabilities.

### Acceptance Criteria

- Provider adapter boundaries are documented.
- Core auth interfaces do not depend on Better Auth, OpenAuth, Okta, Clerk, or Slack SDKs.
- At least one dependency-light token identity adapter or adapter contract test proves the boundary.
- Provider groups, roles, scopes, tenant, and organization can populate normalized auth context.
- Usernames and emails are documented as aliases, not preferred immutable identifiers.
- Third-party adapter packages have a clear contract to implement.
