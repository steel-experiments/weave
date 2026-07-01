# Steel Docs Sync App

## Purpose

The Steel docs sync app is a focused Weave app for auditing docs drift across `steel-dev/docs`, live docs, `llms.txt`, and canonical API reference inputs.

It should remain smaller than a broad host operator.

A broad host application can be a full internal AI operator. Docs sync is a recurring docs and API audit workflow that uses Weave primitives without needing a broad operator's full specialist set, sandbox UX, Slack/Discord support surface, or background implementation abilities.

## Relationship To Host Applications

Docs sync should share lessons with a host application's docs and examples agent, but it should not become a broad host product surface by accident.

Recommended split:

- Weave owns durable threads, events, tools, artifacts, inboxes, gates, credentials, and resumability.
- Docs sync owns Steel docs audit prompts, source collection, drift checks, findings, CI result handling, and optional GitHub publishing.
- A host application may later call or wrap a docs sync workflow as one specialist capability.

## Existing Source Docs

The original plans remain in place while this area is split into slice docs:

- `../steel-docs-sync-example.md`: product-shaped example and end-to-end flow
- `../steel-docs-sync-missing-work.md`: original missing-work rollup and progress tracker

The new slice index is:

- `slices/README.md`

## Current Product Shape

```txt
GitHub Action in steel-dev/docs
  -> signed webhook
  -> Weave thread created or resumed
  -> docs sync agent requests source collection and audit tools
  -> artifacts store large source bodies and snapshots
  -> structured findings drive CI pass, warning, or failure
  -> optional GitHub publishing records check runs, comments, or issues
```

## Scope Boundary

Docs sync should include:

- webhook ingress from GitHub Actions
- source collection from allowlisted docs and API URLs
- artifact and snapshot handling for large inputs
- structured docs audit findings
- CI-readable summary outcome
- optional model-backed review tool
- optional GitHub result publishing
- worker reliability and diagnostics needed for recurring audits

Docs sync should not include by default:

- broad chat ingress
- arbitrary repository crawling
- generalized support triage
- background implementation
- child-session orchestration
- production remediation
- customer-facing messaging policy

## Completion Rule

When a docs sync slice ships, update:

- the slice doc in `slices/`
- this overview if product capability changed
- `../steel-docs-sync-example.md` if the end-to-end flow changed
- core Weave docs if the implementation changed reusable primitives
