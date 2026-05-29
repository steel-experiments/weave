# Docs Operating Model

## Purpose

These docs should be a living architecture and work tracker for Weave.

The goal is to make implementation slices small enough to build, review, test, and revise without losing the larger product direction.

## North Star

Blade is the north-star product.

Weave should keep owning the durable control primitives:

- threads
- events
- inboxes
- runners
- workers
- tools
- artifacts
- credentials
- gates
- resumability

Blade should own the production workflows:

- GitHub PR review
- Slack engineering help
- support and Discord triage
- SRE investigation
- background implementation
- child sessions and recurring automations

The Steel docs sync agent is a focused Weave app and a useful recurring automation. It should reuse Weave primitives and later Blade lessons, but it does not need Blade's full product surface, specialist roster, sandbox UX, or broad integration scope.

## Document Layers

### 1. North-Star Product Docs

These describe what the product is trying to become.

Current examples:

- `blade/overview.md`
- future Blade UX, runtime, policy, and domain docs

These should not become task checklists. They should describe durable product direction, accepted vocabulary, and target architecture.

### 2. Slice Docs

Each implementation slice gets one markdown document.

Slice docs are the day-to-day work trackers. They should be specific enough for another agent or engineer to pick up the work without rereading every research note.

Current examples:

- `blade/slices/01-github-pr-review.md`
- `docs-sync/slices/*.md`

### 3. Core Weave Architecture Docs

These describe reusable primitives and contracts that should outlive one product vertical.

Current examples:

- `architecture.md`
- `interface.md`
- `event-taxonomy.md`
- `engine-contracts.md`
- `runnable-inbox.md`
- `declarative-api.md`

When a slice changes a Weave primitive, the matching architecture doc must be updated when the slice completes.

### 4. App And Vertical Docs

These describe a specific app built on Weave.

Current examples:

- `docs-sync/README.md`
- `steel-docs-sync-example.md`
- `north-star-sre-demo.md`

Over time, SRE should likely move under Blade as a product slice input. Docs sync can remain separate because it is a focused audit automation rather than the full Blade operator.

### 5. Research Docs

Research docs inform decisions, but they should not be treated as current plans unless a slice references them.

Current examples:

- `similar-systems.md`
- `dbos-comparison.md`
- `s2-engine-research.md`
- `ecc-analysis.md`
- `ecc-features-for-weave.md`
- `weave-research.md`

Research docs should be moved to a future `docs/research/` directory after active planning docs stop linking to root-level paths directly.

## Slice Lifecycle

Use these statuses consistently:

- `Proposed`: useful idea, not committed for near-term work
- `Planned`: accepted and ordered, but not started
- `In Progress`: active implementation work exists
- `Blocked`: cannot proceed without a decision, dependency, or external input
- `Shipped`: implemented, tested, and documented
- `Superseded`: replaced by another slice or architecture decision

Every slice should include:

- owner vertical
- status
- last updated date
- goal
- non-goals
- user-visible outcome
- architecture impact
- implementation plan
- acceptance criteria
- test plan
- progress checklist
- completion update requirements

Use `slices/template.md` for new slices.

## Completion Rule

A slice is not complete when code merges.

A slice is complete only when all of these are true:

- behavior exists in code
- meaningful tests pass
- the slice document reflects actual behavior, not just intended behavior
- the owning vertical doc reflects the new capability
- changed Weave primitives are reflected in core architecture docs
- new terminology is reflected in `glossary.md` or `blade/domain-model.md`
- any follow-up work is captured as new proposed slices or explicit open questions

## Testing Rule

Slices should describe the tests before or during implementation.

Tests should prove the module or vertical actually works. Avoid tests that only validate a mock of the thing being built.

Preferred test shapes:

- unit tests for pure planners, reducers, validators, and policy decisions
- integration tests that use the real `ThreadService`, engine, runner, worker, and app definitions where practical
- contract tests for typed tool input, output, progress, credential, and artifact behavior
- replay tests that reconstruct behavior from thread events
- idempotency tests for webhook delivery, retries, and external publishing
- failure-path tests for `tool.failed`, dead-letter, timeout, invalid payload, invalid signature, and denied gate cases
- artifact tests that verify hashes, references, byte limits, and no large raw bodies in events

Mocking rules:

- mock external networks, model providers, GitHub, Slack, Sentry, Axiom, and sandbox providers at the boundary
- do not mock the planner, service, engine, projection, worker, or tool module being tested
- prefer fake implementations that preserve the same contract over loose object mocks
- assert durable events and artifacts, not only returned strings
- include at least one test that would fail if the module under implementation was not called

## Vertical Update Rule

When a slice ships, update both levels:

- the slice doc gets a completion note with code paths, tests, behavior, and known gaps
- the vertical overview gets a shorter capability update so readers can understand the current architecture without opening every slice

Example:

- `blade/slices/01-github-pr-review.md` records exact GitHub review behavior, events, gates, and tests
- `blade/overview.md` updates the PR Review section and MVP status once the vertical exists

## Review Cadence

At the end of a meaningful slice or cluster of slices, do an architecture review pass.

The review should ask:

- did the implementation deepen or violate the Weave thread model?
- did product-specific Blade logic leak into Weave core?
- did app-specific docs sync behavior become too generic too early?
- are events still durable facts rather than hidden state transitions?
- are artifacts inspectable enough for humans to trust results?
- do tests prove behavior through the real module boundaries?
- did any new primitive earn a place in core architecture docs?

## Migration Plan

Use this order to restructure without breaking references:

1. Add slice docs beside existing rollups.
2. Point `docs/README.md` at the new docs.
3. Keep old root docs as historical rollups until their content is either migrated or intentionally archived.
4. Move stable core docs into a future `docs/weave/` directory in one dedicated cleanup slice.
5. Move research docs into a future `docs/research/` directory in one dedicated cleanup slice.
6. Delete or archive superseded rollups only after inbound links are updated.
