import type { Pool } from "pg";
import type { ThreadLogRecord, ThreadSpanRecord, ObservabilityReader, ObservabilitySink } from "./observability.js";

export class PostgresObservabilitySink implements ObservabilitySink, ObservabilityReader {
  constructor(private readonly pool: Pool) {}

  async emitSpan(span: ThreadSpanRecord): Promise<void> {
    await this.pool.query(
      `insert into weave.observability_span(
         trace_id,
         span_id,
         parent_span_id,
         thread_id,
         event_id,
         correlation_id,
         causation_id,
         tool_call_id,
         tool_name,
         name,
         kind,
         status,
         started_at,
         ended_at,
         duration_ms,
         attributes_json
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (trace_id, span_id) do update
       set status = excluded.status,
           ended_at = excluded.ended_at,
           duration_ms = excluded.duration_ms,
           attributes_json = excluded.attributes_json`,
      [
        span.traceId,
        span.spanId,
        span.parentSpanId ?? null,
        span.threadId ?? null,
        span.eventId ?? null,
        span.correlationId ?? null,
        span.causationId ?? null,
        span.toolCallId ?? null,
        span.toolName ?? null,
        span.name,
        span.kind,
        span.status,
        span.startedAt,
        span.endedAt,
        span.durationMs,
        JSON.stringify(span.attributes ?? {}),
      ],
    );
  }

  async emitLog(record: ThreadLogRecord): Promise<void> {
    await this.pool.query(
      `insert into weave.observability_log(
         timestamp,
         level,
         message,
         trace_id,
         span_id,
         thread_id,
         event_id,
         correlation_id,
         causation_id,
         tool_call_id,
         tool_name,
         attributes_json
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.timestamp,
        record.level,
        record.message,
        record.traceId ?? null,
        record.spanId ?? null,
        record.threadId ?? null,
        record.eventId ?? null,
        record.correlationId ?? null,
        record.causationId ?? null,
        record.toolCallId ?? null,
        record.toolName ?? null,
        JSON.stringify(record.attributes ?? {}),
      ],
    );
  }

  async listSpans(threadId: string): Promise<ThreadSpanRecord[]> {
    const result = await this.pool.query(
      `select *
       from weave.observability_span
       where thread_id = $1
       order by started_at asc, span_id asc`,
      [threadId],
    );

    return result.rows.map((row) => ({
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      eventId: row.event_id ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      name: row.name,
      kind: row.kind,
      status: row.status,
      startedAt: toIso(row.started_at),
      endedAt: toIso(row.ended_at),
      durationMs: row.duration_ms,
      attributes: row.attributes_json,
    }));
  }

  async listLogs(threadId: string): Promise<ThreadLogRecord[]> {
    const result = await this.pool.query(
      `select *
       from weave.observability_log
       where thread_id = $1
       order by timestamp asc, id asc`,
      [threadId],
    );

    return result.rows.map((row) => ({
      timestamp: toIso(row.timestamp),
      level: row.level,
      message: row.message,
      traceId: row.trace_id ?? undefined,
      spanId: row.span_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      eventId: row.event_id ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      attributes: row.attributes_json,
    }));
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
