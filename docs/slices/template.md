# Slice Template

## Status

- Vertical: `<host | docs-sync | weave-core | other>`
- Status: `<Proposed | Planned | In Progress | Blocked | Shipped | Superseded>`
- Last updated: `YYYY-MM-DD`
- Owner: `<person or agent role>`

## Goal

Describe the smallest user-visible outcome this slice should deliver.

## Non-goals

List nearby work that this slice intentionally does not include.

## User Outcome

Write the capability from the user's point of view.

Example:

As an engineer, I can request a review on a GitHub PR and inspect a durable review thread before a review is published.

## Architecture Impact

List the expected changes to:

- Weave primitives
- host product concepts
- app-specific code
- event taxonomy
- tool contracts
- artifacts
- gates and policy
- credentials
- external integrations

If no core primitive changes, say so explicitly.

## Implementation Plan

Break the work into concrete implementation steps.

Prefer vertical steps that produce observable behavior over horizontal infrastructure-only phases.

## Test Plan

Describe the tests that will prove the slice works.

Required considerations:

- unit tests for pure logic
- integration tests through real service, runner, worker, and tool boundaries where practical
- contract tests for tool schemas and event payloads
- replay or resumability tests when thread behavior changes
- idempotency tests for retries, webhooks, and external publishing
- failure-path tests for invalid input, denied gates, timeouts, and worker failures

Mock only external boundaries. Do not mock the module this slice exists to build.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Progress

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Completion Notes

Fill this in when the slice ships.

Include:

- shipped behavior
- changed files or modules
- tests added
- commands run
- known gaps
- follow-up slices created

## Docs To Update On Completion

- [ ] this slice document
- [ ] owning vertical overview
- [ ] relevant Weave architecture docs
- [ ] glossary or domain model if vocabulary changed
- [ ] README or slice index if status changed
