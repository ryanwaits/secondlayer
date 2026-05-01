"use client";

import { useEffect, useState } from "react";

export interface KeyEntry {
	label: string;
	value: string;
}

export function KeyRevealModal({
	title,
	subtitle,
	warning,
	keys,
	gateLabel,
	onDismiss,
}: {
	title: string;
	subtitle: string;
	warning: string;
	keys: KeyEntry[];
	gateLabel: string;
	onDismiss: () => void;
}) {
	const [gated, setGated] = useState(false);

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && gated) onDismiss();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			document.body.style.overflow = prev;
			window.removeEventListener("keydown", onKey);
		};
	}, [gated, onDismiss]);

	return (
		<div className="modal-backdrop">
			<div className="modal-panel">
				<div className="modal-title">{title}</div>
				<div className="modal-subtitle">{subtitle}</div>

				<div className="modal-warn">
					<span className="icon">!</span>
					<span>{warning}</span>
				</div>

				{keys.map((k) => (
					<KeyRow key={k.label} entry={k} />
				))}

				<label className="modal-gate">
					<input
						type="checkbox"
						checked={gated}
						onChange={(e) => setGated(e.target.checked)}
					/>
					{gateLabel}
				</label>

				<div className="modal-footer">
					<button
						type="button"
						className="settings-btn primary small"
						disabled={!gated}
						onClick={onDismiss}
					>
						Done
					</button>
				</div>
			</div>
		</div>
	);
}

function KeyRow({ entry }: { entry: KeyEntry }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(entry.value);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="key-reveal-row">
			<div className="label">{entry.label}</div>
			<div className="value-box">
				{entry.value}
				<button
					type="button"
					className={`copy-btn${copied ? " copied" : ""}`}
					onClick={handleCopy}
				>
					{copied ? "copied" : "copy"}
				</button>
			</div>
		</div>
	);
}
