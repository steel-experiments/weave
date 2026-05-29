# Weave Docs

This directory is the working source of truth for Weave, Blade, and the example apps that prove the architecture.

## Current North Star

Blade is the product north star.

Weave is the durable control layer. Blade is the production operator we expect to run on top of it. The Steel docs sync agent is still important, but it should stay a focused Weave app and recurring audit workflow rather than inheriting every Blade feature.

## Start Here

- `what-is-weave.md`: one-page product narrative for Weave
- `overview.md`: Weave thesis, goals, and principles
- `blade/overview.md`: Blade product overview and north-star spec
- `docs-operating-model.md`: how docs, slice plans, tests, and architecture updates should stay in sync
- `blade/domain-model.md`: Blade vocabulary mapped to Weave primitives
- `blade/slices/README.md`: Blade slice index and current implementation order
- `docs-sync/README.md`: focused docs sync app area, with links back to the existing Steel docs sync plans
- `docs-sync/slices/README.md`: Steel docs sync slice index and progress tracker

## Proposed Layout

The docs are moving toward this information architecture:

- `docs/`: root index, operating model, and currently un-migrated legacy docs
- `docs/blade/`: Blade product direction, domain model, runtime strategy, and production slices
- `docs/blade/slices/`: one progress-tracked markdown document per Blade slice
- `docs/docs-sync/`: Steel docs sync app plan and scope
- `docs/docs-sync/slices/`: one progress-tracked markdown document per docs sync slice
- `docs/slices/`: shared slice template and rules used by all verticals
- future `docs/weave/`: stable Weave core architecture, contracts, event model, and implementation notes
- future `docs/research/`: comparisons and research notes that inform but do not directly drive current implementation

This structure is intentionally incremental. Existing root-level docs are not moved yet so references remain stable while the new working model is adopted.

## Canonical Planning Docs

- Product north star: `blade/overview.md`
- Blade domain vocabulary: `blade/domain-model.md`
- Current Blade slices: `blade/slices/README.md`
- Current first Blade implementation slice: `blade/slices/01-github-pr-review.md`
- Docs sync focused app: `docs-sync/README.md`
- Docs sync slice progress: `docs-sync/slices/README.md`
- Shared slice template: `slices/template.md`

## Existing Core Docs

- `architecture.md`: system shape, boundaries, and core components
- `glossary.md`: shared Weave vocabulary
- `interface.md`: low-level engine and higher-level thread interfaces
- `agent-adapters.md`: how OpenCode-style and other agents can adapt to the thread model
- `declarative-api.md`: current `defineTool`, `defineAgent`, and `defineWeaveApp` authoring API
- `engine-contracts.md`: typed engine contracts for the first Postgres-backed implementation
- `event-taxonomy.md`: strongly typed PoC event set using Zod-style schemas
- `runnable-inbox.md`: explicit inbox routing and claim model for daemon work

## Existing Vertical And Demo Docs

- `north-star-sre-demo.md`: original SRE agent harness north-star demo, now best understood as a Blade SRE slice input
- `steel-docs-sync-example.md`: product-shaped docs sync example
- `steel-docs-sync-missing-work.md`: original docs sync missing-work rollup, now split into `docs-sync/slices/`
- `mvp.md`: smallest useful end-to-end Weave primitive definition
- `poc-scope.md`: fixed decisions and success criteria for the first proof of concept
- `poc-components-and-flow.md`: detailed component plan and end-to-end demo flow
- `roadmap.md`: original phase roadmap; should be reconciled with the slice model over time

## Existing Research And Positioning Docs

- `positioning.md`: product framing for Weave as a control plane above engines
- `engines-and-integrations.md`: classification of execution engines, storage engines, companions, and adapters
- `similar-systems.md`: comparison of adjacent systems and how Weave differs
- `dbos-comparison.md`: focused DBOS comparison and integration strategy
- `weave-research.md`: longer-form technical research and reference notes
- `ecc-analysis.md`: analysis of ECC as an adjacent runtime/operator system
- `ecc-features-for-weave.md`: focused ECC feature analysis for security, skills, instincts, and memory
- `s2-engine-research.md`: evaluation of S2 and s2-lite as a possible event stream engine

## Working Rule

Every meaningful feature should have a slice document before implementation begins.

When a slice ships, update:

- the slice document with actual behavior, test evidence, and remaining follow-up
- the owning vertical overview, such as `blade/overview.md` or `docs-sync/README.md`
- core architecture docs if a Weave primitive changed
- glossary or domain-model docs if vocabulary changed
