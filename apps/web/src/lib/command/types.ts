// ── Command palette AI types ──

export type PaletteMode =
  | "actions"
  | "action"
  | "thinking"
  | "confirm"
  | "code"
  | "info"
  | "success"
  | "error";

export interface CommandRequest {
  query: string;
  context: {
    path: string;
    resourceIds?: string[];
  };
}

// Discriminated union for AI responses
export type CommandResponse =
  | CommandActionResponse
  | CommandConfirmResponse
  | CommandCodeResponse
  | CommandInfoResponse;

export interface CommandActionResponse {
  type: "action";
  actionId: string;
  params?: Record<string, unknown>;
}

export interface ConfirmResource {
  name: string;
  meta?: string;
  status?: "green" | "red" | "yellow";
}

export interface CommandConfirmResponse {
  type: "confirm";
  title: string;
  description?: string;
  resources: ConfirmResource[];
  destructive: boolean;
  apiCalls: ApiCall[];
}

export interface CommandCodeResponse {
  type: "code";
  title: string;
  code: string;
  lang: string;
}

export interface CommandInfoResponse {
  type: "info";
  title: string;
  markdown: string;
  docUrl?: string;
}

export interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}
