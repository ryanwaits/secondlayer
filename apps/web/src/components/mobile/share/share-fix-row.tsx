"use client";

import type { Insight } from "@/lib/insights";
import { shareText } from "./share-fix-sheet";
import {
	SHARE_TARGETS,
	type ShareTarget,
	buildShareText,
	shareUrl,
} from "./share-text";

/**
 * "Share the fix": the phone's stand-in for a command to copy. Claude, ChatGPT
 * and Cursor open with the fix filled in; More hands it to the system share
 * sheet. The reader checks the text, then sends.
 */
export function ShareFixRow({ insight }: { insight: Insight }) {
	return (
		<div className="m-sharerow">
			<span>Share the fix</span>
			{(Object.keys(SHARE_TARGETS) as ShareTarget[]).map((target) => (
				<a
					key={target}
					href={shareUrl(target, insight)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{SHARE_TARGETS[target].label}
				</a>
			))}
			<button
				type="button"
				onClick={() => {
					const { title, text } = buildShareText(insight);
					void shareText(title, text);
				}}
			>
				More
			</button>
		</div>
	);
}
