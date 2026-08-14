import { ConsoleShell } from "@/components/console/shell";
import type { InstanceMeta } from "@/components/console/sidebar";
import { apiRequest } from "@/lib/api";
import { PreferencesProvider } from "@/lib/preferences";
import { QueryProvider } from "@/lib/queries/provider";
import { TopbarProvider } from "@/lib/topbar-context";
import type { HealthInfo, InstanceSummary } from "@/lib/types";

/**
 * Console chrome. No session check — access is the token gate in middleware,
 * and identity is the instance itself: the sidebar footer carries
 * network · mode, image sha, and instance id from `/v1/instance` + `/health`.
 * Both fetches are best-effort; an unreachable runtime renders dashes.
 */
export default async function ConsoleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [instanceResult, healthResult] = await Promise.allSettled([
		apiRequest<InstanceSummary>("/v1/instance"),
		apiRequest<HealthInfo>("/health"),
	]);
	const instance =
		instanceResult.status === "fulfilled" ? instanceResult.value : null;
	const health =
		healthResult.status === "fulfilled" ? healthResult.value : null;

	const meta: InstanceMeta = {
		network: instance?.network ?? null,
		mode: instance?.mode ?? null,
		imageSha: health?.image_sha ?? null,
		instanceId: instance?.instance_id ?? null,
	};

	return (
		<QueryProvider>
			<PreferencesProvider>
				<TopbarProvider>
					<ConsoleShell meta={meta}>{children}</ConsoleShell>
				</TopbarProvider>
			</PreferencesProvider>
		</QueryProvider>
	);
}
