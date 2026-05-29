# Blade Overview

## Purpose

Blade is Steel's internal AI operator built on top of Weave.

It is inspired by Ramp's Inspect, but the goal is broader than a background coding agent.

Blade should become the durable, auditable AI system that can review PRs, answer engineering help requests, triage support conversations, investigate production issues, spawn specialist agents, and coordinate work across GitHub, Slack, Discord, Linear, observability systems, and Steel-controlled sandboxes.

This document is the first Blade product/spec overview.

It should guide implementation without prematurely locking the runtime, UI, or infrastructure details.

Implementation slices now live in `slices/`. The current first planned slice is `slices/01-github-pr-review.md`.

## Product Claim

An engineering org should be able to delegate routine code review, support triage, SRE investigation, and background implementation work to a persistent AI operator without giving that operator unbounded credentials or relying on ephemeral chat state.

Blade should make that work:

- triggerable from the places engineers already work
- inspectable while it runs
- resumable after workers, browsers, sandboxes, or clients disconnect
- policy-aware around credentials, production systems, and external comments
- artifact-driven enough for humans to review and trust
- extensible through specialist agents and typed tools

## Relationship To Weave

Blade and Weave overlap because they were born from the same need.

The distinction should stay clear:

- Weave is the durable control layer for agents.
- Blade is the flagship product built on Weave.
- Weave owns threads, events, inboxes, tool routing, credentials, gates, and resumability.
- Blade owns product workflows, specialist roles, prompts, integrations, UX, and Steel-specific operating taste.

Blade should prove Weave by exercising it under real organizational workflows.

Blade should not fork Weave's primitives into a separate control plane unless the primitive is product-specific.

## Research Inputs

### Ramp Inspect

Primary source:

- `https://builders.ramp.com/post/why-we-built-our-background-agent`

Related public context:

- `https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal`
- `https://linear.app/customers/ramp`

Useful takeaways:

- Inspect is a background coding agent, not a synchronous chatbot.
- Each session runs in a sandboxed cloud VM with a full development environment.
- The core advantage is closed-loop verification: code, tests, telemetry, previews, screenshots, CI, feature flags, and repo context are available to the agent.
- Sessions can be started or continued from Slack, web, Chrome extension, PR comments, and web VS Code.
- Sessions are multiplayer and persistent across clients.
- Ramp treats merged PRs from agent sessions as a key success metric.
- Ramp emphasizes user-scoped authorship for PRs rather than app-authored changes that weaken review controls.
- Ramp uses per-session state and real-time streaming so a session can keep working without the user's laptop.
- Ramp recommends child sessions for parallel work and cross-repo research.

### Public Open-Inspect Implementation

Source:

- `https://github.com/ColeMurray/background-agents`

The public implementation is a useful imagined shape for Inspect.

Observed architecture:

- Cloudflare Workers and Durable Objects for the control plane.
- One Durable Object SQLite database per session.
- Modal sandboxes as the primary data plane.
- OpenCode inside the sandbox as the coding runtime.
- A sandbox supervisor and bridge that connect back to the control plane.
- Next.js web UI for sessions, artifacts, terminal, code-server, child sessions, and streaming events.
- Slack, GitHub, Linear, webhook, schedule, and Sentry-style automation integrations.
- Shared type contracts across clients, control plane, sandbox runtime, and bots.

Useful product lessons:

- Treat `Session` as the central aggregate.
- Keep clients thin; all clients enqueue prompts and observe the same session state.
- Make artifacts first-class: PRs, screenshots, videos, preview URLs, branches, logs, diffs, and test results.
- Use per-prompt authorship, not just per-session ownership.
- Make sandbox bridge semantics explicit: commands, events, ACK/replay, heartbeat, reconnect, and final status.
- Build warming and restore paths early because startup latency determines adoption.

### Internal `steel-dev/blade`

Source:

- `https://github.com/steel-dev/blade`

This repo is an internal Open-Inspect fork with Steel-specific direction already appearing.

Useful pieces:

