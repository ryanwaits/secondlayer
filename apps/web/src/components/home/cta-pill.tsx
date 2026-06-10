"use client";

import { Notation } from "@/components/notation";
import { useState } from "react";

const GHOST_KEYS_ENABLED = process.env.NEXT_PUBLIC_GHOST_KEYS === "1";
const API_BASE =
	process.env.NEXT_PUBLIC_API_URL ?? "https://api.secondlayer.tools";
const INSTALL_CMD = "npm install @secondlayer/sdk";

type MintState =
	| { phase: "idle" }
	| { phase: "minting" }
	| { phase: "minted"; key: string; claimUrl: string }
	| { phase: "error" };

/**
 * Hero CTA. Two modes behind NEXT_PUBLIC_GHOST_KEYS:
 *  - off (default): copyable SDK install command
 *  - on: "mint a key" — POST /v1/keys (anon ghost key), key lands on the
 *    clipboard; fine print swaps to the claim URL
 */
function KeyLine({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="home-reveal-line">
			<span className="k">{label}</span>
			<span className="v">{value}</span>
			<button
				type="button"
				className="home-reveal-copy"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
					} catch {}
					setCopied(true);
					setTimeout(() => setCopied(false), 1300);
				}}
			>
				{copied ? "✓ copied" : "copy"}
			</button>
		</div>
	);
}

export function CtaPill() {
	const [copied, setCopied] = useState(false);
	const [mint, setMint] = useState<MintState>({ phase: "idle" });

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {}
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	if (!GHOST_KEYS_ENABLED) {
		return (
			<button
				type="button"
				className="home-cmd"
				onClick={() => copy(INSTALL_CMD)}
				aria-label="Copy install command"
			>
				<span className="p">$</span>
				<span className="home-cmd-label">{INSTALL_CMD}</span>
				<span className="cp">{copied ? "copied" : "copy"}</span>
			</button>
		);
	}

	async function doMint() {
		if (mint.phase === "minting" || mint.phase === "minted") return;
		setMint({ phase: "minting" });
		try {
			const res = await fetch(`${API_BASE}/v1/keys`, { method: "POST" });
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { key: string; claim_url: string };
			setMint({ phase: "minted", key: body.key, claimUrl: body.claim_url });
		} catch {
			setMint({ phase: "error" });
		}
	}

	return (
		<div className="home-cta-col">
			<button
				type="button"
				className="home-cmd home-cmd-mint"
				onClick={doMint}
				aria-label="Mint a free API key"
			>
				<span className="p">$</span>
				<span className="home-cmd-label">
					curl -X POST api.secondlayer.tools/v1/keys
				</span>
				<span className="cp">
					{mint.phase === "minting"
						? "minting…"
						: mint.phase === "minted"
							? "minted ✓"
							: mint.phase === "error"
								? "retry"
								: "mint a key"}
				</span>
			</button>
			{mint.phase === "minted" ? (
				<div className="home-reveal" aria-live="polite">
					<div className="home-reveal-head">
						<span className="t">Your key is live.</span>
						<span className="once">shown once — save it</span>
					</div>
					<KeyLine label="key" value={mint.key} />
					<KeyLine label="claim" value={mint.claimUrl} />
				</div>
			) : (
				<p className="home-mint-fine" aria-live="polite">
					<Notation
						type="underline"
						color="var(--accent)"
						strokeWidth={2}
						padding={2}
						animationDuration={600}
						iterations={2}
					>
						get an API key, no sign up required
					</Notation>
				</p>
			)}
		</div>
	);
}
