/**
 * Factory adapter: Secondlayer feedback tickets, read through the ops script
 * (scripts/ops/feedback-queue.ts, SELECT only). Customers and first-party
 * (Dogfood, Sentinel) accounts are two separate calls.
 */
import { z } from "zod";

type Incoming = {
	kind: "new";
	id: string;
	project: string;
	title?: string;
	body: string;
	requester: { name: string; ref?: string };
};
type Exec = (
	argv: string[],
	opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string; ms: number }>;
type Adapter = { name: string; pull(ctx: { exec: Exec }): Promise<Incoming[]> };

// Mirrors TicketRow in scripts/ops/feedback-queue.ts. Unknown keys allowed.
const RowSchema = z.object({
	id: z.string(),
	intent: z.string(),
	expected: z.unknown().optional(),
	kind_hint: z.string().nullable().optional(),
	evidence: z.unknown().optional(),
	attempted: z
		.object({
			method: z.string().optional(),
			path: z.string().optional(),
			status: z.number().optional(),
			code: z.string().optional(),
		})
		.nullable()
		.optional(),
	origin: z.string().nullable().optional(),
	status: z.string().optional(),
	route: z.string().nullable().optional(),
	classification: z
		.object({ reason: z.string().nullable().optional() })
		.nullable()
		.optional(),
	created_at: z.string(),
});
export type FeedbackRow = z.infer<typeof RowSchema>;

const DEFAULT_ROUTES = ["human", "schema_gap", "docs", "decode_fixture"];

const text = (v: unknown): string =>
	v == null ? "(none)" : typeof v === "string" ? v : JSON.stringify(v);

export function toIncoming(
	row: FeedbackRow,
	project: string,
	internal: boolean,
): Incoming {
	const a = row.attempted;
	const attempted = a
		? `${a.method ?? "?"} ${a.path ?? "?"} -> ${a.status ?? "?"}${a.code ? ` ${a.code}` : ""}`
		: "(none)";
	const reason = row.classification?.reason;
	const body = [
		row.intent,
		"",
		`Expected: ${text(row.expected)}`,
		`Kind hint: ${row.kind_hint || "(none)"}`,
		`Route: ${row.route ?? "(none)"}${reason ? ` (${reason})` : ""}`,
		`Evidence: ${text(row.evidence)}`,
		`Attempted: ${attempted}`,
		`Ticket: ${row.id}, filed ${row.created_at}, origin ${row.origin ?? "(none)"}`,
	].join("\n");
	return {
		kind: "new",
		id: row.id,
		project,
		title: (row.intent.split("\n")[0] ?? "").slice(0, 80),
		body,
		requester: {
			name: internal ? "dogfood" : "feedback",
			...(row.origin ? { ref: row.origin } : {}),
		},
	};
}

export function secondlayerFeedback(opts: {
	repo: string;
	project: string;
	routes?: string[];
	since?: number;
	skipTicketIds?: string[];
}): Adapter {
	const routes = new Set(opts.routes ?? DEFAULT_ROUTES);
	const skip = new Set(opts.skipTicketIds ?? []);
	const since = String(opts.since ?? 365);

	return {
		name: "secondlayer-feedback",
		async pull(ctx) {
			const out: Incoming[] = [];
			for (const internal of [false, true]) {
				const argv = [
					"bun",
					"scripts/ops/feedback-queue.ts",
					"--json",
					"--status",
					"classified",
					"--since",
					since,
					"--limit",
					"1000",
					...(internal ? ["--internal"] : []),
				];
				const r = await ctx.exec(argv, { cwd: opts.repo, timeoutMs: 60_000 });
				if (r.exitCode !== 0) {
					const tail = r.stderr.trim().split("\n").slice(-3).join("\n");
					throw new Error(
						r.exitCode === 2 && /no db/.test(r.stderr)
							? "feedback-queue failed (2): set TARGET_DATABASE_URL"
							: `feedback-queue failed (${r.exitCode}): ${tail}`,
					);
				}
				const rows = z.array(RowSchema).parse(JSON.parse(r.stdout));
				for (const row of rows) {
					if (!row.route || !routes.has(row.route) || skip.has(row.id))
						continue;
					out.push(toIncoming(row, opts.project, internal));
				}
			}
			return out;
		},
	};
}
