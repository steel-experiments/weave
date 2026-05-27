import { z } from "zod";
import { NoopMailboxArtifactStore, type MailboxArtifactStore } from "./artifacts.js";
import type { MailboxEngine } from "./contracts.js";
import {
  EmptyCredentialProvider,
  ResolvedCredentials,
  type CredentialProvider,
  type CredentialRequest,
  type CredentialResolution,
} from "./credentials.js";
import { eventKey, nowIso, type MailboxEvent } from "./events.js";
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
  type AnyToolContract,
  type ToolProgressUpdate,
} from "./tool-contract.js";

type ToolRequestedEvent = Extract<MailboxEvent, { type: "tool.requested" }>;

export type ToolWorkerResult = {
  acted: boolean;
  eventType?: string;
  errorCode?: string;
  errorMessage?: string;
};

export class ContractToolWorker {
  private readonly registry: ToolRegistry;

  constructor(
    private readonly engine: MailboxEngine,
    tools: readonly AnyToolContract[] | ToolRegistry,
    private readonly workerId = `tool-worker-${process.pid}`,
    private readonly credentialProvider: CredentialProvider = new EmptyCredentialProvider(),
    private readonly observability: ObservabilitySink = new NoopObservabilitySink(),
    private readonly artifactStore: MailboxArtifactStore = new NoopMailboxArtifactStore(),
  ) {
    this.registry = tools instanceof ToolRegistry ? tools : createToolRegistry(tools);
  }

