import { unhex } from "./bytes.ts";
import type { VerifyCheckpoint } from "./checkpoint.ts";
import { parseNakamotoHeader } from "./header.ts";
import type { BlockVerification, VerifyStep } from "./verify-block.ts";

export type LinkStatus = "ok" | "failed" | "skipped";

export interface LinkLine {
	step: VerifyStep;
	label: string;
	status: LinkStatus;
	/** What the link proved, why it failed, or why it was not checked. */
	detail: string;
}

/** The chain of links, in the order verifyBlock walks them. */
export const LINKS: readonly { step: VerifyStep; label: string }[] = [
	{ step: "ancestry", label: "ancestry" },
	{ step: "block", label: "block" },
	{ step: "bitcoin", label: "bitcoin" },
	{ step: "burn", label: "burn" },
	{ step: "signer-set", label: "cycle" },
	{ step: "signatures", label: "signatures" },
	{ step: "txs", label: "txs" },
	{ step: "witness", label: "state root" },
	{ step: "names", label: "diff" },
	{ step: "rows", label: "rows" },
];

const n = (v: number | bigint) => v.toLocaleString("en-US");

/** What each link proved, for the human view. */
function linkDetail(
	step: VerifyStep,
	r: BlockVerification,
	cp: VerifyCheckpoint,
): string {
	switch (step) {
		case "ancestry": {
			const a = r.ancestry;
			if (!a) return "";
			const checkpoint = parseNakamotoHeader(unhex(cp.stacks.header));
			const start =
				a.fromHeight === Number(checkpoint.chainLength)
					? `the checkpoint ${n(a.fromHeight)}`
					: `block ${n(a.fromHeight)}`;
			return a.via === "marf"
				? `${n(r.height ?? 0)} proven in the state of ${start} (one MARF proof)`
				: `${n(r.height ?? 0)} reached from ${start} by parent links`;
		}
		case "block":
			return `${n(r.height ?? 0)}  ${r.blockId}`;
		case "bitcoin":
			return `headers ${n(cp.bitcoin.height)}..${n(r.burnHeight ?? 0)}, proof-of-work and retargets checked`;
		case "burn":
			return `height ${n(r.burnHeight ?? 0)}  ${r.bitcoinBlockHash}`;
		case "signer-set":
			return r.cycle === cp.stacks.cycle
				? `${r.cycle}, the checkpoint's own signer set`
				: `${r.cycle}, signer set proven forward from checkpoint cycle ${cp.stacks.cycle}`;
		case "signatures":
			return `${n(r.signerWeight ?? 0n)} / ${n(r.totalWeight ?? 0n)} weight signed, threshold ${n(r.threshold ?? 0n)}`;
		case "txs":
			return `${n(r.transactions?.length ?? 0)} transactions match the tx merkle root`;
		case "witness":
			return `${r.stateRoot} matches the witness`;
		case "names": {
			const d = r.diff;
			if (!d) return "";
			const named = d.writes.filter((w) => w.named).length;
			const written = named
				? `${d.writes.length} written (${named} named, ${d.writes.length - named} unnamed)`
				: `${d.writes.length} written (unnamed)`;
			return `${written}, ${d.carried.length} carried, ${d.internal.length} internal`;
		}
		case "rows":
			return `${n(r.rowsChecked ?? 0)} vm_events rows match the diff`;
	}
}

/**
 * Links a block below the checkpoint skips: its id is pinned by hash from a
 * trusted descendant, so no signer set or signatures; the burn block is bound
 * only when the synced Bitcoin chain reaches it.
 */
function notNeeded(step: VerifyStep, r: BlockVerification): boolean {
	if (!r.ancestry) return false;
	if (step === "bitcoin" || step === "burn") return r.burnHeight === undefined;
	return step === "signer-set" || step === "signatures";
}

/**
 * One line per link, then the verdict: the human view of a verification,
 * shared by the CLI and the browser checker. Ancestry appears only below the
 * checkpoint. `rows` says whether the caller asked for the rows link.
 */
export function describeLinks(
	r: BlockVerification,
	cp: VerifyCheckpoint,
	opts: { rows?: boolean } = {},
): { lines: LinkLine[]; verdict: { ok: boolean; text: string } } {
	const first = r.failures[0];
	const broken = first
		? LINKS.findIndex((l) => l.step === first.step)
		: LINKS.length;
	const lines: LinkLine[] = [];
	for (const [i, link] of LINKS.entries()) {
		const { step, label } = link;
		const failure = r.failures.find((f) => f.step === step);
		// Ancestry is a link only below the checkpoint.
		if (step === "ancestry" && !failure && !r.ancestry) continue;
		const skipped = (detail: string): LinkLine => ({
			step,
			label,
			status: "skipped",
			detail,
		});
		if (failure)
			lines.push({ step, label, status: "failed", detail: failure.message });
		else if (step === "rows" && !opts.rows)
			lines.push(skipped("not checked (pass --rows)"));
		else if (i > broken)
			lines.push(skipped("not checked: an earlier link is broken"));
		else if (notNeeded(step, r))
			lines.push(
				skipped("not needed: the block is hash-chained to the checkpoint"),
			);
		else if (step === "rows" && r.rowsChecked === undefined)
			lines.push(skipped("not checked: the source serves no indexed rows"));
		else if (step === "txs" && r.transactions === undefined)
			lines.push(
				skipped(
					"not checked: no transaction bytes (epoch 2.x, or the source served the header only)",
				),
			);
		else
			lines.push({
				step,
				label,
				status: "ok",
				detail: linkDetail(step, r, cp),
			});
	}

	if (!first) {
		const from = n(parseNakamotoHeader(unhex(cp.stacks.header)).chainLength);
		return {
			lines,
			verdict: {
				ok: true,
				text: `Block ${n(r.height ?? 0)} is proven. Trusted: only the checkpoint (Stacks ${from}, Bitcoin ${n(cp.bitcoin.height)}).`,
			},
		};
	}
	const label = LINKS[broken]?.label ?? first.step;
	return {
		lines,
		verdict: {
			ok: false,
			text:
				first.code === "unavailable"
					? `Could not check the ${label} link: the source could not serve it.`
					: `Not proven: the ${label} link is broken.`,
		},
	};
}