- Full Open-Inspect-style product stack with web, Slack, GitHub, Linear, control plane, and sandbox runtime packages.
- GitHub bot support for auto-review, reviewer assignment, issue comments, PR review comments, and mention-triggered work.
- Slack bot support for session creation, thread context, channel context, model preferences, branch preferences, and progress links.
- Automation support for cron, inbound webhooks, and Sentry alerts.
- Sentry webhook verification with per-automation encrypted client secrets.
- Sub-task spawning with child sessions, status checks, cancellation, depth limits, and per-repo guardrails.
- Steel runtime checkpoint work under `packages/steel-infra`, including `blade-entrypoint`, OpenCode, browser tooling, code-server, ttyd, and reusable Steel checkpoints.
- Blade specialist prompts for `blade`, `sre`, `dev`, `code-reviewer`, `support`, `docs-examples`, `adversarial-qa`, `analytics`, and `sales`.
- Visual verification skills around browser automation and screenshot artifacts.

Important caution:

- The inherited Open-Inspect security model is explicitly single-tenant.
- Multi-tenant or customer-facing Blade would require tenant-aware repo access, per-tenant app installs, and stronger data isolation.
- For the first internal Blade, single-tenant may be acceptable if the boundary is documented and enforced by deployment controls.

### Internal `steel-experiments/blade`

Source:

- `https://github.com/steel-experiments/blade`

This repo is a smaller second pass with a cleaner conceptual core.

Useful pieces:

- `WorkItem` represents external demand from manual, GitHub, Slack, Linear, webhook, or schedule sources.
- `Session` groups one or more runs around a work item.
- `Run` represents a role-specific execution such as coordinator, researcher, implementer, reviewer, or tester.
- `Step` captures lifecycle phases such as prepare workspace, read guidance, plan, implement, test, self-review, open pull request, fix CI, and summarize.
- `Artifact` captures logs, command output, patches, PR drafts, test reports, screenshots, recordings, summaries, and snapshots.
- `RuntimeProvider` abstracts local, Docker, and future sandbox runtimes.
- `CredentialGrant` scopes secret injection by role, action, and repository.
- File-backed queue, session store, API, and worker provide a simple low-ceremony prototype path.

This conceptual model maps well onto Weave's thread/event/tool primitives.

## Blade In One Sentence

Blade is a persistent AI engineering operator that turns external work signals into durable Weave threads, routes them through specialist agents and typed tools, and returns reviewable artifacts to humans.

## Target Users

Initial users:

- Steel engineers reviewing PRs
- on-call engineers investigating incidents
- support engineers triaging Slack or Discord reports
- docs and developer-experience maintainers keeping examples current
- engineering managers tracking repeated failures, CI breakage, and review bottlenecks

Later users:

- sales and solutions engineers preparing account-specific follow-up
- product and analytics users asking source-backed usage questions
- external customers if Blade becomes customer-facing

## Primary Entry Points

Blade should be reachable from:

- GitHub PR review request
- GitHub PR comment or review comment containing `@blade`
- GitHub issue label or assignment
- Slack mention or DM
- Discord mention or forum/support thread
- Sentry alert or issue webhook
- Axiom alert or saved query webhook
- Linear issue assignment or comment
- scheduled automation
- web UI session launcher
- future browser extension or Steel console integration

All entry points should normalize into one work intake path.

```txt
external signal
  -> Blade intake adapter
  -> Weave thread created or resumed
  -> Blade coordinator receives normalized prompt and context
  -> typed tools and specialist agents run through Weave
  -> artifacts, findings, gates, and status events accumulate
  -> result is posted back to the originating surface
```

## Core User Stories

### PR Review

As an engineer, I want to request Blade as a reviewer on a PR, so that it can inspect the diff, read relevant context, run targeted checks, and publish concrete findings before a human reviewer spends time on it.

### PR Follow-up

As a PR author, I want to comment `@blade fix this` or `@blade explain this failure`, so that Blade can either patch the branch or respond with evidence-backed analysis.

### Support Triage

As a support engineer, I want to mention Blade in Slack or Discord, so that it can summarize the user problem, connect it to docs, known issues, recent deploys, logs, or tickets, and draft an accurate response or escalation.

### SRE Investigation

As an on-call engineer, I want Blade to trigger an SRE specialist from an alert or incident thread, so that it can gather Axiom, Sentry, Grafana, deploy, and cloud context before recommending mitigation.

