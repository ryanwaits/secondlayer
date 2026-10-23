/**
 * Every push string, and the rule to preference map, in one place. Pure: no
 * I/O. Copy says what happened and what it means, in plain words, with no em
 * dashes. URLs are same-origin paths the service worker opens.
 */
import { utcTime } from "@secondlayer/shared/insights";
import type { PushKind } from "../db/queries/push.ts";
import type { PushPayload } from "./send.ts";

/**
 * Which platform (account) insight rules push, and under which preference.
 * Unknown rules never push. Tenant insights (webhook and subgraph rules) are
 * never pushed: a stopped subgraph arrives as its own event instead.
 */
export const PUSH_RULES: Record<string, PushKind> = {
	stack_unreachable_subgraphs: "subgraph_not_serving",
	stack_unreachable: "subgraph_not_serving",
	cap_pace: "spend_cap",
	polling_loop: "key_repeat",
	duplicate_reads: "key_repeat",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const enc = encodeURIComponent;

export function webhookFailingPush(d: {
	id: string;
	name: string;
	failingSince: Date;
	failures: number;
	lastError: string | null;
}): PushPayload {
	const err = d.lastError ? d.lastError.slice(0, 60) : "No answer";
	return {
		title: `${d.name} can't reach your server`,
		body: `${err} since ${utcTime(d.failingSince)}. ${fmt(d.failures)} failed attempts in a row.`,
		url: `/account/webhooks/${enc(d.id)}`,
		tag: `webhook:${d.id}`,
	};
}

const ACCOUNT_RULE_URL: Record<string, string> = {
	stack_unreachable_subgraphs: "/account#subgraphs",
	cap_pace: "/account#usage",
	polling_loop: "/account#usage",
	duplicate_reads: "/account#usage",
};

export function insightPush(i: {
	rule: string;
	resource: {
		kind: "webhook" | "subgraph" | "account";
		id: string;
		name: string;
	};
	line: string;
	lead: string;
}): PushPayload {
	const url =
		i.resource.kind === "webhook"
			? `/account/webhooks/${enc(i.resource.id)}`
			: i.resource.kind === "subgraph"
				? `/account/subgraphs/${enc(i.resource.name)}`
				: (ACCOUNT_RULE_URL[i.rule] ?? "/account");
	return {
		title: i.line,
		body: i.lead,
		url,
		tag: `insight:${i.rule}:${i.resource.id}`,
	};
}

export function replayDonePush(r: {
	webhookId: string;
	webhookName: string;
	delivered: number;
	gaveUp: number;
	total: number;
}): PushPayload {
	return {
		title: `Replay done: ${r.webhookName}`,
		body:
			r.gaveUp > 0
				? `${fmt(r.delivered)} delivered, ${fmt(r.gaveUp)} gave up. Tap to requeue them.`
				: `All ${fmt(r.delivered)} delivered.`,
		url: `/account/webhooks/${enc(r.webhookId)}`,
		tag: `replay:${r.webhookId}`,
	};
}

export function subgraphStoppedPush(e: {
	subgraph: string;
	reason: "out_of_memory" | "crashed" | "stalled" | "error";
	height: number;
	lastError: string | null;
}): PushPayload {
	const at = fmt(e.height);
	const body = {
		stalled: `No progress at block ${at}. We restarted it 3 times, then halted it.`,
		out_of_memory: `It ran out of memory at block ${at} and was halted.`,
		crashed: `It crashed at block ${at} and was halted.`,
		error: `${(e.lastError?.trim() || "It hit its error limit").slice(0, 120).replace(/\.+$/, "")}. Redeploy to resume.`,
	}[e.reason];
	return {
		title: `${e.subgraph} stopped ingesting`,
		body,
		url: "/account#subgraphs",
		tag: `subgraph:${e.subgraph}`,
	};
}
