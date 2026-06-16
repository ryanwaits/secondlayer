"use client";

import { CopyButton } from "@/components/copy-button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCurl, buildPath, buildUrl, defaultValues } from "./build-request";
import type {
	FieldValue,
	FieldValues,
	PlaygroundConfig,
	PlaygroundField,
	PlaygroundPayoff,
} from "./types";

type Phase = "idle" | "loading" | "done" | "error";

interface RestResult {
	status?: number;
	ms?: number;
	body: string;
	rows?: number;
}

export interface PlaygroundProps {
	config: PlaygroundConfig;
	/** Real key creation; falls back to a simulated key for marketing demos. */
	onGenerateKey?: (email: string) => Promise<string>;
	/** Real claim/provision; falls back to a simulated success for demos. */
	onClaim?: () => Promise<void>;
}

/**
 * A live, keyless request cell rendered entirely from `config`. REST configs
 * fetch on Send; SSE configs open an EventSource ticker. Every state is
 * surfaced (idle / loading / done / error / empty) and the request is editable
 * inline, so pointing it at a different contract or table is a field edit.
 */
export function Playground({
	config,
	onGenerateKey,
	onClaim,
}: PlaygroundProps) {
	const [values, setValues] = useState<FieldValues>(() =>
		defaultValues(config),
	);
	const [phase, setPhase] = useState<Phase>("idle");
	const [result, setResult] = useState<RestResult | null>(null);
	const [ticks, setTicks] = useState<string[]>([]);
	const esRef = useRef<EventSource | null>(null);

	const url = useMemo(() => buildUrl(config, values), [config, values]);
	const path = useMemo(() => buildPath(config, values), [config, values]);
	const curl = useMemo(() => buildCurl(config, values), [config, values]);

	const reset = useCallback(() => {
		esRef.current?.close();
		esRef.current = null;
		setPhase("idle");
		setResult(null);
		setTicks([]);
	}, []);

	const setField = useCallback(
		(name: string, value: FieldValue) => {
			setValues((prev) => ({ ...prev, [name]: value }));
			reset();
		},
		[reset],
	);

	const applyPreset = useCallback(
		(values: FieldValues) => {
			setValues((prev) => ({ ...prev, ...values }));
			reset();
		},
		[reset],
	);

	const sendRest = useCallback(async () => {
		setPhase("loading");
		const started = performance.now();
		try {
			const res = await fetch(url);
			const ms = Math.round(performance.now() - started);
			const json = await res.json();
			setResult({
				status: res.status,
				ms,
				body: JSON.stringify(json, null, 2),
				rows: countRows(json),
			});
			setPhase(res.ok ? "done" : "error");
		} catch (err) {
			setResult({
				ms: Math.round(performance.now() - started),
				body: err instanceof Error ? err.message : "request failed",
			});
			setPhase("error");
		}
	}, [url]);

	const connectSse = useCallback(() => {
		esRef.current?.close();
		setTicks([]);
		setPhase("loading");
		const es = new EventSource(url);
		esRef.current = es;
		es.onopen = () => setPhase("done");
		es.onmessage = (e) =>
			setTicks((prev) => [formatTick(e.data), ...prev].slice(0, 8));
		es.onerror = () => {
			setPhase("error");
			es.close();
		};
	}, [url]);

	const send = config.request.mode === "sse" ? connectSse : sendRest;

	// Close any open stream when the cell unmounts (e.g. dock collapses).
	useEffect(() => () => esRef.current?.close(), []);

	const streaming = config.request.mode === "sse";

	return (
		<div className="pg">
			<div className="pg-head">
				<span className="pg-meth">{streaming ? "SSE" : "GET"}</span>
				<span className="pg-path" title={url}>
					{path}
				</span>
				<button
					type="button"
					className="pg-send"
					onClick={send}
					disabled={phase === "loading"}
				>
					{streaming ? (phase === "done" ? "Streaming" : "Tail") : "Send"}
				</button>
			</div>

			{config.presets ? (
				<div className="pg-presets">
					{config.presets.map((preset) => (
						<button
							type="button"
							key={preset.label}
							className="pg-preset"
							onClick={() => applyPreset(preset.values)}
						>
							{preset.label}
						</button>
					))}
				</div>
			) : null}

			<FieldsEditor
				fields={config.request.fields}
				values={values}
				onChange={setField}
			/>

			<ResponseView
				render={config.render}
				phase={phase}
				result={result}
				ticks={ticks}
				curl={curl}
				streaming={streaming}
			/>

			{config.agents ? (
				<div className="pg-agents">
					<span className="t">for agents</span>
					<div className="links">
						{config.agents.markdown && (
							<a href={config.agents.markdown}>docs.md</a>
						)}
						{config.agents.openapi && (
							<a href={config.agents.openapi}>openapi.json</a>
						)}
						{config.agents.schema && (
							<a href={config.agents.schema}>schema.json</a>
						)}
						{config.agents.stream && (
							<a href={config.agents.stream}>stream (SSE)</a>
						)}
					</div>
				</div>
			) : null}

			<Payoff
				payoff={config.payoff}
				onGenerateKey={onGenerateKey}
				onClaim={onClaim}
			/>
		</div>
	);
}