### Background Implementation

As an engineer, I want to give Blade an implementation task and disconnect, so that it can work in a sandbox, produce a PR draft, run checks, and notify me when the artifact is ready.

### Parallel Work

As a Blade user, I want Blade to spawn child sessions for independent research, review, or implementation branches, so that large tasks can progress concurrently without losing traceability.

## Non-goals

Blade should not initially become:

- a replacement for Weave primitives
- a general workflow engine unrelated to agent execution
- a fully autonomous production remediator
- a customer-facing multi-tenant SaaS without explicit tenant design
- a generic chatbot that stores important state only in a message transcript
- a system that bypasses human review for risky code, infra, or production actions
- a place where raw credentials are freely available to model prompts or shell history

## Product Principles

- durable before clever
- artifact-driven over vibes-driven
- one session visible from every client
- user-scoped authorship where possible
- typed tools over ad hoc shell side effects
- explicit gates for risky actions
- specialist agents are useful, but Blade owns final synthesis
- humans should be able to audit why Blade acted
- production write access starts denied
- startup latency is a product feature, not an implementation detail

## Desired End-to-end Flows

### GitHub PR Review Flow

```txt
PR opened or Blade requested as reviewer
  -> GitHub adapter verifies repo and caller policy
  -> Blade review thread is created
  -> prompt includes PR title/body/diff metadata as untrusted context
  -> sandbox checks out PR head
  -> code-reviewer agent inspects diff and relevant call sites
  -> repo and test tools run targeted verification
  -> findings are emitted as structured artifacts
  -> Blade posts review summary or inline comments to GitHub
  -> thread remains available for follow-up prompts
```

Safety notes:

- PR title, body, and comments are untrusted input.
- Public repo comments must not leak internal URLs, secrets, sandbox IDs, or raw logs.
- Blade should never approve its own app-authored change without a human gate.

### Slack Or Discord Help Flow

```txt
user mentions Blade in a channel or thread
  -> messaging adapter captures channel, thread, user, and allowed context
  -> Blade selects repository, product surface, or support domain
  -> support agent triages facts, assumptions, and missing info
  -> Blade may call docs, GitHub, Linear, Sentry, Axiom, or deploy tools
  -> Blade drafts response or escalation
  -> Blade posts concise answer with links to artifacts or asks one blocker question
```

Safety notes:

- Customer-facing text must avoid unconfirmed root cause and private data.
- Blade should mark speculation as speculation.
- Production-impacting symptoms should escalate into an SRE investigation thread.

### SRE Alert Flow

```txt
Sentry, Axiom, Grafana, or webhook alert arrives
  -> alert adapter verifies signature and idempotency
  -> Blade incident triage thread is created
  -> SRE specialist fixes environment, time window, impact, and blast radius
  -> observability tools collect logs, metrics, traces, deploys, issues, and recent changes
  -> Blade classifies customer-facing failures versus noise
  -> Blade produces incident report and proposed mitigations
  -> risky remediation creates a Weave gate
  -> human approves, denies, or asks for more evidence
```

Safety notes:

- Default SRE mode is read-only.
- Every production write action needs an explicit gate.
- Incident reports should include time window, evidence, rejected noise, confidence, mitigation, and follow-up.

### Background Implementation Flow

```txt
user starts Blade task from web, Slack, GitHub, Linear, or API
  -> work item is normalized
  -> session and sandbox are prepared
  -> Blade reads repo guidance and current state
  -> dev agent plans smallest safe implementation
  -> code changes run inside sandbox
  -> tests, lint, typecheck, preview, or browser checks run as tools
  -> diff, test results, screenshots, and summary become artifacts
  -> Blade opens or drafts a PR using user-scoped identity where possible
  -> humans review and merge
```

Safety notes:

- Code generation is not enough; verification artifacts are part of the deliverable.
- Branches and commits should preserve prompt authorship.
- Blade should preserve unrelated user changes in existing branches.

## Weave App Shape

Blade should be implemented as a Weave app, not as an alternate runtime.

Expected authoring shape:

