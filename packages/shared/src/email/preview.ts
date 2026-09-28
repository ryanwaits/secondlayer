import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEmail } from "./render.ts";

/**
 * Writes every customer email (example values, current copy) as .html + .txt
 * pairs into `email-previews/` at the repo root, so they can be opened and
 * reviewed without sending anything. Not a test — the examples below mirror
 * the `renderEmail()` calls in each sender file; keep them in sync by hand
 * when that copy changes.
 *
 * Run with: `bun run packages/shared/src/email/preview.ts`
 */

const OUT_DIR = join(import.meta.dir, "../../../../email-previews");

const examples: Record<string, ReturnType<typeof renderEmail>> = {
	"login-code": renderEmail({
		heading: "Your login code",
		paragraphs: ["Or click below to sign in directly:"],
		code: "482913",
		cta: {
			label: "Sign in to secondlayer",
			url: "https://secondlayer.tools/verify?token=example-token",
		},
		footnote:
			"This expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
	}),

	"balance-low": renderEmail({
		heading: "About 6 days of credit left",
		paragraphs: [
			"Your delivery service stops when your balance reaches $0, and webhooks stop delivering until you add credits.",
		],
		facts: [
			{ label: "Balance", value: "$3.20" },
			{ label: "Spending", value: "$0.52/day" },
			{ label: "Runs out around", value: "Oct 4" },
		],
		cta: {
			label: "Add credits",
			url: "https://secondlayer.tools/account/credits",
		},
		footnote:
			"You get this because balance alerts are on. Turn them off on your credits page.",
	}),

	"balance-crit": renderEmail({
		heading: "Under 2 days of credit left",
		paragraphs: [
			"Your delivery service stops when your balance reaches $0, and webhooks stop delivering until you add credits.",
		],
		facts: [
			{ label: "Balance", value: "$0.45" },
			{ label: "Spending", value: "$0.52/day" },
			{ label: "Runs out around", value: "Sep 29" },
			{ label: "Runs out in about", value: "18 hours" },
		],
		cta: {
			label: "Add credits",
			url: "https://secondlayer.tools/account/credits",
		},
		footnote:
			"You get this because balance alerts are on. Turn them off on your credits page.",
	}),

	"balance-stopped": renderEmail({
		heading: "Your delivery service stopped",
		paragraphs: [
			"Your balance reached $0, so your delivery service stopped. Webhook events are held while it's stopped and delivered after you add credits. It starts again within 5 minutes of a top-up.",
		],
		facts: [
			{ label: "Balance", value: "$0.00" },
			{ label: "Stopped at", value: "Sep 28 14:32 UTC" },
		],
		cta: {
			label: "Add credits",
			url: "https://secondlayer.tools/account/credits",
		},
		footnote:
			"You get this because balance alerts are on. Turn them off on your credits page.",
	}),

	"spend-cap-threshold": renderEmail({
		heading: "You've used 80% of your monthly spend cap",
		paragraphs: [
			"Your spend on hosted Index and Streams reads past your free 1M rows is $8.00 this month, 80% of your $10.00 cap. Once you reach the cap, those reads keep working without a charge until Oct 1 or until you raise your cap. Webhooks and your delivery service aren't affected.",
		],
		facts: [
			{ label: "Spent this month", value: "$8.00" },
			{ label: "Cap", value: "$10.00" },
			{ label: "Resets", value: "Oct 1" },
		],
		cta: {
			label: "Change your cap",
			url: "https://secondlayer.tools/account/credits#cap",
		},
	}),

	"spend-cap-frozen": renderEmail({
		heading: "You reached your monthly spend cap",
		paragraphs: [
			"Your spend on hosted Index and Streams reads past your free 1M rows reached your $10.00 cap. Those reads keep working without a charge until Oct 1 or until you raise your cap. Your balance is untouched, and webhooks and your delivery service keep running.",
		],
		facts: [
			{ label: "Spent this month", value: "$10.00" },
			{ label: "Cap", value: "$10.00" },
			{ label: "Resets", value: "Oct 1" },
		],
		cta: {
			label: "Raise your cap",
			url: "https://secondlayer.tools/account/credits#cap",
		},
	}),

	"reindex-complete-clean": renderEmail({
		heading: "Reindex complete: my-subgraph",
		paragraphs: [
			'Your subgraph "my-subgraph" finished reindexing: 128,402 blocks, 54,910 events, no errors.',
		],
	}),

	"reindex-complete-errors": renderEmail({
		heading: "Reindex complete: my-subgraph",
		paragraphs: [
			'Your subgraph "my-subgraph" finished reindexing: 128,402 blocks, 54,910 events, 3 errors.',
		],
	}),
};

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	for (const [name, { html, text }] of Object.entries(examples)) {
		await writeFile(join(OUT_DIR, `${name}.html`), html);
		await writeFile(join(OUT_DIR, `${name}.txt`), text);
	}
	console.log(
		`Wrote ${Object.keys(examples).length} email previews to ${OUT_DIR}`,
	);
}

main();
