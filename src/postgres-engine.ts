import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AppendOptions,
  AppendResult,
  CreateThreadOptions,
  FollowCursor,
  InboxConsumer,
  InboxRoute,
  InboxRouteResolver,
  InboxWorkItem,
  Lease,
  ThreadEngine,
  ThreadLeaseStore,
  ReadOptions,
} from "./contracts.js";
import {
  SessionMetadataSchema,
  ThreadEventSchema,
  ThreadProjectionSchema,
  type ThreadEvent,
  type ThreadProjection,
  type ThreadStatus,
} from "./events.js";
import type {
  LatestChildReply,
  ListThreadHeadsOptions,
  ListThreadHealthSummariesOptions,
  ListThreadInboxItemsOptions,
  RecentEventsResult,
  ThreadHealthSummary,
  ThreadHeadRead,
  ThreadHeadReadWithDepth,
  ThreadInboxItem,
  ThreadInboxState,
  ThreadReadModel,
} from "./thread-query-service.js";

export type PostgresThreadEngineOptions = {
  inboxRoutes?: InboxRouteResolver;
};

export class PostgresThreadEngine implements ThreadEngine, ThreadLeaseStore, ThreadReadModel {
  constructor(
    private readonly pool: Pool,
    private readonly options: PostgresThreadEngineOptions = {},
  ) {}