- `defineWeaveApp` composes Blade agents, tools, ingress adapters, egress adapters, and policy defaults.
- `defineAgent` declares the Blade coordinator and specialist agents.
- `defineTool` declares typed side-effect contracts for GitHub, Slack, Discord, Sentry, Axiom, sandbox execution, browser verification, and child sessions.
- Weave threads own durable execution, inbox wakeups, event history, gates, credentials, and resumability.
- Blade tools emit progress and artifacts through thread events.

Initial app modules could be:

- `blade.intake`: normalizes GitHub, Slack, Discord, Linear, webhook, and schedule signals.
- `blade.coordinator`: routes work to specialists and synthesizes final output.
- `blade.review`: PR review workflow and finding model.
- `blade.support`: support and community triage workflow.
- `blade.sre`: production investigation workflow, likely sharing the SRE agent harness.
- `blade.runtime`: sandbox, workspace, branch, preview, and artifact management.
- `blade.egress`: posts back to GitHub, Slack, Discord, Linear, or web callbacks.

## Core Domain Model

Blade can start with these product-level concepts while mapping storage to Weave threads and events.

### Work Item

A normalized request for Blade to do something.

Fields:

- source: `manual`, `github`, `slack`, `discord`, `linear`, `webhook`, or `schedule`
- source reference: URL, event id, alert id, message id, or issue id
- repository or product surface
- prompt or instructions
- mode: `plan`, `implement`, `review`, `triage`, `fix-ci`, or `investigate`
- created by actor
- idempotency key when event-driven

### Session

The durable Blade conversation and execution boundary.

Maps naturally to one Weave thread.

Contains:

- work item
- participants
- prompts
- status
- model and reasoning preferences
- sandbox state
- child sessions
- artifacts
- callback context

### Run

A bounded execution attempt inside a session.

Examples:

- coordinator run
- code-reviewer run
- dev implementation run
- SRE investigation run
- support triage run
- QA validation run

Runs can be parented when a coordinator spawns a specialist or child session.

### Step

A named part of a run lifecycle.

Initial step kinds:

- prepare workspace
- read guidance
- collect context
- plan
- await approval
- implement
- test
- self-review
- open pull request
- post external response
- summarize

### Artifact

A durable thing a human can inspect.

Initial artifact kinds:

- PR review
- inline finding
- patch
- branch
- PR draft
- test report
- command output
- screenshot
- browser recording
- preview URL
- incident report
- support response draft
- Linear issue draft
- session snapshot

### Finding

A structured review, support, docs, or SRE observation.

Suggested fields:

- id
- severity: `info`, `warning`, `critical`, or `blocking`
- category
- summary
- affected file, URL, PR line, service, endpoint, customer, or environment
- evidence
- confidence
- suggested fix
- whether human action is required

### Gate

A human decision required before Blade continues.

Initial gate types:

- publish GitHub review
- push branch
- create PR
- post customer-facing response
- run expensive test suite
- access sensitive logs
- perform production write
- trigger rollback or remediation

## Agent Roles

### Blade Coordinator

The primary agent for a session.

Responsibilities:

- understand the work item
- inspect available context
- select the right specialist or tool
- spawn child sessions when useful
- keep the user-facing narrative coherent
- synthesize final output from multiple specialists
- decide when a gate is required

The coordinator should not force every task through a specialist.

Short, local, single-threaded work can stay in the main Blade thread.

### Code Reviewer

Reviews diffs and PRs for correctness, regressions, security, missing tests, contract breaks, migration risks, observability gaps, and rollout hazards.

### Dev Agent

Implements focused code, docs, or infra changes with repo-aware discipline, tests, and PR hygiene.

### SRE Agent

Investigates incidents and production questions using logs, metrics, traces, Sentry, deploy history, cloud CLIs, and runbooks.

Default mode is skeptical and read-only.

### Support Agent

Turns Slack, Discord, support threads, GitHub issues, Linear tickets, logs, and docs into accurate summaries, responses, or escalations.

### Docs And Examples Agent

Audits docs, examples, API references, SDK snippets, and developer-facing instructions.

This should reuse lessons from the Steel docs sync example.

### Adversarial QA Agent

Tests previews, staging apps, APIs, and browser flows to find reproducible issues before humans or customers do.

### Analytics Agent

Answers source-backed product and operational analytics questions.

