# Auth Decision Audit Trail

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Record safe, durable auth decision evidence for thread-scoped authorization without storing secrets or full provider claims.

## User Outcome

As an operator, I can inspect a thread and answer who was authenticated, which Weave action was authorized or denied, and why, without exposing raw tokens or sensitive claims.

## Non-goals

- Do not store raw access tokens, raw ID tokens, refresh tokens, or full provider claims.
- Do not solve global audit for requests denied before any thread exists.
- Do not introduce a separate audit storage backend.
- Do not replace existing `policy.evaluated` runtime evidence.
- Do not log provider subject values in cleartext where a hash is sufficient.

## Event Shape

Add thread-scoped event types:

- `auth.authenticated`
- `auth.authorized`
- `auth.denied`

Payloads should be safe summaries:

```ts
export interface AuthDecisionPayload {
  principalId: string;
  principalKind: "user" | "service" | "bot" | "anonymous";
  provider: string;
  providerSubjectHash?: string;
  action: WeaveAction;
  resourceType?: string;
  resourceName?: string;
  resourceId?: string;
  decision: "allow" | "deny";
  reason?: string;
}
```

`session.started.payload.metadata.auth` remains the compact thread-start summary. Auth events are decision evidence, not a replacement for policy events.

## Architecture Impact

- Extends event taxonomy with safe auth audit events.
- Adds append points for authorization decisions that already have a thread id.
- Clarifies that pre-thread denials are logged through normal server logging until a global audit sink exists.
- Keeps runtime `policy.evaluated` as the replay source of truth for durable runtime request policy decisions.

## Implementation Plan

1. Add typed event schemas for `auth.authenticated`, `auth.authorized`, and `auth.denied`.
2. Add a helper to redact/hash provider subjects and omit sensitive claims.
3. Append `auth.authorized` before successful thread-scoped mutations such as signal delivery and gate resolution.
4. Append `auth.denied` only when a safe thread-scoped denial event can be recorded without mutating protected state in a confusing way.
5. Add `auth.authenticated` only where it provides useful thread-scoped evidence and does not duplicate every route read.
6. Document that denied `thread.start` currently has no thread event and needs a later global audit/log sink if durable pre-thread audit is required.

## Test Plan

- Unit test auth decision payload redaction and provider-subject hashing.
- Event schema test rejects raw token-looking fields if represented structurally.
- Integration test allowed gate resolution records safe auth authorization evidence.
- Integration test allowed signal delivery records safe auth authorization evidence.
- Integration test denied thread-scoped mutation records safe denial evidence where the chosen design permits it.
- Integration test denied `thread.start` does not create a thread event and is documented as server-log-only for now.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Auth audit event types are part of the typed event taxonomy.
- [ ] Thread-scoped auth decisions can be inspected from thread history.
- [ ] Safe payloads include principal id, principal kind, provider, action, resource, decision, and reason.
- [ ] Provider subject is omitted or hashed where appropriate.
- [ ] Raw tokens and full provider claims are not stored.
- [ ] Pre-thread denial limitations are documented explicitly.

## Progress

- [ ] Event taxonomy updates.
- [ ] Redaction/hash helper.
- [ ] Thread-scoped append points.
- [ ] Tests.
- [ ] Docs updates.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/architecture.md`
