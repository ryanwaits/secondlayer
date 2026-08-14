import { ConsoleShell } from "@/components/console/shell";
import type { InstanceMeta } from "@/components/console/sidebar";
import { apiRequest } from "@/lib/api";
import { assertConsoleAccess } from "@/lib/gate";
import { InstanceMetaProvider } from "@/lib/instance-meta";
import { PreferencesProvider } from "@/lib/preferences";
import { QueryProvider } from "@/lib/queries/provider";
import type { HealthInfo, InstanceSummary } from "@/lib/types";

/**
 * Console chrome. No session — access is the token gate (proxy + the layout
 * backstop below), and identity is the instance itself: the sidebar footer
 * carries network · mode, image sha, and instance id from `/v1/instance` +
 * `/health`, and the topbar's network chip reads the same meta via context.
 * Both fetches are best-effort; an unreachable runtime renders dashes.
 */
export default async function ConsoleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await assertConsoleAccess();
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
				<InstanceMetaProvider meta={meta}>
					<ConsoleShell meta={meta}>{children}</ConsoleShell>
				</InstanceMetaProvider>
			</PreferencesProvider>
		</QueryProvider>
	);
}
