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
