export interface Account {
  id: string;
  email: string;
  plan: string;
  createdAt: string;
}

export interface StreamOptions {
  decodeClarityValues?: boolean;
  includeRawTx?: boolean;
  includeBlockMetadata?: boolean;
  rateLimit?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface Stream {
  id: string;
  name: string;
  status: "inactive" | "active" | "paused" | "failed";
  enabled: boolean;
  webhookUrl: string;
  webhookSecret?: string;
  filters: unknown[];
  options: StreamOptions;
  totalDeliveries: number;
  failedDeliveries: number;
  lastTriggeredAt: string | null;
  lastTriggeredBlock: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Delivery {
  id: string;
  blockHeight: number;
  status: string;
  statusCode: number;
  responseTimeMs: number;
  attempts: number;
  error: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ViewSummary {
  name: string;
  version: string;
  status: string;
  lastProcessedBlock: number | null;
  tables: string[];
  createdAt: string;
}

export interface ViewDetail {
  name: string;
  health: {
    totalProcessed: number;
    totalErrors: number;
    errorRate: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  tables: Record<
    string,
    {
      rowCount: number;
      endpoint: string;
      columns: Record<string, unknown>;
      example: unknown;
    }
  >;
}
