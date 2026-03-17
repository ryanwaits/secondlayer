// Query key factory — single source of truth for cache keys
export const queryKeys = {
  streams: {
    all: ["streams"] as const,
    detail: (id: string) => ["streams", id] as const,
    deliveries: (id: string) => ["streams", id, "deliveries"] as const,
  },
  views: {
    all: ["views"] as const,
    detail: (name: string) => ["views", name] as const,
  },
  keys: {
    all: ["keys"] as const,
  },
  status: ["status"] as const,
};
