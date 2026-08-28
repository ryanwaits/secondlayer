import {
	type ContextField,
	type ContextFieldError,
	SecondLayer,
} from "@secondlayer/sdk";
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

				// Flatten the SDK's `{ value, error? }` fields: the printed snapshot
				// keeps one key per field, and every failed read lands under
				// `errors` with the code and status the API answered with.
				const values: Record<string, unknown> = {};
				const errors: Record<string, ContextFieldError> = {};
				for (const [field, entry] of Object.entries(snapshot) as Array<
					[string, ContextField<unknown>]
				>) {
					values[field] = entry.value;
					if (entry.error) errors[field] = entry.error;
				}

				// A null still reads the same whether the instance is
				// unbootstrapped, unauthorized, or down. Probe once and say which.
				const diagnostics = await explain(values, apiUrl, apiKey);
				const payload = {
					...values,
					...(Object.keys(errors).length > 0 ? { errors } : {}),
					diagnostics,
				};

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