  async processOnce(mailboxId: string): Promise<ToolWorkerResult> {
    const events = await this.engine.read(mailboxId);
    const request = events.find((event): event is ToolRequestedEvent => {
      return event.type === "tool.requested" && !hasTerminalEvent(events, event.payload.toolCallId);
    });

    if (!request) {
      return { acted: false };
    }

    const toolCallId = request.payload.toolCallId;
    const started = events.some((event) => event.type === "tool.started" && event.payload.toolCallId === toolCallId);
    if (!started) {
      const event = this.startedEvent(mailboxId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const tool = this.registry.get(request.payload.toolName);
    if (!tool) {
      const event = this.failedEvent(mailboxId, request, "unknown_tool", `No tool contract registered for ${request.payload.toolName}`);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
    }

    return this.executeTool(mailboxId, request, tool);
  }

  private async executeTool(
    mailboxId: string,
    request: ToolRequestedEvent,
    tool: AnyToolContract,
  ): Promise<ToolWorkerResult> {
    const spanContext = this.newToolSpanContext(mailboxId, request);
    const rootStartedAt = new Date();

    const inputResult = tool.input.safeParse(request.payload.args);
    if (!inputResult.success) {
      const event = this.failedEvent(
        mailboxId,
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

    const progressEvents: MailboxEvent[] = [];
    const credentialEvents: MailboxEvent[] = [];
    const progress = async (update: ToolProgressUpdate): Promise<void> => {
      progressEvents.push(this.progressEvent(mailboxId, request, progressEvents.length, update));
    };

    await this.emitToolLog(spanContext, "info", "Tool execution started", {
      toolName: request.payload.toolName,
    });

    const credentialResult = await this.resolveCredentials(mailboxId, request, tool, inputResult.data, spanContext);
    credentialEvents.push(...credentialResult.events);
    if (credentialResult.failed) {
      const event = this.failedEvent(mailboxId, request, "credential_resolution_failed", credentialResult.message);
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
      try {
        const output = await observer.span(
          "tool.run",
          () =>
            tool.run({
              mailboxId,
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
        );
      const outputResult = tool.output.safeParse(output);
      if (!outputResult.success) {
        const event = this.failedEvent(
          mailboxId,
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

      const event = this.completedEvent(mailboxId, request, outputResult.data);
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
      } catch (error) {
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

        const event = this.failedEvent(mailboxId, request, "execution_failed", errorMessage(error));
        await this.emitToolLog(spanContext, "error", "Tool execution failed", {
          attempt,
          errorCode: "execution_failed",
          error: errorMessage(error),
        });
        await this.emitToolSpan(spanContext, rootStartedAt, "error", {
          attempt,
          errorCode: "execution_failed",
          error: errorMessage(error),
        });
        await this.engine.append([...credentialEvents, ...progressEvents, event]);
        return { acted: true, eventType: event.type, errorCode: event.payload.errorCode, errorMessage: event.payload.message };
      }
    }
  }

  private async resolveCredentials(
    mailboxId: string,
    request: ToolRequestedEvent,
    tool: AnyToolContract,
    input: unknown,
    parentContext: ObservabilityContext,
  ): Promise<
    | { failed: false; events: MailboxEvent[]; credentials: ResolvedCredentials }
    | { failed: true; events: MailboxEvent[]; credentials: ResolvedCredentials; message: string }
  > {
    const credentialRequests = normalizeCredentialRequests(tool.credentials?.({ input }));
    const events: MailboxEvent[] = [];
    const resolutions: CredentialResolution[] = [];

    for (const credentialRequest of credentialRequests) {
      const spanContext = { ...parentContext, spanId: newSpanId() };
      const startedAt = new Date();
      events.push(this.credentialRequestedEvent(mailboxId, request, credentialRequest));

      let resolution: CredentialResolution | null;
      try {
        resolution = await this.credentialProvider.resolve(credentialRequest, {
          mailboxId,
          toolCallId: request.payload.toolCallId,
          toolName: request.payload.toolName,
        });
      } catch (error) {
        const message = errorMessage(error);
        events.push(this.credentialFailedEvent(mailboxId, request, credentialRequest, "credential_provider_error", message));
        await this.emitCredentialSpan(parentContext, spanContext, startedAt, credentialRequest, "error", {
          errorCode: "credential_provider_error",
          error: message,
        });
        return {
          failed: true,
          events,
          credentials: new ResolvedCredentials(resolutions),
          message: `Credential provider failed for ${credentialRequest.name}: ${message}`,
        };
      }

      if (!resolution) {
        events.push(this.credentialFailedEvent(mailboxId, request, credentialRequest, "credential_not_found", "Credential provider returned no credential"));
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
      events.push(this.credentialResolvedEvent(mailboxId, request, resolution));
      await this.emitCredentialSpan(parentContext, spanContext, startedAt, credentialRequest, "ok", {
        source: resolution.source,
      });
    }

    return { failed: false, events, credentials: new ResolvedCredentials(resolutions) };
  }

  private newToolSpanContext(mailboxId: string, request: ToolRequestedEvent): ObservabilityContext {
    return {
      traceId: newTraceId(),
      spanId: newSpanId(),
      mailboxId,
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
    mailboxId: string,
    request: ToolRequestedEvent,
  ): Extract<MailboxEvent, { type: "tool.started" }> {
    return {
      eventId: eventKey(mailboxId, "tool.started", request.payload.toolCallId),
      mailboxId,
      type: "tool.started",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: this.workerId },
      payload: { toolCallId: request.payload.toolCallId, toolName: request.payload.toolName },
    };
  }

  private progressEvent(
    mailboxId: string,
    request: ToolRequestedEvent,
    index: number,
    update: ToolProgressUpdate,
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "tool.progress", `${request.payload.toolCallId}:${index}:${update.percent}`),
      mailboxId,
      type: "tool.progress",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        percent: update.percent,
        message: update.message,
      },
    };
  }

  private completedEvent(
    mailboxId: string,
    request: ToolRequestedEvent,
    output: Extract<MailboxEvent, { type: "tool.completed" }>["payload"]["output"],
  ): Extract<MailboxEvent, { type: "tool.completed" }> {
    return {
      eventId: eventKey(mailboxId, "tool.completed", request.payload.toolCallId),
      mailboxId,
      type: "tool.completed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        output,
      },
    };
  }

  private credentialRequestedEvent(
    mailboxId: string,
    request: ToolRequestedEvent,
    credential: CredentialRequest,
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "credential.requested", `${request.payload.toolCallId}:${credential.name}`),
      mailboxId,
      type: "credential.requested",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
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
    mailboxId: string,
    request: ToolRequestedEvent,
    resolution: CredentialResolution,
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "credential.resolved", `${request.payload.toolCallId}:${resolution.name}`),
      mailboxId,
      type: "credential.resolved",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
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
    mailboxId: string,
    request: ToolRequestedEvent,
    credential: CredentialRequest,
    errorCode: string,
    message: string,
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "credential.failed", `${request.payload.toolCallId}:${credential.name}:${errorCode}`),
      mailboxId,
      type: "credential.failed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
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
    mailboxId: string,
    request: ToolRequestedEvent,
    errorCode: string,
    message: string,
  ): Extract<MailboxEvent, { type: "tool.failed" }> {
    return {
      eventId: eventKey(mailboxId, "tool.failed", `${request.payload.toolCallId}:${errorCode}`),
      mailboxId,
      type: "tool.failed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: this.workerId },
      payload: {
        toolCallId: request.payload.toolCallId,
        errorCode,
        message,
      },
    };
  }
}

function hasTerminalEvent(events: MailboxEvent[], toolCallId: string): boolean {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
