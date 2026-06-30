import type { InboxConsumer, ReadOptions, ThreadEngine } from "./contracts.js";
import type { SessionMetadata, ThreadEvent, ThreadStatus } from "./events.js";

export type ThreadHeadRead = {
  threadId: string;
  status: ThreadStatus;
  parentThreadId: string | null;
  rootThreadId: string;
  parentScopeKey: string | null;
  parentStepKey: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: SessionMetadata | null;
};

export type ThreadHeadReadWithDepth = ThreadHeadRead & { depth: number };

export type ListThreadHeadsOptions = {
  parentThreadId?: string | null;
  parentThreadIdNotNull?: boolean;
  statuses?: readonly ThreadStatus[];
  updatedBefore?: string;
  orderBy?: "created_asc" | "created_desc" | "updated_asc" | "updated_desc";
  limit?: number;
};

export type RecentEventsResult = {
  events: ThreadEvent[];
  total: number;
};

export type LatestChildReply = {
  parentThreadId: string;
  childThreadId: string;
  status: ThreadStatus;
  summary: string | null;
  eventId: string | null;
  occurredAt: string | null;
  updatedAt: string;
};

export type ListThreadEventsOptions = {
  threadId: string;
  types?: readonly ThreadEvent["type"][];
  cursor?: string | null;
  limit?: number;
};

export type ThreadEventPage = {
  events: ThreadEvent[];
  nextCursor: string | null;
};

export type ThreadInboxState = "pending" | "claimed" | "done" | "dead-letter";

export type ThreadInboxItem = {
  id: number;
  threadId: string;
  consumer: InboxConsumer;
  eventSeq: number;
  state: ThreadInboxState;
  attempts: number;
  visibleAt: string;
  claimedBy: string | null;
  claimedUntil: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
};

export type ListThreadInboxItemsOptions = {
  states?: readonly ThreadInboxState[];
  consumers?: readonly InboxConsumer[];
  claimedUntilBefore?: string;
  visibleBefore?: string;
  updatedBefore?: string;
  orderBy?: "id_asc" | "id_desc" | "updated_asc" | "updated_desc" | "visible_asc";
  limit?: number;
};

export type ThreadHealthSummary = ThreadHeadRead & {
  latestEventType: ThreadEvent["type"] | null;
  latestEventId: string | null;
  latestEventOccurredAt: string | null;
  errorCode: string | null;
  message: string | null;
};

export type ListThreadHealthSummariesOptions = ListThreadHeadsOptions & {
  threadId?: string;
  latestEventTypes?: readonly ThreadEvent["type"][];
};

export interface ThreadReadModel extends Pick<ThreadEngine, "read"> {
  getThreadHead(threadId: string): Promise<ThreadHeadRead | null>;
  listThreadHeads(options?: ListThreadHeadsOptions & { threadId?: string }): Promise<ThreadHeadRead[]>;
  countThreadHeads(options?: ListThreadHeadsOptions & { threadId?: string }): Promise<number>;
  listThreadAncestors(threadId: string): Promise<ThreadHeadReadWithDepth[]>;
  listRecentEvents(options: {
    types: readonly ThreadEvent["type"][];
    limit?: number;
  }): Promise<RecentEventsResult>;
  listLatestChildRepliesByMetadata(options: {
    parentThreadIds: readonly string[];
    metadata: Record<string, string>;
    statuses?: readonly ThreadStatus[];
  }): Promise<LatestChildReply[]>;
  listThreadInboxItems(options?: ListThreadInboxItemsOptions): Promise<ThreadInboxItem[]>;
  countThreadInboxItems(options?: ListThreadInboxItemsOptions): Promise<number>;
  listThreadHealthSummaries(options?: ListThreadHealthSummariesOptions): Promise<ThreadHealthSummary[]>;
  countThreadHealthSummaries(options?: ListThreadHealthSummariesOptions): Promise<number>;
}

