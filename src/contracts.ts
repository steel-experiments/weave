import type { ThreadEvent, ThreadProjection } from "./events.js";

export type AppendOptions = {
  expectedTailSeq?: number;
  idempotencyKey?: string;
};

export type AppendResult = {
  firstSeq: number;
  lastSeq: number;
};

export type ReadOptions = {
  fromSeq?: number;
  limit?: number;
};

export type FollowCursor = {
  fromSeq?: number;
  tail?: boolean;
};

export type Lease = {
  threadId: string;
  ownerId: string;
  token: string;
  expiresAt: string;
};

export type InboxConsumer = "runner" | "tool-worker";

export type InboxWorkItem = {
  id: number;
  threadId: string;
  consumer: InboxConsumer;
  eventSeq: number;
  attempts: number;
};

export interface ThreadEngine {
  createThread(threadId: string): Promise<void>;
  append(events: ThreadEvent[], options?: AppendOptions): Promise<AppendResult>;
  read(threadId: string, options?: ReadOptions): Promise<ThreadEvent[]>;
  follow(threadId: string, cursor?: FollowCursor): AsyncIterable<ThreadEvent>;
  getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: string }>;
  getProjection(threadId: string): Promise<ThreadProjection | null>;
}

export interface ThreadLeaseStore {
  acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease | null>;
  renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease>;
  releaseLease(threadId: string, token: string): Promise<void>;
}
