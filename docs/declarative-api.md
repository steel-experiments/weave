# Declarative API

The current authoring API is import-composed TypeScript, not file-based discovery or string config.

## Current Primitives

- `defineTool`: declares a typed side-effect contract with input, output, progress, optional gate metadata, and `run`.
- `defineAgent`: composes a named planner with the tools it is allowed to request.
- `defineMailboxApp`: composes one or more named agents into an app-level definition.

## Credentials

Tools can declare required credentials without reading secrets or delegated tokens directly.

Credential requests can represent static secrets, scoped tokens, delegated identity, or browser sessions. The worker resolves them before tool execution and appends `credential.requested` / `credential.resolved` / `credential.failed` events to the mailbox. Credential values are only passed in-process to the tool run context; mailbox events store metadata, not secret values.

## Observability

Observability is a parallel signal plane, not a replacement for mailbox events.

- Mailbox events remain durable control-plane facts.
- Observability spans/logs capture runtime execution details.
- Spans and logs reference `mailboxId`, `eventId`, `correlationId`, `toolCallId`, and `toolName` so an admin panel can align the mailbox stream with traces and logs.
- `ObservabilitySink` is the extension point for OTLP collectors, local Postgres ingestion, or any custom backend.

The first internal sink is `PostgresObservabilitySink`, which writes queryable spans and logs into `agent_mailbox.observability_span` and `agent_mailbox.observability_log` for the future admin panel.

## Deferred Primitive

`defineMailbox` is intentionally not implemented yet.

A mailbox is currently runtime session state, while `defineTool`, `defineAgent`, and `defineMailboxApp` are authoring-time composition primitives. We should only add `defineMailbox` if a concrete authoring need appears, such as reusable mailbox templates, ingress-specific routing, parent/child mailbox policies, or per-session policy defaults.

Hallmark to revisit: if app authors start needing to configure mailbox/session behavior before a session exists, reconsider `defineMailbox`.
