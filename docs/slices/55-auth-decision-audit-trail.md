# Auth Decision Audit Trail

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-09`
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

Add a thread-scoped event type:

- `auth.decision.recorded`

Payloads should be safe summaries:

```ts
export interface AuthDecisionRecordedPayload {
  principalId: string;
  principalKind: string;
  provider: string;
  action: string;
  resource?: string;
  decision: "allowed" | "denied";
  reason?: string;
  subjectHash?: string;
}
```

`session.started.payload.metadata.auth` remains the compact thread-start summary. Auth events are decision evidence, not a replacement for policy events.

## Architecture Impact

- Extends event taxonomy with safe auth audit events.
- Adds append points for authorization decisions that already have a thread id.
- Clarifies that pre-thread denials are logged through normal server logging until a global audit sink exists.
- Keeps runtime `policy.evaluated` as the replay source of truth for durable runtime request policy decisions.

## Implementation Plan

1. Add typed event schema for `auth.decision.recorded`.
2. Add a helper to redact/hash provider subjects and omit sensitive claims.
3. Append `auth.decision.recorded` before successful thread-scoped mutations such as signal delivery and gate resolution.
4. Append denied `auth.decision.recorded` decisions only when safe thread-scoped denial evidence can be recorded without mutating protected state in a confusing way.
5. Avoid recording route-level authentication-only events where they duplicate every route read.
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

- [x] Auth audit event types are part of the typed event taxonomy.
- [x] Thread-scoped auth decisions can be inspected from thread history.
- [x] Safe payloads include principal id, principal kind, provider, action, resource, decision, and reason.
- [x] Provider subject is omitted or hashed where appropriate.
- [x] Raw tokens and full provider claims are not stored.
- [x] Pre-thread denial limitations are documented explicitly.

## Progress

- [x] Event taxonomy updates.
- [x] Redaction/hash helper.
- [x] Thread-scoped append points.
- [x] Tests.
- [x] Docs updates.

## Completion Notes

Shipped 2026-06-09. Added `auth.decision.recorded` as the durable thread-scoped audit event, plus `auth-audit` helpers for resource summaries and provider subject hashing. API authorization paths record safe auth decision evidence without raw tokens, full provider claims, or unhashed provider subjects. Pre-thread denial limitations are documented in the event taxonomy.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/event-taxonomy.md`
- [x] `docs/architecture.md`
