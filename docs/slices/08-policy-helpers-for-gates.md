# Policy Helpers For Gates Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Add a reusable authoring helper for approval policy decisions while keeping durable enforcement explicit through `ctx.gate`.

## Non-goals

- Do not implement centralized runtime policy enforcement.
- Do not add storage-backed policy records.
- Do not change gate event schemas.

## User Outcome

As a Weave app author, I can name and reuse approval rules instead of hard-coding every `ctx.gate` request inline.

## Architecture Impact

- Adds `approvalPolicy` / `defineApprovalPolicy`.
- An approval policy has `requiresApproval(input)`, `gate(input)`, and `evaluate(input)`.
- `evaluate(input)` returns a `GateRequest` when approval is required, otherwise `undefined`.
- Agents still call `ctx.gate`; the helper is not a security boundary.
- SRE uses a named `production-remediation` policy before rebuilding production infrastructure.

## Acceptance Criteria

- [x] `approvalPolicy` is exported from root `weave`.
- [x] Policy evaluation returns a gate request only when approval is required.
- [x] SRE uses a named policy helper before `ctx.gate`.
- [x] Existing gate semantics are unchanged.
- [x] Docs state that policy helpers are authoring helpers, not runtime enforcement.

## Completion Notes

Changed modules:

- `src/policy-contract.ts`: policy helper types and implementation.
- `src/index.ts`: root export for policy helpers.
- `src/weave-interface.ts`: public boundary sketch includes policy helpers.
- `src/tests/replay-authoring.test.ts`: policy evaluation coverage.
- `examples/sre-demo/src/agent.ts`: uses `production-remediation` policy.
- `docs/declarative-api.md`: documents policy helpers.

Known follow-ups:

- Central runtime policy enforcement.
- Policy audit events if policy decisions need durable provenance.
- Capability-backed approval requirements.
