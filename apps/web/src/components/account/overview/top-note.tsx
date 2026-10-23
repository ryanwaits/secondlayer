"use client";

import { CopyButton } from "@/components/copy-button";
import { type Insight, insightTargetName, rankInsights } from "@/lib/insights";
import { dismiss } from "@/lib/insights-store";
import { useState } from "react";
import { toast } from "sonner";
import { CliLine } from "../webhooks/shared";

export interface FailingWebhook {
	id: string;
	name: string;
}

/** A state of the whole account that is not an insight: it has no buttons. */
export type AccountState = "credits_out" | "asleep";

const STATE_NOTES: Record<AccountState, { lead: string; body: string }> = {
	credits_out: {
		lead: "Your hosted stack stopped.",
		body: "Credits ran out, so webhooks aren't delivering. Add credits to start it again.",
	},
	asleep: {
		lead: "Your hosted stack is asleep.",
		body: "Every webhook is paused, so it isn't billed. Wake it from Webhooks.",
	},
};

/**
 * The open insights, worst first (a recovered incident is not open), and the
 * failing webhooks that no open insight speaks for.
 */
export function topNotes(
	insights: readonly Insight[],
	failing: readonly FailingWebhook[],
): { open: Insight[]; unspoken: FailingWebhook[] } {
	const open = rankInsights(insights.filter((i) => i.severity !== "recovered"));
	const spoken = new Set(
		open.filter((i) => i.resource.kind === "webhook").map((i) => i.resource.id),
	);
	return { open, unspoken: failing.filter((w) => !spoken.has(w.id)) };
}

/**
 * Which notes show. Until a note is handled, the top one shows by itself.
 * After that, only the ones the reader asked for with "Show it" do: nothing
 * appears on its own. `next` is the one "Show it" reveals; `more` counts
 * everything behind.
 */
export function nextVisible(
	open: readonly Insight[],
	revealed: readonly string[],
	handledAny = false,
): { visible: Insight[]; next: Insight | null; more: number } {
	const visible = open.filter(
		(i, n) => (n === 0 && !handledAny) || revealed.includes(i.id),
	);
	const rest = open.filter((i) => !visible.includes(i));
	return { visible, next: rest[0] ?? null, more: rest.length };
}

const dotTone = (insight: Insight) =>
	insight.severity === "losing" ? "alarm" : "hi";

function Commands({ insight }: { insight: Insight }) {
	return (
		<>
			{insight.handoff.commands.map((command, n) => (
				<CliLine
					key={command}
					command={command}
					label={n === 0 ? "See why" : undefined}
				/>
			))}
		</>
	);
}

function NoteCard({
	insight,
	onDone,
}: { insight: Insight; onDone: (insight: Insight) => void }) {
	// "Got it" and "Dismiss" are the same action: hide it until the rule fires again.
	async function act() {
		onDone(insight);
		if (!(await dismiss(insight.id))) toast.error("Couldn't update that note");
	}
	return (
		<section className="ov-note" aria-label="Note">
			<p className="ov-note-text">
				<span className={`dash-dot ${dotTone(insight)}`} />
				<span>
					<b>{insight.lead}</b> {insight.body}
				</span>
			</p>
			<div className="ov-note-acts">
				<button type="button" className="ins-act" onClick={() => void act()}>
					Got it
				</button>
				<button type="button" className="ins-act" onClick={() => void act()}>
					Dismiss
				</button>
			</div>
			<Commands insight={insight} />
			<span className="ov-note-prompt">
				<CopyButton
					code={insight.handoff.prompt}
					label="Copy the fix as a prompt"
				/>
			</span>
		</section>
	);
}

/** A webhook still failing after its note was handled: its row stays red. */
function OnItCard({
	webhook,
	remembered,
}: { webhook: FailingWebhook; remembered: Insight | undefined }) {
	return (
		<section className="ov-note" aria-label="Note">
			<p className="ov-note-text">
				<span className="dash-dot alarm" />
				<span>
					<b>{webhook.name} is failing. You're on it.</b> Its row stays red
					until it delivers again.
				</span>
			</p>
			{remembered ? <Commands insight={remembered} /> : null}
		</section>
	);
}

/**
 * The one note at the top of /account: the worst open insight, or nothing.
 * Healthy means no card at all. More notes wait behind a quiet line.
 */
export function TopNote({
	insights,
	failing,
	state = null,
}: {
	insights: readonly Insight[];
	failing: readonly FailingWebhook[];
	state?: AccountState | null;
}) {
	const [revealed, setRevealed] = useState<string[]>([]);
	// Notes handled in this visit, so a failing webhook keeps their commands.
	const [handled, setHandled] = useState<Insight[]>([]);
	const { open, unspoken } = topNotes(insights, failing);
	// A note whose dismissal failed is back in `open`, so it does not count.
	const handledAny = handled.some((h) => !open.some((o) => o.id === h.id));
	const { visible, next, more } = nextVisible(open, revealed, handledAny);
	if (!state && open.length === 0 && unspoken.length === 0) return null;
	const note = state ? STATE_NOTES[state] : null;
	return (
		<div className="ov-notes">
			{unspoken.map((webhook) => (
				<OnItCard
					key={webhook.id}
					webhook={webhook}
					remembered={handled.find(
						(i) =>
							i.resource.kind === "webhook" &&
							i.resource.id === webhook.id &&
							!open.some((o) => o.id === i.id),
					)}
				/>
			))}
			{note ? (
				<section className="ov-note" aria-label="Note">
					<p className="ov-note-text">
						<span
							className={`dash-dot ${state === "credits_out" ? "alarm" : "idle"}`}
						/>
						<span>
							<b>{note.lead}</b> {note.body}
						</span>
					</p>
					{state === "credits_out" ? (
						<a className="ky-link" href="#usage">
							Add credits
						</a>
					) : null}
				</section>
			) : null}
			{visible.map((insight) => (
				<NoteCard
					key={insight.id}
					insight={insight}
					onDone={(done) => setHandled((list) => [...list, done])}
				/>
			))}
			{next ? (
				<p className="ov-note-more">
					{more === 1 ? "1 more note" : `${more} more notes`}, on{" "}
					{insightTargetName(next)}.{" "}
					<button
						type="button"
						className="ky-link"
						onClick={() => setRevealed((ids) => [...ids, next.id])}
					>
						Show it
					</button>
				</p>
			) : null}
		</div>
	);
}
