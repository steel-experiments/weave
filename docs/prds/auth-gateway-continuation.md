# Auth Gateway Continuation

Continue the Auth Gateway work after the authenticated thread-actions section completed on branch `auth-gateway-remaining`.

Completed context:

- Branch `auth-gateway-remaining` contains checkpoint `4ec7477d1dfc` for authenticated thread actions.
- Failed integration-ingress edits were discarded by restoring the worktree to checkpoint `4ec7477d1dfc`.
- Continue from a fresh working branch based on `auth-gateway-remaining` so the next accepted section starts from the clean checkpoint.
- Source checkpoint support must stay enabled. Each completed section should create an inspectable source checkpoint before the next one starts.

Recommended command:

```sh
npm run initiative:run -- --from docs/prds/auth-gateway-continuation.md --base-branch auth-gateway-remaining --working-branch auth-gateway-continuation
```

Recommended validation for every section:

- `npm test`
- `npm run typecheck`
- `git diff --check`

Global non-goals:

- Do not store raw access tokens, raw ID tokens, refresh tokens, or full provider claims.
- Do not add concrete Better Auth, Clerk, Okta, Slack, or OpenAuth SDK dependencies to core.
- Do not add a principal database, organization database, or global pre-thread audit backend.
- Do not change replay semantics by re-authenticating recorded work.
- Do not implement dashboard or CLI auth clients in this continuation.

## Slice 54: Authenticated Integration Ingress

Let integration ingress routes use the same auth gateway model as the HTTP API, starting with a Slack-shaped integration test path.

### Objective

Prove that an integration can authenticate a stable external principal, authorize `integration.trigger`, authorize `thread.start`, and pass safe auth context into the thread.

### Expected Touchpoints

- `src/integration-contract.ts`
- `src/auth-gateway.ts`
- `src/thread-service.ts`
- `src/tests/auth-gateway.test.ts`
- `docs/integrations.md`
- `docs/declarative-api.md`
- `docs/architecture.md`

### Implementation Notes

- Add or document integration route context access to the configured auth gateway.
- Use a Slack-shaped fake integration path with local signature verification and stable workspace id plus user id identity.
- Add `integration.trigger` as a Weave authorization action.
- Keep trigger authorization and thread-start authorization as separate decisions.
- Persist Slack username or display name only as aliases, never as the primary access key.
- Add a runtime capability denial test using the auth context from the integration-started thread.

### Acceptance Criteria

- Integration route authors can access the configured auth gateway.
- `integration.trigger` is a supported Weave authorization action.
- A Slack-shaped ingress path uses stable workspace id plus user id as provider subject.
- Slack username and display name are never used as the primary access key.
- Trigger authorization and thread-start authorization are separate decisions.
- Auth context from integration ingress reaches runtime capability policy checks.

## Slice 55: Auth Decision Audit Trail

Record safe, durable auth decision evidence for thread-scoped authorization without storing secrets or full provider claims.

### Objective

Make thread history sufficient for an operator to inspect who was authenticated, which Weave action was authorized or denied, and why, for thread-scoped decisions.

### Expected Touchpoints

- `src/events.ts`
- `src/auth-gateway.ts`
- `src/api-server.ts`
- `src/tests/auth-gateway.test.ts`
- `docs/event-taxonomy.md`
- `docs/architecture.md`

### Implementation Notes

- Add typed event schemas for safe auth evidence, such as `auth.authenticated`, `auth.authorized`, and `auth.denied` if those names still fit the event taxonomy.
- Add a helper to redact or hash provider subjects and omit sensitive claims.
- Append `auth.authorized` before successful thread-scoped mutations where useful.
- Append `auth.denied` only when safe thread-scoped denial evidence can be recorded without mutating protected state in a confusing way.
- Document that denied `thread.start` still has no thread event until a global audit sink exists.
- Keep runtime `policy.evaluated` as the replay source of truth for runtime request policy decisions.

### Acceptance Criteria

- Auth audit event types are part of the typed event taxonomy.
- Thread-scoped auth decisions can be inspected from thread history.
- Safe payloads include principal id, principal kind, provider, action, resource, decision, and reason.
- Provider subject is omitted or hashed where appropriate.
- Raw tokens and full provider claims are not stored.
- Pre-thread denial limitations are documented explicitly.

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