This should start as read-only and require careful data access policies.

### Sales Agent

Later specialist for account research, call-note synthesis, CRM updates, and customer follow-up drafts.

This should not be in the first engineering MVP unless sales workflows become a near-term priority.

## Initial Tool Contracts

### `github.inspectPullRequest`

Purpose:

- fetch PR metadata, diff, comments, review threads, checks, and related commits

Inputs:

- owner
- repository
- PR number
- optional paths or commit range

Outputs:

- PR summary
- changed files
- check statuses
- comment context
- links to raw GitHub resources

Credential needs:

- GitHub token scoped to repo read access

### `github.publishReview`

Purpose:

- publish Blade's PR review result to GitHub

Inputs:

- owner
- repository
- PR number
- review body
- event: `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`
- optional inline comments

Outputs:

- review URL
- published comment ids

Credential needs:

- user-scoped or app-scoped GitHub token with review permissions

Gate policy:

- require gate for `APPROVE` and `REQUEST_CHANGES` until review quality is trusted
- require gate for public repositories unless explicitly allowlisted

### `github.createOrUpdatePullRequest`

Purpose:

- turn a verified implementation artifact into a PR

Inputs:

- branch name
- base branch
- title
- body
- commit summary
- artifact references

Outputs:

- PR URL
- PR number
- branch name

Credential needs:

- user-scoped GitHub identity where possible

Gate policy:

- require gate before creating PRs from non-user-initiated automations

### `runtime.prepareWorkspace`

Purpose:

- prepare a sandbox or Steel computer for a Blade run

Inputs:

- repository
- base ref
- head ref
- setup mode
- runtime provider
- requested secrets

Outputs:

- workspace id
- root path
- branch state
- setup logs artifact reference
- available preview and terminal endpoints

Credential needs:

- repo clone credential
- scoped environment secrets

### `runtime.runCommand`

Purpose:

- run typed shell commands in the workspace with timeout, output capture, and redaction

Inputs:

- command
- args
- working directory
- timeout
- redaction policy

Outputs:

- exit code
- stdout and stderr artifact references
- duration
- timeout flag

Gate policy:

- require gate for dangerous command classes until policy is mature

### `runtime.captureDiff`

Purpose:

- capture tracked and untracked workspace changes as a patch artifact

Inputs:

- workspace id
- path filters

Outputs:

- patch artifact
- changed files
- diff summary

### `browser.verifyPreview`

Purpose:

- open a preview URL, exercise a small flow, and capture screenshot or video evidence

Inputs:

- URL
- viewport
- steps or natural-language verification instruction
- screenshot mode

Outputs:

- screenshot artifact
- video artifact if requested
- verification summary

### `sentry.findIssues`

Purpose:

- inspect recent errors and issue context for a service, release, environment, or alert

Inputs:

- organization
- project
- query
- environment
- release
- time range

Outputs:

- issue summaries
- stack trace highlights
- affected release or commit
- links to Sentry events

### `axiom.searchLogs`

Purpose:

- search logs for incident investigation or support triage

Inputs:

- dataset
- query
- environment
- time range
- limit

Outputs:

- matching log summaries
- counts by class
- representative examples
- raw log links or artifact references

### `slack.postUpdate`

Purpose:

- post progress, blocker questions, final summaries, or response drafts back to Slack

Inputs:

- channel
- thread timestamp
- message body
- blocks
- visibility mode

Outputs:

- Slack message id

Gate policy:

- require gate for customer-facing channels until safe response policy is established

### `discord.postUpdate`

Purpose:

- post progress, blocker questions, final summaries, or response drafts back to Discord

Inputs:

- guild
- channel
- thread
- message body
- visibility mode

Outputs:

- Discord message id

Gate policy:

- require gate for public customer-facing channels until safe response policy is established

### `blade.spawnChildSession`

Purpose:

- start an independent Blade session for parallel research, implementation, review, QA, docs, or SRE work

Inputs:

- parent session id
- role
- prompt
- repository
- branch or base ref
- allowed tools
- edit permission
- expected artifact

Outputs:

- child session id
- status URL

Policy:

- enforce depth limits
- enforce per-repo concurrency limits
- require explicit prompt context because child sessions do not inherit full parent context

