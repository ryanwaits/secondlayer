"use client";

import { getReplays, requeueDead } from "@/lib/webhooks-data";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface Recovery {
	/** Dead events since the webhook last succeeded; null until read. */
	dead: { count: number; since: string | null } | null;
	/** The bulk requeue: in flight, or how many went out. */
	requeue: { busy: boolean; requeued: number | null; onRequeue: () => void };
}

/** The dead-event count for a webhook and the bulk requeue that sends them again. */
export function useRecovery(id: string): Recovery {
	const [dead, setDead] = useState<Recovery["dead"]>(null);
	const [busy, setBusy] = useState(false);
	const [requeued, setRequeued] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		getReplays(id).then((res) => {
			if (!cancelled && res.kind === "ok") {
				setDead(res.data.ranges.deadSinceFailing);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [id]);

	const onRequeue = async () => {
		if (busy) return;
		setBusy(true);
		const res = await requeueDead(id, { since: dead?.since ?? undefined });
		setBusy(false);
		if (res.kind !== "ok") {
			toast.error("Couldn't requeue", {
				description:
					res.kind === "error" ? res.message : "Try again in a moment.",
			});
			return;
		}
		const n = res.data.requeued.toLocaleString("en-US");
		toast.success(`Requeued ${n}. They go out with live events.`);
		setRequeued(res.data.requeued);
	};

	return { dead, requeue: { busy, requeued, onRequeue } };
}
