"use client";

import { useEffect, useState } from "react";

interface DbAccess {
	slug: string;
	bastionHost: string;
	bastionPort: number;
	bastionUser: string;
	pgContainer: string;
	localPort: number;
	sshCommand: string;
	databaseUrl: string;
}

/**
 * Direct-DB access surface — mirrors the `sl instance db` CLI flow.
 *
 *   1. Fetch the tunnel/URL template from /api/tenants/me/db-access.
 *   2. User uploads their SSH pubkey (we never see their private key).
 *   3. We reveal the `ssh -L` command + DATABASE_URL for copy-paste.
 *
 * The DATABASE_URL only works while the tunnel is open — no point showing
 * it before the pubkey is installed, because the tunnel won't authenticate.
 */
export function DbAccessSection({ sessionToken }: { sessionToken: string }) {
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [access, setAccess] = useState<DbAccess | null>(null);
	const [pubkey, setPubkey] = useState("");
	const [keyInstalled, setKeyInstalled] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showUpload, setShowUpload] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);

	useEffect(() => {
		const run = async () => {
			try {
				const res = await fetch("/api/tenants/me/db-access", {
					headers: { Authorization: `Bearer ${sessionToken}` },
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				setAccess((await res.json()) as DbAccess);
				setState("ready");
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to load");
				setState("error");
			}
		};
		run();
	}, [sessionToken]);

	const copy = async (value: string, tag: string) => {
		await navigator.clipboard.writeText(value);
		setCopied(tag);
		setTimeout(() => setCopied(null), 1500);
	};

	const handleUpload = async () => {
		const trimmed = pubkey.trim();
		if (!trimmed) {
			setError("Paste your public key (ssh-ed25519 or ssh-rsa)");
			return;
		}
		setUploading(true);
		setError(null);
		try {
			const res = await fetch("/api/tenants/me/db-access/key", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ publicKey: trimmed }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Upload failed (${res.status})`);
			}
			setKeyInstalled(true);
			setShowUpload(false);
			setPubkey("");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	const handleRevoke = async () => {
		if (
			!window.confirm(
				"Revoke bastion access? You'll need to upload a key again to reconnect.",
			)
		) {
			return;
		}
		try {
			const res = await fetch("/api/tenants/me/db-access/key", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setKeyInstalled(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Revoke failed");
		}
	};

	if (state === "loading") {
		return (
			<section className="settings-section">
				<div className="settings-section-title">Database access</div>
				<div className="instance-gauge-empty">
					<span className="pulse" />
					Loading…
				</div>
			</section>
		);
	}

	if (state === "error" || !access) {
		return (
			<section className="settings-section">
				<div className="settings-section-title">Database access</div>
				<div className="settings-hint" style={{ color: "var(--red)" }}>
					{error ?? "Could not load database access info."}
				</div>
			</section>
		);
	}

	return (
		<section className="settings-section">
			<div className="settings-section-title">Database access</div>
			<p className="settings-desc" style={{ marginBottom: 14 }}>
				Tunnel to your tenant Postgres over SSH. Your public key is installed on
				our bastion — we never see your private key.
			</p>

			{!keyInstalled && !showUpload && (
				<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
					<button
						type="button"
						className="settings-btn primary small"
						onClick={() => setShowUpload(true)}
					>
						Upload SSH public key
					</button>
					<span className="settings-hint" style={{ alignSelf: "center" }}>
						Paste the contents of <code>~/.ssh/id_ed25519.pub</code> or similar.
					</span>
				</div>
			)}

			{showUpload && (
				<div style={{ marginBottom: 16 }}>
					<textarea
						className="settings-input"
						placeholder="ssh-ed25519 AAAAC3Nz… user@host"
						value={pubkey}
						onChange={(e) => setPubkey(e.target.value)}
						rows={3}
						spellCheck={false}
						style={{
							width: "100%",
							fontFamily: "var(--font-mono-stack)",
							fontSize: 12,
							marginBottom: 8,
						}}
					/>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							type="button"
							className="settings-btn primary small"
							onClick={handleUpload}
							disabled={uploading || !pubkey.trim()}
						>
							{uploading ? "Installing…" : "Install key"}
						</button>
						<button
							type="button"
							className="settings-btn ghost small"
							onClick={() => {
								setShowUpload(false);
								setPubkey("");
								setError(null);
							}}
						>
							Cancel
						</button>
					</div>
					{error && (
						<div
							className="settings-hint"
							style={{ color: "var(--red)", marginTop: 8 }}
						>
							{error}
						</div>
					)}
				</div>
			)}

			{keyInstalled && (
				<div className="instance-banner info" style={{ marginBottom: 12 }}>
					<span className="banner-dot" />
					<div className="banner-body">
						Key installed. Open the tunnel in one terminal, then use the{" "}
						<code>DATABASE_URL</code> from another.
					</div>
				</div>
			)}

			<div className="instance-kv" style={{ marginBottom: 12 }}>
				<div className="row">
					<div className="key">bastion</div>
					<div className="val mono">
						{access.bastionUser}@{access.bastionHost}:{access.bastionPort}
					</div>
				</div>
				<div className="row">
					<div className="key">target</div>
					<div className="val mono">{access.pgContainer}:5432</div>
				</div>
			</div>

			<div className="settings-section-title" style={{ marginTop: 16 }}>
				1. Open the tunnel
			</div>
			<div className="connect-url">
				<span className="url">{access.sshCommand}</span>
				<button
					type="button"
					className="copy-btn"
					onClick={() => copy(access.sshCommand, "ssh")}
				>
					{copied === "ssh" ? "copied" : "copy"}
				</button>
			</div>

			<div className="settings-section-title" style={{ marginTop: 16 }}>
				2. Connect with this URL
			</div>
			<div className="connect-url">
				<span className="url">{access.databaseUrl}</span>
				<button
					type="button"
					className="copy-btn"
					onClick={() => copy(access.databaseUrl, "url")}
				>
					{copied === "url" ? "copied" : "copy"}
				</button>
			</div>

			{keyInstalled && (
				<div style={{ marginTop: 12 }}>
					<button
						type="button"
						className="settings-btn ghost small"
						onClick={handleRevoke}
					>
						Revoke bastion access
					</button>
				</div>
			)}
		</section>
	);
}
