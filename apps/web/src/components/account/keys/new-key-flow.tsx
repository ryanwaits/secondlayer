"use client";

import { Choice } from "@/components/choice";
import { CopyButton } from "@/components/copy-button";
import { CreateKeyError, createKey } from "@/lib/account-data";
import { useState } from "react";

/** The most active keys an account can hold. Mirrors the API's default. */
export const KEY_LIMIT = 50;
export const NAME_MAX = 64;
/** The character counter shows once the name is past this. */
export const NAME_COUNT_FROM = 48;
/** A key's prefix as the list shows it: `sk-sl_` plus 8 characters. */
const PREFIX_LENGTH = 14;

const EMPTY_NAME_ERROR = "Give the key a name";

/** Why a name can't be used, or null when it can. */
export function nameError(name: string): string | null {
	return name.trim() ? null : EMPTY_NAME_ERROR;
}

/** A refused creation in words: the cap, the rate limit, or whatever the API said. */
export function createErrorMessage(err: unknown): string {
	if (err instanceof CreateKeyError) {
		if (err.status === 403) {
			return `You have ${KEY_LIMIT} keys. Revoke one to make another.`;
		}
		if (err.status === 429) {
			return err.retryAfter
				? `Too many new keys. Try again in ${err.retryAfter}s.`
				: "Too many new keys. Try again later.";
		}
	}
	return err instanceof Error ? err.message : "Couldn't create a key";
}

const sameName = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

/** The name already on one of your keys, if the typed name repeats it. */
export function duplicateName(
	name: string,
	existing: readonly string[],
): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	return existing.find((n) => sameName(n, trimmed)) ?? null;
}

export type UseItTab = "cli" | "env" | "sdk" | "agent";

export const USE_IT_TABS: { value: UseItTab; label: string }[] = [
	{ value: "cli", label: "CLI" },
	{ value: "env", label: "Env" },
	{ value: "sdk", label: "SDK" },
	{ value: "agent", label: "Agent" },
];

export interface UseItSnippet {
	/** What the block shows. Shows the key's prefix, never the whole key. */
	shown: string;
	/** What Copy puts on the clipboard: the same, except where the whole key is needed. */
	copy: string;
	note: string;
	/** A shell command, drawn with a `$`. */
	command: boolean;
}

const mcpBlock = (apiKey: string) =>
	`{
  "mcpServers": {
    "secondlayer": {
      "command": "npx",
      "args": ["-y", "@secondlayer/mcp"],
      "env": {
        "SECONDLAYER_API_URL": "https://api.secondlayer.tools",
        "SECONDLAYER_API_KEY": "${apiKey}"
      }
    }
  }
}`;

/** The four ways to put a new key to work. The whole key is only ever copied. */
export function useItSnippets(key: string): Record<UseItTab, UseItSnippet> {
	const hidden = `${key.slice(0, PREFIX_LENGTH)}…`;
	return {
		cli: {
			shown: "pbpaste | sl login --with-token",
			copy: "pbpaste | sl login --with-token",
			note: "Copy the key first. The CLI stores it for every sl command.",
			command: true,
		},
		env: {
			shown: `export SECONDLAYER_API_KEY=${hidden}`,
			copy: `export SECONDLAYER_API_KEY=${key}`,
			note: "The SDK, the CLI and the MCP server all read this variable.",
			command: true,
		},
		sdk: {
			shown: `import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiKey: process.env.SECONDLAYER_API_KEY,
});`,
			copy: `import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiKey: process.env.SECONDLAYER_API_KEY,
});`,
			note: "Keep the key in your environment, never in the code.",
			command: false,
		},
		agent: {
			shown: mcpBlock(hidden),
			copy: mcpBlock(key),
			note: "Paste into .mcp.json. A client's env block can't read your shell, so the key goes in literally.",
			command: false,
		},
	};
}