  async createThread(threadId: string, options: CreateThreadOptions = {}): Promise<void> {
    await this.pool.query(
      `insert into weave.thread(
         id,
         status,
         next_seq,
         parent_thread_id,
         root_thread_id,
         parent_scope_key,
         parent_step_key
       )
       values ($1, 'idle', 0, $2, $3, $4, $5)
       on conflict (id) do nothing`,
      [
        threadId,
        options.parentThreadId ?? null,
        options.rootThreadId ?? threadId,
        options.parentScopeKey ?? null,
        options.parentStepKey ?? null,
      ],
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
      const thread = await client.query<{ next_seq: number; status: ThreadStatus }>(
        `select next_seq, status from weave.thread where id = $1 for update`,
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

      let nextStatus: ThreadStatus | undefined = threadRow.status;
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
      parent_thread_id: string | null;
      root_thread_id: string | null;
      parent_scope_key: string | null;
      parent_step_key: string | null;
    }>(
      `select
          m.id,
          m.status,
          m.next_seq,
          m.active_lease_owner_id,
          m.parent_thread_id,
          m.root_thread_id,
          m.parent_scope_key,
          m.parent_step_key,
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
      parentThreadId: row.parent_thread_id,
      rootThreadId: row.root_thread_id,
      parentScopeKey: row.parent_scope_key,
      parentStepKey: row.parent_step_key,
      updatedAt: row.updated_at.toISOString(),
    });
  }

  async getThreadHead(threadId: string): Promise<ThreadHeadRead | null> {
    const heads = await this.listThreadHeads({ limit: 1, threadId });
    return heads[0] ?? null;
  }

  async listThreadHeads(options: ListThreadHeadsOptions & { threadId?: string } = {}): Promise<ThreadHeadRead[]> {
    const { where, values } = threadHeadWhere(options);
    const orderBy = threadHeadOrderBy(options.orderBy);
    const limit = options.limit ?? 500;
    const result = await this.pool.query(
      `${THREAD_HEAD_SELECT}
       ${where}
       ${orderBy}
       limit $${values.length + 1}`,
      [...values, limit],
    );
    return result.rows.map(rowToThreadHead);
  }

  async countThreadHeads(options: ListThreadHeadsOptions & { threadId?: string } = {}): Promise<number> {
    const { where, values } = threadHeadWhere(options);
    const result = await this.pool.query<{ total: string }>(
      `select count(*)::text as total
       from weave.thread t
       ${where}`,
      values,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async listThreadAncestors(threadId: string): Promise<ThreadHeadReadWithDepth[]> {
    const result = await this.pool.query(
      `with recursive chain as (
         select id, parent_thread_id, 0 as depth from weave.thread where id = $1
         union all
         select t.id, t.parent_thread_id, c.depth + 1
         from weave.thread t join chain c on t.id = c.parent_thread_id
       )
       select
         t.id,
         t.status,
         t.parent_thread_id,
         coalesce(t.root_thread_id, t.id) as root_thread_id,
         t.parent_scope_key,
         t.parent_step_key,
         t.created_at,
         t.updated_at,
         se.payload_json->'metadata' as metadata_json,
         c.depth
       from chain c
       join weave.thread t on t.id = c.id
       left join lateral (
         select payload_json
         from weave.thread_event
         where thread_id = t.id and type = 'session.started'
         order by seq
         limit 1
       ) se on true
       order by c.depth asc`,
      [threadId],
    );
    return result.rows.map((row) => ({ ...rowToThreadHead(row), depth: Number(row.depth) }));
  }

  async listRecentEvents(options: {
    types: readonly ThreadEvent["type"][];
    limit?: number;
  }): Promise<RecentEventsResult> {
    if (options.types.length === 0) {
      return { events: [], total: 0 };
    }
    const result = await this.pool.query(
      `select *, count(*) over()::int as total
       from weave.thread_event
       where type = any($1::text[])
       order by occurred_at desc, thread_id asc, seq desc
       limit $2`,
      [options.types, options.limit ?? 100],
    );
    return {
      events: result.rows.map((row) => this.rowToEvent(row)),
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  async listLatestChildRepliesByMetadata(options: {
    parentThreadIds: readonly string[];
    metadata: Record<string, string>;
    statuses?: readonly ThreadStatus[];
  }): Promise<LatestChildReply[]> {
    if (options.parentThreadIds.length === 0) {
      return [];
    }
    const values: unknown[] = [options.parentThreadIds];
    const clauses = ["t.parent_thread_id = any($1::text[])"];
    if (options.statuses && options.statuses.length > 0) {
      values.push(options.statuses);
      clauses.push(`t.status = any($${values.length}::text[])`);
    }
    for (const [key, value] of Object.entries(options.metadata)) {
      values.push(key);
      const keyIndex = values.length;
      values.push(value);
      clauses.push(`se.payload_json->'metadata'->>$${keyIndex} = $${values.length}`);
    }
    const result = await this.pool.query<{
      parent_thread_id: string;
      child_thread_id: string;
      status: ThreadStatus;
      summary: string | null;
      event_id: string | null;
      occurred_at: Date | null;
      updated_at: Date;
    }>(
      `select distinct on (t.parent_thread_id)
         t.parent_thread_id,
         t.id as child_thread_id,
         t.status,
         reply.payload_json->>'message' as summary,
         reply.event_id::text as event_id,
         reply.occurred_at,
         t.updated_at
       from weave.thread t
       join lateral (
         select payload_json
         from weave.thread_event
         where thread_id = t.id and type = 'session.started'
         order by seq
         limit 1
       ) se on true
       left join lateral (
         select event_id, occurred_at, payload_json
         from weave.thread_event
         where thread_id = t.id and type in ('agent.reply.produced', 'agent.response.produced')
         order by seq desc
         limit 1
       ) reply on true
       where ${clauses.join(" and ")}
       order by t.parent_thread_id, t.updated_at desc`,
      values,
    );
    return result.rows.map((row) => ({
      parentThreadId: row.parent_thread_id,
      childThreadId: row.child_thread_id,
      status: row.status,
      summary: row.summary,
      eventId: row.event_id,
      occurredAt: row.occurred_at?.toISOString() ?? null,
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async listThreadInboxItems(options: ListThreadInboxItemsOptions = {}): Promise<ThreadInboxItem[]> {
    const { where, values } = threadInboxWhere(options);
    const result = await this.pool.query<{
      id: string;
      thread_id: string;
      consumer: InboxConsumer;
      event_seq: number;
      state: ThreadInboxState;
      attempts: number;
      visible_at: Date;
      claimed_by: string | null;
      claimed_until: Date | null;
      last_error_code: string | null;
      last_error_message: string | null;
      updated_at: Date;
    }>(
      `select
         id,
         thread_id,
         consumer,
         event_seq,
         state,
         attempts,
         visible_at,
         claimed_by,
         claimed_until,
         last_error_code,
         last_error_message,
         updated_at
       from weave.thread_inbox
       ${where}
       ${threadInboxOrderBy(options.orderBy)}
       limit $${values.length + 1}`,
      [...values, options.limit ?? 100],
    );
    return result.rows.map(rowToThreadInboxItem);
  }

  async countThreadInboxItems(options: ListThreadInboxItemsOptions = {}): Promise<number> {
    const { where, values } = threadInboxWhere(options);
    const result = await this.pool.query<{ total: string }>(
      `select count(*)::text as total
       from weave.thread_inbox
       ${where}`,
      values,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async listThreadHealthSummaries(options: ListThreadHealthSummariesOptions = {}): Promise<ThreadHealthSummary[]> {
    const { where, values } = threadHeadWhere(options);
    const latestEventTypes = options.latestEventTypes && options.latestEventTypes.length > 0 ? options.latestEventTypes : null;
    const latestTypeIndex = values.length + 1;
    const result = await this.pool.query<{
      id: string;
      status: ThreadStatus;
      parent_thread_id: string | null;
      root_thread_id: string | null;
      parent_scope_key: string | null;
      parent_step_key: string | null;
      created_at: Date;
      updated_at: Date;
      metadata_json: unknown;
      latest_event_type: ThreadEvent["type"] | null;
      latest_event_id: string | null;
      latest_event_occurred_at: Date | null;
      latest_payload_json: Record<string, unknown> | null;
    }>(
      `${threadHealthSummarySelect(latestTypeIndex)}
       ${where}
       ${threadHeadOrderBy(options.orderBy)}
       limit $${latestTypeIndex + 1}`,
      [...values, latestEventTypes, options.limit ?? 100],
    );
    return result.rows.map(rowToThreadHealthSummary);
  }

  async countThreadHealthSummaries(options: ListThreadHealthSummariesOptions = {}): Promise<number> {
    return this.countThreadHeads(options);
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

  async heartbeatInbox(ids: number[], ownerId: string, ttlMs: number): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.pool.query(
      `update weave.thread_inbox
       set claimed_until = now() + ($3 * interval '1 millisecond'),
           updated_at = now()
       where id = any($1::bigint[])
         and claimed_by = $2
         and state = 'claimed'`,
      [ids, ownerId, ttlMs],
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
      case "timer.scheduled":
      case "timer.fired":
      case "signal.waiting":
      case "signal.received":
      case "child_thread.spawned":
      case "child_thread.completed":
      case "child_thread.failed":
        if (currentStatus === "completed" || currentStatus === "failed") {
          return currentStatus;
        }
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
      case "agent.failed":
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
      case "agent.output.completed":
      case "agent.reply.produced":
      case "domain.event":
        return currentStatus;
    }
  }

  private async routeInboxEvent(
    client: PoolClient,
    threadId: string,
    seq: number,
    event: ThreadEvent,
  ): Promise<void> {
    const routes = [
      ...inboxRoutesForEvent(event),
      ...(this.options.inboxRoutes?.(event) ?? []),
    ].map(validateInboxRoute);

    for (const route of routes) {
      await client.query(
        `insert into weave.thread_inbox(thread_id, consumer, event_seq, state, visible_at)
         values ($1, $2, $3, 'pending', coalesce($4::timestamptz, now()))
         on conflict (thread_id, consumer, event_seq) do nothing`,
        [threadId, route.consumer, seq, route.visibleAt ?? null],
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

function inboxRoutesForEvent(event: ThreadEvent): InboxRoute[] {
  switch (event.type) {
    case "prompt.received":
    case "tool.completed":
    case "gate.resolved":
    case "timer.fired":
    case "signal.received":
    case "child_thread.spawned":
    case "child_thread.completed":
    case "child_thread.failed":
      return [{ consumer: "runner" }];
    case "timer.scheduled":
      return [{ consumer: "runner", visibleAt: event.payload.fireAt }];
    case "tool.requested":
      return [{ consumer: "tool-worker" }];
    case "session.started":
    case "runner.resumed":
    case "agent.step.started":
    case "agent.step.completed":
    case "agent.failed":
    case "checkpoint.completed":
    case "policy.evaluated":
    case "signal.waiting":
    case "tool.started":
    case "tool.progress":
    case "credential.requested":
    case "credential.resolved":
    case "credential.failed":
    case "tool.failed":
    case "gate.created":
    case "agent.response.produced":
    case "agent.reply.produced":
    case "agent.output.completed":
    case "domain.event":
    default:
      return [];
  }
}

function validateInboxRoute(route: InboxRoute): InboxRoute {
  if (!route.consumer || route.consumer.includes("\0")) {
    throw new Error("Inbox route consumer must be a non-empty string without NUL bytes");
  }
  return route;
}

const THREAD_HEAD_SELECT = `
  select
    t.id,
    t.status,
    t.parent_thread_id,
    coalesce(t.root_thread_id, t.id) as root_thread_id,
    t.parent_scope_key,
    t.parent_step_key,
    t.created_at,
    t.updated_at,
    se.payload_json->'metadata' as metadata_json
  from weave.thread t
  left join lateral (
    select payload_json
    from weave.thread_event
    where thread_id = t.id and type = 'session.started'
    order by seq
    limit 1
  ) se on true`;

function threadHealthSummarySelect(latestTypeIndex: number): string {
  return `
    select
      t.id,
      t.status,
      t.parent_thread_id,
      coalesce(t.root_thread_id, t.id) as root_thread_id,
      t.parent_scope_key,
      t.parent_step_key,
      t.created_at,
      t.updated_at,
      se.payload_json->'metadata' as metadata_json,
      le.latest_event_type,
      le.latest_event_id,
      le.latest_event_occurred_at,
      le.latest_payload_json
    from weave.thread t
    left join lateral (
      select payload_json
      from weave.thread_event
      where thread_id = t.id and type = 'session.started'
      order by seq
      limit 1
    ) se on true
    left join lateral (
      select type as latest_event_type,
             event_id::text as latest_event_id,
             occurred_at as latest_event_occurred_at,
             payload_json as latest_payload_json
      from weave.thread_event
      where thread_id = t.id
        and ($${latestTypeIndex}::text[] is null or type = any($${latestTypeIndex}::text[]))
      order by seq desc
      limit 1
    ) le on true`;
}

function threadHeadWhere(options: ListThreadHeadsOptions & { threadId?: string }): {
  where: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (options.threadId !== undefined) {
    values.push(options.threadId);
    clauses.push(`t.id = $${values.length}`);
  }
  if (options.parentThreadId !== undefined) {
    if (options.parentThreadId === null) {
      clauses.push("t.parent_thread_id is null");
    } else {
      values.push(options.parentThreadId);
      clauses.push(`t.parent_thread_id = $${values.length}`);
    }
  }
  if (options.parentThreadIdNotNull) {
    clauses.push("t.parent_thread_id is not null");
  }
  if (options.statuses && options.statuses.length > 0) {
    values.push(options.statuses);
    clauses.push(`t.status = any($${values.length}::text[])`);
  }
  if (options.updatedBefore) {
    values.push(options.updatedBefore);
    clauses.push(`t.updated_at < $${values.length}::timestamptz`);
  }
  return {
    where: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

function threadHeadOrderBy(orderBy: ListThreadHeadsOptions["orderBy"]): string {
  switch (orderBy) {
    case "created_asc":
      return "order by t.created_at asc";
    case "updated_asc":
      return "order by t.updated_at asc";
    case "updated_desc":
      return "order by t.updated_at desc";
    case "created_desc":
    default:
      return "order by t.created_at desc";
  }
}

function rowToThreadHead(row: {
  id: string;
  status: ThreadStatus;
  parent_thread_id: string | null;
  root_thread_id: string | null;
  parent_scope_key: string | null;
  parent_step_key: string | null;
  created_at: Date;
  updated_at: Date;
  metadata_json: unknown;
}): ThreadHeadRead {
  return {
    threadId: row.id,
    status: row.status,
    parentThreadId: row.parent_thread_id,
    rootThreadId: row.root_thread_id ?? row.id,
    parentScopeKey: row.parent_scope_key,
    parentStepKey: row.parent_step_key,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    metadata: row.metadata_json == null ? null : SessionMetadataSchema.parse(row.metadata_json),
  };
}

function threadInboxWhere(options: ListThreadInboxItemsOptions): {
  where: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (options.states && options.states.length > 0) {
    values.push(options.states);
    clauses.push(`state = any($${values.length}::text[])`);
  }
  if (options.consumers && options.consumers.length > 0) {
    values.push(options.consumers);
    clauses.push(`consumer = any($${values.length}::text[])`);
  }
  if (options.claimedUntilBefore) {
    values.push(options.claimedUntilBefore);
    clauses.push(`claimed_until < $${values.length}::timestamptz`);
  }
  if (options.visibleBefore) {
    values.push(options.visibleBefore);
    clauses.push(`visible_at < $${values.length}::timestamptz`);
  }
  if (options.updatedBefore) {
    values.push(options.updatedBefore);
    clauses.push(`updated_at < $${values.length}::timestamptz`);
  }
  return {
    where: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

function threadInboxOrderBy(orderBy: ListThreadInboxItemsOptions["orderBy"]): string {
  switch (orderBy) {
    case "id_desc":
      return "order by id desc";
    case "updated_asc":
      return "order by updated_at asc, id asc";
    case "updated_desc":
      return "order by updated_at desc, id desc";
    case "visible_asc":
      return "order by visible_at asc, id asc";
    case "id_asc":
    default:
      return "order by id asc";
  }
}

function rowToThreadInboxItem(row: {
  id: string;
  thread_id: string;
  consumer: InboxConsumer;
  event_seq: number;
  state: ThreadInboxState;
  attempts: number;
  visible_at: Date;
  claimed_by: string | null;
  claimed_until: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: Date;
}): ThreadInboxItem {
  return {
    id: Number(row.id),
    threadId: row.thread_id,
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
  };
}

function rowToThreadHealthSummary(row: {
  id: string;
  status: ThreadStatus;
  parent_thread_id: string | null;
  root_thread_id: string | null;
  parent_scope_key: string | null;
  parent_step_key: string | null;
  created_at: Date;
  updated_at: Date;
  metadata_json: unknown;
  latest_event_type: ThreadEvent["type"] | null;
  latest_event_id: string | null;
  latest_event_occurred_at: Date | null;
  latest_payload_json: Record<string, unknown> | null;
}): ThreadHealthSummary {
  const payload = row.latest_payload_json ?? {};
  return {
    ...rowToThreadHead(row),
    latestEventType: row.latest_event_type,
    latestEventId: row.latest_event_id,
    latestEventOccurredAt: row.latest_event_occurred_at?.toISOString() ?? null,
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null,
    message: typeof payload.message === "string" ? payload.message : null,
  };
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
