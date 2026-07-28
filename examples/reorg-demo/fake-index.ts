// A fake Secondlayer Index API, serving a scripted chain that reorgs at block
// 102. It speaks the real envelope shape — rows + `next_cursor` + `tip` +
// `reorgs` — which is the whole trick: the consumer under test is the real
// SDK, pointed at localhost via `new Index({ baseUrl })`.
//
// The chain is fabricated. The consumer path is not.
const PORT = Number(process.env.PORT ?? 8899);
const SHOW_WIRE = process.env.SHOW_WIRE === "1";

type Call = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	contract_id: string;
	function_name: string;
	sender: string;
	status: string;
	args: unknown[];
	result: unknown;
	result_hex: string | null;
};

const MARKETPLACE = "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4";

function sale(h: number, i: number, buyer: string, token: string): Call {
	return {
		cursor: `${h}:${i}`,
		block_height: h,
		tx_id: `0x${h}${i}${buyer.slice(-2).toLowerCase()}`,
		tx_index: i,
		contract_id: MARKETPLACE,
		function_name: "purchase-asset",
		sender: buyer,
		status: "success",
		args: ["SP2X.bitcoin-birds", token],
		result: null,
		result_hex: null,
	};
}

const REORG = {
	id: "r-102",
	detected_at: "2026-07-28T18:00:00.000Z",
	fork_point_height: 102,
	old_index_block_hash: "0xaaaa...old",
	new_index_block_hash: "0xbbbb...new",
	orphaned_range: { from: "102:0", to: "103:0" },
	new_canonical_tip: "103:0",
};

const TIP = { block_height: 103, finalized_height: 99, lag_seconds: 2 };

// The scripted history, keyed by the cursor the consumer asks for
// ("" = first page).
const pages: Record<
	string,
	{ calls: Call[]; next: string | null; reorgs: unknown[] }
> = {
	// 1. The original fork: blocks 100-103 all look canonical.
	"": {
		calls: [
			sale(100, 0, "SP1BUYER...ALICE", "u841"),
			sale(101, 0, "SP2BUYER...BOB", "u912"),
			sale(102, 0, "SP3BUYER...CAROL", "u377"),
			sale(103, 0, "SP4BUYER...DAVE", "u108"),
		],
		next: "103:0",
		reorgs: [],
	},
	// 2. Next poll: Bitcoin reorged. Blocks 102-103 were never real.
	"103:0": { calls: [], next: null, reorgs: [REORG] },
	// 3. The consumer rewinds to the FOOT of block 101 (`101:int4max`, which is
	//    `Cursor.atHeight(102)`) and re-reads the true chain — inclusive of
	//    block 102 itself, because the new chain re-supplies that block.
	"101:2147483647": {
		calls: [sale(102, 0, "SP9BUYER...ERIN", "u555")],
		next: "102:0",
		reorgs: [REORG],
	},
};

Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	fetch(req) {
		const url = new URL(req.url);
		const cursor = url.searchParams.get("cursor") ?? "";
		const page = pages[cursor] ?? { calls: [], next: null, reorgs: [REORG] };
		if (SHOW_WIRE) {
			console.log(
				`  [chain]  GET ?cursor=${(cursor || "(none)").padEnd(18)} ->  ${page.calls.length} calls, ${page.reorgs.length} reorgs`,
			);
		}
		return Response.json({
			contract_calls: page.calls,
			next_cursor: page.next,
			tip: TIP,
			reorgs: page.reorgs,
		});
	},
});

console.log(`fake chain listening on http://127.0.0.1:${PORT}`);
