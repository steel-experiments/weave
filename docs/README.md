# Agent Mailbox Docs

This directory is the working source of truth for the project direction, architecture, and phased execution plan.

## Start Here

- `overview.md`: project overview, thesis, stretch goal, and guiding principles
- `roadmap.md`: phased research, planning, and development roadmap
- `architecture.md`: system shape, boundaries, and core components
- `mvp.md`: smallest useful end-to-end slice to build first
- `glossary.md`: shared language for future sessions
- `interface.md`: low-level engine and higher-level mailbox interfaces
- `agent-adapters.md`: how OpenCode-style and other agents can adapt to the mailbox model
- `similar-systems.md`: comparison of adjacent systems and how Agent Mailbox differs
- `positioning.md`: product framing for Agent Mailbox as a control plane above engines
- `engines-and-integrations.md`: classification of execution engines, storage engines, companions, and adapters
- `poc-scope.md`: fixed decisions and success criteria for the first proof of concept
- `engine-contracts.md`: typed engine contracts for the first Postgres-backed implementation
- `event-taxonomy.md`: strongly typed PoC event set using Zod-style schemas
- `poc-components-and-flow.md`: detailed component plan and end-to-end demo flow
- `agent-mailbox-research.md`: longer-form technical research and reference notes
- `s2-engine-research.md`: evaluation of S2 and s2-lite as a possible first engine

## Intent

These docs are meant to:

- keep the project grounded across sessions
- separate core ideas from implementation details
- prevent scope drift
- make it easier for future contributors to onboard

## Suggested Reading Order

1. `overview.md`
2. `glossary.md`
3. `architecture.md`
4. `interface.md`
5. `agent-adapters.md`
6. `similar-systems.md`
7. `positioning.md`
8. `engines-and-integrations.md`
9. `poc-scope.md`
10. `engine-contracts.md`
11. `event-taxonomy.md`
12. `poc-components-and-flow.md`
13. `mvp.md`
14. `roadmap.md`
15. `agent-mailbox-research.md`
16. `s2-engine-research.md`
