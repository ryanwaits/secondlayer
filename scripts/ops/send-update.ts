#!/usr/bin/env bun
/**
 * Send a post or launch email to confirmed updates-list subscribers.
 *
 * Usage:
 *   bun scripts/ops/send-update.ts --file <email.json> --dry-run
 *   bun scripts/ops/send-update.ts --file <email.json> --to you@example.com
 *   bun scripts/ops/send-update.ts --file <email.json> --send
 *
 *   --dry-run  count recipients and already-sent, write an HTML preview; no sends
 *   --to       send ONE "[test]" email (real token if the address is on the
 *              list); writes nothing to update_sends
 *   --send     email every confirmed subscriber with no update_sends row for
 *              the file's `key`; re-running skips everyone already sent
 *
 * Env: TARGET_DATABASE_URL or DATABASE_URL (required);
 *      RESEND_API_KEY (required for --send and --to).
 * Exit codes: 0 ok, 1 some sends failed, 2 bad usage, bad file or missing env.
 * Writes only update_sends rows, and only under --send.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type RenderEmailInput,
	UPDATES_FROM,
	renderEmail,
	sendEmail,
	unsubscribeFor,
} from "@secondlayer/shared/email";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

const FOOTNOTE =
	"You get these because you subscribed at secondlayer.tools/blog.";
const SEND_INTERVAL_MS = 600;
const PLACEHOLDER_TOKEN = "preview";

const REQUIRED = ["key", "subject", "heading", "cta"] as const;
const PASSTHROUGH = [
	"preheader",
	"paragraphs",
	"facts",
	"figure",
	"figureNote",
	"status",
	"excerpt",
] as const;

export type EmailFile = {
	key: string;
	subject: string;
	heading: string;
	cta: { label: string; url: string };
} & Partial<Pick<RenderEmailInput, (typeof PASSTHROUGH)[number]>>;

export function parseEmailFile(raw: unknown): EmailFile {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error("email file must be a JSON object");
	}
	const obj = raw as Record<string, unknown>;
	const allowed = new Set<string>([...REQUIRED, ...PASSTHROUGH]);
	for (const k of Object.keys(obj)) {
		if (!allowed.has(k)) throw new Error(`unknown field: ${k}`);
	}
	for (const k of ["key", "subject", "heading"] as const) {
		if (typeof obj[k] !== "string" || obj[k] === "") {
			throw new Error(`${k} is required (string)`);
		}
	}
	if (!/^[a-z0-9-]{3,80}$/.test(obj.key as string)) {
		throw new Error("key must match /^[a-z0-9-]{3,80}$/");
	}
	const cta = obj.cta as Record<string, unknown> | undefined;
	if (
		typeof cta !== "object" ||
		cta === null ||
		typeof cta.url !== "string" ||
		cta.url === "" ||
		typeof cta.label !== "string" ||
		cta.label === ""
	) {
		throw new Error("cta.label and cta.url are required (strings)");
	}
	return obj as unknown as EmailFile;
}

export function buildEmail(file: EmailFile, token: string) {
	const unsubscribe = unsubscribeFor(token);
	const { key: _key, subject, ...input } = file;
	const { html, text } = renderEmail({
		...input,
		paragraphs: file.paragraphs ?? [],
		footnote: FOOTNOTE,
		unsubscribeUrl: unsubscribe.url,
	});
	return { subject, html, text, headers: unsubscribe.headers };
}

type Args = {
	file: string;
	mode: "dry-run" | "send" | "to";
	to: string | null;
};

export function parseArgs(argv: string[]): Args {
	let file: string | null = null;
	let to: string | null = null;
	const modes: Array<Args["mode"]> = [];
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${flag} needs a value`);
			return v;
		};
		switch (flag) {
			case "--file":
				file = value();
				break;
			case "--to":
				to = value();
				modes.push("to");
				break;
			case "--dry-run":
				modes.push("dry-run");
				break;
			case "--send":
				modes.push("send");
				break;
			default:
				throw new Error(`unknown flag: ${flag}`);
		}
	}
	if (!file) throw new Error("--file <email.json> is required");
	if (modes.length !== 1) {
		throw new Error("pass exactly one of --dry-run, --to <email>, --send");
	}
	return { file, mode: modes[0] as Args["mode"], to };
}

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

async function main() {
	let args: Args;
	let file: EmailFile;
	try {
		args = parseArgs(process.argv.slice(2));
		file = parseEmailFile(await Bun.file(args.file).json());
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}
	const url = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
	if (!url) fail("no db: set TARGET_DATABASE_URL or DATABASE_URL");
	if (args.mode !== "dry-run" && !process.env.RESEND_API_KEY) {
		fail("no RESEND_API_KEY: export it to send");
	}

	const client = postgres(url, { max: 1 });
	try {
		const db = new Kysely<Record<string, never>>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		if (args.mode === "dry-run") {
			const counts = await sql<{ recipients: string; already_sent: string }>`
				SELECT count(*) AS recipients,
				       count(s.subscriber_id) AS already_sent
				FROM update_subscribers u
				LEFT JOIN update_sends s
				  ON s.subscriber_id = u.id AND s.send_key = ${file.key}
				WHERE u.status = 'confirmed'
			`.execute(db);
			const row = counts.rows[0];
			const preview = join(tmpdir(), `send-update-${file.key}.html`);
			await Bun.write(preview, buildEmail(file, PLACEHOLDER_TOKEN).html);
			console.log(
				`recipients=${row?.recipients ?? 0} already_sent=${row?.already_sent ?? 0} preview=${preview}`,
			);
			return;
		}

		if (args.mode === "to") {
			const to = args.to as string;
			const found = await sql<{ token: string }>`
				SELECT token FROM update_subscribers WHERE email = ${to} LIMIT 1
			`.execute(db);
			const email = buildEmail(file, found.rows[0]?.token ?? PLACEHOLDER_TOKEN);
			const result = await sendEmail({
				to,
				subject: `[test] ${email.subject}`,
				html: email.html,
				text: email.text,
				from: UPDATES_FROM,
				headers: email.headers,
			});
			console.log(result.skipped ? "skipped (no RESEND_API_KEY)" : "sent test");
			return;
		}

		const pending = await sql<{ id: string; email: string; token: string }>`
			SELECT u.id, u.email, u.token
			FROM update_subscribers u
			WHERE u.status = 'confirmed'
			  AND NOT EXISTS (
			    SELECT 1 FROM update_sends s
			    WHERE s.subscriber_id = u.id AND s.send_key = ${file.key}
			  )
			ORDER BY u.created_at
		`.execute(db);
		const total = await sql<{ n: string }>`
			SELECT count(*) AS n FROM update_subscribers WHERE status = 'confirmed'
		`.execute(db);
		const skippedAlreadySent =
			Number(total.rows[0]?.n ?? 0) - pending.rows.length;

		let sent = 0;
		let failed = 0;
		for (const sub of pending.rows) {
			try {
				const email = buildEmail(file, sub.token);
				const result = await sendEmail({
					to: sub.email,
					subject: email.subject,
					html: email.html,
					text: email.text,
					from: UPDATES_FROM,
					headers: email.headers,
				});
				if (result.skipped) throw new Error("send skipped");
				await sql`
					INSERT INTO update_sends (send_key, subscriber_id)
					VALUES (${file.key}, ${sub.id})
					ON CONFLICT DO NOTHING
				`.execute(db);
				sent++;
				if (sent % 25 === 0) console.log(`sent ${sent}/${pending.rows.length}`);
			} catch (err) {
				failed++;
				console.error(
					`failed subscriber=${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			await Bun.sleep(SEND_INTERVAL_MS);
		}
		console.log(
			`sent=${sent} failed=${failed} skipped_already_sent=${skippedAlreadySent}`,
		);
		if (failed > 0) process.exitCode = 1;
	} finally {
		await client.end();
	}
}

if (import.meta.main) await main();
