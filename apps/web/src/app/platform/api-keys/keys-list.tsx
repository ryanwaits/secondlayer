"use client";

import { CopyButton } from "@/components/copy-button";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/lib/queries/api-keys";
import type { ApiKey } from "@/lib/types";
import { useCallback, useRef, useState } from "react";

function timeAgo(dateStr: string | null): string {
	if (!dateStr) return "never";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

export function KeysList({
	initialKeys,
	sessionToken = "",
}: {
	initialKeys: ApiKey[];
	sessionToken?: string;
}) {
	const { data: keys = initialKeys } = useApiKeys(initialKeys);
	const createKey = useCreateApiKey();
	const revokeKey = useRevokeApiKey();
	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [newRawKey, setNewRawKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const status = createKey.isPending
		? "creating"
		: createKey.isError
			? "error"
			: createKey.isSuccess && newRawKey
				? "done"
				: "idle";

	const handleCreate = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			createKey.mutate(name || undefined, {
				onSuccess: (data) => {
					setNewRawKey(data.key);
				},
			});
		},
		[name, createKey],
	);

	const handleCopy = useCallback(async () => {
		if (!newRawKey) return;
		await navigator.clipboard.writeText(newRawKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [newRawKey]);

	const dismissSuccess = useCallback(() => {
		setNewRawKey(null);
		setShowForm(false);
		setName("");
		createKey.reset();
	}, [createKey]);

	return (
		<>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
				<div>
					<h1 className="settings-title">API Keys</h1>
					<p className="settings-desc">Manage keys for authenticating with the secondlayer API. Keep these secret.</p>
				</div>
			</div>

			{!showForm && status !== "done" && (
				<div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
					<button
						type="button"
						className="settings-btn primary"
						style={{ display: "flex", alignItems: "center", gap: 5 }}
						onClick={() => {
							setShowForm(true);
							setTimeout(() => inputRef.current?.focus(), 0);
						}}
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>
						Create key
					</button>
				</div>
			)}

			{/* Inline create form */}
			{showForm && status !== "done" && (
				<div style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
					<form onSubmit={handleCreate} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
						<label style={{ flex: 1 }}>
							<span className="settings-label">Key name</span>
							<input
								ref={inputRef}
								className="settings-input"
								type="text"
								placeholder="e.g. production"
								value={name}
								onChange={(e) => setName(e.target.value)}
								autoFocus
							/>
						</label>
						<button type="submit" className="settings-btn primary" disabled={status === "creating"}>
							{status === "creating" ? "..." : "Create"}
						</button>
						<button type="button" className="settings-btn ghost" onClick={() => { setShowForm(false); setName(""); }}>
							Cancel
						</button>
					</form>
					{status === "error" && (
						<p style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>
							Failed to create key. Try again.
						</p>
					)}
				</div>
			)}

			{/* Success banner */}
			{status === "done" && newRawKey && (
				<div style={{ padding: "14px 16px", border: "1px solid var(--green)", borderRadius: 8, marginBottom: 16, background: "var(--green-bg)" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth="2" aria-hidden="true"><path d="M4 8l3 3 5-5" /></svg>
						<span style={{ fontSize: 13, fontWeight: 500 }}>{name || "Key"} created</span>
						<span style={{ flex: 1 }} />
						<button type="button" className="settings-btn ghost" onClick={dismissSuccess}>Dismiss</button>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--code-bg)", borderRadius: 6 }}>
						<span style={{ flex: 1, fontFamily: "var(--font-mono-stack)", fontSize: 12, wordBreak: "break-all" }}>{newRawKey}</span>
						<button type="button" className="settings-btn ghost" onClick={handleCopy}>{copied ? "Copied" : "Copy"}</button>
					</div>
					<div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
						Copy this key now — it won&apos;t be shown again.
					</div>
				</div>
			)}

			{/* Keys list */}
			<div className="settings-section">
				{keys.length === 0 && !showForm ? (
					<div className="ov-empty">
						No API keys yet.{" "}
						<button type="button" className="ov-section-link" onClick={() => setShowForm(true)} style={{ cursor: "pointer", background: "none", border: "none", font: "inherit" }}>
							Create your first key &rarr;
						</button>
					</div>
				) : (
					keys.map((key) => (
						<div key={key.id} className="settings-key-row">
							<div className="settings-key-name">{key.name || key.prefix}</div>
							<div className="settings-key-prefix">{key.prefix}</div>
							<div className="settings-key-created">
								{new Date(key.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
							</div>
							<button
								type="button"
								className="settings-key-revoke"
								style={key.status !== "active" ? { visibility: "hidden" } : undefined}
								onClick={() => { if (confirm("Revoke this key? This cannot be undone.")) revokeKey.mutate(key.id); }}
							>
								Revoke
							</button>
						</div>
					))
				)}
			</div>

			<div className="settings-divider" />

			<div className="settings-section">
				<div className="settings-section-title">Rate limits</div>
				<div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
					Each key allows <span style={{ fontFamily: "var(--font-mono-stack)", fontSize: 12, color: "var(--text-main)", fontWeight: 500 }}>1,000</span> requests per minute.
					Exceeding this limit returns <span style={{ fontFamily: "var(--font-mono-stack)", fontSize: 12, color: "var(--text-main)" }}>429 Too Many Requests</span>.
				</div>
			</div>
		</>
	);
}
