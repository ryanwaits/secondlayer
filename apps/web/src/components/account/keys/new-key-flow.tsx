"use client";

import { Choice } from "@/components/choice";
import { CopyButton } from "@/components/copy-button";
import { notify } from "@/components/toast/notify";
import { CreateKeyError, createKey } from "@/lib/account-data";
import { useCopied } from "@/lib/use-copied";
import { useLayoutEffect, useReducer, useRef, useState } from "react";
import {
	KEY_FLOW_IDLE,
	type KeyFlow,
	type KeyFlowEvent,
	keyFlowReducer,
} from "./key-flow";

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

/** Create key waits for a name and for the last request to finish. */
export function createKeyDisabled(name: string, busy: boolean): boolean {
	return busy || nameError(name) !== null;
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
	/** Without it the step has no Cancel: the flow is the screen's only job. */
	onCancel?: () => void;
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
				if (e.key === "Escape" && !busy) onCancel?.();
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
					<span>
						You already have a key called {repeat}. Names don't have to be
						unique; a new one helps you tell them apart.
					</span>
				</p>
			) : null}
			{shownError ? <p className="acct-error">{shownError}</p> : null}
			<div className="acct-row-actions">
				<button
					type="submit"
					className="acct-btn solid small"
					disabled={createKeyDisabled(name, busy)}
				>
					{busy ? "Creating…" : "Create key"}
				</button>
				{onCancel ? (
					<button
						type="button"
						className="acct-btn line small"
						onClick={onCancel}
						disabled={busy}
					>
						{cancelLabel}
					</button>
				) : null}
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
	copied = false,
	warned = false,
	onCopied,
	onWarn,
	onDone,
}: {
	value: string;
	name: string;
	initialTab?: UseItTab;
	/** The key reached the clipboard. Owned by the flow, so it survives a remount. */
	copied?: boolean;
	/** The reader tried to leave without copying. */
	warned?: boolean;
	onCopied?: () => void;
	onWarn?: () => void;
	/** `force` is Close anyway: leave although the key was never copied. */
	onDone: (force?: boolean) => void;
}) {
	const { copied: flash, copy: copyValue } = useCopied();
	const [tab, setTab] = useState<UseItTab>(initialTab);
	const snippets = useItSnippets(value);

	async function copy() {
		if (await copyValue(value)) onCopied?.();
		else {
			notify.fail("Couldn't copy the key", {
				desc: "Select it and copy it by hand. It won't be shown again.",
			});
		}
	}

	return (
		<div
			className="nk"
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				if (copied) onDone();
				else onWarn?.();
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
					{flash ? "Copied" : "Copy"}
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
					Lost it? Rotate this key for a new one. We never show it again.
				</p>
				<button
					type="button"
					className="acct-btn solid small"
					onClick={() => (copied ? onDone() : onWarn?.())}
				>
					Done
				</button>
			</div>
			{warned && !copied ? (
				<p className="nk-note">
					<span>
						You haven't copied it. It won't be shown again.{" "}
						<button type="button" className="ky-link" onClick={copy}>
							Copy
						</button>
						{" · "}
						<button
							type="button"
							className="ky-link"
							onClick={() => onDone(true)}
						>
							Close anyway
						</button>
					</span>
				</p>
			) : null}
		</div>
	);
}

/**
 * The create-key lifecycle for a screen: the reducer, and the first-run offer.
 * It lives in the screen, above anything that mounts or unmounts, so a key on
 * screen is never lost to a re-render. `open` offers the name step once, the
 * first time it turns true (an account that never made a key).
 */
export function useKeyFlow(initial: KeyFlow = KEY_FLOW_IDLE, open = false) {
	const [flow, dispatch] = useReducer(keyFlowReducer, initial);
	const offered = useRef(false);
	useLayoutEffect(() => {
		if (!open || offered.current) return;
		offered.current = true;
		dispatch({ type: "open" });
	}, [open]);
	return [flow, dispatch] as const;
}

/**
 * Make a key: name it, then see it once with ways to use it. State in, events
 * out (`useKeyFlow`), no routing, so the Keys tab and onboarding can both host
 * it. Renders nothing while the flow is idle.
 */
export function NewKeyFlow({
	flow,
	dispatch,
	existingNames = [],
	create = createKey,
	cancelLabel = "Cancel",
	dismissible = true,
	onCreated,
}: {
	flow: KeyFlow;
	dispatch: (event: KeyFlowEvent) => void;
	existingNames?: readonly string[];
	create?: (name: string) => Promise<string>;
	cancelLabel?: string;
	/** False when the flow is the screen's only job: no Cancel on the name step. */
	dismissible?: boolean;
	/** The key exists; the whole value is still on screen. */
	onCreated?: (key: string, name: string) => void;
}) {
	if (flow.step === "idle") return null;

	if (flow.step === "revealed") {
		return (
			<RevealStep
				value={flow.key}
				name={flow.name}
				copied={flow.copied}
				warned={flow.warned}
				onCopied={() => dispatch({ type: "copied" })}
				onWarn={() => dispatch({ type: "warn" })}
				onDone={(force) => dispatch({ type: "close", force })}
			/>
		);
	}

	async function submit(name: string) {
		dispatch({ type: "submit", name });
		try {
			const key = await create(name);
			dispatch({ type: "created", key, name });
			onCreated?.(key, name);
		} catch (err) {
			dispatch({ type: "failed", error: createErrorMessage(err) });
		}
	}

	return (
		<NameStep
			existingNames={existingNames}
			busy={flow.step === "submitting"}
			error={flow.step === "naming" ? flow.error : null}
			cancelLabel={cancelLabel}
			onSubmit={submit}
			onCancel={dismissible ? () => dispatch({ type: "close" }) : undefined}
		/>
	);
}
