"use client";

import type { LinkLine, ProofSource, VerifyStep } from "@secondlayer/verify";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	bitcoinBlockUrl,
	bitcoinHeightUrl,
	rerunCommand,
	stacksBlockUrl,
} from "./explorers";

const DEFAULT_REF = "9137005";

type Link = { step: VerifyStep; label: string };

type View =
	| { kind: "idle"; hint?: string }
	| { kind: "running"; order: Link[]; passed: VerifyStep[] }
	| {
			kind: "done";
			lines: LinkLine[];
			verdict: { ok: boolean; text: string };
			target: number | string;
			below: boolean;
			blockId?: string;
			bitcoinBlockHash?: string;
			checkpoint: {
				stacksId: string;
				stacksHeight: string;
				bitcoinHeight: number;
			};
	  }
	| { kind: "error"; message: string };

/** A height, or a 32-byte index block hash (0x optional). Null when neither. */
function parseRef(raw: string): number | string | null {
	if (/^\d+$/.test(raw)) {
		const height = Number(raw);
		return Number.isSafeInteger(height) ? height : null;
	}
	const hash = raw.replace(/^0x/i, "").toLowerCase();
	return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function Mark({ status }: { status: LinkLine["status"] | "pending" }) {
	if (status === "ok") return <span className="bc-ok">{"✓"}</span>;
	if (status === "failed") return <span className="bc-fail">{"✗"}</span>;
	return <span className="bc-mute">{status === "pending" ? "…" : "·"}</span>;
}

/**
 * Wrap the first occurrence of each match in a link. A match that is not in the
 * text is skipped, so a reworded line degrades to plain text instead of throwing.
 */
export function linkify(
	text: string,
	links: { match: string; href: string }[],
): ReactNode {
	const found = links
		.map((l) => ({ ...l, at: text.indexOf(l.match) }))
		.filter((l) => l.match && l.at >= 0)
		.sort((a, b) => a.at - b.at);
	const out: ReactNode[] = [];
	let cursor = 0;
	for (const l of found) {
		if (l.at < cursor) continue;
		if (l.at > cursor) out.push(text.slice(cursor, l.at));
		out.push(
			<a key={l.at} href={l.href} target="_blank" rel="noopener noreferrer">
				{l.match}
			</a>,
		);
		cursor = l.at + l.match.length;
	}
	if (cursor < text.length) out.push(text.slice(cursor));
	return out;
}

/** How to repeat the check without us. */
export function RerunHint({
	target,
	below,
}: {
	target: number | string;
	below: boolean;
}) {
	return (
		<div className="bc-rerun">
			<p className="bc-mute">Run it on your machine, against your own node:</p>
			<p className="bc-code">
				<span className="bc-name" aria-hidden="true">
					{"❯ "}
				</span>
				{rerunCommand(target, below)
					.split(" ")
					.map((word, i) => (
						<span key={`${i}:${word}`}>
							{i > 0 ? " " : null}
							<span className="bc-word">{word}</span>
						</span>
					))}
			</p>
			{below ? (
				<p className="bc-mute">
					A node alone can't serve proofs more than 16 blocks back; this reads
					them from the public proofs API.
				</p>
			) : null}
		</div>
	);
}

/** The hashes a proven line prints, paired with the explorer that shows each. */
function lineLinks(
	step: VerifyStep,
	view: { blockId?: string; bitcoinBlockHash?: string },
): { match: string; href: string }[] {
	if (step === "block" && view.blockId)
		return [{ match: view.blockId, href: stacksBlockUrl(view.blockId) }];
	if (step === "burn" && view.bitcoinBlockHash)
		return [
			{
				match: view.bitcoinBlockHash,
				href: bitcoinBlockUrl(view.bitcoinBlockHash),
			},
		];
	return [];
}

function Row({
	status,
	label,
	detail,
}: {
	status: LinkLine["status"] | "pending";
	label: string;
	detail?: ReactNode;
}) {
	return (
		<div className="bc-line">
			<Mark status={status} />
			<span className={status === "pending" ? "bc-mute" : undefined}>
				{label}
			</span>
			{detail ? (
				<span
					className={
						status === "skipped"
							? "bc-mute"
							: status === "failed"
								? "bc-fail"
								: undefined
					}
				>
					{detail}
				</span>
			) : null}
		</div>
	);
}

/**
 * Check one Stacks block in the browser: the same links `secondlayer verify
 * block` proves, computed here against the free proofs API. No key, no account.
 * The verifier loads on the first check, not with the page.
 */
export function BlockChecker({ source }: { source?: ProofSource }) {
	const [input, setInput] = useState(DEFAULT_REF);
	const [view, setView] = useState<View>({ kind: "idle" });
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const running = view.kind === "running";
	// The link after the last one to pass, so a link the verifier skips never sticks.
	const next =
		view.kind === "running"
			? view.order[
					Math.max(
						-1,
						...view.passed.map((p) =>
							view.order.findIndex((l) => l.step === p),
						),
					) + 1
				]
			: undefined;

	async function check(e: FormEvent) {
		e.preventDefault();
		if (running) return;
		const ref = parseRef(input.trim());
		if (ref === null) {
			setView({
				kind: "idle",
				hint: "Enter a block height or a 0x index block hash (64 hex).",
			});
			return;
		}
		const show = (next: View) => {
			if (alive.current) setView(next);
		};
		setView({ kind: "running", order: [], passed: [] });
		try {
			const verify = await import("@secondlayer/verify");
			const cp = verify.MAINNET_CHECKPOINT;
			const below =
				typeof ref === "number" &&
				ref <
					Number(
						verify.parseNakamotoHeader(verify.unhex(cp.stacks.header))
							.chainLength,
					);
			// Rows are opt-in and billed, so the live view never waits on them.
			const order = verify.LINKS.filter(
				(l) => l.step !== "rows" && (below || l.step !== "ancestry"),
			);
			show({ kind: "running", order, passed: [] });
			const result = await verify.verifyBlock(ref, {
				source: source ?? new verify.SecondlayerProofSource(),
				checkpoint: cp,
				onStep: (step) => {
					if (alive.current)
						setView((v) =>
							v.kind === "running" ? { ...v, passed: [...v.passed, step] } : v,
						);
				},
			});
			const header = verify.parseNakamotoHeader(verify.unhex(cp.stacks.header));
			show({
				kind: "done",
				...verify.describeLinks(result, cp),
				target: ref,
				below: !!result.ancestry,
				blockId: result.blockId,
				bitcoinBlockHash: result.bitcoinBlockHash,
				checkpoint: {
					stacksId: verify.hex(verify.blockId(header)),
					stacksHeight: header.chainLength.toLocaleString("en-US"),
					bitcoinHeight: cp.bitcoin.height,
				},
			});
		} catch (err) {
			show({
				kind: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return (
		<div className="site block-checker">
			<div className="cb">
				<div className="cb-bar">
					<span>your browser</span>
				</div>
				<form className="bc-body" onSubmit={check}>
					<div className="bc-row">
						<span className="bc-mute" aria-hidden="true">
							{"$"}
						</span>
						<span className="bc-cmd">
							<span className="bc-name">secondlayer verify</span> block
						</span>
						<input
							className="bc-input"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							aria-label="Block height or index block hash"
							spellCheck={false}
							autoComplete="off"
							autoCapitalize="off"
							inputMode="text"
							disabled={running}
						/>
						<button
							type="submit"
							className="btn btn-pri bc-go"
							disabled={running}
						>
							Check
						</button>
					</div>
					<div className="bc-out" aria-live="polite">
						{view.kind === "idle" ? (
							<>
								<p className="bc-mute">
									Runs in your browser against the public proofs API. No key, no
									account.
								</p>
								{view.hint ? <p className="bc-mute">{view.hint}</p> : null}
							</>
						) : null}
						{view.kind === "running" ? (
							<>
								{view.order
									.filter((l) => view.passed.includes(l.step))
									.map((l) => (
										<Row key={l.step} status="ok" label={l.label} />
									))}
								{next ? <Row status="pending" label={next.label} /> : null}
							</>
						) : null}
						{view.kind === "done" ? (
							<>
								{view.lines.map((l) => (
									<Row
										key={l.step}
										status={l.status}
										label={l.label}
										detail={
											l.detail && l.status === "ok"
												? linkify(l.detail, lineLinks(l.step, view))
												: l.detail
										}
									/>
								))}
								<p className={view.verdict.ok ? "bc-ok" : "bc-fail"}>
									{view.verdict.ok ? "✓ " : "✗ "}
									{view.verdict.ok
										? linkify(view.verdict.text, [
												{
													match: `Stacks ${view.checkpoint.stacksHeight}`,
													href: stacksBlockUrl(view.checkpoint.stacksId),
												},
												{
													match: `Bitcoin ${view.checkpoint.bitcoinHeight.toLocaleString("en-US")}`,
													href: bitcoinHeightUrl(view.checkpoint.bitcoinHeight),
												},
											])
										: view.verdict.text}
								</p>
								<RerunHint target={view.target} below={view.below} />
							</>
						) : null}
						{view.kind === "error" ? (
							<p className="bc-fail">
								{"✗ Could not reach the proofs API: "}
								{view.message}
							</p>
						) : null}
					</div>
				</form>
			</div>
		</div>
	);
}
