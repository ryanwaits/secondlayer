import { SecondLayer } from "@secondlayer/sdk";
import type { Command } from "commander";
import { httpPlatformAnon } from "../lib/http.ts";
import {
	type ContextExplanation,
	type PublicStatus,
	explainContextNulls,
} from "../lib/instance-diagnosis.ts";
import { error as logError, note, output, writeData } from "../lib/output.ts";
import {
	isOssMode,
	resolveApiUrl,
	resolveEnvKey,
} from "../lib/resolve-auth.ts";

export function registerContextCommand(program: Command): void {
	program
		.command("context")
		.description(
			"Print an agent orientation snapshot: account, live Streams/Index tips, your subgraphs/subscriptions, and in-flight reindex operations",
		)
		.option("--json", "Print as JSON (default)")
		.action(async (o: { json?: boolean }) => {
			try {
				const apiUrl = resolveApiUrl();
				const apiKey = resolveEnvKey();
				const sl = new SecondLayer({ baseUrl: apiUrl, apiKey });
				const snapshot = await sl.context();

				// The SDK degrades each read to `null`, so an all-null snapshot reads
				// the same whether the instance is unbootstrapped, unauthorized, or
				// down. Probe once and say which it is.
				const diagnostics = await explain(
					snapshot as unknown as Record<string, unknown>,
					apiUrl,
					apiKey,
				);
				const payload = { ...snapshot, diagnostics };

				output({
					json: o.json,
					data: payload,
					human: () => {
						writeData(JSON.stringify(payload, null, 2));
						if (diagnostics) note(diagnostics.summary);
					},
				});
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});
}

/** `null` when nothing is null — a full snapshot needs no explanation. */
async function explain(
	snapshot: Record<string, unknown>,
	apiUrl: string,
	apiKey: string | undefined,
): Promise<ContextExplanation | null> {
	const hasNull = Object.values(snapshot).some((v) => (v ?? null) === null);
	if (!hasNull) return null;

	let status: PublicStatus | null = null;
	let statusError: string | undefined;
	try {
		status = await httpPlatformAnon<PublicStatus>("/public/status");
	} catch (err) {
		statusError = err instanceof Error ? err.message : String(err);
	}

	return explainContextNulls(snapshot, {
		apiUrl,
		selfHosted: isOssMode(),
		hasCredential: Boolean(apiKey),
		status,
		statusError,
	});
}
