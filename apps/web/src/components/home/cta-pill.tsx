"use client";

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
		if (mint.phase === "minted") {
			copy(mint.key);
			return;
		}
		if (mint.phase === "minting") return;
		setMint({ phase: "minting" });
		try {
			const res = await fetch(`${API_BASE}/v1/keys`, { method: "POST" });
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { key: string; claim_url: string };
			setMint({ phase: "minted", key: body.key, claimUrl: body.claim_url });
			copy(body.key);
		} catch {
			setMint({ phase: "error" });
		}
	}

	return (
		<>
			<button
				type="button"
				className={`home-cmd home-cmd-mint${mint.phase === "minted" ? " minted" : ""}`}
				onClick={doMint}
				aria-label="Mint a free API key"
			>
				<span className="p">$</span>
				<span className="home-cmd-label">
					{mint.phase === "minted"
						? `${mint.key.slice(0, 12)}…${mint.key.slice(-4)}`
						: "curl -X POST api.secondlayer.tools/v1/keys"}
				</span>
				<span className="cp">
					{mint.phase === "minting"
						? "minting…"
						: mint.phase === "minted"
							? copied
								? "copied ✓"
								: "copy"
							: mint.phase === "error"
								? "retry"
								: "mint a key"}
				</span>
			</button>
			<p className="home-mint-fine" aria-live="polite">
				{mint.phase === "minted"
					? `on your clipboard · free tier · claim it at ${mint.claimUrl.replace(/^https?:\/\//, "").slice(0, 44)}…`
					: "free tier · no signup · claim it with an email whenever you want"}
			</p>
		</>
	);
}
