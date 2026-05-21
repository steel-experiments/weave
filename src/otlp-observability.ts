import type {
  LogLevel,
  MailboxLogRecord,
  MailboxSpanRecord,
  ObservabilityAttributes,
  ObservabilitySink,
  SpanKind,
} from "./observability.js";

export type OtlpHttpObservabilityOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  serviceVersion?: string;
  resourceAttributes?: ObservabilityAttributes;
  timeoutMs?: number;
};

export class OtlpHttpObservabilitySink implements ObservabilitySink {
  private readonly tracesUrl: string;
  private readonly logsUrl: string;
  private readonly headers: Record<string, string>;
  private readonly serviceName: string;
  private readonly serviceVersion: string | undefined;
  private readonly resourceAttributes: ObservabilityAttributes;
  private readonly timeoutMs: number;

  constructor(options: OtlpHttpObservabilityOptions) {
    this.tracesUrl = otlpSignalUrl(options.endpoint, "traces");
    this.logsUrl = otlpSignalUrl(options.endpoint, "logs");
    this.headers = options.headers ?? {};
    this.serviceName = options.serviceName ?? "agent-mailbox";
    this.serviceVersion = options.serviceVersion;
    this.resourceAttributes = options.resourceAttributes ?? {};
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async emitSpan(span: MailboxSpanRecord): Promise<void> {
    await this.post(this.tracesUrl, {
      resourceSpans: [
        {
          resource: {
            attributes: attributesToOtlp({
              "service.name": this.serviceName,
              "service.version": this.serviceVersion,
              ...this.resourceAttributes,
            }),
          },
          scopeSpans: [
            {
              scope: { name: "@agent-mailbox/core" },
              spans: [spanToOtlp(span)],
            },
          ],
        },
      ],
    });
  }

  async emitLog(record: MailboxLogRecord): Promise<void> {
    await this.post(this.logsUrl, {
      resourceLogs: [
        {
          resource: {
            attributes: attributesToOtlp({
              "service.name": this.serviceName,
              "service.version": this.serviceVersion,
              ...this.resourceAttributes,
            }),
          },
          scopeLogs: [
            {
              scope: { name: "@agent-mailbox/core" },
              logRecords: [logToOtlp(record)],
            },
          ],
        },
      ],
    });
  }

  private async post(url: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OTLP export failed: HTTP ${response.status} ${await response.text()}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function otlpFromEnv(options: Partial<OtlpHttpObservabilityOptions> = {}): OtlpHttpObservabilitySink | null {
  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return null;
  }

  return new OtlpHttpObservabilitySink({
    endpoint,
    headers: {
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      ...options.headers,
    },
    serviceName: options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? "agent-mailbox",
    serviceVersion: options.serviceVersion,
    resourceAttributes: {
      ...parseOtlpResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
      ...options.resourceAttributes,
    },
    timeoutMs: options.timeoutMs,
  });
}

function spanToOtlp(span: MailboxSpanRecord): Record<string, unknown> {
  return compact({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: spanKindToOtlp(span.kind),
    startTimeUnixNano: dateToUnixNano(span.startedAt),
    endTimeUnixNano: dateToUnixNano(span.endedAt),
    attributes: attributesToOtlp({
      ...contextAttributes(span),
      "agent_mailbox.span.kind": span.kind,
      "agent_mailbox.span.duration_ms": span.durationMs,
      ...span.attributes,
    }),
    status: {
      code: span.status === "ok" ? 1 : 2,
    },
  });
}

function logToOtlp(record: MailboxLogRecord): Record<string, unknown> {
  return {
    timeUnixNano: dateToUnixNano(record.timestamp),
    observedTimeUnixNano: dateToUnixNano(new Date().toISOString()),
    severityNumber: severityNumber(record.level),
    severityText: record.level.toUpperCase(),
    body: { stringValue: record.message },
    attributes: attributesToOtlp({
      ...contextAttributes(record),
      ...record.attributes,
    }),
  };
}

function contextAttributes(record: Partial<MailboxSpanRecord | MailboxLogRecord>): ObservabilityAttributes {
  return compact({
    "agent_mailbox.mailbox_id": record.mailboxId,
    "agent_mailbox.event_id": record.eventId,
    "agent_mailbox.correlation_id": record.correlationId,
    "agent_mailbox.causation_id": record.causationId,
    "agent_mailbox.tool_call_id": record.toolCallId,
    "agent_mailbox.tool_name": record.toolName,
  });
}

function attributesToOtlp(attributes: ObservabilityAttributes): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: anyValueToOtlp(value) }));
}

function anyValueToOtlp(value: unknown): Record<string, unknown> {
  if (value === null) {
    return { stringValue: "null" };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { intValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(anyValueToOtlp) } };
  }
  if (typeof value === "object") {
    return {
      kvlistValue: {
        values: attributesToOtlp(value as ObservabilityAttributes),
      },
    };
  }
  return { stringValue: String(value) };
}

function spanKindToOtlp(kind: SpanKind): number {
  switch (kind) {
    case "http":
      return 3;
    case "internal":
    case "tool":
    case "credential":
    case "db":
      return 1;
  }
}

function severityNumber(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 5;
    case "info":
      return 9;
    case "warn":
      return 13;
    case "error":
      return 17;
  }
}

function dateToUnixNano(value: string): string {
  const milliseconds = new Date(value).getTime();
  return String(BigInt(milliseconds) * 1_000_000n);
}

function otlpSignalUrl(endpoint: string, signal: "traces" | "logs"): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith(`/v1/${signal}`)) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1/traces")) {
    return trimmed.replace(/\/v1\/traces$/, `/v1/${signal}`);
  }
  if (trimmed.endsWith("/v1/logs")) {
    return trimmed.replace(/\/v1\/logs$/, `/v1/${signal}`);
  }
  return `${trimmed}/v1/${signal}`;
}

function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  return parseCommaSeparatedKeyValues(value);
}

function parseOtlpResourceAttributes(value: string | undefined): ObservabilityAttributes {
  return parseCommaSeparatedKeyValues(value);
}

function parseCommaSeparatedKeyValues(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const part of value.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (key) {
      result[key] = rawValue;
    }
  }
  return result;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
