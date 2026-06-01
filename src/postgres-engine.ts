import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AppendOptions,
  AppendResult,
  FollowCursor,
  InboxConsumer,
  InboxWorkItem,
  Lease,
  ThreadEngine,
  ThreadLeaseStore,
  ReadOptions,
} from "./contracts.js";
import {
  ThreadEventSchema,
  ThreadProjectionSchema,
  type ThreadEvent,
  type ThreadProjection,
  type ThreadStatus,
} from "./events.js";

export class PostgresThreadEngine implements ThreadEngine, ThreadLeaseStore {
  constructor(private readonly pool: Pool) {}

  async createThread(threadId: string): Promise<void> {
    await this.pool.query(
      `insert into weave.thread(id, status, next_seq)
       values ($1, 'idle', 0)
       on conflict (id) do nothing`,
      [threadId],
    );
  }

  async append(events: ThreadEvent[], options: AppendOptions = {}): Promise<AppendResult> {
    if (events.length === 0) {
      throw new Error("Cannot append an empty event batch");
    }

    const parsedEvents = events.map((event) => ThreadEventSchema.parse(event));
    const firstEvent = parsedEvents[0];
    if (!firstEvent) {
      throw new Error("Thread id is required");
    }
    const threadId = firstEvent.threadId;

    for (const event of parsedEvents) {
      if (event.threadId !== threadId) {
        throw new Error("All appended events must belong to the same thread");
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const thread = await client.query<{ next_seq: number }>(
        `select next_seq from weave.thread where id = $1 for update`,
        [threadId],
      );

      if (thread.rowCount !== 1) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      const threadRow = thread.rows[0];
      if (!threadRow) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      const firstSeq = threadRow.next_seq;
      if (options.expectedTailSeq !== undefined && options.expectedTailSeq !== firstSeq) {
        throw new Error(`Expected tail ${options.expectedTailSeq}, found ${firstSeq}`);
      }

      let nextStatus: ThreadStatus | undefined;
      for (const [index, event] of parsedEvents.entries()) {
        const seq = firstSeq + index;
        await client.query(
          `insert into weave.thread_event(
             thread_id,
             seq,
             event_id,
             type,
             occurred_at,
              correlation_id,
              causation_id,
              idempotency_key,
              scope_key,
              step_key,
              actor_type,
              actor_id,
              payload_json
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            threadId,
            seq,
            event.eventId,
            event.type,
            event.occurredAt,
            event.correlationId ?? null,
            event.causationId ?? null,
            event.idempotencyKey ?? null,
            event.scopeKey ?? null,
            event.stepKey ?? null,
            event.actor.type,
            event.actor.id,
            JSON.stringify(event.payload),
          ],
        );

        await this.routeInboxEvent(client, threadId, seq, event);

        nextStatus = await this.applyProjectionSideEffects(client, threadId, event, nextStatus);
      }

      await client.query(
        `update weave.thread
         set next_seq = $2,
             status = coalesce($3, status),
             updated_at = now()
         where id = $1`,
        [threadId, firstSeq + parsedEvents.length, nextStatus ?? null],
      );

      await client.query("commit");

      return {
        firstSeq,
        lastSeq: firstSeq + parsedEvents.length - 1,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async read(threadId: string, options: ReadOptions = {}): Promise<ThreadEvent[]> {
    const fromSeq = options.fromSeq ?? 0;
    const limit = options.limit ?? 1000;
    const result = await this.pool.query(
      `select *
       from weave.thread_event
       where thread_id = $1 and seq >= $2
       order by seq asc
       limit $3`,
      [threadId, fromSeq, limit],
    );

    return result.rows.map((row) => this.rowToEvent(row));
  }

  async *follow(threadId: string, cursor: FollowCursor = {}): AsyncIterable<ThreadEvent> {
    let nextSeq = cursor.tail ? (await this.getTail(threadId)).tailSeq : (cursor.fromSeq ?? 0);

    while (true) {
      const events = await this.read(threadId, { fromSeq: nextSeq, limit: 100 });
      if (events.length === 0) {
        await sleep(100);
        continue;
      }

      for (const event of events) {
        nextSeq = (event.seq ?? nextSeq) + 1;
        yield event;
      }
    }
  }

  async getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: string }> {
    const result = await this.pool.query<{ next_seq: number; updated_at: Date }>(
      `select next_seq, updated_at from weave.thread where id = $1`,
      [threadId],
    );

    if (result.rowCount !== 1) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return {
      tailSeq: result.rows[0]?.next_seq ?? 0,
      updatedAt: result.rows[0]?.updated_at.toISOString() ?? new Date(0).toISOString(),
    };
  }

  async getProjection(threadId: string): Promise<ThreadProjection | null> {
    const result = await this.pool.query<{
      id: string;
      status: ThreadStatus;
      next_seq: number;
      active_lease_owner_id: string | null;
      updated_at: Date;
      pending_gate_ids: string[] | null;
    }>(
      `select
         m.id,
         m.status,
         m.next_seq,
         m.active_lease_owner_id,
         m.updated_at,
         coalesce(array_agg(g.gate_id::text) filter (where g.gate_id is not null), '{}') as pending_gate_ids
       from weave.thread m
       left join weave.thread_gate g
         on g.thread_id = m.id and g.status = 'pending'
       where m.id = $1
       group by m.id`,
      [threadId],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return ThreadProjectionSchema.parse({
      threadId: row.id,
      status: row.status,
      tailSeq: row.next_seq,
      activeLeaseOwnerId: row.active_lease_owner_id,
      pendingGateIds: row.pending_gate_ids ?? [],
      updatedAt: row.updated_at.toISOString(),
    });
  }

  async claimInbox(consumer: InboxConsumer, ownerId: string, limit = 20, ttlMs = 10_000): Promise<InboxWorkItem[]> {
    const result = await this.pool.query<{
      id: string;
      thread_id: string;
      consumer: InboxConsumer;
      event_seq: number;
      attempts: number;
    }>(
      `with candidates as (
         select id
         from weave.thread_inbox
         where consumer = $1
           and visible_at <= now()
           and (
             state = 'pending'
             or (state = 'claimed' and claimed_until <= now())
           )
         order by id asc
         limit $2
         for update skip locked
       )
       update weave.thread_inbox inbox
       set state = 'claimed',
           claimed_by = $3,
           claimed_until = now() + ($4 * interval '1 millisecond'),
           attempts = attempts + 1,
           updated_at = now()
       from candidates
       where inbox.id = candidates.id
       returning inbox.id, inbox.thread_id, inbox.consumer, inbox.event_seq, inbox.attempts`,
      [consumer, limit, ownerId, ttlMs],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      threadId: row.thread_id,
      consumer: row.consumer,
      eventSeq: row.event_seq,
      attempts: row.attempts,
    }));
  }

  async completeInbox(ids: number[], ownerId: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.pool.query(
      `update weave.thread_inbox
       set state = 'done',
           claimed_until = null,
           updated_at = now()
       where id = any($1::bigint[])
         and claimed_by = $2`,
      [ids, ownerId],
    );
  }

  async deadLetterInbox(
    ids: number[],
    ownerId: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.pool.query(
      `update weave.thread_inbox
       set state = 'dead-letter',
           claimed_until = null,
           last_error_code = $3,
           last_error_message = $4,
           updated_at = now()
       where id = any($1::bigint[])
         and claimed_by = $2`,
      [ids, ownerId, errorCode ?? null, errorMessage ?? null],
    );
  }

  async listInbox(threadId: string): Promise<
    Array<{
      id: number;
      consumer: InboxConsumer;
      eventSeq: number;
      state: string;
      attempts: number;
      visibleAt: string;
      claimedBy: string | null;
      claimedUntil: string | null;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
      updatedAt: string;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      consumer: InboxConsumer;
      event_seq: number;
      state: string;
      attempts: number;
      visible_at: Date;
      claimed_by: string | null;
      claimed_until: Date | null;
      last_error_code: string | null;
      last_error_message: string | null;
      updated_at: Date;
    }>(
      `select *
       from weave.thread_inbox
       where thread_id = $1
       order by id asc`,
      [threadId],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      consumer: row.consumer,
      eventSeq: row.event_seq,
      state: row.state,
      attempts: row.attempts,
      visibleAt: row.visible_at.toISOString(),
      claimedBy: row.claimed_by,
      claimedUntil: row.claimed_until?.toISOString() ?? null,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease | null> {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await client.query(
        `delete from weave.thread_lease
         where thread_id = $1 and expires_at <= now()`,
        [threadId],
      );

      const result = await client.query<{ thread_id: string; owner_id: string; token: string; expires_at: Date }>(
        `insert into weave.thread_lease(thread_id, owner_id, token, expires_at)
         values ($1, $2, $3, $4)
         on conflict (thread_id) do nothing
         returning *`,
        [threadId, ownerId, token, expiresAt],
      );

      if (result.rowCount !== 1) {
        await client.query("rollback");
        return null;
      }

      await client.query(
        `update weave.thread
         set active_lease_owner_id = $2, updated_at = now()
         where id = $1`,
        [threadId, ownerId],
      );

      await client.query("commit");
      const row = result.rows[0];
      if (!row) {
        throw new Error(`Lease insert failed for thread ${threadId}`);
      }

      return leaseFromRow(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const result = await this.pool.query<{ thread_id: string; owner_id: string; token: string; expires_at: Date }>(
      `update weave.thread_lease
       set expires_at = $3
       where thread_id = $1 and token = $2 and expires_at > now()
       returning *`,
      [threadId, token, expiresAt],
    );

    if (result.rowCount !== 1) {
      throw new Error(`Lease not renewable for thread ${threadId}`);
    }

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Lease not renewable for thread ${threadId}`);
    }

    return leaseFromRow(row);
  }

  async releaseLease(threadId: string, token: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ owner_id: string }>(
        `delete from weave.thread_lease
         where thread_id = $1 and token = $2
         returning owner_id`,
        [threadId, token],
      );

      if (result.rowCount === 1) {
        await client.query(
          `update weave.thread
           set active_lease_owner_id = null, updated_at = now()
           where id = $1`,
          [threadId],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyProjectionSideEffects(
    client: PoolClient,
    threadId: string,
    event: ThreadEvent,
    currentStatus: ThreadStatus | undefined,
  ): Promise<ThreadStatus | undefined> {
    switch (event.type) {
      case "session.started":
        return currentStatus ?? "idle";
      case "prompt.received":
      case "tool.requested":
      case "tool.completed":
      case "gate.resolved":
        if (event.type === "gate.resolved") {
          await client.query(
            `update weave.thread_gate
             set status = 'resolved', resolved_at = now(), resolution_json = $3
             where thread_id = $1 and gate_id = $2`,
            [threadId, event.payload.gateId, JSON.stringify(event.payload)],
          );
        }
        return "waiting";
      case "runner.resumed":
        return "running";
      case "gate.created":
        await client.query(
          `insert into weave.thread_gate(gate_id, thread_id, status, gate_type)
           values ($1, $2, 'pending', $3)`,
          [event.payload.gateId, threadId, event.payload.gateType],
        );
        return "blocked";
      case "tool.failed":
        return "failed";
      case "agent.response.produced":
        return "completed";
      case "tool.started":
      case "tool.progress":
      case "credential.requested":
      case "credential.resolved":
      case "credential.failed":
      case "agent.step.started":
      case "agent.step.completed":
      case "checkpoint.completed":
      case "agent.finding.produced":
      case "agent.remediation.proposed":
      case "agent.incident_report.produced":
        return currentStatus;
    }
  }

  private async routeInboxEvent(
    client: PoolClient,
    threadId: string,
    seq: number,
    event: ThreadEvent,
  ): Promise<void> {
    const consumers = consumersForEvent(event);

    for (const consumer of consumers) {
      await client.query(
        `insert into weave.thread_inbox(thread_id, consumer, event_seq, state)
         values ($1, $2, $3, 'pending')
         on conflict (thread_id, consumer, event_seq) do nothing`,
        [threadId, consumer, seq],
      );
    }
  }

  private rowToEvent(row: Record<string, unknown>): ThreadEvent {
    const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at);
    return ThreadEventSchema.parse({
      eventId: row.event_id,
      threadId: row.thread_id,
      seq: row.seq,
      type: row.type,
      occurredAt,
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      scopeKey: row.scope_key ?? undefined,
      stepKey: row.step_key ?? undefined,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
      },
      payload: row.payload_json,
    });
  }
}

function consumersForEvent(event: ThreadEvent): InboxConsumer[] {
  switch (event.type) {
    case "prompt.received":
    case "tool.completed":
    case "gate.resolved":
      return ["runner"];
    case "tool.requested":
      return ["tool-worker"];
    case "session.started":
    case "runner.resumed":
    case "agent.step.started":
    case "agent.step.completed":
    case "checkpoint.completed":
    case "tool.started":
    case "tool.progress":
    case "credential.requested":
    case "credential.resolved":
    case "credential.failed":
    case "tool.failed":
    case "gate.created":
    case "agent.response.produced":
    case "agent.finding.produced":
    case "agent.remediation.proposed":
    case "agent.incident_report.produced":
      return [];
  }
}

function leaseFromRow(row: { thread_id: string; owner_id: string; token: string; expires_at: Date }): Lease {
  return {
    threadId: row.thread_id,
    ownerId: row.owner_id,
    token: row.token,
    expiresAt: row.expires_at.toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
