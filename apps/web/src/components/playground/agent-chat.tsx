"use client";

import { CopyButton } from "@/components/copy-button";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HlSnippet } from "./snippets";

/**
 * Inline agent-harness chat, rendered as an in-terminal Claude Code session in
 * a self-contained console window that copies the marketing `pp-window` design.
 * One component across every product page; only the responses differ (driven by
 * `product`). The render layer is shaped to AI SDK 7 harness stream parts (text
 * / tool-call / file-change) plus a `ui` part for generative-UI outputs — a
 * simplified inline result, copy-paste snippets per surface, a prompt for the
 * user's own agent, an API-key/deploy payoff — so S2 swaps the local
 * `scriptedRun` driver for `useChat` over `/api/agent` without touching this UI.
 *
 * Code snippets are pre-highlighted server-side (shared Shiki highlighter) and
 * passed in via `snippets`, so they match every other code block on the site.
 */

export type AgentProduct = "index" | "streams" | "subgraphs";

const API = "https://api.secondlayer.tools";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

type UiAction =
	| {
			kind: "result";
			endpoint: string;
			url: string;
			decimals: number;
			symbol: string;
	  }
	| { kind: "snippet"; tabs: HlSnippet[] }
	| { kind: "prompt"; label: string; text: string }
	| { kind: "key"; blurb: string }
	| { kind: "deploy"; name: string };

type Part =
	| { type: "text"; text: string }
	| { type: "tool"; name: string; detail: string }
	| { type: "file"; path: string; body: string }
	| { type: "ui"; action: UiAction };

interface Message {
	role: "user" | "assistant";
	parts: Part[];
}

const SUGGESTIONS: Record<AgentProduct, string[]> = {
	index: [
		"Show me recent sBTC transfers",
		"Get contract calls to a marketplace",
		"List the largest STX transfers",
	],
	streams: [
		"Tail the live firehose",
		"Stream sBTC transfers as they land",
		"Replay events from a cursor",
	],
	subgraphs: [
		"Index every sBTC transfer to my contract",
		"Build a BNS names subgraph",
		"Track Velar swap events into a table",
	],
};

export function AgentChat({
	product = "subgraphs",
	snippets = [],
}: {
	product?: AgentProduct;
	snippets?: HlSnippet[];
}) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const termRef = useRef<HTMLDivElement>(null);

	const toBottom = useCallback(() => {
		requestAnimationFrame(() =>
			termRef.current?.scrollTo({ top: termRef.current.scrollHeight }),
		);
	}, []);

	const pushPart = useCallback(
		(part: Part) => {
			setMessages((prev) => {
				const next = [...prev];
				const last = next[next.length - 1];
				if (last?.role === "assistant") {
					next[next.length - 1] = { ...last, parts: [...last.parts, part] };
				}
				return next;
			});
			toBottom();
		},
		[toBottom],
	);

	const run = useCallback(
		async (prompt: string) => {
			if (!prompt.trim() || running) return;
			setInput("");
			setMessages((prev) => [
				...prev,
				{ role: "user", parts: [{ type: "text", text: prompt }] },
				{ role: "assistant", parts: [] },
			]);
			setRunning(true);
			toBottom();

			// ── S2 swap point: replace this scripted run with the streamed parts
			//    from useChat(`/api/agent`). The part shapes are identical. ──
			for (const step of scriptedRun(product, snippets)) {
				await delay(step.after);
				pushPart(step.part);
			}

			setRunning(false);
		},
		[product, snippets, running, pushPart, toBottom],
	);

	return (
		<div className="ac-win">
			<div className="ac-bar">
				<div className="ac-dots">
					<i />
					<i />
					<i />
				</div>
				<div className="ac-title">sl — agent</div>
			</div>

			<div className="ac-term" ref={termRef}>
				{messages.length === 0 ? (
					<div className="ac-intro">
						<div className="ac-comment">
							# ask the agent — it runs in a live sandbox, no key, no login
						</div>
						{SUGGESTIONS[product].map((s) => (
							<button
								type="button"
								key={s}
								className="ac-sgst"
								onClick={() => run(s)}
							>
								<span className="ac-pfx">›</span> {s}
							</button>
						))}
					</div>
				) : (
					messages.map((m, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
						<MessageView key={i} message={m} />
					))
				)}
				{running ? (
					<div className="ac-row">
						<span className="ac-pfx">$</span> <span className="ac-cur" />
					</div>
				) : null}
			</div>

			<form
				className="ac-prompt"
				onSubmit={(e) => {
					e.preventDefault();
					run(input);
				}}
			>
				<span className="ac-pfx">›</span>
				<input
					className="ac-prompt-input"
					placeholder="describe what you want…"
					spellCheck={false}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					disabled={running}
				/>
			</form>
		</div>
	);
}

