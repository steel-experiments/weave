# North Star Demo: SRE Agent Harness

## Purpose

This is the first north-star demo for Agent Mailbox.

It is not the whole product vision, but it is a concrete target that proves why the mailbox primitive matters.

If we can build this well, the project becomes obviously useful.

## Demo Summary

Build an SRE agent harness powered by Agent Mailbox.

The entry point is Slack.

A human tags the agent in a Slack channel and asks it to investigate an issue.

Example:

```txt
@sre can you look into the API error spike in production?
```

That message creates one mailbox session.

The SRE agent receives a scoped set of tools based on its mailbox capabilities.

It can inspect mocked or real observability systems, reason about what it sees, call the correct tools, emit progress, and request gates before performing risky actions.

## Why This Demo Matters

This demo exercises the most important parts of the product:

- Slack ingress
- one mailbox per agent session
- runtime-neutral agent execution
- custom tools instead of ad hoc skills
- capability-scoped credentials
- environment-scoped permissions
- tool progress events
- policy and approval gates
- audit trail of every decision and action
- resumable investigation flow

It turns Agent Mailbox from an abstract control plane into an obviously valuable operational workflow.

## Core Claim

An SRE agent should not directly hold credentials, call arbitrary tools, or perform risky actions without durable trace and policy checks.

Instead:

```txt
Slack request
  -> mailbox session
  -> SRE agent runtime
  -> capability-scoped tools
  -> mailbox events
  -> policy gates where needed
  -> human-visible timeline
```

## User Story

As an engineer on-call, I want to tag an SRE agent in Slack and ask it to investigate an incident, so it can gather context from observability systems, explain its reasoning, and request approval before taking risky remediation actions.

## Initial Demo Flow

```txt
Slack mention received
  -> mailbox created
  -> prompt recorded
  -> runner wakes SRE agent
  -> agent decides what context it needs
  -> agent calls observability tools
  -> tools emit progress and results
  -> agent synthesizes likely cause
  -> agent proposes remediation
  -> risky action creates gate
  -> human approves or denies in Slack/API
  -> agent resumes
  -> action runs or is cancelled
  -> final report posted back to Slack
```

## First Scenario

Use a mocked production incident.

Example incident:

```txt
API 5xx errors increased after a deploy.
Users are reporting failed checkouts.
```

The agent should:

- inspect mock Axiom logs
- inspect mock Grafana metrics
- inspect mock Sentry issues
- correlate the signals
- identify a likely failing service or deploy
- propose a remediation
- request approval before the remediation runs
- produce a final report

## Tooling Model

The demo should avoid relying on agent skills as the primary execution mechanism.

Skills can inspire behavior, but the mailbox should expose explicit custom tools.

Why custom tools:

- typed arguments
- typed results
- policy checks per tool
- credential scope per tool
- progress events
- gates before risky operations
- better testing with mock backends

## Initial Tool Set

### `axiom.searchLogs`

Purpose:

- search logs for an environment, service, or time range

Inputs:

- environment
- query
- time range
- limit

Outputs:

- matching log summaries
- notable error patterns
- links or references to raw entries

Credential needs:

- Axiom API token scoped by environment

### `grafana.queryMetrics`

Purpose:

- query service metrics and dashboards

Inputs:

- environment
- service
- metric names or dashboard references
- time range

Outputs:

- metric summaries
- anomaly windows
- links or references to panels

Credential needs:

- Grafana token scoped by environment

### `sentry.findIssues`

Purpose:

- inspect recent errors and exceptions

Inputs:

- environment
- project
- issue query
- time range

Outputs:

- issue summaries
- stack trace highlights
- affected release or commit if known

Credential needs:

- Sentry token scoped by environment/project

### `deploy.inspectRecentChanges`

Purpose:

- inspect recent deploys or changes

Inputs:

- environment
- service
- time range

Outputs:

- recent deploys
- versions
- authors
- change summaries

Credential needs:

- deploy metadata access, likely read-only

### `infra.rebuildNode`

Purpose:

- simulate or perform a risky remediation such as rebuilding a NATS node

Inputs:

- environment
- node identifier
- reason

Outputs:

- action accepted
- progress events
- completion or failure

