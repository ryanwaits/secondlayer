import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { ApiKey } from "@/lib/types";
import { KeysList } from "./keys-list";

export default async function KeysPage() {
	const session = await getSessionFromCookies();
	let keys: ApiKey[] = [];

	if (session) {
		try {
			const data = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
				sessionToken: session,
				tags: ["keys"],
			});
			keys = data.keys;
		} catch {}
	}

	return (
		<>
			<OverviewTopbar path="Settings" page="API Keys" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<KeysList initialKeys={keys} sessionToken={session ?? ""} />
				</div>
			</div>
		</>
	);
}