// ── fields ────────────────────────────────────────────────────────────────

function FieldsEditor({
	fields,
	values,
	onChange,
}: {
	fields: PlaygroundField[];
	values: FieldValues;
	onChange: (name: string, value: FieldValue) => void;
}) {
	if (fields.length === 0) return null;
	return (
		<div className="pg-fields">
			{fields.map((field) => (
				<label
					className="pg-field"
					key={field.name}
					htmlFor={`pg-${field.name}`}
				>
					<span className="pg-field-label">{field.label}</span>
					{field.kind === "enum" ? (
						<select
							id={`pg-${field.name}`}
							className="pg-control"
							value={String(values[field.name] ?? "")}
							onChange={(e) => onChange(field.name, e.target.value)}
						>
							{field.options.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label ?? opt.value}
								</option>
							))}
						</select>
					) : field.kind === "number" ? (
						<input
							id={`pg-${field.name}`}
							className="pg-control pg-control-num"
							type="number"
							min={field.min}
							max={field.max}
							step={field.step}
							value={String(values[field.name] ?? "")}
							onChange={(e) => onChange(field.name, Number(e.target.value))}
						/>
					) : (
						<input
							id={`pg-${field.name}`}
							className="pg-control pg-control-mono"
							type="text"
							spellCheck={false}
							placeholder={field.placeholder}
							value={String(values[field.name] ?? "")}
							onChange={(e) => onChange(field.name, e.target.value)}
						/>
					)}
				</label>
			))}
		</div>
	);
}

// ── response ──────────────────────────────────────────────────────────────

function ResponseView({
	render,
	phase,
	result,
	ticks,
	curl,
	streaming,
}: {
	render: "json" | "ticker";
	phase: Phase;
	result: RestResult | null;
	ticks: string[];
	curl: string;
	streaming: boolean;
}) {
	const status =
		phase === "idle"
			? "idle · press to run"
			: phase === "loading"
				? streaming
					? "connecting…"
					: "querying…"
				: phase === "error"
					? `${result?.status ?? "error"} · ${result?.ms ?? 0}ms`
					: streaming
						? "● live"
						: `${result?.status} · ${result?.ms}ms${
								result?.rows != null ? ` · ${result.rows} rows` : ""
							}`;

	return (
		<div className={`pg-res${phase === "idle" ? " idle" : ""}`}>
			<div className="pg-res-meta" aria-live="polite">
				<span
					className={`pg-dot${phase === "error" ? " err" : ""}${
						streaming && phase === "done" ? " live" : ""
					}`}
				/>
				<span className="pg-res-status">{status}</span>
				<span className="pg-spacer" />
				<CopyButton code={curl} />
			</div>

			{render === "ticker" ? (
				<div className="pg-ticker">
					{ticks.length === 0 ? (
						<p className="pg-hint">
							{phase === "idle"
								? "press Tail — events stream in live, no key"
								: "waiting for the next block…"}
						</p>
					) : (
						ticks.map((tick, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only log
							<div className="pg-tick" key={`${tick}-${i}`}>
								{tick}
							</div>
						))
					)}
				</div>
			) : (
				<pre className="pg-pre">
					{result?.body ?? "// press Send — no key, no login"}
				</pre>
			)}
		</div>
	);
}

