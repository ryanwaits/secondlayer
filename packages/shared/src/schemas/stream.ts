import { z } from "zod/v4";
import { StreamFilterSchema, type StreamFilter } from "./filters.ts";

// ── Type interfaces ──────────────────────────────────────────────────

export interface StreamOptions {
  decodeClarityValues: boolean;
  includeRawTx: boolean;
  includeBlockMetadata: boolean;
  rateLimit: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface CreateStream {
  name: string;
  endpointUrl: string;
  filters: StreamFilter[];
  options?: StreamOptions;
  startBlock?: number;
  endBlock?: number;
}

export interface UpdateStream {
  name?: string;
  endpointUrl?: string;
  filters?: StreamFilter[];
  options?: Partial<StreamOptions>;
}

export interface DeliveryPayload {
  streamId: string;
  streamName: string;
  block: {
    height: number;
    hash: string;
    parentHash: string;
    burnBlockHeight: number;
    timestamp: number;
  };
  matches: {
    transactions: Array<{
      txId: string;
      type: string;
      sender: string;
      status: string;
      contractId: string | null;
      functionName: string | null;
      rawTx?: string;
    }>;
    events: Array<{
      txId: string;
      eventIndex: number;
      type: string;
      data?: any;
    }>;
  };
  isBackfill: boolean;
  deliveredAt: string;
}

export interface StreamMetricsResponse {
  totalDeliveries: number;
  failedDeliveries: number;
  lastTriggeredAt: string | null;
  lastTriggeredBlock: number | null;
  errorMessage: string | null;
}

export interface StreamResponse {
  id: string;
  name: string;
  status: "inactive" | "active" | "paused" | "failed";
  endpointUrl: string;
  filters: StreamFilter[];
  options: StreamOptions;
  totalDeliveries: number;
  failedDeliveries: number;
  lastTriggeredAt?: string | null;
  lastTriggeredBlock?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Zod schemas ──────────────────────────────────────────────────────

// Stream options schema (internal, keeps ZodObject methods like .partial())
const streamOptionsShape = z.object({
  decodeClarityValues: z.boolean().default(true),
  includeRawTx: z.boolean().default(false),
  includeBlockMetadata: z.boolean().default(true),
  rateLimit: z.number().int().positive().max(100).default(10),
  timeoutMs: z.number().int().positive().max(30000).default(10000),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

// Cast: .default() makes _input fields optional, but output type matches StreamOptions
export const StreamOptionsSchema: z.ZodType<StreamOptions> =
  streamOptionsShape as unknown as z.ZodType<StreamOptions>;

export const CreateStreamSchema: z.ZodType<CreateStream> = z.object({
  name: z.string().min(1).max(255),
  endpointUrl: z.string().url(),
  filters: z.array(StreamFilterSchema).min(1),
  options: streamOptionsShape.optional().default(undefined),
  startBlock: z.number().int().positive().optional(),
  endBlock: z.number().int().positive().optional(),
}) as unknown as z.ZodType<CreateStream>;

export const UpdateStreamSchema: z.ZodType<UpdateStream> = z.object({
  name: z.string().min(1).max(255).optional(),
  endpointUrl: z.string().url().optional(),
  filters: z.array(StreamFilterSchema).min(1).optional(),
  options: streamOptionsShape.partial().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
) as unknown as z.ZodType<UpdateStream>;

export const DeliveryPayloadSchema: z.ZodType<DeliveryPayload> = z.object({
  streamId: z.string().uuid(),
  streamName: z.string(),
  block: z.object({
    height: z.number(),
    hash: z.string(),
    parentHash: z.string(),
    burnBlockHeight: z.number(),
    timestamp: z.number(),
  }),
  matches: z.object({
    transactions: z.array(z.object({
      txId: z.string(),
      type: z.string(),
      sender: z.string(),
      status: z.string(),
      contractId: z.string().nullable(),
      functionName: z.string().nullable(),
      rawTx: z.string().optional(),
    })),
    events: z.array(z.object({
      txId: z.string(),
      eventIndex: z.number(),
      type: z.string(),
      data: z.any(),
    })),
  }),
  isBackfill: z.boolean(),
  deliveredAt: z.string().datetime(),
}) as unknown as z.ZodType<DeliveryPayload>;

export const StreamMetricsSchema: z.ZodType<StreamMetricsResponse> = z.object({
  totalDeliveries: z.number(),
  failedDeliveries: z.number(),
  lastTriggeredAt: z.string().datetime().nullable(),
  lastTriggeredBlock: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export const StreamResponseSchema: z.ZodType<StreamResponse> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(["inactive", "active", "paused", "failed"]),
  endpointUrl: z.string().url(),
  filters: z.array(StreamFilterSchema),
  options: streamOptionsShape,
  totalDeliveries: z.number().int().default(0),
  failedDeliveries: z.number().int().default(0),
  lastTriggeredAt: z.string().datetime().nullable().optional(),
  lastTriggeredBlock: z.number().int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}) as unknown as z.ZodType<StreamResponse>;

// API response types
export interface CreateStreamResponse {
  stream: StreamResponse;
  signingSecret: string;
}

export interface ListStreamsResponse {
  streams: StreamResponse[];
  total: number;
}

export interface BulkPauseResponse {
  paused: number;
  streams: StreamResponse[];
}

export interface BulkResumeResponse {
  resumed: number;
  streams: StreamResponse[];
}