## Event Model

Blade should reuse the existing Weave event taxonomy where possible.

Useful existing events:

- `session.started`
- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `runner.resumed`
- `agent.response.produced`

Blade may need product-specific events once the first implementation proves the shape.

Candidate events:

- `blade.work_item.created`
- `blade.run.started`
- `blade.run.completed`
- `blade.artifact.created`
- `blade.finding.produced`
- `blade.child_session.spawned`
- `blade.notification.posted`
- `blade.external_callback.failed`

Do not add all of these up front.

The first implementation should encode Blade-specific data inside existing events and artifact payloads until repeated query needs justify new event types.

## Security And Policy

Blade's safety model should be stricter than a normal coding agent because it touches production systems and external communication channels.

Initial requirements:

- Treat GitHub, Slack, Discord, Linear, and webhook payloads as untrusted input.
- Keep raw secret values out of thread events, model prompts, logs, and artifacts.
- Resolve credentials through Weave capabilities or a credential provider.
- Scope credentials by repo, environment, role, and action.
- Default production actions to read-only.
- Require gates for production writes, public/customer-facing responses, broad log access, branch pushes, PR creation from automation, and approvals.
- Use user-scoped identity for PRs and comments where feasible.
- Preserve prompt author identity for commits and audit history.
- Keep every external callback linked to the session, event, actor, and correlation id.
- Redact command output and logs before publishing outside the thread.

Single-tenant internal deployment can be an MVP constraint.

If Blade becomes multi-tenant or customer-facing, the product must add:

- tenant-aware data model
- per-tenant GitHub and Slack app installs
- per-user repository access validation at session creation
- tenant-isolated sandboxes and artifact storage
- stricter cross-tenant event and search boundaries

## UX Requirements

### Session UI

The web UI should show:

- current status
- prompt queue
- participants
- model and reasoning settings
- event timeline
- tool progress
- artifacts
- linked PRs, issues, alerts, and messages
- child sessions
- gates waiting for approval
- sandbox endpoints such as terminal, preview, browser, or code-server when enabled

### GitHub UX

Blade should support:

- reviewer assignment
- auto-review on open for configured repos
- `@blade` issue comments
- `@blade` PR review comments
- CI failure triage
- publishing summary comments and inline findings
- pushing fixes to the PR branch when explicitly asked and permitted

### Slack UX

Blade should support:

- mention in channel
- direct message
- thread continuation
- channel and thread context capture
- repository selection when ambiguous
- model and branch preferences
- progress link to the session UI
- final answer posted back to the originating thread

### Discord UX

Discord should mirror Slack concepts where practical:

- mention in channel or thread
- forum/support thread capture
- repo or product surface selection
- safe draft response or public reply
- escalation to SRE, dev, docs, or Linear

## Runtime Strategy

Blade needs a full execution body, not just model calls.

Near-term runtime options:

- local runtime for development and tests
- Docker runtime for isolated smoke tests
- Steel computer runtime for internal product alignment
- Modal or similar cloud sandbox only if it remains useful after Steel runtime evaluation

Runtime requirements:

- clone or mount repo safely
- install dependencies through setup hooks or prebuilt checkpoints
- run repo-defined start hooks
- run OpenCode or another coding runtime
- expose command execution through typed tools
- provide browser automation and screenshot capture
- snapshot or checkpoint state after useful milestones
- support cancellation and timeout
- stream lifecycle events back to Weave
- redact secrets from logs and artifacts

Steel runtime checkpoint requirements:

- base checkpoint with OpenCode, browser tooling, code-server, ttyd, and Blade entrypoint
- per-session injection of tokens and repo secrets
- no secrets baked into checkpoints
- enough metadata to correlate sandbox, workspace, session, and thread ids

## Metrics

Blade should measure product value and operational quality.

North-star candidates:

- Blade sessions resulting in merged PRs
- PR review findings accepted by humans
- support threads resolved without engineering escalation
- incident investigations that produce useful evidence before a human starts manual triage

Operational metrics:

- session startup latency
- time to first useful event
- prompt queue latency
- sandbox failure rate
- tool failure rate by integration
- gate wait time
- review publish success rate
- external callback failure rate
- cost per completed session
- child session fanout and success rate