Credential needs:

- elevated infrastructure capability

Gate requirement:

- always requires manual approval in the first version

## Credential And Policy Model

This demo should test the credential boundary early.

The mailbox should not simply hand raw API keys to the agent.

Instead:

- mailbox capabilities define what tools are available
- policy decides which environments are allowed
- workers receive scoped credentials when executing approved tool calls
- events record credential/capability use without exposing secret values

## Environment Scoping

Capabilities should be scoped by environment.

Examples:

- `axiom.searchLogs:staging`
- `axiom.searchLogs:production`
- `grafana.queryMetrics:production`
- `sentry.findIssues:production`
- `infra.rebuildNode:staging`
- `infra.rebuildNode:production`

This lets the demo show that the same agent can have different permissions depending on mailbox policy.

## Gates

Gates are the most important safety primitive in this demo.

Initial gate types:

- `manual-approval`
- `oracle-check`
- `time-delay`

## Manual Approval Gate

Used for risky actions.

Examples:

- rebuild NATS node
- restart production service
- roll back deploy
- update incident status externally

Flow:

```txt
agent requests risky tool
  -> policy detects gate requirement
  -> gate.created
  -> Slack approval message or API prompt
  -> human approves or denies
  -> gate.resolved
  -> action proceeds or is cancelled
```

## Oracle Gate

An oracle gate requires the agent to solve or justify a task before proceeding.

This can be used as a controlled reasoning checkpoint.

Examples:

- agent must summarize evidence before remediation
- agent must identify blast radius
- agent must provide rollback plan
- agent must answer a validation question from a policy oracle

This does not need a real external oracle in the first demo. A mock oracle can accept or reject based on deterministic criteria.

## Time-Based Gate

A time-based gate pauses execution until a specified time or delay.

Examples:

- wait five minutes after a deploy to see if errors recover
- pause before escalating
- schedule a follow-up check

This exercises the mailbox wake/resume model.

## Mock Systems For The First Version

The first SRE demo does not need real Axiom, Grafana, Sentry, or infrastructure access.

It can use mock APIs that behave like those systems.

Mock services should provide:

- realistic logs
- realistic metrics
- realistic error traces
- deterministic incident data
- deterministic remediation behavior

This keeps the demo safe and reproducible while still proving the mailbox architecture.

## Mock Incident Dataset

Create a fixed incident dataset with:

- API 5xx spike
- checkout failures
- Sentry issue tied to a recent release
- Grafana metric showing elevated latency or error rate
- Axiom logs containing a repeated exception
- deploy metadata showing a recent service rollout

Expected diagnosis:

```txt
The checkout API started failing after release X.
Logs and Sentry both point to a database timeout path.
Metrics show latency rose immediately after deploy.
Likely cause is release X in service checkout-api.
Recommended action is rollback or controlled restart.
```

## Event Model Extensions

The current PoC event model is enough for the primitive, but this demo will need richer events.

Suggested additions:

- `integration.slack.mention.received`
- `tool.capability.granted`
- `tool.capability.denied`
- `tool.credential.requested`
- `tool.credential.granted`
- `tool.credential.denied`
- `tool.policy.gate_required`
- `gate.oracle.requested`
- `gate.time_delay.created`
- `agent.finding.produced`
- `agent.remediation.proposed`
- `agent.incident_report.produced`
- `slack.message.posted`

## Components Needed

## 1. Slack ingress adapter

Responsibilities:

- receive Slack mention event
- create mailbox session
- map Slack user/channel/thread into mailbox metadata
- append Slack ingress event

PoC version:

- can be a mock Slack webhook or CLI command

## 2. SRE agent adapter

Responsibilities:

- inspect mailbox history
- choose observability tools
- synthesize findings
- propose remediation
- respond after gates resolve

PoC version:

- can start deterministic or semi-deterministic
- can later be replaced with a real LLM runtime

## 3. Capability and policy layer

Responsibilities:

- define available tools for the mailbox
- enforce environment scope
- require gates for risky tools
- route credential access to workers

PoC version:

- static policy config
- static mock credential references

## 4. Tool workers

Responsibilities:

- execute typed tool calls
- emit progress events
- return typed results
- request credentials through the policy layer

