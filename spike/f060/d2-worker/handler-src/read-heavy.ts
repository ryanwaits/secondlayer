// f060 SPIKE — handler source bundled into the worker (D2 read-heavy profile).
// Same shape as spike/f060/lib/subgraphs.ts's `readHeavyAccumulator` handler
// (2 findOne + 2 increment per event) but written standalone — this file gets
// esbuild-bundled by bundle.ts and shipped into a Bun Worker, so it must not
// import any product code or Node builtins (the resolver lockdown would block
// it anyway; see bundle.ts).
export default async function handler(
	payload: { sender: string; txId: string; poison?: boolean },
	// biome-ignore lint/suspicious/noExplicitAny: worker-side ctx proxy, typed in worker-entry.ts
	ctx: any,
): Promise<void> {
	const senderKey = payload.sender;
	const recipientKey = `spike-${payload.txId.slice(2, 10)}`;
	await ctx.findOne("read_heavy_balances", { address: senderKey });
	await ctx.findOne("read_heavy_balances", { address: recipientKey });
	ctx.increment("read_heavy_balances", { address: senderKey }, { balance: 1n });
	// fix-f040 B6 checkpoint/rollback demo: a "poisoned" event throws AFTER
	// queuing the first leg's write but BEFORE the second — mirrors a transfer
	// handler that debits then throws. If the worker-side checkpoint/rollback
	// (worker-entry.ts's runBlock handler) is broken, the sender-side
	// increment above survives in the ops the worker ships home even though
	// the handler never completed — a one-sided write, exactly what fix-f040
	// B6 exists to prevent.
	if (payload.poison) {
		throw new Error("f060 poison pill: simulated mid-handler failure");
	}
	ctx.increment(
		"read_heavy_balances",
		{ address: recipientKey },
		{ balance: 1n },
	);
}