function MessageView({ message }: { message: Message }) {
	if (message.role === "user") {
		const text = message.parts[0]?.type === "text" ? message.parts[0].text : "";
		return (
			<div className="ac-row ac-user">
				<span className="ac-pfx">›</span> {text}
			</div>
		);
	}
	return (
		<div className="ac-asst">
			{message.parts.map((part, i) => {
				if (part.type === "text") {
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
						<div className="ac-row ac-text" key={i}>
							{part.text}
						</div>
					);
				}
				if (part.type === "tool") {
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
						<div className="ac-tool" key={i}>
							<span className="ac-tool-b">·</span>
							<span className="ac-tool-name">{part.name}</span>
							<span className="ac-tool-detail">{part.detail}</span>
						</div>
					);
				}
				if (part.type === "file") {
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
						<div className="ac-file" key={i}>
							<div className="ac-file-head">
								<span className="ac-inf">✎</span>
								<span className="ac-file-path">{part.path}</span>
								<CopyButton code={part.body} />
							</div>
							<pre className="ac-file-body">{part.body}</pre>
						</div>
					);
				}
				// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
				return <UiPart key={i} action={part.action} />;
			})}
		</div>
	);
}

// ── generative-UI outputs rendered inline in the agent's response ───────────

function UiPart({ action }: { action: UiAction }) {
	if (action.kind === "result") return <ResultCard {...action} />;
	if (action.kind === "snippet") return <SnippetCard tabs={action.tabs} />;
	if (action.kind === "prompt")
		return <PromptCard label={action.label} text={action.text} />;
	if (action.kind === "deploy") return <DeployCard name={action.name} />;
	return <KeyPayoff blurb={action.blurb} />;
}

/** Simplified inline result — just the decoded rows, real keyless fetch. */
function ResultCard({
	endpoint,
	url,
	decimals,
	symbol,
}: {
	endpoint: string;
	url: string;
	decimals: number;
	symbol: string;
}) {
	const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
	const [rows, setRows] = useState<Record<string, unknown>[]>([]);
	const [ms, setMs] = useState(0);

	const load = useCallback(async () => {
		setPhase("loading");
		const t0 = performance.now();
		try {
			const res = await fetch(url);
			const json = (await res.json()) as {
				rows?: unknown[];
				events?: unknown[];
			};
			setMs(Math.round(performance.now() - t0));
			const list = (json.rows ?? json.events ?? []).slice(0, 3) as Record<
				string,
				unknown
			>[];
			setRows(list);
			setPhase(res.ok ? "done" : "error");
		} catch {
			setPhase("error");
		}
	}, [url]);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="ac-res">
			<div className="ac-res-head">
				<span className="ac-res-ep">{endpoint}</span>
				<span className="ac-res-sp" />
				<span className="ac-res-live">
					<span className="ac-res-dot" />
					{phase === "loading"
						? "running…"
						: phase === "error"
							? "error"
							: `${ms}ms`}
				</span>
			</div>
			{phase === "done" && rows.length > 0 ? (
				rows.map((r, i) => {
					const { who, amt } = summarizeRow(r, decimals, symbol);
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length result slice
						<div className="ac-res-row" key={i}>
							<span className="ac-res-who">{who}</span>
							{amt ? <span className="ac-res-amt">{amt}</span> : null}
						</div>
					);
				})
			) : (
				<div className="ac-res-empty">
					{phase === "loading" ? "querying…" : "no rows"}
				</div>
			)}
			<div className="ac-res-foot">
				<button type="button" className="ac-rerun" onClick={load}>
					↻ run again
				</button>
			</div>
		</div>
	);
}

