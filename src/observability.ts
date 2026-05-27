import { randomBytes } from "node:crypto";

export type ObservabilityAttributes = Record<string, unknown>;

export type SpanKind = "internal" | "tool" | "credential" | "db" | "http";

export type SpanStatus = "ok" | "error";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityContext = {
  traceId: string;
  spanId: string;
  mailboxId?: string;
  eventId?: string;
  correlationId?: string;
  causationId?: string;
  toolCallId?: string;
  toolName?: string;
};

export type MailboxSpanRecord = ObservabilityContext & {
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  attributes?: ObservabilityAttributes;
};

export type MailboxLogRecord = Partial<ObservabilityContext> & {
  timestamp: string;
  level: LogLevel;
  message: string;
  attributes?: ObservabilityAttributes;
};

export interface ObservabilitySink {
  emitSpan(span: MailboxSpanRecord): Promise<void>;
  emitLog(record: MailboxLogRecord): Promise<void>;
}

export interface ObservabilityReader {
  listSpans(mailboxId: string): Promise<MailboxSpanRecord[]>;
  listLogs(mailboxId: string): Promise<MailboxLogRecord[]>;
}

export class NoopObservabilitySink implements ObservabilitySink {
  async emitSpan(): Promise<void> {}
  async emitLog(): Promise<void> {}
}

export class CompositeObservabilitySink implements ObservabilitySink {
  constructor(private readonly sinks: readonly ObservabilitySink[]) {}

  async emitSpan(span: MailboxSpanRecord): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.emitSpan(span)));
  }

  async emitLog(record: MailboxLogRecord): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.emitLog(record)));
  }
}

export class ToolObserver {
  constructor(
    private readonly sink: ObservabilitySink,
    private readonly context: ObservabilityContext,
  ) {}

  async log(level: LogLevel, message: string, attributes: ObservabilityAttributes = {}): Promise<void> {
    await safeEmitLog(this.sink, {
      ...this.context,
      timestamp: nowIso(),
      level,
      message,
      attributes,
    });
  }

  async span<T>(
    name: string,
    fn: (observer: ToolObserver) => Promise<T> | T,
    options: { kind?: SpanKind; attributes?: ObservabilityAttributes } = {},
  ): Promise<T> {
    const spanId = newSpanId();
    const childContext: ObservabilityContext = {
      ...this.context,
      spanId,
    };
    const startedAt = new Date();
    try {
      const result = await fn(new ToolObserver(this.sink, childContext));
      await safeEmitSpan(this.sink, {
        ...childContext,
        parentSpanId: this.context.spanId,
        name,
        kind: options.kind ?? "internal",
        status: "ok",
        startedAt: startedAt.toISOString(),
        endedAt: nowIso(),
        durationMs: elapsedMs(startedAt),
        attributes: options.attributes,
      });
      return result;
    } catch (error) {
      await safeEmitSpan(this.sink, {
        ...childContext,
        parentSpanId: this.context.spanId,
        name,
        kind: options.kind ?? "internal",
        status: "error",
        startedAt: startedAt.toISOString(),
        endedAt: nowIso(),
        durationMs: elapsedMs(startedAt),
        attributes: { ...options.attributes, error: errorMessage(error) },
      });
      throw error;
    }
  }
}

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function elapsedMs(startedAt: Date): number {
  return Math.max(0, Date.now() - startedAt.getTime());
}

export async function safeEmitSpan(sink: ObservabilitySink, span: MailboxSpanRecord): Promise<void> {
  try {
    await sink.emitSpan(span);
  } catch {
    // Observability must not change mailbox execution semantics.
  }
}

export async function safeEmitLog(sink: ObservabilitySink, record: MailboxLogRecord): Promise<void> {
  try {
    await sink.emitLog(record);
  } catch {
    // Observability must not change mailbox execution semantics.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
