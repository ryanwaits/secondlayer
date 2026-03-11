export interface Action {
  id: string;
  label: string;
  keywords: string[];
  category: string;
  icon: string; // SVG path(s) key
  href?: string;
  shortcut?: string[];
}

export const actions: Action[] = [
  // Streams
  { id: "create-stream", label: "Create Stream", keywords: ["new", "add", "webhook"], category: "Streams", icon: "stream", href: "/streams/create" },
  { id: "list-streams", label: "List Streams", keywords: ["show", "all", "streams"], category: "Streams", icon: "stream", href: "/streams" },
  { id: "replay-failed", label: "Replay Failed Deliveries", keywords: ["retry", "resend", "failed"], category: "Streams", icon: "stream" },
  { id: "pause-stream", label: "Pause Stream", keywords: ["stop", "disable"], category: "Streams", icon: "stream" },

  // Views
  { id: "deploy-view", label: "Deploy View", keywords: ["create", "new", "index"], category: "Views", icon: "view", shortcut: ["⌘", "⇧", "V"] },
  { id: "list-views", label: "List Views", keywords: ["show", "all", "views"], category: "Views", icon: "view", href: "/views" },
  { id: "query-view", label: "Query View Table", keywords: ["data", "select", "rows"], category: "Views", icon: "view" },

  // API Keys
  { id: "create-key", label: "Create API Key", keywords: ["new", "add", "token"], category: "API Keys", icon: "key", shortcut: ["⌘", "⇧", "K"] },
  { id: "list-keys", label: "List API Keys", keywords: ["show", "all", "keys"], category: "API Keys", icon: "key", href: "/keys" },
  { id: "revoke-key", label: "Revoke API Key", keywords: ["delete", "remove", "disable"], category: "API Keys", icon: "key" },

  // Account
  { id: "view-usage", label: "View Usage", keywords: ["billing", "plan", "limits", "quota"], category: "Account", icon: "settings", href: "/usage" },
  { id: "settings", label: "Settings", keywords: ["account", "profile", "email"], category: "Account", icon: "settings", href: "/settings" },
  { id: "logout", label: "Log Out", keywords: ["sign out", "exit"], category: "Account", icon: "settings" },
];

export function getActionsByCategory(filtered: Action[]): Map<string, Action[]> {
  const map = new Map<string, Action[]>();
  for (const action of filtered) {
    const list = map.get(action.category) || [];
    list.push(action);
    map.set(action.category, list);
  }
  return map;
}