/** Copy-paste snippet — quiet tabbed surfaces, pre-highlighted with Shiki. */
function SnippetCard({ tabs }: { tabs: HlSnippet[] }) {
	const [active, setActive] = useState(0);
	if (tabs.length === 0) return null;
	const current = tabs[active] ?? tabs[0];
	return (
		<div className="ac-snip">
			<div className="ac-snip-bar">
				{tabs.map((t, i) => (
					<button
						type="button"
						key={t.label}
						className={`ac-tab${i === active ? " on" : ""}`}
						onClick={() => setActive(i)}
					>
						{t.label}
					</button>
				))}
				<span className="ac-snip-sp" />
				<CopyButton code={current?.code ?? ""} />
			</div>
			<div
				className="ac-snip-code"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted server-rendered HTML
				dangerouslySetInnerHTML={{ __html: current?.html ?? "" }}
			/>
		</div>
	);
}

function PromptCard({ label, text }: { label: string; text: string }) {
	return (
		<div className="ac-pmt">
			<div className="ac-pmt-bar">
				{label}
				<span className="ac-pmt-sp" />
				<CopyButton code={text} />
			</div>
			<div className="ac-pmt-body">{text}</div>
		</div>
	);
}

/** Quiet payoff — a text link that reveals the inline keygen on intent. */
function KeyPayoff({ blurb }: { blurb: string }) {
	const [step, setStep] = useState<"link" | "email" | "done">("link");
	const [email, setEmail] = useState("");

	if (step === "done") {
		return (
			<div className="ac-gen-done">
				<span className="ac-ok">✓</span> key created —{" "}
				<code>sl_live_8f3c…a91d</code>. Drop it in{" "}
				<code>SECONDLAYER_API_KEY</code>.
			</div>
		);
	}
	if (step === "email") {
		return (
			<form
				className="ac-pay-form"
				onSubmit={(e) => {
					e.preventDefault();
					setStep("done");
				}}
			>
				<input
					className="ac-gen-input"
					type="email"
					placeholder="you@email.com"
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
				<button type="submit" className="ac-gen-go">
					Create key
				</button>
			</form>
		);
	}
	return (
		<div className="ac-pay">
			<button
				type="button"
				className="ac-pay-link"
				onClick={() => setStep("email")}
			>
				Generate an API key →
			</button>
			<span>{blurb}</span>
		</div>
	);
}

