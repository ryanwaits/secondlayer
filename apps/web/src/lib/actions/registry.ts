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
  // Navigation
  { id: "home", label: "Home", keywords: ["dashboard", "overview"], category: "Navigation", icon: "home", href: "/" },
  { id: "streams", label: "Streams", keywords: ["webhooks", "events", "list"], category: "Navigation", icon: "stream", href: "/streams" },
  { id: "views", label: "Views", keywords: ["tables", "indexes", "data"], category: "Navigation", icon: "view", href: "/views" },
  { id: "api-keys", label: "API Keys", keywords: ["tokens", "keys", "auth"], category: "Navigation", icon: "key", href: "/api-keys" },
  { id: "usage", label: "Usage", keywords: ["quota", "limits", "metrics"], category: "Navigation", icon: "settings", href: "/usage" },
  { id: "billing", label: "Billing", keywords: ["plan", "payment", "invoice"], category: "Navigation", icon: "settings", href: "/billing" },
  { id: "settings", label: "Settings", keywords: ["account", "profile", "email"], category: "Navigation", icon: "settings", href: "/settings" },

  // Account
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
