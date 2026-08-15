"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type TermLine = {
	kind?: "prompt" | "ok" | "good" | "head" | "dim";
	text: string;
};

type Term = {
	path: string;
	meta: string;
	cmd: string;
	lines: TermLine[];
};

type Section = {
	id: string;
	title: string;
	pitch: string;
	items: { href?: string; label: string; detail: string }[];
	term: Term;
};

const SECTIONS: Section[] = [
	{
		id: "run",
		title: "What you run",
		pitch:
			"Already have an API layer? Use Index. Would rather not build one? Use Subgraphs. Both ride on Streams.",
		items: [
			{
				href: "/docs/index",
				label: "Index",
				detail: "Rows into a schema you define",
			},
			{
				href: "/docs/subgraphs",
				label: "Subgraphs",
				detail: "One file. Table plus REST API",
			},
			{
				href: "/docs/streams",
				label: "Streams",
				detail: "The raw signed feed underneath",
			},
		],
		term: {
			path: "~/secondlayer",
			meta: "status",
			cmd: "secondlayer status",
			lines: [
				{ kind: "head", text: "System Status" },
				{ kind: "good", text: "  HEALTHY (mainnet)" },
				{ kind: "head", text: "Database" },
				{ text: "  Status: ok" },
				{ kind: "head", text: "Index Progress" },
				{ text: "  mainnet: block 8763223 (synced)" },
				{
					kind: "good",
					text: "  chain: ██████████████████████████████ 100.0% (tip: 8,763,223)",
				},
				{ text: "  contiguous: 8763223 (complete)" },
				{ kind: "head", text: "Activity" },
				{ text: "  Active Subgraphs  5" },
				{ kind: "dim", text: "Last updated: 2026-08-14T17:44:27Z" },
			],
		},
	},
	{
		id: "history",
		title: "History",
		pitch:
			"Getting the past is the hard part. Follow your node forward for free, or restore verified history from the signed archive in hours instead of days.",
		items: [
			{
				label: "Free",
				detail: "Runtime, compose, CLI. Forward-only from your node.",
			},
			{
				label: "Metered",
				detail:
					"Official-archive bootstrap. Backfill / reindex that reads our R2.",
			},
			{
				label: "Check",
				detail: "secondlayer verify / secondlayer repair",
			},
		],
		term: {
			path: "~/secondlayer",
			meta: "verify",
			cmd: "secondlayer verify all --against snapshot-7ca39e7c.json",
			lines: [
				{ kind: "dim", text: "  checked 25/175 ranges" },
				{ kind: "dim", text: "  checked 75/175 ranges" },
				{ kind: "dim", text: "  checked 125/175 ranges" },
				{ kind: "dim", text: "  checked 175/175 ranges" },
				{
					kind: "ok",
					text: "✓ Local data matches the archive across 175 ranges.",
				},
				{ kind: "good", text: "  reference signature verified" },
			],
		},
	},
	{
		id: "deploy",
		title: "Deploy",
		pitch:
			"One TypeScript file. Your table goes live on your instance, with a REST API you didn't write. Want your own API shape instead? Use Index and keep your schema.",
		items: [
			{
				label: "Deploy",
				detail: "secondlayer subgraphs deploy subgraphs/sbtc-flows.ts",
			},
			{
				label: "Read",
				detail: "127.0.0.1:3800/v1/subgraphs/sbtc-flows",
			},
			{
				label: "Watch",
				detail: "secondlayer subgraphs status sbtc-flows",
			},
		],
		term: {
			path: "~/secondlayer",
			meta: "deploy",
			cmd: "secondlayer subgraphs deploy subgraphs/sbtc-flows.ts",
			lines: [
				{ kind: "dim", text: "Loading subgraph from subgraphs/sbtc-flows.ts" },
				{ kind: "dim", text: "Bundling for remote deploy (mainnet)..." },
				{
					kind: "good",
					text: '✓ Subgraph "sbtc-flows" updated → v1.0.4 (reindexing)',
				},
				{
					text: "  Read:     http://127.0.0.1:3800/v1/subgraphs/sbtc-flows",
				},
				{ text: "  Tables:   events, deposits, withdrawals" },
				{ text: "  Reindex:  ~12,425 events, started in the background" },
				{ kind: "dim", text: "  Watch:    sl subgraphs status sbtc-flows" },
			],
		},
	},
];

function Icon({ name }: { name: Section["id"] }) {
	const common = {
		width: 28,
		height: 28,
		viewBox: "0 0 28 28",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.4,
		"aria-hidden": true as const,
	};
	if (name === "run") {
		return (
			<svg {...common} aria-hidden="true">
				<rect x="4" y="7" width="20" height="14" rx="2" />
				<path d="M8 11h8M8 15h5" />
			</svg>
		);
	}
	if (name === "history") {
		return (
			<svg {...common} aria-hidden="true">
				<circle cx="14" cy="14" r="9" />
				<path d="M14 9v5l3.5 2" />
			</svg>
		);
	}
	return (
		<svg {...common} aria-hidden="true">
			<path d="M6 20l6-6-6-6" />
			<path d="M14 20h8" />
		</svg>
	);
}

/**
 * Plays the terminal like a real shell session: the command types out at the
 * prompt, output lines land one at a time, then an empty prompt blinks.
 * playKey=null renders the finished session statically (mobile, reduced motion).
 */