/** Step 1: a name, so keys can be told apart later. */
export function NameStep({
	existingNames = [],
	busy = false,
	error = null,
	initialName = "",
	cancelLabel = "Cancel",
	onSubmit,
	onCancel,
}: {
	/** Names of the keys you already have, for the repeat warning. */
	existingNames?: readonly string[];
	busy?: boolean;
	error?: string | null;
	initialName?: string;
	cancelLabel?: string;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [tried, setTried] = useState(false);
	const repeat = duplicateName(name, existingNames);
	const shownError = tried ? (nameError(name) ?? error) : error;

	return (
		<form
			className="nk"
			onSubmit={(e) => {
				e.preventDefault();
				setTried(true);
				if (nameError(name)) return;
				onSubmit(name.trim());
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape" && !busy) onCancel();
			}}
		>
			<label htmlFor="nk-name" className="nk-label">
				Name it for where it runs
			</label>
			<input
				id="nk-name"
				className="acct-input"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="laptop, ci, prod-indexer"
				maxLength={NAME_MAX}
				autoComplete="off"
				disabled={busy}
				autoFocus
			/>
			<p className="nk-hint">
				One key per place it runs, so revoking one never breaks the others.
				{name.length > NAME_COUNT_FROM ? (
					<span className="nk-count">
						{" "}
						{name.length}/{NAME_MAX}
					</span>
				) : null}
			</p>
			{repeat ? (
				<p className="nk-note">
					<span className="dash-dot hi" />
					<span>
						You already have a key called {repeat}. Names don't have to be
						unique; a new one helps you tell them apart.
					</span>
				</p>
			) : null}
			{shownError ? <p className="acct-error">{shownError}</p> : null}
			<div className="acct-row-actions">
				<button type="submit" className="acct-btn solid small" disabled={busy}>
					{busy ? "Creating…" : "Create key"}
				</button>
				<button
					type="button"
					className="acct-btn line small"
					onClick={onCancel}
					disabled={busy}
				>
					{cancelLabel}
				</button>
			</div>
		</form>
	);
}

function Snippet({ snippet }: { snippet: UseItSnippet }) {
	return (
		<div className={snippet.command ? "wh-cli" : "wh-cli nk-block"}>
			<code className="wh-cli-code">
				{snippet.command ? <span className="wh-cli-p">$ </span> : null}
				{snippet.shown}
			</code>
			<CopyButton code={snippet.copy} inline label="Copy" />
		</div>
	);
}

/** Step 2: the whole key, once, and four ways to use it. */
export function RevealStep({
	value,
	name,
	initialTab = "cli",
	onDone,
}: {
	value: string;
	name: string;
	initialTab?: UseItTab;
	onDone: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [everCopied, setEverCopied] = useState(false);
	const [warn, setWarn] = useState(false);
	const [tab, setTab] = useState<UseItTab>(initialTab);
	const snippets = useItSnippets(value);

	function copy() {
		navigator.clipboard.writeText(value).catch(() => {});
		setCopied(true);
		setEverCopied(true);
		setWarn(false);
		setTimeout(() => setCopied(false), 1400);
	}

	return (
		<div
			className="nk"
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				if (everCopied) onDone();
				else setWarn(true);
			}}
		>
			<p className="nk-lead">
				<strong>Copy it now.</strong> This is the only time you'll see the whole
				key.
			</p>
			<div className="nk-key">
				<span className="nk-key-name">{name}</span>
				<code className="nk-key-value">{value}</code>
				<button type="button" className="acct-btn line small" onClick={copy}>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="nk-use">
				<span id="nk-use-label" className="nk-label">
					Use it
				</span>
				<Choice
					name="nk-use"
					size="sm"
					labelledBy="nk-use-label"
					options={USE_IT_TABS}
					value={tab}
					onChange={(v) => setTab(v as UseItTab)}
				/>
			</div>
			<Snippet snippet={snippets[tab]} />
			<p className="nk-hint">{snippets[tab].note}</p>
			<div className="nk-foot">
				<p className="nk-hint">
					Lost it? Revoke this one and make another. We never show it again.
				</p>
				<button
					type="button"
					className="acct-btn solid small"
					onClick={() => (everCopied ? onDone() : setWarn(true))}
				>
					Done
				</button>
			</div>
			{warn && !everCopied ? (
				<p className="nk-note">
					<span className="dash-dot hi" />
					<span>
						You haven't copied it. It won't be shown again.{" "}
						<button type="button" className="ky-link" onClick={copy}>
							Copy
						</button>
						{" · "}
						<button type="button" className="ky-link" onClick={onDone}>
							Close anyway
						</button>
					</span>
				</p>
			) : null}
		</div>
	);
}

/**
 * Make a key: name it, then see it once with ways to use it. Callbacks in, no
 * routing, so the Keys tab and onboarding can both host it. `initial` opens
 * on the reveal for a key that already exists (sign-in hands one over).
 */
export function NewKeyFlow({
	existingNames = [],
	initial,
	create = createKey,
	cancelLabel = "Cancel",
	onCreated,
	onClose,
}: {
	existingNames?: readonly string[];
	initial?: { key: string; name: string } | null;
	create?: (name: string) => Promise<string>;
	cancelLabel?: string;
	/** The key exists; the whole value is still on screen. */
	onCreated?: (key: string, name: string) => void;
	/** Done, Close anyway or Cancel. */
	onClose: () => void;
}) {
	const [made, setMade] = useState(initial ?? null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (made) {
		return <RevealStep value={made.key} name={made.name} onDone={onClose} />;
	}

	async function submit(name: string) {
		setBusy(true);
		setError(null);
		try {
			const key = await create(name);
			setMade({ key, name });
			onCreated?.(key, name);
		} catch (err) {
			setError(createErrorMessage(err));
			setBusy(false);
		}
	}

	return (
		<NameStep
			existingNames={existingNames}
			busy={busy}
			error={error}
			cancelLabel={cancelLabel}
			onSubmit={submit}
			onCancel={onClose}
		/>
	);
}
