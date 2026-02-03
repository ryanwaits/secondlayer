import { z } from "zod";
import { StreamFilterSchema } from "./filters.ts";

// Stream options schema
export const StreamOptionsSchema = z.object({
  // Include decoded Clarity values in webhook payload
  decodeClarityValues: z.boolean().default(true),
  // Include raw transaction hex in payload
  includeRawTx: z.boolean().default(false),
  // Include full block metadata
  includeBlockMetadata: z.boolean().default(true),
  // Rate limit: max webhooks per second
  rateLimit: z.number().int().positive().max(100).default(10),
  // Timeout for webhook delivery in ms
  timeoutMs: z.number().int().positive().max(30000).default(10000),
  // Max retry attempts for failed webhooks
  maxRetries: z.number().int().min(0).max(10).default(3),
});

// Create stream schema
export const CreateStreamSchema = z.object({
  name: z.string().min(1).max(255),
  webhookUrl: z.string().url(),
  // At least one filter required
  filters: z.array(StreamFilterSchema).min(1),
  // Optional settings
  options: StreamOptionsSchema.optional().default({}),
  // Optional: start processing from specific block (for backfill)
  startBlock: z.number().int().positive().optional(),
  // Optional: stop processing at specific block
  endBlock: z.number().int().positive().optional(),
});

// Update stream schema (all fields optional)
export const UpdateStreamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  webhookUrl: z.string().url().optional(),
  filters: z.array(StreamFilterSchema).min(1).optional(),
  options: StreamOptionsSchema.partial().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

// Webhook payload schema (what gets sent to the user's endpoint)
export const WebhookPayloadSchema = z.object({
  // Stream metadata
  streamId: z.string().uuid(),
  streamName: z.string(),

  // Block metadata
  block: z.object({
    height: z.number(),
    hash: z.string(),
    parentHash: z.string(),
    burnBlockHeight: z.number(),
    timestamp: z.number(),
  }),

  // Matched data
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

  // Metadata
  isBackfill: z.boolean(),
  deliveredAt: z.string().datetime(),
});

// Stream response schema (what API returns)
// Stream metrics schema
export const StreamMetricsSchema = z.object({
  totalDeliveries: z.number(),
  failedDeliveries: z.number(),
  lastTriggeredAt: z.string().datetime().nullable(),
  lastTriggeredBlock: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

// Stream response schema (what API returns)
export const StreamResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(["inactive", "active", "paused", "failed"]),
  webhookUrl: z.string().url(),
  filters: z.array(StreamFilterSchema),
  options: StreamOptionsSchema,

  // Metrics (joined from stream_metrics)
  totalDeliveries: z.number().int().default(0),
  failedDeliveries: z.number().int().default(0),
  lastTriggeredAt: z.string().datetime().nullable().optional(),
  lastTriggeredBlock: z.number().int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Type exports
export type StreamOptions = z.infer<typeof StreamOptionsSchema>;
export type CreateStream = z.infer<typeof CreateStreamSchema>;
export type UpdateStream = z.infer<typeof UpdateStreamSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type StreamResponse = z.infer<typeof StreamResponseSchema>;
export type StreamMetricsResponse = z.infer<typeof StreamMetricsSchema>;

// API response types
export interface CreateStreamResponse {
  stream: StreamResponse;
  webhookSecret: string;
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
