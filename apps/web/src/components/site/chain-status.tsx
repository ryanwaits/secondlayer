"use client";

import {
	type ChainState,
	type ChainTip,
	POLL_MS,
	chainState,
	useChainTip,
} from "@/lib/chain-tip";
import NumberFlow from "@number-flow/react";
import { usePathname } from "next/navigation";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ChainMark } from "./chain-link";

const fmt = (n: number) => n.toLocaleString("en-US");
/** "16:41 UTC". */
const utc = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
/** "7s ago", "4m 12s ago". */
const ago = (sec: number) => {
	const s = Math.max(0, Math.floor(sec));
	return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
};

const GROUPED = { useGrouping: true } as const;

/** A block height that rolls to its next value. */
function Height({ value }: { value: number }) {
	return (
		<span className="cstat-n cstat-fade">
			#<NumberFlow value={value} format={GROUPED} locales="en-US" />
		</span>
	);
}

/**
 * A chain's mark. `beat` remounts it on every new block, which replays the
 * ring once; the first render has no ring.
 */
function Mark({ chain, beat }: { chain: "stacks" | "bitcoin"; beat: number }) {
	return (
		<span key={beat} className={beat > 0 ? "cstat-mark pulse" : "cstat-mark"}>
			<ChainMark chain={chain} />
		</span>
	);
}

type Row = [label: string, value: string];

