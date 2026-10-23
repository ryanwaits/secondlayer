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

const CREDITS = "https://secondlayer.tools/account#usage";
const BALANCE_FOOTNOTE =
	"You get this because balance alerts are on. Turn them off on your credits page.";
const CAP_FOOTNOTE =
	"You set this cap. Change it or turn it off on your credits page.";
const STACK_STOPS =
	"Your hosted stack stops at $0. Webhooks hold events instead of delivering, and subgraphs pause indexing, until you add credits.";
const WEBHOOK_FOOTNOTE =
	"One email per outage. If it recovers and fails again, we'll email again.";
const REINDEX_FOOTNOTE =
	"You get this because reindex emails are on for your account.";

const examples: Record<string, ReturnType<typeof renderEmail>> = {
	"sign-in-code": renderEmail({
		heading: "Your sign-in code",
		preheader: "Expires in 15 minutes.",
		paragraphs: [
			"Enter this code where you started signing in, or use the button.",
		],
		code: "482913",
		status: { tone: "neutral", text: "Expires in 15 minutes" },
		cta: {
			label: "Sign in to secondlayer",
			url: "https://secondlayer.tools/auth/verify?token=example-token",
		},
		footnote:
			"Didn't ask to sign in? Ignore this email. Nobody gets in without this code or link.",
	}),

	"balance-low": renderEmail({
		heading: "About 6 days of credit left",
		preheader: "$3.20 left at $0.52/day. Runs out around Oct 24.",
		paragraphs: [STACK_STOPS],
		facts: [
			{ label: "Balance", value: "$3.20" },
			{ label: "Spending", value: "$0.52/day" },
			{ label: "Runs out around", value: "Oct 24" },
		],
		figure: "credits",
		status: { tone: "neutral", text: "Low balance" },
		cta: { label: "Add credits", url: CREDITS },
		footnote: BALANCE_FOOTNOTE,
	}),

	"balance-crit": renderEmail({
		heading: "Under 2 days of credit left",
		preheader: "$0.45 left at $0.52/day. Runs out around Oct 19.",
		paragraphs: [STACK_STOPS],
		facts: [
			{ label: "Balance", value: "$0.45" },
			{ label: "Spending", value: "$0.52/day" },
			{ label: "Runs out around", value: "Oct 19" },
			{ label: "Runs out in about", value: "18 hours" },
		],
		figure: "credits",
		status: { tone: "neutral", text: "Critical balance" },
		cta: { label: "Add credits", url: CREDITS },
		footnote: BALANCE_FOOTNOTE,
	}),

	"balance-stopped": renderEmail({
		heading: "Your hosted stack stopped",
		preheader: "Balance reached $0. Events are held, nothing is lost.",
		paragraphs: [
			"Your balance reached $0. Webhook events are held and go out after you add credits. Subgraphs pick up where they left off.",
			"Everything restarts within 5 minutes of a top-up.",
		],
		facts: [
			{ label: "Balance", value: "$0.00" },
			{ label: "Stopped at", value: "Oct 19 14:32 UTC" },
		],
		figure: "credits",
		status: { tone: "alarm", text: "Stopped" },
		cta: { label: "Add credits", url: CREDITS },
		footnote: BALANCE_FOOTNOTE,
	}),

	"spend-cap-threshold": renderEmail({
		heading: "You've used 80% of your monthly cap",
		preheader: "$8.00 of $10.00. Resets Nov 1.",
		paragraphs: [
			"At the cap, hosted Index and Streams reads past your free 1M rows pause and your hosted stack stops until Nov 1, or until you raise it.",
		],
		facts: [
			{ label: "Spent this month", value: "$8.00" },
			{ label: "Cap", value: "$10.00" },
			{ label: "Resets", value: "Nov 1" },
		],
		figure: "spend cap",
		status: { tone: "neutral", text: "80% of cap" },
		cta: { label: "Change your cap", url: `${CREDITS}#cap` },
		footnote: CAP_FOOTNOTE,
	}),

	"spend-cap-frozen": renderEmail({
		heading: "You reached your monthly cap",
		preheader: "Hosted stack paused until Nov 1. Your balance is untouched.",
		paragraphs: [
			"Hosted Index and Streams reads past your free 1M rows are paused. Your hosted stack stops within minutes: webhooks hold events and subgraphs pause.",
			"Both resume Nov 1, or as soon as you raise the cap. Your balance is untouched.",
		],
		facts: [
			{ label: "Spent this month", value: "$10.00" },
			{ label: "Cap", value: "$10.00" },
			{ label: "Resets", value: "Nov 1" },
		],
		figure: "spend cap",
		status: { tone: "neutral", text: "Cap reached, paused" },
		cta: { label: "Raise your cap", url: `${CREDITS}#cap` },
		footnote: CAP_FOOTNOTE,
	}),

	"top-up-declined": renderEmail({
		heading: "Auto top-up is off",
		preheader: "We won't retry. Add credits or update your card.",
		paragraphs: [
			"We tried to add $25.00 to your balance and your card was declined. We turned auto top-up off and won't try again.",
			"Add credits or update your card, then turn it back on.",
		],
		facts: [{ label: "Refill", value: "$25.00" }],
		figure: "auto top-up",
		status: { tone: "alarm", text: "Card declined" },
		cta: { label: "Add credits", url: CREDITS },
		footnote: "You get this because auto top-up was on.",
	}),

	"webhook-incident-one": renderEmail({
		heading: `"whale-alerts" can't reach your server`,
		preheader:
			"Failing since Oct 18, 09:05 UTC. Events are safe, we keep retrying.",
		paragraphs: [
			"Every delivery to hooks.acme.dev has failed since Oct 18, 09:05 UTC. Your events are safe: we retry for up to 3 days before anything moves to dead letters.",
			"Once your server answers, queued deliveries go out on their own.",
		],
		facts: [
			{ label: "Webhook", value: "whale-alerts" },
			{ label: "Receiver", value: "hooks.acme.dev" },
			{ label: "Failing since", value: "Oct 18, 09:05 UTC" },
			{ label: "Failed attempts in a row", value: "37" },
			{ label: "Last error", value: "connect ECONNREFUSED 443" },
		],
		figure: "webhook · whale-alerts",
		status: { tone: "alarm", text: "Failing" },
		cta: {
			label: "Open the webhook",
			url: "https://secondlayer.tools/account/webhooks/example-id",
		},
		footnote: WEBHOOK_FOOTNOTE,
	}),

	"reindex-complete-clean": renderEmail({
		heading: "my-subgraph finished reindexing",
		preheader: "128,402 blocks, 54,910 events, no errors.",
		paragraphs: ["It's serving queries from the new data now."],
		facts: [
			{ label: "Blocks", value: "128,402" },
			{ label: "Events", value: "54,910" },
			{ label: "Errors", value: "0" },
		],
		figure: "subgraph · my-subgraph",
		status: { tone: "ok", text: "Complete, no errors" },
		cta: {
			label: "Open the subgraph",
			url: "https://secondlayer.tools/account/subgraphs/my-subgraph",
		},
		footnote: REINDEX_FOOTNOTE,
	}),

	"reindex-complete-errors": renderEmail({
		heading: "my-subgraph finished with 3 errors",
		preheader: "128,402 blocks, 54,910 events, 3 handler errors.",
		paragraphs: [
			"3 events failed in your handlers. Everything else is indexed.",
		],
		facts: [
			{ label: "Blocks", value: "128,402" },
			{ label: "Events", value: "54,910" },
			{ label: "Errors", value: "3" },
		],
		figure: "subgraph · my-subgraph",
		status: { tone: "alarm", text: "Complete, 3 errors" },
		cta: {
			label: "See the errors",
			url: "https://secondlayer.tools/account/subgraphs/my-subgraph",
		},
		footnote: REINDEX_FOOTNOTE,
	}),

	"contact-request": renderEmail({
		heading: "New contact request",
		preheader: "We're moving off our own indexer and want history from genesis",
		paragraphs: [],
		quote:
			"We're moving off our own indexer and want history from genesis plus webhooks for our sBTC flows. Can we talk volume pricing?",
		figure: "contact · ctc_7a91b2",
		facts: [
			{ label: "Name", value: "Dana Ortiz" },
			{ label: "Email", value: "dana@acme.dev" },
			{ label: "Company", value: "Acme Labs" },
			{ label: "Volume", value: "10M+ rows/mo" },
			{ label: "From page", value: "/pricing" },
			{ label: "Reference", value: "ctc_7a91b2" },
		],
		footnote: "Reply to this email to answer Dana.",
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
