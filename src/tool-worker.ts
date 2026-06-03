import { z } from "zod";
import { NoopThreadArtifactStore, type ThreadArtifactStore } from "./artifacts.js";
import type { ThreadEngine } from "./contracts.js";
import {
  EmptyCredentialProvider,
  ResolvedCredentials,
  type CredentialProvider,
  type CredentialRequest,
  type CredentialResolution,
} from "./credentials.js";
import { eventKey, nowIso, type ThreadEvent } from "./events.js";
import { internalTryPromise, runInternalEffect } from "./internal-effect.js";
import { isCapabilityRequest, normalizeCapabilityDeclarations, type CapabilityDeclaration } from "./capability-contract.js";
import {
  NoopObservabilitySink,
  ToolObserver,
  elapsedMs,
  newSpanId,
  newTraceId,
  safeEmitLog,
  safeEmitSpan,
  type ObservabilityContext,
  type ObservabilitySink,
} from "./observability.js";
import {
  RetryableToolError,
  ToolRegistry,
  createToolRegistry,
  isLegacyToolCompletionOutput,
  type AnyToolContract,
  type ToolProgressUpdate,
} from "./tool-contract.js";

type ToolRequestedEvent = Extract<ThreadEvent, { type: "tool.requested" }>;

type CredentialProviderFailure = {
  type: "credential_provider_error";
  message: string;
};

type ToolRunFailure = {
  type: "tool_execution_failed";
  message: string;
  cause: unknown;
};

export type ToolWorkerResult = {
  acted: boolean;
  eventType?: string;
  errorCode?: string;
  errorMessage?: string;
};

export class ContractToolWorker {
  private readonly registry: ToolRegistry;

  constructor(
    private readonly engine: ThreadEngine,
    tools: readonly AnyToolContract[] | ToolRegistry,
    private readonly workerId = `tool-worker-${process.pid}`,
    private readonly credentialProvider: CredentialProvider = new EmptyCredentialProvider(),
    private readonly observability: ObservabilitySink = new NoopObservabilitySink(),
    private readonly artifactStore: ThreadArtifactStore = new NoopThreadArtifactStore(),
  ) {
    this.registry = tools instanceof ToolRegistry ? tools : createToolRegistry(tools);
  }

