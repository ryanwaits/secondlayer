import { z } from "zod";

// ── Deploy Subgraph Request ─────────────────────────────────────────────────

export interface DeploySubgraphRequest {
  name: string;
  version?: string;
  description?: string;
  sources: string[];
  schema: Record<string, unknown>;
  handlerCode: string;
  reindex?: boolean;
}

export const DeploySubgraphRequestSchema: z.ZodType<DeploySubgraphRequest> = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only").max(63),
  version: z.string().optional(),
  description: z.string().optional(),
  sources: z.array(z.string()).min(1),
  schema: z.record(z.unknown()),
  handlerCode: z.string().max(1_048_576, "handler code exceeds 1MB limit"),
  reindex: z.boolean().optional(),
});

export interface DeploySubgraphResponse {
  action: "created" | "unchanged" | "updated" | "reindexed";
  subgraphId: string;
  message: string;
}

// Subgraph API response types

export interface SubgraphSummary {
  name: string;
  version: string;
  status: string;
  lastProcessedBlock: number;
  tables: string[];
  createdAt: string;
}

export interface SubgraphDetail {
  name: string;
  version: string;
  status: string;
  lastProcessedBlock: number;
  health: {
    totalProcessed: number;
    totalErrors: number;
    errorRate: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  tables: Record<string, {
    endpoint: string;
    columns: Record<string, { type: string; nullable?: boolean }>;
    rowCount: number;
    example: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ReindexResponse {
  message: string;
  fromBlock: number;
  toBlock: number | string;
}

export interface SubgraphQueryParams {
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  fields?: string;
  filters?: Record<string, string>;
}
