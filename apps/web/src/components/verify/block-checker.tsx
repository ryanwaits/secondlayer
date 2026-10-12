"use client";

import { Terminal } from "@/components/site/terminal";
import type { LinkLine, ProofSource, VerifyStep } from "@secondlayer/verify";
import { type FormEvent, useEffect, useRef, useState } from "react";

const DEFAULT_REF = "9137005";

type Link = { step: VerifyStep; label: string };

type View =
	| { kind: "idle"; hint?: string }
	| { kind: "running"; order: Link[]; passed: VerifyStep[] }
	| {
			kind: "done";
			lines: LinkLine[];
			verdict: { ok: boolean; text: string };
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
	if (status === "ok") return <span className="t-ok">{"✓"}</span>;
	if (status === "failed") return <span className="bc-fail">{"✗"}</span>;
	return <span className="t-m">{status === "pending" ? "…" : "·"}</span>;
}

function Row({
	status,
	label,
	detail,
}: {
	status: LinkLine["status"] | "pending";
	label: string;
	detail?: string;
}) {
	return (
		<div className="bc-line">
			<Mark status={status} />
			<span className={status === "pending" ? "t-m" : undefined}>{label}</span>
			{detail ? (
				<span
					className={
						status === "skipped"
							? "t-m"
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
			show({ kind: "done", ...verify.describeLinks(result, cp) });
		} catch (err) {
			show({
				kind: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return (
		<div className="site block-checker">
			<Terminal title="your browser" meta="live · mainnet">
				<form className="bc-body" onSubmit={check}>
					<div className="bc-row">
						<span className="t-a" aria-hidden="true">
							{"❯"}
						</span>
						<span className="bc-cmd">secondlayer verify block</span>
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
								<p className="t-m">
									Runs in your browser against the public proofs API. No key, no
									account.
								</p>
								{view.hint ? <p className="t-m">{view.hint}</p> : null}
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
										detail={l.detail}
									/>
								))}
								<p className={view.verdict.ok ? "t-ok" : "bc-fail"}>
									{view.verdict.ok ? "✓ " : "✗ "}
									{view.verdict.text}
								</p>
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
			</Terminal>
		</div>
	);
}
