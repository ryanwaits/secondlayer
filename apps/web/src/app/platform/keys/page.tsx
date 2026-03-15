import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { ApiKey, AccountInsight } from "@/lib/types";
import { KeysList } from "./keys-list";

export default async function KeysPage() {
  const session = await getSessionFromCookies();
  let keys: ApiKey[] = [];
  let insights: AccountInsight[] = [];

  if (session) {
    try {
      const data = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
        sessionToken: session,
      });
      keys = data.keys;
    } catch {}

    try {
      const data = await apiRequest<{ insights: AccountInsight[] }>(
        "/api/insights?category=key",
        { sessionToken: session },
      );
      insights = data.insights;
    } catch {}
  }

  return <KeysList initialKeys={keys} insights={insights} sessionToken={session ?? ""} />;
}
