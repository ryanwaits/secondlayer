"use client";

import { copyText } from "@/lib/docs-clipboard";
import type { Insight } from "@/lib/insights";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Sheet } from "../sheet";
import { ClaudeMark, CursorMark, OpenAIMark, SlackMark } from "./share-marks";
import {
	SHARE_TARGETS,
	type ShareTarget,
	buildShareText,
	shareUrl,
} from "./share-text";

const MARKS: Record<ShareTarget, ReactNode> = {
	claude: <ClaudeMark />,
	chatgpt: <OpenAIMark />,
	cursor: <CursorMark />,
};

const CHECK = "Check: ";

/** Hand a title and link to the phone's share sheet (Slack is in it); copy the link when there is none. */
export async function shareLink(title: string, url: string): Promise<void> {
	if (typeof navigator.share === "function") {
		try {
			await navigator.share({ title, url });
			return;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
		}
	}
	if (await copyText(url)) toast("Copied the link.");
	else toast.error("Couldn't copy. Press and hold the link to select it.");
}

async function shareToSlack(title: string, text: string): Promise<void> {
	if (typeof navigator.share === "function") {
		try {
			await navigator.share({ title, text });
			return;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
		}
	}
	if (await copyText(text)) toast("Copied. Paste it in Slack.");
	else toast.error("Couldn't copy. Press and hold the text to select it.");
}

async function copyFix(text: string): Promise<void> {
	if (await copyText(text)) toast("Copied the fix and the link.");
	else toast.error("Couldn't copy. Press and hold the text to select it.");
}

function PreviewLine({ line }: { line: string }) {
	if (!line.startsWith(CHECK)) return <>{line}</>;
	return (
		<>
			{CHECK}
			<code>{line.slice(CHECK.length)}</code>
		</>
	);
}

/** What the sheet shows. Rendered alone by the Lab and tests; `Sheet` portals. */
export function ShareFixBody({ insight }: { insight: Insight }) {
	const { title, text, url } = buildShareText(insight);
	const body = text.endsWith(url) ? text.slice(0, -url.length).trimEnd() : text;
	return (
		<>
			<div className="m-share-prev">
				<b>{title}</b>
				<span className="m-share-text">
					{body.split("\n").map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static preview lines
						<span key={i} className="m-share-line">
							<PreviewLine line={line} />
						</span>
					))}
				</span>
				<span className="m-share-url">{url}</span>
			</div>
			<div className="m-share-targets">
				{(Object.keys(SHARE_TARGETS) as ShareTarget[]).map((target) => (
					<a
						key={target}
						className="m-share-target"
						href={shareUrl(target, insight)}
						target="_blank"
						rel="noopener noreferrer"
					>
						<i>{MARKS[target]}</i>
						{SHARE_TARGETS[target].label}
					</a>
				))}
				<button
					type="button"
					className="m-share-target"
					onClick={() => void shareToSlack(title, text)}
				>
					<i>
						<SlackMark />
					</i>
					Slack
				</button>
			</div>
			<button
				type="button"
				className="m-share-copy"
				onClick={() => void copyFix(text)}
			>
				<span>Copy</span>
				<svg
					aria-hidden="true"
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.4"
				>
					<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
					<path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
				</svg>
			</button>
			<p className="m-share-hint">
				Claude, ChatGPT and Cursor open with this filled in. You read it, then
				send.
			</p>
		</>
	);
}

/** Share an insight's fix as a bottom sheet. */
export function ShareFixSheet({
	insight,
	onClose,
}: {
	insight: Insight | null;
	onClose: () => void;
}) {
	return (
		<Sheet
			open={insight !== null}
			onClose={onClose}
			eyebrow="Share"
			title="Share fix"
			detents="auto"
		>
			{insight ? <ShareFixBody insight={insight} /> : null}
		</Sheet>
	);
}