PoC version:

- mock workers backed by deterministic fixture data

## 5. Gate resolver

Responsibilities:

- expose pending gates to humans or mock humans
- resolve manual approvals
- resolve oracle or time-based gates

PoC version:

- API endpoint and scripted approval
- Slack approval can come later

## 6. Slack egress adapter

Responsibilities:

- post progress updates
- post approval prompts
- post final incident report

PoC version:

- console output or mock Slack endpoint

## Suggested Build Phases

## Phase 1: Mock SRE Incident Flow

Goal:

- prove SRE workflow using only mock Slack and mock observability tools

Build:

- mock Slack ingress
- mock SRE agent
- mock Axiom/Grafana/Sentry tools
- incident report event
- final console or mock Slack output

Success criteria:

- mailbox contains complete investigation timeline
- agent calls multiple tools based on available capabilities
- final report explains evidence and likely cause

## Phase 2: Capability And Credential Policy

Goal:

- prove that tool availability and credentials are mailbox-scoped

Build:

- static capability config
- environment-scoped mock credentials
- policy decision events
- denied tool attempt test

Success criteria:

- production tools only run when production capability exists
- credential values are never written into mailbox event payloads
- tool credential use is audited

## Phase 3: Manual Gate For Risky Action

Goal:

- prove safe remediation through approval gate

Build:

- risky mock tool such as `infra.rebuildNode`
- policy requiring manual approval
- gate created before execution
- scripted approval path

Success criteria:

- risky action does not run before approval
- denial cancels action cleanly
- approval resumes action and emits progress

## Phase 4: Slack Integration

Goal:

- make the demo feel real from Slack

Build:

- Slack app mention handler
- Slack thread updates
- Slack approval interaction
- final report posted to thread

Success criteria:

- user can start and resolve an investigation from Slack
- mailbox remains source of truth

## Phase 5: Real Tool Adapter Trial

Goal:

- replace one mock tool with a real integration

Candidate first real tool:

- Sentry issue lookup
- Axiom log search
- Grafana query

Success criteria:

- real credential is scoped through mailbox policy
- real response is converted into typed tool result events
- no raw secrets enter mailbox history

## Acceptance Criteria For The North Star Demo

The demo is compelling when:

- Slack can start a mailbox-backed investigation
- the agent uses multiple SRE tools through custom tool contracts
- each tool call is visible as events with progress and results
- capabilities restrict what tools and environments the agent can access
- credentials are consumed by workers, not exposed to the agent as raw values
- risky remediation requires a gate
- the final incident report is traceable to evidence in the mailbox timeline
- the full flow can be replayed or inspected after completion

## What Makes This Ground Breaking

The important part is not that an LLM can read logs.

The important part is that the LLM operates inside a durable, inspectable, permissioned mailbox boundary.

That means every operational action has:

- a durable cause
- a traceable tool call
- a policy decision
- a credential boundary
- a human gate when needed
- a replayable audit trail

That is the product.

## Relationship To Current PoC

The current PoC already proves the primitive pieces:

- mailbox session
- typed events
- runnable inbox
- runner daemon
- mock tool worker
- progress events
- manual gate
- resume after gate resolution

The SRE demo is the next product-shaped scenario built on those pieces.

## Immediate Next Step

The next implementation step should be:

- add a mock SRE scenario dataset
- add three typed mock tools: Axiom, Grafana, Sentry
- add an SRE-specific deterministic agent adapter
- drive it through the existing mailbox service and runnable inbox

Do not start with real Slack or real credentials.

First make the mocked SRE workflow excellent and fully traceable.

## Current Implementation Status

The first runnable version of this north-star path exists as `npm run sre:demo`.

It currently includes:

- API-driven mailbox session creation
- deterministic SRE agent adapter
- mock Axiom log search tool
- mock Grafana metrics query tool
- mock Sentry issue lookup tool
- mock deploy metadata tool
- manual approval gate before remediation
- mock `infra.rebuildNode` remediation tool
- final incident report event
- timeline and Mermaid output

It does not yet include:

- real Slack ingress or egress
- real credential policy
- real Axiom, Grafana, or Sentry APIs
- real remediation actions