function useSession(term: Term, playKey: string | number | null) {
	const total = term.lines.length;
	const [typed, setTyped] = useState(playKey === null ? term.cmd.length : 0);
	const [shown, setShown] = useState(playKey === null ? total : 0);

	useEffect(() => {
		if (playKey === null) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setTyped(term.cmd.length);
			setShown(total);
			return;
		}
		setTyped(0);
		setShown(0);
		const timers: ReturnType<typeof setInterval>[] = [];
		let t = 0;
		const type = setInterval(() => {
			t += 1;
			setTyped(t);
			if (t >= term.cmd.length) {
				clearInterval(type);
				let l = 0;
				const land = setInterval(() => {
					l += 1;
					setShown(l);
					if (l >= total) clearInterval(land);
				}, 220);
				timers.push(land);
			}
		}, 26);
		timers.push(type);
		return () => {
			for (const timer of timers) clearInterval(timer);
		};
	}, [playKey, term, total]);

	return { typed, shown, done: typed >= term.cmd.length && shown >= total };
}

function Terminal({
	term,
	className,
	playKey = null,
	idle = false,
}: {
	term: Term;
	className?: string;
	/** Changing key replays the session; null renders it finished (static). */
	playKey?: string | number | null;
	/** The stack hasn't been scrolled to yet: an empty prompt, waiting. */
	idle?: boolean;
}) {
	const { typed, shown, done } = useSession(term, playKey);
	const typing = playKey !== null && typed < term.cmd.length;

	return (
		<div className={className ? `home-term ${className}` : "home-term"}>
			<div className="home-term-bar">
				<span className="home-term-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
				<span className="home-term-path">{term.path}</span>
				<span className="home-term-meta">{term.meta}</span>
			</div>
			<div className="home-term-body">
				<p className="home-term-prompt" data-shown="">
					<span className="home-term-gt">❯</span>
					{idle ? "" : term.cmd.slice(0, typed)}
					{typing ? <span className="home-term-cursor" /> : null}
					{idle ? <span className="home-term-cursor" data-blink="" /> : null}
				</p>
				{term.lines.map((line, i) => (
					<p
						key={`${line.kind ?? "t"}:${line.text}`}
						className={line.kind ? `home-term-${line.kind}` : undefined}
						data-shown={
							!idle && (playKey === null || i < shown) ? "" : undefined
						}
					>
						{line.kind === "prompt" ? (
							<span className="home-term-gt">❯</span>
						) : null}
						{line.text}
					</p>
				))}
				{!idle && (playKey === null || done) ? (
					<p className="home-term-prompt" data-shown="">
						<span className="home-term-gt">❯</span>
						<span className="home-term-cursor" data-blink="" />
					</p>
				) : null}
			</div>
		</div>
	);
}

export function FeatureStack({
	historyExtra,
}: {
	historyExtra?: ReactNode;
}) {
	// null = the stack hasn't been scrolled to yet; the stage terminal idles
	// so the first session doesn't play while the hero is still on screen.
	const [active, setActive] = useState<number | null>(null);
	const refs = useRef<Array<HTMLElement | null>>([]);

	useEffect(() => {
		let raf = 0;
		const pick = () => {
			raf = 0;
			const first = refs.current[0];
			if (
				first &&
				first.getBoundingClientRect().top > window.innerHeight * 0.85
			) {
				setActive(null);
				for (const el of refs.current) el?.removeAttribute("data-in");
				return;
			}
			const mid = window.innerHeight / 2;
			let best = 0;
			let bestDist = Number.POSITIVE_INFINITY;
			refs.current.forEach((el, i) => {
				if (!el) return;
				const r = el.getBoundingClientRect();
				const dist = Math.abs(r.top + r.height / 2 - mid);
				if (dist < bestDist) {
					bestDist = dist;
					best = i;
				}
			});
			setActive(best);
			refs.current.forEach((el, i) => {
				if (!el) return;
				if (i === best) el.setAttribute("data-in", "");
				else el.removeAttribute("data-in");
			});
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(pick);
		};
		pick();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, []);

	return (
		<div className="home-stack">
			<div className="home-stack-copy">
				{SECTIONS.map((section, i) => (
					<section
						key={section.id}
						id={section.id === "history" ? "history" : undefined}
						className="home-stack-block"
						data-i={i}
						{...(i === 0 ? { "data-in": "" } : {})}
						ref={(el) => {
							refs.current[i] = el;
						}}
					>
						<div className="home-stack-head">
							<Icon name={section.id} />
							<h2>{section.title}</h2>
						</div>
						<p className="home-stack-pitch">{section.pitch}</p>
						<ul className="home-stack-list">
							{section.items.map((item) => (
								<li key={item.label}>
									{item.href ? (
										<Link href={item.href}>
											<span className="n">{item.label}</span>
											<span className="w">{item.detail}</span>
										</Link>
									) : (
										<>
											<span className="n">{item.label}</span>
											<span className="w">{item.detail}</span>
										</>
									)}
								</li>
							))}
						</ul>
						{section.id === "history" ? historyExtra : null}
						<Terminal term={section.term} className="home-term-mobile" />
					</section>
				))}
			</div>
			<div className="home-stack-stage" aria-hidden="true">
				<Terminal
					term={SECTIONS[active ?? 0].term}
					playKey={active}
					idle={active === null}
				/>
			</div>
		</div>
	);
}
