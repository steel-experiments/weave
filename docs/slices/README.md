# Slice Docs

This directory contains shared rules and templates for vertical implementation slices.

Use `template.md` when creating a new slice under a vertical such as `blade/slices/` or `docs-sync/slices/`.

## Required Pattern

Each slice should be independently reviewable.

It should define:

- what user-visible capability changes
- what Weave or Blade architecture changes
- what code paths are expected to change
- what tests prove the slice works
- what docs must be updated when it ships

The slice document should stay alive after implementation. It becomes the compact record of what was planned, what actually shipped, and what follow-up remains.

## Current Weave Core Slices

- `01-replay-authoring-api.md`: shipped slice for replay-based `agent.run` and `ctx.tool`.
- `02-tool-output-migration.md`: shipped slice for domain-shaped tool outputs with legacy compatibility.
- `03-gates-and-approval-policies.md`: shipped slice for replay-safe `ctx.gate` and explicit approval gates.
- `04-sre-run-first-domain-outputs.md`: shipped slice migrating the SRE demo to `agent.run`, domain outputs, and `ctx.gate`.
- `05-public-api-polish.md`: shipped slice making `weave`, `agent`, `tool`, and `integration` the primary authoring boundary.
- `06-failure-semantics-hardening.md`: shipped slice clarifying failed tool terminal behavior and inbox states.
- `07-package-subpaths-runtime-boundary.md`: shipped slice adding runtime, postgres, server, and testing subpaths.
- `08-policy-helpers-for-gates.md`: shipped slice adding reusable approval policy authoring helpers.
- `09-agent-failure-events.md`: shipped slice adding durable `agent.failed` events for non-tool agent exceptions.
- `10-typed-event-factories.md`: shipped slice adding typed `event(type, payload)` builders for `ctx.emit`.
- `11-parallel-durable-effects-guardrails.md`: shipped slice rejecting unsupported parallel suspending effects.
- `12-subthread-lineage-foundation.md`: shipped slice adding lineage fields and child-thread event taxonomy.
- `13-start-child-session-service.md`: shipped slice adding `ThreadService.startChildSession` for API-created child threads.
- `14-ctx-spawn-durable-effect.md`: shipped slice adding service-backed `ctx.spawn` for child sessions.
- `15-ctx-join-child-terminal-mirroring.md`: shipped slice adding `ctx.join` and parent child-terminal mirroring.
- `16-child-listing.md`: shipped slice adding `ThreadService.listChildren` and `ctx.children`.
- `17-child-agent-runtime-dispatch.md`: shipped slice dispatching child threads to their target agent.
- `18-agent-output-raw-join-output.md`: shipped slice storing raw agent outputs and returning them from `ctx.join`.
- `19-join-output-schema-validation.md`: shipped slice validating raw joined child output against child agent output schemas.
- `20-child-listing-filters.md`: shipped slice adding child listing filters by agent name and status.
- `21-child-cancellation.md`: shipped slice adding durable child cancellation through `ctx.cancelChild` and `ThreadService.cancelChildThread`.
- `22-agent-output-schema-validation.md`: shipped slice validating run-first agent outputs against declared output schemas.
- `23-agent-input-validation-errors.md`: shipped slice recording invalid run-first agent input as durable `AGENT_INPUT_INVALID` failures.
- `24-root-session-agent-dispatch.md`: shipped slice letting root sessions target agents through `session.started.payload.agentName`.
- `25-unknown-agent-dispatch-failure.md`: shipped slice recording unknown runtime agent dispatch as durable `AGENT_NOT_FOUND` failures.
- `26-root-session-idempotency-mismatch.md`: shipped slice rejecting changed root session inputs for reused idempotency keys.
- `27-child-session-idempotency-mismatch.md`: shipped slice rejecting changed child session inputs for reused idempotency keys.
- `28-unknown-child-agent-dispatch-failure.md`: shipped slice proving unknown child target agents record durable `AGENT_NOT_FOUND` failures.
- `29-v1-authoring-api-stabilization.md`: shipped umbrella slice for merge hardening the V1 authoring/runtime boundary.
- `30-public-api-export-audit.md`: shipped slice testing and documenting root and subpath package exports.
- `31-migration-legacy-compatibility.md`: shipped slice for legacy event, tool-output, and database migration compatibility coverage.
- `32-replay-invariant-hardening.md`: shipped slice locking down run-first replay invariants.
- `33-child-thread-integrity-audit.md`: shipped slice for child lineage, ownership, cancellation, and terminal mirroring hardening.
- `34-documentation-conformance-pass.md`: shipped slice aligning docs with implemented V1 behavior and limitations.
- `35-example-quality-audit.md`: shipped slice making examples trustworthy demos and regression assets.
- `36-api-refactor-upgrade-guide.md`: shipped slice for a human-readable migration guide from planner-first to V1 authoring.
- `37-typed-events-and-stable-ids.md`: shipped slice for contract-based typed event factories and `ctx.id` stable IDs.
- `38-capability-contracts.md`: shipped slice for declarative capability contracts without enforcement.
- `39-policy-enforcement-over-requests.md`: shipped slice for runtime policy enforcement over tool requests, gates, and capabilities.
- `40-effect-internals-tool-credential.md`: shipped slice for Effect-style tool execution and credential resolution internals.
- `41-policy-capability-runtime-stabilization.md`: shipped slice hardening durable policy replay, request hashing, ordering, and capability-aware mismatch detection.
- `42-capability-mediated-credentials.md`: planned slice turning capabilities into scoped credential request boundaries.
- `43-typed-integration-event-handlers.md`: planned slice adding schema-backed typed integration event handlers.
- `44-effect-internals-runner-policy-tool.md`: planned slice expanding Effect-style internals into runner and policy paths.
- `45-durable-timers-and-ctx-sleep.md`: planned slice adding durable timer semantics and `ctx.sleep`.
- `46-durable-waits-and-external-signals.md`: planned slice adding durable waits for external signals.