Quality metrics:

- false positive review comments
- missed critical review findings
- tests run per implementation PR
- rollback or revert rate for Blade-authored PRs
- human edit distance between Blade draft and final merged PR
- support response correction rate

## MVP Recommendation

The first Blade slice should be GitHub PR review on top of Weave.

Why:

- clear user value
- bounded input and output
- easy human review loop
- existing internal fork has useful GitHub bot behavior
- fits Weave thread, tools, artifacts, and gates naturally
- can reuse code-reviewer specialist prompt from `steel-dev/blade`
- produces measurable outcomes quickly

MVP flow:

```txt
GitHub PR event or `@blade review`
  -> create Weave thread
  -> prepare read-only sandbox or repo checkout
  -> inspect diff and relevant files
  -> run focused checks when cheap and relevant
  -> emit structured findings as artifacts
  -> require gate before publishing review
  -> post review summary to GitHub
```

MVP tools:

- `github.inspectPullRequest`
- `runtime.prepareWorkspace`
- `runtime.runCommand`
- `runtime.captureDiff`
- `github.publishReview`

MVP artifacts:

- review summary
- structured findings
- command output summaries
- test report when checks run

MVP success criteria:

- a PR review request creates exactly one durable thread
- every external GitHub action is visible in the thread
- a human can inspect evidence before publishing
- retries do not duplicate comments
- public repo untrusted input is contained
- no raw secrets appear in thread events, logs, or review comments

## Follow-on Slices

Track slice progress in `slices/README.md`. Each meaningful slice should have its own markdown document before implementation starts.

### Slice 2: Slack Engineering Help

Build Slack mention and thread continuation around the same session model.

Primary outcome:

- Blade can answer internal engineering questions with links to code, docs, PRs, and artifacts.

### Slice 3: Support And Discord Triage

Add Discord and support triage behavior.

Primary outcome:

- Blade can draft safe support responses and create clean engineering escalations.

### Slice 4: SRE Investigation

Integrate the SRE north-star demo into Blade as a specialist workflow.

Primary outcome:

- alerts and incident prompts create read-only investigation threads with Axiom, Sentry, Grafana, and deploy evidence.

### Slice 5: Background Implementation

Allow Blade to make changes, run checks, capture artifacts, and draft PRs.

Primary outcome:

- Blade can complete small implementation tasks without constant human presence.

### Slice 6: Child Sessions And Automations

Add scheduled and event-triggered Blade work with bounded child session fanout.

Primary outcome:

- Blade can run recurring audits, CI triage, Sentry triage, docs drift checks, and parallel investigation tasks.

## Open Questions

- Should Blade's first runtime be Steel computers, Docker, Modal, or a pluggable abstraction with local/Docker first?
- Should GitHub review publishing be gated in the MVP, or can internal allowlisted repos publish automatically?
- Should Blade use OpenCode as the first coding runtime, or should Weave support multiple adapters from the start?
- How much of `steel-dev/blade` should be ported versus treated as a reference implementation?
- Should the `steel-experiments/blade` domain model become the Blade product vocabulary inside Weave docs?
- What is the first source of truth for repo-specific Blade guidance: `AGENTS.md`, `.blade/`, `.openinspect/`, Weave app config, or all of these with precedence?
- How should Slack and Discord identity map to GitHub identity for authorship and permissions?
- What is the minimum safe policy for reading production logs from Slack or Discord requests?
- Which actions require gates in internal-only deployment?
- What should Blade call a user-visible unit of work: work item, task, session, thread, run, or job?

## Immediate Next Steps

- Use PR review as the first implementation slice unless a stronger near-term Steel workflow replaces it.
- Keep `docs/blade/slices/01-github-pr-review.md` updated with concrete GitHub event handling, tools, events, gates, tests, and completion notes.
- Keep `docs/blade/domain-model.md` updated as Work Item, Session, Run, Step, Artifact, Finding, and Weave Thread terminology changes.
- Draft `docs/blade/runtime.md` to compare Steel computer, Docker, Modal, and local runtime providers.
- Identify the smallest reusable code or prompts to lift from `steel-dev/blade` and `steel-experiments/blade`.
