# Blade Domain Model

## Purpose

This document defines Blade product vocabulary and maps it to Weave primitives.

The goal is to keep Blade product language clear without forking Weave's control-plane model.

## Naming Rule

Blade should use product terms for user-facing workflows and Weave terms for durable execution primitives.

Recommended split:

- Blade users see work items, sessions, runs, artifacts, findings, and gates.
- Weave core stores threads, events, inbox rows, artifacts, credentials, leases, and gates.

## Core Mapping

| Blade term | Weave mapping | Notes |
| --- | --- | --- |
| Work Item | metadata captured during thread creation | Normalized external demand from GitHub, Slack, Discord, Linear, webhook, schedule, or manual launch. |
| Session | one Weave thread | User-visible durable conversation and execution boundary. |
| Prompt | `prompt.received` or future user-message event | Per-author instruction that may arrive after the session starts. |
| Run | events for one bounded coordinator or specialist execution attempt | May later deserve first-class Blade events if query needs become clear. |
| Step | `agent.step.*`, `tool.*`, gate, or artifact events | Should stay event-backed rather than becoming hidden state. |
| Artifact | `thread_artifact` plus artifact-created event data | Durable inspectable output such as review, patch, log, screenshot, report, or PR. |
| Finding | structured event or artifact payload | Review, support, docs, or SRE observation with severity and evidence. |
| Gate | Weave gate | Human decision required before continuing. |
| Child Session | linked Weave thread | Spawned for parallel work or specialist delegation. |

## Work Item

A work item is normalized external demand for Blade to do something.

Fields:

- source: `manual`, `github`, `slack`, `discord`, `linear`, `webhook`, or `schedule`
- source reference: URL, event id, alert id, message id, issue id, or run id
- repository, service, product surface, or customer context
- prompt or instructions
- mode: `plan`, `implement`, `review`, `triage`, `fix-ci`, or `investigate`
- actor who created the work
- idempotency key when event-driven

For the shipped GitHub PR review slice, the work item is durable in `session.started.payload.metadata`. The metadata deliberately uses a stable PR/reviewer idempotency key instead of a per-delivery webhook id so redeliveries can reuse the same thread.

## Session

A session is the main user-visible unit of Blade work.

One Blade session should map to one Weave thread unless a future slice proves a stronger reason not to.

A session contains:

- work item
- participants
- prompts
- current status
- model and reasoning preferences
- runtime or sandbox state
- runs and steps
- child sessions
- artifacts
- callback context

Use `session` in Blade UX. Use `thread` in Weave core APIs and implementation notes.

## Run

A run is a bounded execution attempt inside a session.

Examples:

- coordinator run
- code-reviewer run
- dev implementation run
- SRE investigation run
- support triage run
- QA validation run

Runs should first be represented through existing events and artifact metadata. Add `blade.run.started` or `blade.run.completed` only when query, UI, or replay needs justify dedicated events.

## Step

A step is a named lifecycle phase in a run.

Initial step kinds:

- prepare workspace
- read guidance
- collect context
- plan
- await approval
- inspect diff
- run checks
- implement
- test
- self-review
- open pull request
- post external response
- summarize

Steps should be visible through events. Avoid storing step state only in process memory or external provider state.

## Artifact

An artifact is a durable thing a human can inspect.

Initial artifact kinds:

- PR review
- PR metadata snapshot
- raw PR diff
- PR diff summary
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

Artifacts should store references, hashes, media type, byte length, and source context. Large raw bodies should stay outside thread events.

## Finding

A finding is an evidence-backed observation.

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

Findings currently start as structured PR review artifacts plus compact generic `agent.finding.produced` events. Add Blade-specific finding events only after repeated query and UI needs are clear.

## Gate

A gate is a human decision required before Blade continues.

Initial gate types:

- publish GitHub review
- push branch
- create PR
- post customer-facing response
- run expensive test suite
- access sensitive logs
- perform production write
- trigger rollback or remediation

Blade policy defaults risky external writes to gates. The shipped GitHub PR review slice requires a `pr-review-approval` gate before `github.publishReview`, even for comment-only reviews.

## Terms To Avoid For Now

Avoid introducing new durable nouns unless they are clearly different from existing ones.

- Avoid `job` unless describing external queue infrastructure.
- Avoid `task` as a top-level noun because it conflicts with work item, session, and run.
- Avoid `workflow` for product behavior unless comparing to workflow engines.
- Avoid `conversation` as the source-of-truth term because Blade sessions include tools, artifacts, gates, and side effects, not just messages.

## Open Decisions

- Whether `Work Item` deserves a dedicated event in the first Blade slice or can live in `session.started` metadata.
- Whether `Run` should become a first-class read model before child sessions exist.
- Whether the user-visible URL should use `/sessions/:id` while the core API continues to expose `/threads/:id`.
- Whether findings should stay generic across Blade roles or specialize by review, support, docs, and SRE workflows.
