"use client";

import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";
import { useCallback, useState } from "react";

interface Step {
	label: string;
	desc: string;
	code: string;
	agentPrompt?: boolean;
}

const STEPS: Step[] = [
	{
		label: "Install the CLI",
		desc: "Install the Secondlayer CLI and authenticate with your account.",
		code: "npm i -g @secondlayer/cli && sl login",
	},
	{
		label: "Deploy your first subgraph",
		desc: "Index on-chain data into queryable tables.",
		code: "sl subgraphs deploy ./my-subgraph.ts",
		agentPrompt: true,
	},
];

function CopyBtn({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [text]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			style={{
				fontFamily: "var(--font-sans-stack)",
				fontSize: 11,
				fontWeight: 500,
				color: "var(--text-muted)",
				background: "none",
				border: "none",
				padding: "2px 6px",
				borderRadius: 3,
				cursor: "pointer",
				flexShrink: 0,
			}}
		>
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

export function OnboardingCard() {
	const { showOnboarding, completeOnboarding } = usePreferences();
	const { account } = useAuth();
	const [expanded, setExpanded] = useState<number | null>(null);

	if (!showOnboarding) return null;

	const name = account?.displayName ?? account?.email?.split("@")[0] ?? "";

	return (
		<div
			style={{
				border: "1px solid var(--accent-border)",
				borderRadius: 10,
				padding: 24,
				marginBottom: 28,
				background: "var(--accent-bg)",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 20,
				}}
			>
				<div
					style={{
						fontFamily: "var(--font-heading-stack)",
						fontSize: 16,
						fontWeight: 600,
						letterSpacing: "-0.02em",
					}}
				>
					Welcome to Secondlayer{name ? `, ${name}` : ""}
				</div>
				<button
					type="button"
					onClick={completeOnboarding}
					style={{
						fontSize: 11,
						color: "var(--text-muted)",
						background: "none",
						border: "none",
						cursor: "pointer",
						textDecoration: "underline",
						textUnderlineOffset: 2,
						textDecorationColor: "transparent",
					}}
					onMouseEnter={(e) => {
						(e.target as HTMLElement).style.textDecorationColor =
							"var(--text-muted)";
					}}
					onMouseLeave={(e) => {
						(e.target as HTMLElement).style.textDecorationColor = "transparent";
					}}
				>
					Dismiss
				</button>
			</div>

			{/* Checklist */}
			<div style={{ display: "flex", flexDirection: "column" }}>
				{STEPS.map((step, i) => (
					<button
						type="button"
						key={step.label}
						style={{
							display: "flex",
							gap: 14,
							padding: "14px 0",
							borderBottom:
								i < STEPS.length - 1
									? "1px solid var(--accent-border)"
									: "none",
							cursor: "pointer",
							background: "none",
							border: "none",
							color: "inherit",
							textAlign: "left",
							width: "100%",
							fontFamily: "inherit",
						}}
						onClick={() => setExpanded(expanded === i ? null : i)}
					>
						{/* Circle */}
						<div
							style={{
								width: 20,
								height: 20,
								borderRadius: "50%",
								border: "1.5px solid var(--border)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
								marginTop: 1,
								background: "var(--bg)",
							}}
						>
							<svg
								width="10"
								height="10"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								style={{ opacity: 0.2 }}
								aria-hidden="true"
							>
								<title>Step indicator</title>
								<path d="M3 8h10" />
							</svg>
						</div>

						{/* Body */}
						<div style={{ flex: 1 }}>
							<div style={{ fontSize: 13, fontWeight: 560, marginBottom: 4 }}>
								{step.label}
							</div>
							<div
								style={{
									fontSize: 12,
									color: "var(--text-muted)",
									lineHeight: 1.5,
								}}
							>
								{step.desc}
							</div>

							{expanded === i && (
								<div
									style={{
										marginTop: 10,
										display: "flex",
										alignItems: "center",
										flexWrap: "wrap",
										gap: 6,
									}}
									onClick={(e) => e.stopPropagation()}
									onKeyDown={(e) => e.stopPropagation()}
								>
									<div
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 8,
											background: "var(--code-block-bg)",
											border: "1px solid var(--border)",
											borderRadius: 6,
											padding: "6px 10px",
											fontFamily: "var(--font-mono-stack)",
											fontSize: 11,
										}}
									>
										<span
											style={{
												color: "var(--text-muted)",
												userSelect: "none",
											}}
										>
											$
										</span>
										<code>{step.code}</code>
										<CopyBtn text={step.code} />
									</div>
									{step.agentPrompt && (
										<>
											<span
												style={{
													fontSize: 11,
													color: "var(--text-muted)",
													margin: "0 4px",
												}}
											>
												or
											</span>
											<a
												href="/sessions"
												style={{
													fontFamily: "var(--font-sans-stack)",
													fontSize: 11,
													fontWeight: 560,
													color: "var(--accent)",
													border: "1px solid var(--accent-border)",
													borderRadius: 6,
													padding: "5px 12px",
													textDecoration: "none",
													whiteSpace: "nowrap",
												}}
											>
												Create with Agent →
											</a>
										</>
									)}
								</div>
							)}
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
