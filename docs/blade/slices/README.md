# Blade Slices

Blade is the north-star product built on Weave.

Each slice should prove one useful product capability while strengthening, not bypassing, Weave's durable thread model.

## Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. GitHub PR Review | Shipped | `01-github-pr-review.md` | Blade can review a PR through a durable Weave thread and publish only through a gated path. |
| 2. Slack Engineering Help | Proposed | _to create_ | Blade can answer internal engineering questions from Slack with source-backed artifacts. |
| 3. Support And Discord Triage | Proposed | _to create_ | Blade can draft safe support responses and clean escalations. |
| 4. SRE Investigation | Proposed | _to create_ | Blade can investigate alerts in read-only mode with observability evidence and gates for risky actions. |
| 5. Background Implementation | Proposed | _to create_ | Blade can make focused code changes, run checks, and draft PRs. |
| 6. Child Sessions And Automations | Proposed | _to create_ | Blade can spawn bounded child sessions and run recurring automations. |

## Current Recommendation

GitHub PR Review is the first shipped Blade slice.

Why:

- bounded input and output
- obvious value to Steel engineers
- easy human review loop
- strong fit for threads, tools, artifacts, gates, and idempotency
- validates whether Blade product workflows can run on Weave without forking the primitives
- ships as `examples/blade` with fake GitHub boundaries and root verification wiring

## Slice Creation Rule

Before starting a new Blade capability, create a slice document from `../../slices/template.md`.

The slice should define:

- user-visible outcome
- tool contracts
- event and artifact shape
- gate and credential policy
- tests that prove the actual vertical works
- docs to update when shipped