/** The tooltip: who owns the problem, what happened, and what it means for your data. */
function Tip({
	title,
	owner,
	rows,
	children,
}: {
	title?: string;
	owner?: string;
	rows: Row[];
	children?: ReactNode;
}) {
	return (
		<div className="cstat-tip" aria-hidden="true">
			{title ? (
				<div className="cstat-tip-head">
					{owner ? <span className="cstat-tip-owner">{owner}</span> : null}
					<b>{title}</b>
				</div>
			) : null}
			<dl>
				{rows.map(([label, value]) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
			{children ? <p>{children}</p> : null}
		</div>
	);
}

function tipFor(state: ChainState, tip: ChainTip, now: number) {
	const height = tip.height ?? 0;
	if (state.kind === "stalled") {
		const rows: Row[] = [
			[
				"Last Stacks block",
				`#${fmt(height)}${tip.seenAt ? ` · ${utc(tip.seenAt)}` : ""}`,
			],
		];
		if (state.bitcoinSince !== null)
			rows.push([
				"Bitcoin since",
				`${state.bitcoinSince} block${state.bitcoinSince === 1 ? "" : "s"}`,
			]);
		if (tip.nodeTip !== null) rows.push(["Our node", "caught up"]);
		return (
			<Tip
				title={`Stacks hasn't made a block in ${state.minutes} minutes`}
				owner="Stacks network"
				rows={rows}
			>
				<b>Not us.</b> The network stopped producing blocks. Your data is
				current to #{fmt(height)}, and webhooks and subgraphs resume on their
				own when blocks do.
			</Tip>
		);
	}
	if (state.kind === "behind") {
		return (
			<Tip
				title={`We're ${fmt(state.blocks)} blocks behind the chain`}
				owner="Secondlayer"
				rows={[
					["Chain tip", `#${fmt(tip.nodeTip ?? height)}`],
					["We've indexed", `#${fmt(height)}`],
				]}
			>
				<b>Ours.</b> The chain is fine, and our indexer is catching up. Nothing
				is skipped: webhooks and subgraphs deliver every block in order.
			</Tip>
		);
	}
	if (state.kind === "unreachable") {
		return (
			<Tip
				title="Can't reach Secondlayer"
				owner="Us or your connection"
				rows={[
					[
						"Last answer",
						tip.okAt
							? `${utc(tip.okAt)} · ${ago((now - tip.okAt) / 1000)}`
							: "none yet",
					],
					["Retrying", `every ${POLL_MS / 1000}s`],
				]}
			>
				The numbers shown are from that last answer. If other sites load fine,
				the problem is ours.
			</Tip>
		);
	}
	const usually =
		tip.avgBlockSec !== null
			? ` · usually ${Math.round(tip.avgBlockSec)}s`
			: "";
	const rows: Row[] = [
		[
			"Stacks block",
			`${ago(tip.seenAt ? (now - tip.seenAt) / 1000 : 0)}${usually}`,
		],
	];
	if (tip.bitcoin !== null)
		rows.push([
			"Bitcoin block",
			tip.bitcoinSeenAt
				? ago((now - tip.bitcoinSeenAt) / 1000)
				: `#${fmt(tip.bitcoin)}`,
		]);
	return <Tip rows={rows} />;
}

function label(state: ChainState, tip: ChainTip): string {
	const heights = `Stacks block ${fmt(tip.height ?? 0)}${tip.bitcoin !== null ? `, Bitcoin block ${fmt(tip.bitcoin)}` : ""}`;
	if (state.kind === "stalled")
		return `Stacks has stalled for ${state.minutes} minutes. ${heights}.`;
	if (state.kind === "behind")
		return `Secondlayer is ${state.blocks} blocks behind the chain. ${heights}.`;
	if (state.kind === "unreachable")
		return `Can't reach Secondlayer. Last known: ${heights}.`;
	return `${heights}.`;
}

/** The Stacks mark plus its padding: the pill's width at rest when live. */
const REST_PX = 30;

/**
 * At rest the pill shows only its right edge: the Stacks mark, and the cause
 * when down. The whole pill is always laid out; `--rest` sets how much of it
 * the clip leaves visible, so opening is one reveal that never moves the mark.
 */
function useRestWidth(shown: boolean) {
	const body = useRef<HTMLDivElement>(null);
	const cause = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const el = body.current;
		if (!shown || !el) return;
		const measure = () =>
			el.style.setProperty(
				"--rest",
				`${REST_PX + (cause.current?.offsetWidth ?? 0)}px`,
			);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [shown]);
	return { body, cause };
}

/**
 * The pill itself, from a tip and a clock; renders nothing before the first
 * height. `open` shows the whole pill and its tooltip (a tap on touch screens;
 * hover and focus do it in CSS).
 */
export function ChainStatusView({
	tip,
	now,
	open = false,
	onToggle,
}: {
	tip: ChainTip;
	now: number;
	open?: boolean;
	onToggle?: () => void;
}) {
	const { body, cause } = useRestWidth(tip.height !== null);
	if (tip.height === null) return null;
	const state = chainState(tip, now);
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard focus already opens it; the click is the touch path
		<div
			className={`chain-status is-${state.kind}${open ? " is-open" : ""}`}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the same tooltip as hover, so keyboard readers get the details
			tabIndex={0}
			aria-label={label(state, tip)}
			onClick={onToggle}
		>
			<div className="cstat-shell">
				<div className="cstat-body" ref={body}>
					{tip.bitcoin !== null ? (
						<span className="cstat-seg cstat-bitcoin cstat-fade">
							<Height value={tip.bitcoin} />
							<Mark
								chain="bitcoin"
								beat={state.kind === "unreachable" ? 0 : tip.bitcoinBeat}
							/>
						</span>
					) : null}
					<span className="cstat-seg cstat-stacks">
						<Height value={tip.height} />
						<Mark chain="stacks" beat={state.kind === "live" ? tip.beat : 0} />
					</span>
					{state.kind !== "live" ? (
						<span className="cstat-seg cstat-cause" ref={cause}>
							<span className="cstat-dot" />
							{state.kind === "stalled" ? (
								<>Stacks stalled · {state.minutes}m</>
							) : state.kind === "behind" ? (
								<>
									We're{" "}
									<NumberFlow
										value={state.blocks}
										format={GROUPED}
										locales="en-US"
									/>{" "}
									blocks behind
								</>
							) : (
								<>Can't reach Secondlayer</>
							)}
						</span>
					) : null}
				</div>
			</div>
			{tipFor(state, tip, now)}
		</div>
	);
}

/** Marketing pages carry the pill; docs, blog and account pages don't. */
export function showsChainStatus(pathname: string): boolean {
	return (
		pathname === "/" ||
		pathname === "/pricing" ||
		pathname === "/verify" ||
		pathname.startsWith("/p/")
	);
}

/**
 * The chain status, fixed bottom-right on marketing pages: Stacks and Bitcoin
 * heights that roll on each block, and when something is down, what stopped
 * and whose problem it is. The tooltip (hover or focus) has the details.
 */
export function ChainStatus() {
	const pathname = usePathname();
	return showsChainStatus(pathname) ? <LiveChainStatus /> : null;
}

/** Polls only while mounted, so pages without the pill make no status calls. */
function LiveChainStatus() {
	const tip = useChainTip();
	const [now, setNow] = useState(() => Date.now());
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	// Touch screens have no hover: a tap opens the pill, a tap anywhere else closes it.
	useEffect(() => {
		if (!open) return;
		const close = (e: PointerEvent) => {
			if (!(e.target as Element).closest(".chain-status")) setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	}, [open]);
	const onToggle = () => {
		if (!matchMedia("(hover: hover)").matches) setOpen((o) => !o);
	};
	return (
		<ChainStatusView tip={tip} now={now} open={open} onToggle={onToggle} />
	);
}