export class ThreadQueryService {
  constructor(private readonly readModel: ThreadReadModel) {}

  getThreadHead(threadId: string): Promise<ThreadHeadRead | null> {
    return this.readModel.getThreadHead(threadId);
  }

  listThreadHeads(options: ListThreadHeadsOptions & { threadId?: string } = {}): Promise<ThreadHeadRead[]> {
    return this.readModel.listThreadHeads(options);
  }

  countThreadHeads(options: ListThreadHeadsOptions & { threadId?: string } = {}): Promise<number> {
    return this.readModel.countThreadHeads(options);
  }

  listThreadAncestors(threadId: string): Promise<ThreadHeadReadWithDepth[]> {
    return this.readModel.listThreadAncestors(threadId);
  }

  listRecentEvents(options: {
    types: readonly ThreadEvent["type"][];
    limit?: number;
  }): Promise<RecentEventsResult> {
    return this.readModel.listRecentEvents(options);
  }

  listLatestChildRepliesByMetadata(options: {
    parentThreadIds: readonly string[];
    metadata: Record<string, string>;
    statuses?: readonly ThreadStatus[];
  }): Promise<LatestChildReply[]> {
    return this.readModel.listLatestChildRepliesByMetadata(options);
  }

  listThreadInboxItems(options: ListThreadInboxItemsOptions = {}): Promise<ThreadInboxItem[]> {
    return this.readModel.listThreadInboxItems(options);
  }

  countThreadInboxItems(options: ListThreadInboxItemsOptions = {}): Promise<number> {
    return this.readModel.countThreadInboxItems(options);
  }

  listThreadHealthSummaries(options: ListThreadHealthSummariesOptions = {}): Promise<ThreadHealthSummary[]> {
    return this.readModel.listThreadHealthSummaries(options);
  }

  countThreadHealthSummaries(options: ListThreadHealthSummariesOptions = {}): Promise<number> {
    return this.readModel.countThreadHealthSummaries(options);
  }

  async listThreadEvents(options: ListThreadEventsOptions): Promise<ThreadEventPage> {
    const limit = normalizeThreadEventLimit(options.limit);
    const types = options.types && options.types.length > 0 ? new Set<ThreadEvent["type"]>(options.types) : null;
    const pageSize = 1000;
    const events: ThreadEvent[] = [];
    let fromSeq = decodeThreadEventCursor(options.cursor);

    for (;;) {
      const page = await this.readModel.read(options.threadId, { fromSeq, limit: pageSize } satisfies ReadOptions);
      if (page.length === 0) {
        return { events, nextCursor: null };
      }

      for (const [index, event] of page.entries()) {
        const nextSeq = nextSeqAfter(event, fromSeq);
        fromSeq = nextSeq;
        if (!types || types.has(event.type)) {
          events.push(event);
          if (events.length === limit) {
            return {
              events,
              nextCursor: index === page.length - 1 && page.length < pageSize ? null : encodeThreadEventCursor(nextSeq),
            };
          }
        }
      }

      if (page.length < pageSize) {
        return { events, nextCursor: null };
      }
    }
  }
}

function normalizeThreadEventLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Thread event page limit must be an integer between 1 and 1000");
  }
  return limit;
}

function nextSeqAfter(event: ThreadEvent, fallbackFromSeq: number): number {
  return event.seq === undefined ? fallbackFromSeq + 1 : event.seq + 1;
}

function encodeThreadEventCursor(nextSeq: number): string {
  return Buffer.from(JSON.stringify({ v: 1, nextSeq }), "utf8").toString("base64url");
}

function decodeThreadEventCursor(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      nextSeq?: unknown;
    };
    if (parsed.v !== 1 || !Number.isInteger(parsed.nextSeq) || Number(parsed.nextSeq) < 0) {
      throw new Error("invalid cursor payload");
    }
    return Number(parsed.nextSeq);
  } catch {
    throw new Error("Invalid thread event cursor");
  }
}
