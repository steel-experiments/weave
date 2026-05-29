# Glossary

## Agent

The reasoning system that decides what to do next. It may run in different environments and should not be the durable source of truth.

## Agent Runtime

The execution environment for an agent, such as a local process, hosted coding runtime, browser-capable environment, or cloud sandbox.

## Thread

A durable execution boundary that stores events, coordinates wake and resume behavior, and mediates interactions between an agent and the outside world.

## Event

An immutable record that something happened, was requested, or was resolved.

## Event Stream

The ordered sequence of events associated with a thread.

## Inbox

The subset of events that should wake or notify a consumer, rather than the full historical log.

## Runner

An ephemeral process that acquires a thread, reconstructs state, performs bounded work, and emits new events.

## Worker

A process or component that performs a specific side effect or integration task, such as running a command, controlling a browser, or sending a notification.

## Tool

A structured capability exposed to an agent. A tool should have defined inputs and lifecycle events rather than behaving like an opaque shell escape hatch.

## Tool Contract

The formal description of how a tool is invoked, how it reports progress, and how it returns success or failure.

## Gate

A thread-native pause point that represents pending approval, human input, or another external dependency.

## Interrupt

A signal that normal execution should pause, wait, or be redirected.

## Supervisor

An observer or controller that listens to thread events and may trigger actions such as escalation, retry, notification, or resumption.

## Capability

A scoped grant that lets a worker or integration perform an action or consume a secret in a restricted context.

## Policy

The rules that decide what actions an agent, worker, or human may take under which conditions.

## Trace

The linked record of what initiated a session and how later events, tool calls, and outcomes relate back to it.

## Correlation ID

A shared identifier used to connect events that belong to the same logical request, session, or workflow.

## Causation ID

An identifier linking one event to the earlier event that caused it.

## Stream Link

A controlled connection where one thread or event stream can feed another thread, supervisor path, or child workflow.

## Subagent

A child agent or delegated execution path that may have its own thread while still being trace-linked to a parent session.

## Durable Execution

The ability to stop and later resume work based on persisted events and state rather than live process memory.

## Ephemeral Compute

The assumption that runtimes and runners may stop at any time without losing the durable source of truth.
