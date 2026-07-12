// f060 SPIKE — handler source bundled into the worker (D2 write-only profile).
// Zero ctx reads — every op is a local buffer push, no round trip needed at
// all (see worker-entry.ts's ctx.increment implementation).
export default function handler(
	payload: { sender: string },
	// biome-ignore lint/suspicious/noExplicitAny: worker-side ctx proxy, typed in worker-entry.ts
	ctx: any,
): void {
	ctx.increment("write_only_counters", { key: payload.sender }, { count: 1n });
}