// ── payoff ────────────────────────────────────────────────────────────────

function Payoff({
	payoff,
	onGenerateKey,
	onClaim,
}: {
	payoff: PlaygroundPayoff;
	onGenerateKey?: (email: string) => Promise<string>;
	onClaim?: () => Promise<void>;
}) {
	if (payoff.kind === "apiKey") {
		return <ApiKeyPayoff blurb={payoff.blurb} onGenerateKey={onGenerateKey} />;
	}
	return <ClaimPayoff payoff={payoff} onClaim={onClaim} />;
}

function ApiKeyPayoff({
	blurb,
	onGenerateKey,
}: {
	blurb: string;
	onGenerateKey?: (email: string) => Promise<string>;
}) {
	const [step, setStep] = useState<"cta" | "email" | "done">("cta");
	const [email, setEmail] = useState("");
	const [apiKey, setApiKey] = useState("");
	const emailRef = useRef<HTMLInputElement>(null);

	// Focus the email field when it's revealed by intent (not on page load).
	useEffect(() => {
		if (step === "email") emailRef.current?.focus();
	}, [step]);

	const submit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			const key = onGenerateKey
				? await onGenerateKey(email)
				: "sl_live_8f3c…a91d";
			setApiKey(key);
			setStep("done");
		},
		[email, onGenerateKey],
	);

	if (step === "done") {
		return (
			<div className="pg-out">
				<span className="pg-ck">✓</span>
				<div>
					<b>Key created.</b>
					<code className="pg-key">{apiKey}</code>
					<span>
						Drop it in <code>SECONDLAYER_API_KEY</code> for higher limits, same
						endpoints.
					</span>
				</div>
				<CopyButton code={apiKey} />
			</div>
		);
	}

	if (step === "email") {
		return (
			<form className="pg-keygen" onSubmit={submit}>
				<input
					ref={emailRef}
					type="email"
					className="pg-control pg-control-mono"
					placeholder="you@email.com"
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
				<button type="submit" className="pg-keygen-go">
					Create key
				</button>
			</form>
		);
	}

	return (
		<button type="button" className="pg-claim" onClick={() => setStep("email")}>
			<span className="pg-claim-main">Generate an API key</span>
			<span className="pg-claim-sub">{blurb}</span>
		</button>
	);
}

function ClaimPayoff({
	payoff,
	onClaim,
}: {
	payoff: Extract<PlaygroundPayoff, { kind: "claim" }>;
	onClaim?: () => Promise<void>;
}) {
	const [claimed, setClaimed] = useState(false);

	const claim = useCallback(async () => {
		await onClaim?.();
		setClaimed(true);
	}, [onClaim]);

	if (claimed) {
		return (
			<div className="pg-out">
				<span className="pg-ck">✓</span>
				<div>
					<b>Claimed.</b>
					<span>{payoff.success}</span>
				</div>
			</div>
		);
	}

	return (
		<>
			{payoff.scaffold ? (
				<div className="pg-scaffold">
					<span className="pg-meth alt">CLI</span>
					<span className="pg-path">{payoff.scaffold}</span>
					<CopyButton code={payoff.scaffold} />
				</div>
			) : null}
			<button type="button" className="pg-claim" onClick={claim}>
				<span className="pg-claim-main">{payoff.cta}</span>
				<span className="pg-claim-sub">
					creates your account with the resource already set up
				</span>
			</button>
		</>
	);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function countRows(json: unknown): number | undefined {
	if (json && typeof json === "object") {
		const obj = json as Record<string, unknown>;
		if (Array.isArray(obj.rows)) return obj.rows.length;
		if (Array.isArray(obj.events)) return obj.events.length;
	}
	return undefined;
}

/** Compact one SSE event into a single ticker line. */
function formatTick(data: string): string {
	try {
		const ev = JSON.parse(data) as Record<string, unknown>;
		const height = ev.block_height ?? ev._block_height;
		const type = ev.event_type ?? ev.topic;
		if (height && type) return `#${height} · ${type}`;
	} catch {
		// fall through to the raw line
	}
	return data.length > 88 ? `${data.slice(0, 88)}…` : data;
}
