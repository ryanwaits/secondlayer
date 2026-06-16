"use client";

import { CopyButton } from "@/components/copy-button";
import { useCallback, useRef, useState } from "react";

/**
 * Inline agent-harness chat, rendered as an in-terminal Claude Code session in
 * a self-contained console window that copies the marketing `pp-window` design.
 * The render layer is shaped to AI SDK 7 harness stream parts (text / tool-call
 * / file-change) plus a `ui` part for generative-UI actions (deploy a subgraph,
 * create a key) — so S2 swaps the local `scriptedRun` driver for `useChat` over
 * `/api/agent` (HarnessAgent → toUIMessageStream) without touching this UI.
 */

type Part =
	| { type: "text"; text: string }
	| { type: "tool"; name: string; detail: string }
	| { type: "file"; path: string; body: string }
	| { type: "ui"; kind: "deploy" | "createKey"; name?: string };

interface Message {
	role: "user" | "assistant";
	parts: Part[];
}

const SUGGESTIONS = [
	"Index every sBTC transfer to my contract",
	"Build a BNS names subgraph",
	"Track Velar swap events into a table",
];

export function AgentChat() {
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
			for (const step of scriptedRun(prompt)) {
				await delay(step.after);
				pushPart(step.part);
			}

			setRunning(false);
		},
		[running, pushPart, toBottom],
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
							# ask the agent to build something on Stacks — it runs in a live
							sandbox
						</div>
						{SUGGESTIONS.map((s) => (
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
					placeholder="describe what to build…"
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
				return part.kind === "deploy" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
					<DeployCard key={i} name={part.name ?? "sbtc-flows"} />
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: stable within a turn
					<KeyCard key={i} />
				);
			})}
		</div>
	);
}

// ── generative-UI actions rendered inline in the agent's response ───────────

function DeployCard({ name }: { name: string }) {
	const [step, setStep] = useState<"cta" | "email" | "done">("cta");
	const [email, setEmail] = useState("");

	if (step === "done") {
		return (
			<div className="ac-gen ac-gen-done">
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

function KeyCard() {
	const [step, setStep] = useState<"cta" | "email" | "done">("cta");
	const [email, setEmail] = useState("");

	if (step === "done") {
		return (
			<div className="ac-gen ac-gen-done">
				<span className="ac-ok">✓</span> key created —{" "}
				<code>sl_live_8f3c…a91d</code>. Drop it in{" "}
				<code>SECONDLAYER_API_KEY</code>.
			</div>
		);
	}
	return (
		<div className="ac-gen">
			<div className="ac-gen-head">
				<span className="ac-gen-title">Generate an API key</span>
			</div>
			{step === "cta" ? (
				<>
					<p className="ac-gen-sub">
						Keyless reads are rate-limited. A key lifts limits and works in your
						code.
					</p>
					<button
						type="button"
						className="ac-gen-go"
						onClick={() => setStep("email")}
					>
						Create a key
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
						Create key
					</button>
				</form>
			)}
		</div>
	);
}

// ── local driver (S2 deletes this) ─────────────────────────────────────────

function delay(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

/** A scripted subgraph build, in the same part shapes the harness streams. */
function scriptedRun(_prompt: string): { after: number; part: Part }[] {
	const contract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
	return [
		{
			after: 450,
			part: { type: "text", text: "Reading the contract interface…" },
		},
		{
			after: 650,
			part: { type: "tool", name: "get_contract_abi", detail: contract },
		},
		{
			after: 850,
			part: {
				type: "text",
				text: "Found the print events and transfer function. Scaffolding a subgraph.",
			},
		},
		{
			after: 650,
			part: { type: "tool", name: "write", detail: "subgraph.ts" },
		},
		{
			after: 550,
			part: {
				type: "file",
				path: "subgraph.ts",
				body: `export default defineSubgraph({
  sources: ["${contract}"],
  schema: { transfers: { from: "principal", to: "principal", amount: "uint" } },
  handlers: {
    print: ({ event, db }) =>
      db.transfers.insert({ from: event.sender, to: event.recipient, amount: event.amount }),
  },
});`,
			},
		},
		{
			after: 850,
			part: {
				type: "tool",
				name: "deploy_preview",
				detail: "sandbox · backfilling",
			},
		},
		{
			after: 850,
			part: {
				type: "text",
				text: "Running in the sandbox — 1,284 sBTC transfers indexed. Deploy it to keep it:",
			},
		},
		{ after: 350, part: { type: "ui", kind: "deploy", name: "sbtc-flows" } },
	];
}