  async processOnce(threadId: string): Promise<ToolWorkerResult> {
    const events = await this.engine.read(threadId);
    const request = events.find((event): event is ToolRequestedEvent => {
      return event.type === "tool.requested" && !hasTerminalEvent(events, event.payload.toolCallId);
    });

    if (!request) {
      return { acted: false };
    }

    const toolCallId = request.payload.toolCallId;
    const started = events.some((event) => event.type === "tool.started" && event.payload.toolCallId === toolCallId);
    if (!started) {
      const event = this.startedEvent(threadId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const tool = this.registry.get(request.payload.toolName);
    if (!tool) {
      const event = this.failedEvent(threadId, request, "unknown_tool", `No tool contract registered for ${request.payload.toolName}`);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
    }

    return this.executeTool(threadId, request, tool);
  }

  private async executeTool(
    threadId: string,
    request: ToolRequestedEvent,
    tool: AnyToolContract,
  ): Promise<ToolWorkerResult> {
    const spanContext = this.newToolSpanContext(threadId, request);
    const rootStartedAt = new Date();

    const inputResult = tool.input.safeParse(request.payload.args);
    if (!inputResult.success) {
      const event = this.failedEvent(
        threadId,
        request,
        "input_validation_failed",
        formatZodError(inputResult.error),
      );
      await this.emitToolLog(spanContext, "warn", "Tool input validation failed", {
        errorCode: "input_validation_failed",
      });
      await this.emitToolSpan(spanContext, rootStartedAt, "error", {
        errorCode: "input_validation_failed",
      });
      await this.engine.append([event]);
      return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
    }

    const progressEvents: ThreadEvent[] = [];
    const credentialEvents: ThreadEvent[] = [];
    const progress = async (update: ToolProgressUpdate): Promise<void> => {
      progressEvents.push(this.progressEvent(threadId, request, progressEvents.length, update));
    };

    await this.emitToolLog(spanContext, "info", "Tool execution started", {
      toolName: request.payload.toolName,
    });

    const credentialResult = await this.resolveCredentials(threadId, request, tool, inputResult.data, spanContext);
    credentialEvents.push(...credentialResult.events);
    if (credentialResult.failed) {
      const event = this.failedEvent(threadId, request, "credential_resolution_failed", credentialResult.message);
      await this.emitToolLog(spanContext, "error", "Credential resolution failed", {
        errorCode: "credential_resolution_failed",
        message: credentialResult.message,
      });
      await this.emitToolSpan(spanContext, rootStartedAt, "error", {
        errorCode: "credential_resolution_failed",
      });
      await this.engine.append([...credentialEvents, event]);
      return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
    }

    const observer = new ToolObserver(this.observability, spanContext);
    let attempt = 1;
    while (true) {
      const runResult = await runInternalEffect(
        internalTryPromise<ToolRunFailure, unknown>({
          try: () => observer.span(
            "tool.run",
            () =>
              tool.run({
                threadId,
                toolCallId: request.payload.toolCallId,
                toolName: request.payload.toolName,
                input: inputResult.data,
                credentials: credentialResult.credentials,
                artifactStore: this.artifactStore,
                observe: observer,
                request,
                progress,
              }),
            { kind: "tool", attributes: { toolName: request.payload.toolName, attempt } },
          ),
          catch: (error) => ({ type: "tool_execution_failed", message: errorMessage(error), cause: error }),
        }),
      );

      if (!runResult.ok) {
        const error = runResult.error.cause;
        if (error instanceof RetryableToolError && attempt < 3) {
          const nextAttempt = attempt + 1;
          await progress({
            percent: 0,
            message: `Retrying after transient failure (${nextAttempt}/3): ${error.message}`,
          });
          await this.emitToolLog(spanContext, "warn", "Tool execution retry scheduled", {
            attempt,
            nextAttempt,
            error: error.message,
          });
          attempt = nextAttempt;
          await sleep(100 * nextAttempt);
          continue;
        }

        const event = this.failedEvent(threadId, request, "execution_failed", runResult.error.message);
        await this.emitToolLog(spanContext, "error", "Tool execution failed", {
          attempt,
          errorCode: "execution_failed",
          error: runResult.error.message,
        });
        await this.emitToolSpan(spanContext, rootStartedAt, "error", {
          attempt,
          errorCode: "execution_failed",
          error: runResult.error.message,
        });
        await this.engine.append([...credentialEvents, ...progressEvents, event]);
        return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
      }

      const output = runResult.value;
      const outputResult = tool.output.safeParse(output);
      if (!outputResult.success) {
        const event = this.failedEvent(
          threadId,
          request,
          "output_validation_failed",
          formatZodError(outputResult.error),
        );
        await this.emitToolLog(spanContext, "error", "Tool output validation failed", {
          errorCode: "output_validation_failed",
        });
        await this.emitToolSpan(spanContext, rootStartedAt, "error", {
          errorCode: "output_validation_failed",
        });
        await this.engine.append([...credentialEvents, ...progressEvents, event]);
        return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
      }

      const event = this.completedEvent(threadId, request, outputResult.data, summarizeToolOutput(tool, outputResult.data));
      await this.emitToolLog(spanContext, "info", "Tool execution completed", {
        attempt,
        progressEvents: progressEvents.length,
      });
      await this.emitToolSpan(spanContext, rootStartedAt, "ok", {
        attempt,
        credentialCount: credentialResult.credentials.names().length,
        progressEvents: progressEvents.length,
      });
      await this.engine.append([...credentialEvents, ...progressEvents, event]);
      return { acted: true, eventType: event.type };
    }
  }

  private async resolveCredentials(
    threadId: string,
    request: ToolRequestedEvent,
    tool: AnyToolContract,
    input: unknown,
    parentContext: ObservabilityContext,
  ): Promise<
    | { failed: false; events: ThreadEvent[]; credentials: ResolvedCredentials }
    | { failed: true; events: ThreadEvent[]; credentials: ResolvedCredentials; message: string }
  > {
    const capabilityDeclarations = resolveToolCapabilities(tool, input);
    const capabilityCredentialRequests = capabilityDeclarations
      .filter(isCapabilityRequest)
      .map((capability) => capability.credential);
    const credentialRequests = [
      ...capabilityCredentialRequests,
      ...normalizeCredentialRequests(tool.credentials?.({ input })),
    ];
    const events: ThreadEvent[] = [];
    const resolutions: CredentialResolution[] = [];

    for (const credentialRequest of credentialRequests) {
      const spanContext = { ...parentContext, spanId: newSpanId() };
      const startedAt = new Date();
      events.push(this.credentialRequestedEvent(threadId, request, credentialRequest));

      const resolutionResult = await runInternalEffect(
        internalTryPromise<CredentialProviderFailure, CredentialResolution | null>({
          try: () => this.credentialProvider.resolve(credentialRequest, {
            threadId,
            toolCallId: request.payload.toolCallId,
            toolName: request.payload.toolName,
          }),
          catch: (error) => ({ type: "credential_provider_error", message: errorMessage(error) }),
        }),
      );

      if (!resolutionResult.ok) {
        events.push(this.credentialFailedEvent(threadId, request, credentialRequest, "credential_provider_error", resolutionResult.error.message));
        await this.emitCredentialSpan(parentContext, spanContext, startedAt, credentialRequest, "error", {
          errorCode: "credential_provider_error",
          error: resolutionResult.error.message,
        });
        return {
          failed: true,
          events,
          credentials: new ResolvedCredentials(resolutions),
          message: `Credential provider failed for ${credentialRequest.name}: ${resolutionResult.error.message}`,
        };
      }

      const resolution = resolutionResult.value;

      if (!resolution) {
        events.push(this.credentialFailedEvent(threadId, request, credentialRequest, "credential_not_found", "Credential provider returned no credential"));
        await this.emitCredentialSpan(parentContext, spanContext, startedAt, credentialRequest, "error", {
          errorCode: "credential_not_found",
        });
        return {
          failed: true,
          events,
          credentials: new ResolvedCredentials(resolutions),
          message: `Credential not resolved: ${credentialRequest.name}`,
        };
      }

      resolutions.push(resolution);
      events.push(this.credentialResolvedEvent(threadId, request, resolution));
      await this.emitCredentialSpan(parentContext, spanContext, startedAt, credentialRequest, "ok", {
        source: resolution.source,
      });
    }

    return { failed: false, events, credentials: new ResolvedCredentials(resolutions) };
  }

  private newToolSpanContext(threadId: string, request: ToolRequestedEvent): ObservabilityContext {
    return {
      traceId: newTraceId(),
      spanId: newSpanId(),
      threadId,
      eventId: request.eventId,
      correlationId: request.correlationId,
      causationId: request.causationId,
      toolCallId: request.payload.toolCallId,
      toolName: request.payload.toolName,
    };
  }

  private async emitToolLog(
    context: ObservabilityContext,
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    await safeEmitLog(this.observability, {
      ...context,
      timestamp: nowIso(),
      level,
      message,
      attributes,
    });
  }

  private async emitToolSpan(
    context: ObservabilityContext,
    startedAt: Date,
    status: "ok" | "error",
    attributes: Record<string, unknown>,
  ): Promise<void> {
    await safeEmitSpan(this.observability, {
      ...context,
      name: `tool.execute ${context.toolName ?? "unknown"}`,
      kind: "tool",
      status,
      startedAt: startedAt.toISOString(),
      endedAt: nowIso(),
      durationMs: elapsedMs(startedAt),
      attributes,
    });
  }

  private async emitCredentialSpan(
    parentContext: ObservabilityContext,
    context: ObservabilityContext,
    startedAt: Date,
    request: CredentialRequest,
    status: "ok" | "error",
    attributes: Record<string, unknown>,
  ): Promise<void> {
    await safeEmitSpan(this.observability, {
      ...context,
      parentSpanId: parentContext.spanId,
      name: `credential.resolve ${request.name}`,
      kind: "credential",
      status,
      startedAt: startedAt.toISOString(),
      endedAt: nowIso(),
      durationMs: elapsedMs(startedAt),
      attributes: {
        ...attributes,
        credentialName: request.name,
        credentialKind: request.kind,
        provider: request.provider,
        scopes: request.scopes,
      },
    });
  }

  private startedEvent(
    threadId: string,
    request: ToolRequestedEvent,
  ): Extract<ThreadEvent, { type: "tool.started" }> {
    return {
      eventId: eventKey(threadId, "tool.started", request.payload.toolCallId),
      threadId,
      type: "tool.started",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: { toolCallId: request.payload.toolCallId, toolName: request.payload.toolName },
    };
  }

  private progressEvent(
    threadId: string,
    request: ToolRequestedEvent,
    index: number,
    update: ToolProgressUpdate,
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "tool.progress", `${request.payload.toolCallId}:${index}:${update.percent}`),
      threadId,
      type: "tool.progress",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        percent: update.percent,
        message: update.message,
      },
    };
  }

  private completedEvent(
    threadId: string,
    request: ToolRequestedEvent,
    output: Extract<ThreadEvent, { type: "tool.completed" }>["payload"]["output"],
    summary: string | undefined,
  ): Extract<ThreadEvent, { type: "tool.completed" }> {
    return {
      eventId: eventKey(threadId, "tool.completed", request.payload.toolCallId),
      threadId,
      type: "tool.completed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        output,
        summary,
      },
    };
  }

  private credentialRequestedEvent(
    threadId: string,
    request: ToolRequestedEvent,
    credential: CredentialRequest,
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "credential.requested", `${request.payload.toolCallId}:${credential.name}`),
      threadId,
      type: "credential.requested",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        credentialName: credential.name,
        kind: credential.kind,
        provider: credential.provider,
        reason: credential.reason,
        scopes: credential.scopes,
        scope: credential.scope,
      },
    };
  }

  private credentialResolvedEvent(
    threadId: string,
    request: ToolRequestedEvent,
    resolution: CredentialResolution,
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "credential.resolved", `${request.payload.toolCallId}:${resolution.name}`),
      threadId,
      type: "credential.resolved",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        credentialName: resolution.name,
        kind: resolution.kind,
        source: resolution.source,
        subject: resolution.subject,
        expiresAt: resolution.expiresAt,
      },
    };
  }

  private credentialFailedEvent(
    threadId: string,
    request: ToolRequestedEvent,
    credential: CredentialRequest,
    errorCode: string,
    message: string,
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "credential.failed", `${request.payload.toolCallId}:${credential.name}:${errorCode}`),
      threadId,
      type: "credential.failed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        credentialName: credential.name,
        kind: credential.kind,
        errorCode,
        message,
      },
    };
  }

  private failedEvent(
    threadId: string,
    request: ToolRequestedEvent,
    errorCode: string,
    message: string,
  ): Extract<ThreadEvent, { type: "tool.failed" }> {
    return {
      eventId: eventKey(threadId, "tool.failed", `${request.payload.toolCallId}:${errorCode}`),
      threadId,
      type: "tool.failed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      scopeKey: request.scopeKey ?? request.payload.scopeKey,
      stepKey: request.stepKey ?? request.payload.stepKey,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        errorCode,
        message,
      },
    };
  }
}

function hasTerminalEvent(events: ThreadEvent[], toolCallId: string): boolean {
  return events.some((event) => {
    return (event.type === "tool.completed" || event.type === "tool.failed") && event.payload.toolCallId === toolCallId;
  });
}

function formatZodError(error: z.ZodError): string {
  return z.prettifyError(error);
}

function normalizeCredentialRequests(
  requests: CredentialRequest | readonly CredentialRequest[] | undefined,
): CredentialRequest[] {
  if (!requests) {
    return [];
  }
  if (Array.isArray(requests)) {
    return [...requests];
  }
  return [requests as CredentialRequest];
}

function resolveToolCapabilities(tool: AnyToolContract, input: unknown): CapabilityDeclaration[] {
  return typeof tool.capabilities === "function"
    ? normalizeCapabilityDeclarations(tool.capabilities({ input }))
    : normalizeCapabilityDeclarations(tool.capabilities);
}

function summarizeToolOutput(tool: AnyToolContract, output: unknown): string | undefined {
  if (tool.summarize) {
    return tool.summarize(output);
  }

  return isLegacyToolCompletionOutput(output) ? output.summary : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
