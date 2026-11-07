import { notify } from "@/components/toast/notify";
import { type PauseTarget, setWebhookPaused } from "@/lib/webhooks-store";
import { shortenName } from "./shared";
import { describeFailure } from "./view";

/** The target a pause button moves a webhook to from where it stands. */
export function pauseTargetOf(webhook: { status: string }): PauseTarget {
	return webhook.status === "paused" ? "active" : "paused";
}

/**
 * Pause or resume a webhook and say what happened. The list and the detail
 * page both call this, so the toast, the retry and the undo are the same
 * everywhere. Retry and undo each carry an explicit target, never "toggle":
 * a webhook that changed under the toast can't be sent the wrong way.
 */
export async function changePause(
	id: string,
	name: string,
	target: PauseTarget,
): Promise<void> {
	const label = shortenName(name);
	const verb = target === "paused" ? "pause" : "resume";
	const res = await setWebhookPaused(id, target);
	if (res.kind !== "ok") {
		notify.fail(
			<>
				Couldn't {verb} <code>{label}</code>
			</>,
			{
				desc: describeFailure(res),
				retry: () => changePause(id, name, target),
			},
		);
		return;
	}
	const back: PauseTarget = target === "paused" ? "active" : "paused";
	notify.done(
		<>
			{target === "paused" ? "Paused" : "Resumed"} <code>{label}</code>
		</>,
		{
			desc: target === "paused" ? "Events wait for you." : undefined,
			undo: async () => {
				const undone = await setWebhookPaused(id, back);
				if (undone.kind !== "ok") {
					notify.fail(
						<>
							Couldn't undo for <code>{label}</code>
						</>,
						{
							desc: describeFailure(undone),
							retry: () => changePause(id, name, back),
						},
					);
				}
			},
		},
	);
}
