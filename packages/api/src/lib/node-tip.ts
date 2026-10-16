/**
 * The node's own view of both chains: the Stacks tip it holds and the newest
 * Bitcoin block it has seen. `/public/status` carries it so a reader can tell
 * "Stacks stopped making blocks" (the node is level with our index and Bitcoin
 * kept moving) from "we fell behind" (the node is ahead of our index). The
 * Bitcoin height also keeps moving through a Stacks stall, which the burn
 * height on our last indexed block cannot.
 *
 * Every open tab polls `/public/status`, so the node is read at most once per
 * `ttlMs` (concurrent requests share one read) with a short timeout. A failed
 * read is null and is not cached, so the next request tries again.
 */
export type NodeTip = {
	stacksTip: number;
	bitcoinTip: number;
};

export type NodeTipOptions = {
	/** The node's `/v2/info` body. */
	fetchInfo?: () => Promise<unknown>;
	now?: () => number;
	ttlMs?: number;
};

const TIMEOUT_MS = 1_500;

function fetchNodeInfo(): Promise<unknown> {
	const url = process.env.STACKS_NODE_RPC_URL || "http://localhost:20443";
	return fetch(`${url}/v2/info`, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	}).then((res) => (res.ok ? res.json() : null));
}

/** The two heights out of a `/v2/info` body; null when either is unusable. */
export function readNodeInfo(body: unknown): NodeTip | null {
	const info = body as {
		stacks_tip_height?: unknown;
		burn_block_height?: unknown;
	} | null;
	const stacksTip = info?.stacks_tip_height;
	const bitcoinTip = info?.burn_block_height;
	if (
		typeof stacksTip !== "number" ||
		!Number.isFinite(stacksTip) ||
		typeof bitcoinTip !== "number" ||
		!Number.isFinite(bitcoinTip)
	)
		return null;
	return { stacksTip, bitcoinTip };
}

export function createNodeTipReader({
	fetchInfo = fetchNodeInfo,
	now = Date.now,
	ttlMs = 3_000,
}: NodeTipOptions = {}): () => Promise<NodeTip | null> {
	let cached: { at: number; tip: NodeTip } | null = null;
	let inflight: Promise<NodeTip | null> | null = null;
	return () => {
		if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.tip);
		if (inflight) return inflight;
		inflight = fetchInfo()
			.then(readNodeInfo)
			.catch(() => null)
			.then((tip) => {
				if (tip) cached = { at: now(), tip };
				inflight = null;
				return tip;
			});
		return inflight;
	};
}

export const readNodeTip = createNodeTipReader();