function DeployCard({ name }: { name: string }) {
	const [step, setStep] = useState<"cta" | "email" | "done">("cta");
	const [email, setEmail] = useState("");

	if (step === "done") {
		return (
			<div className="ac-gen-done">
				<span className="ac-ok">✓</span> subgraphs/{name} deployed under your
				account, backfilling now.
			</div>
		);
	}
	return (
		<div className="ac-gen">
			<div className="ac-gen-head">
				<span className="ac-gen-title">Deploy this subgraph</span>
				<span className="ac-gen-name">subgraphs/{name}</span>
			</div>
			{step === "cta" ? (
				<>
					<p className="ac-gen-sub">
						Deploy it to hosted Postgres + a public read API. We create your
						account and keep the sandbox.
					</p>
					<button
						type="button"
						className="ac-gen-go"
						onClick={() => setStep("email")}
					>
						Deploy
					</button>
				</>
			) : (
				<form
					className="ac-gen-form"
					onSubmit={(e) => {
						e.preventDefault();
						setStep("done");
					}}
				>
					<input
						className="ac-gen-input"
						type="email"
						placeholder="you@email.com"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
					<button type="submit" className="ac-gen-go">
						Create account & deploy
					</button>
				</form>
			)}
		</div>
	);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

function short(p: unknown): string {
	const s = String(p);
	return s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-6)}` : s;
}

/** Format a base-unit token amount at the asset's decimals, with tiered
 *  precision + trailing-zero trim so small (dust) amounts don't read 0.0000. */
function formatAmount(raw: unknown, decimals: number, symbol: string): string {
	const n = Number(raw);
	if (!Number.isFinite(n)) return "";
	const value = n / 10 ** decimals;
	if (value === 0) return `0 ${symbol}`;
	const places = value >= 1 ? 4 : value >= 0.0001 ? 6 : decimals;
	const str = value.toFixed(places).replace(/\.?0+$/, "");
	return `${str} ${symbol}`;
}

/** Best-effort one-line summary of a decoded row (transfer-shaped, else keys). */
function summarizeRow(
	r: Record<string, unknown>,
	decimals: number,
	symbol: string,
): { who: string; amt: string } {
	const sender = r.sender ?? r.from;
	const recipient = r.recipient ?? r.to;
	const amount = r.amount;
	if (sender && recipient) {
		return {
			who: `${short(sender)} → ${short(recipient)}`,
			amt: amount != null ? formatAmount(amount, decimals, symbol) : "",
		};
	}
	const who = Object.keys(r)
		.filter((k) => !k.startsWith("_"))
		.slice(0, 2)
		.map((k) => `${k}: ${String(r[k]).slice(0, 12)}`)
		.join(" · ");
	return { who: who || "row", amt: "" };
}

// ── per-product scripted responses (S2 deletes these) ───────────────────────

function scriptedRun(
	product: AgentProduct,
	snippets: HlSnippet[],
): { after: number; part: Part }[] {
	if (product === "index") {
		const url = `${API}/v1/index/events?event_type=ft_transfer&contract_id=${SBTC}&limit=3`;
		return [
			{
				after: 400,
				part: { type: "text", text: "Latest sBTC transfers, decoded:" },
			},
			{
				after: 500,
				part: {
					type: "tool",
					name: "index_events",
					detail: "ft_transfer · sbtc-token",
				},
			},
			{
				after: 250,
				part: {
					type: "ui",
					action: {
						kind: "result",
						endpoint: "/v1/index/events",
						url,
						decimals: 8,
						symbol: "sBTC",
					},
				},
			},
			{ after: 500, part: { type: "text", text: "Copy it for your stack:" } },
			{
				after: 250,
				part: { type: "ui", action: { kind: "snippet", tabs: snippets } },
			},
			{
				after: 500,
				part: { type: "text", text: "Or hand it to your own agent:" },
			},
			{
				after: 250,
				part: {
					type: "ui",
					action: {
						kind: "prompt",
						label: "Run in your agent",
						text: "/secondlayer query /v1/index/events?event_type=ft_transfer&contract_id=…sbtc-token&limit=5 and summarize the largest transfers",
					},
				},
			},
			{
				after: 300,
				part: {
					type: "ui",
					action: { kind: "key", blurb: "keyless reads are rate-limited" },
				},
			},
		];
	}
	if (product === "streams") {
		return [
			{ after: 400, part: { type: "text", text: "Tailing the raw firehose." } },
			{
				after: 500,
				part: { type: "tool", name: "streams_events", detail: "SSE · tip" },
			},
			{ after: 500, part: { type: "text", text: "Copy it for your stack:" } },
			{
				after: 250,
				part: { type: "ui", action: { kind: "snippet", tabs: snippets } },
			},
			{
				after: 500,
				part: { type: "text", text: "Or hand it to your own agent:" },
			},
			{
				after: 250,
				part: {
					type: "ui",
					action: {
						kind: "prompt",
						label: "Run in your agent",
						text: "/secondlayer consume streams.events from the tip and print each ft_transfer as it lands",
					},
				},
			},
			{
				after: 300,
				part: {
					type: "ui",
					action: { kind: "key", blurb: "keyless reads are rate-limited" },
				},
			},
		];
	}
	// subgraphs — scaffold + deploy
	return [
		{
			after: 450,
			part: { type: "text", text: "Reading the contract interface…" },
		},
		{
			after: 600,
			part: { type: "tool", name: "get_contract_abi", detail: SBTC },
		},
		{
			after: 800,
			part: {
				type: "text",
				text: "Found the print events and transfer function. Scaffolding a subgraph.",
			},
		},
		{
			after: 600,
			part: { type: "tool", name: "write", detail: "subgraph.ts" },
		},
		{
			after: 550,
			part: {
				type: "file",
				path: "subgraph.ts",
				body: `export default defineSubgraph({
  sources: ["sbtc-flows"],
  schema: { transfers: { from: "principal", to: "principal", amount: "uint" } },
  handlers: {
    print: ({ event, db }) =>
      db.transfers.insert({ from: event.sender, to: event.recipient, amount: event.amount }),
  },
});`,
			},
		},
		{
			after: 800,
			part: {
				type: "text",
				text: "Running in the sandbox — 1,284 transfers indexed. Deploy it to keep it:",
			},
		},
		{
			after: 350,
			part: { type: "ui", action: { kind: "deploy", name: "sbtc-flows" } },
		},
	];
}
