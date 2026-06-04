# Local Workflow Dashboard

## Status

- Vertical: `development-orchestrator`
- Status: `Planned`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Add a minimal local operator dashboard for Weave development workflows so a maintainer can see active initiatives, slice threads, pending gates, and live execution progress without manually stitching together CLI commands or raw event queries.

## Non-goals

- Do not build a full hosted SaaS UI.
- Do not expose the dashboard beyond localhost in this slice.
- Do not add authentication, user management, teams, or multi-tenant authorization yet.
- Do not replace the CLI operator flow; the dashboard should complement it.
- Do not let the dashboard bypass durable gates, policy checks, or orchestrator state transitions.
- Do not introduce custom dashboard-only state that can drift from thread events and checkpoints.

## User Outcome

As a maintainer, I can open a local Weave dashboard and immediately understand which initiative is running, which slice is active, whether a gate needs my approval, what tools are currently progressing, and what happened most recently.

## Design Direction

The dashboard must use `DESIGN.md` as its visual and interaction source of truth.

Required interpretation of `DESIGN.md`:

- Use the `Sleek Developer Core` dark developer-console aesthetic.
- Treat the dashboard as a mission-control surface for durable agentic workflows.
- Use deep slate surfaces, tonal layering, compact spacing, and high information density.
- Use Geist for UI text and JetBrains Mono for logs, identifiers, metadata, commands, and status labels.
- Use primary indigo for durable thread structure and active selections.
- Use cyan for active execution, live progress, and running tool indicators.
- Use semantic colors for status: success, warning, error, blocked, and pending approval.
- Use panel/card layouts with subtle borders rather than heavy shadows.
- Represent workflow steps as execution nodes or structured rows with status accents.
- On mobile, stack panels vertically and degrade execution graphs into readable lists.

The first dashboard should feel like an operational tool, not a generic admin template.

The dashboard should mirror the shipped operator CLI vocabulary from slice 14: gate list/show/approve/reject and initiative list/status. UI labels should make it obvious which dashboard action corresponds to `npm run gates:list`, `npm run gates:show`, `npm run gates:approve`, `npm run gates:reject`, `npm run initiatives:list`, and `npm run initiative:status`.

## Architecture Impact

- Adds a local dashboard route or server entrypoint over existing Weave HTTP/runtime surfaces.
- Reads initiative, thread, child-thread, gate, checkpoint, and tool-progress state from durable storage.
- Adds a small operator action surface for gate approval/rejection only.
- Preserves the event log and checkpoints as source of truth.
- May add read-only aggregation helpers if the existing API cannot efficiently provide dashboard state.
- Does not change orchestrator execution semantics.
- Does not add auth yet because this slice is localhost-only.

## Required Views

### Initiative List

- Shows recent and active initiatives.
- Shows status, branch/workspace if available, current slice, pending gate count, and last activity time.
- Supports selecting an initiative.

### Initiative Detail

- Shows the root initiative thread and ordered slice plan.
- Shows each slice status: proposed, approved, running, repairing, blocked, failed, completed.
- Shows child threads for implementer, verifier, reviewer, repair, and PR handoff.
- Shows final PR handoff state when available, including the `pr-handoff` / `pr-remote-handoff` artifact fields for validation commands, reviewer results, changed files, known gaps, suggested PR title/body, and remote PR state.

### Gate Panel

- Shows pending gates across the selected initiative.
- Shows gate reason, payload summary, requested action, and source thread.
- Allows approve/reject with an optional short note.
- Requires confirmation before sending an approval/rejection mutation.

### Live Progress Panel

- Shows currently running tools and recent `tool.progress`, `tool.completed`, and `tool.failed` events.
- Shows command names, elapsed time when available, status, and latest progress message.
- Uses JetBrains Mono for commands and event identifiers.

### Event/Log Panel

- Shows recent important events in reverse chronological order.
- Supports filtering by errors, gates, tool events, child-thread lifecycle, and orchestrator lifecycle.
- Keeps raw event payloads inspectable without making them the primary UI.

## Implementation Plan

1. Define the minimal dashboard state query shape for initiatives, slices, gates, children, progress, and recent events.
2. Add read-side aggregation helpers if existing APIs cannot provide the state without duplicating dashboard logic.
3. Add a local dashboard server route or entrypoint bound to localhost by default.
4. Build the initiative list and initiative detail panels using `DESIGN.md` tokens and layout principles.
5. Build the gate panel with approve/reject actions wired to existing durable gate resolution APIs.
6. Build the live progress and event panels from durable thread events/checkpoints.
7. Add empty, loading, failed, and blocked states for all panels.
8. Add documentation for running the local dashboard and its localhost-only security posture.

## Test Plan

- Unit test dashboard state aggregation from representative thread/event fixtures.
- Unit test pending-gate projection and approve/reject request construction.
- Integration test the local dashboard state endpoint against an in-memory or test runtime where practical.
- Integration test gate approval/rejection through the same server boundary the UI uses.
- Snapshot or DOM-level test for the main dashboard shell if a frontend test harness exists.
- Manual responsive check for desktop and mobile widths.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] A local dashboard can be launched from a documented command.
- [ ] The dashboard reads active initiatives and child slice threads from durable Weave state.
- [ ] The dashboard shows pending gates and supports approve/reject through existing gate APIs.
- [ ] The dashboard shows current and recent tool progress.
- [ ] The dashboard shows recent important events with raw payload inspection available.
- [ ] The visual design explicitly follows `DESIGN.md`.
- [ ] The dashboard binds to localhost by default and documents that auth is intentionally deferred.
- [ ] No dashboard-only source of truth is introduced.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Define dashboard read model.
- [ ] Add local dashboard server/route.
- [ ] Build initiative list/detail UI.
- [ ] Build gate approval panel.
- [ ] Build live progress panel.
- [ ] Build event/log panel.
- [ ] Add tests.
- [ ] Add runbook docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `README.md`
- [ ] `../README.md`
- [ ] local development setup docs
- [ ] auth slices if dashboard exposure changes auth priorities
