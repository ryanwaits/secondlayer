"use client";

import { usePreferences } from "@/lib/preferences";

const CARDS = [
	{
		icon: (
			<svg
				aria-hidden="true"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<rect x="4" y="4" width="16" height="16" rx="2" />
				<path d="M9 12l2 2 4-4" />
			</svg>
		),
		title: "Create API key",
		desc: "Create and manage access keys to integrate Secondlayer into your app.",
		href: "/platform/api-keys",
	},
	{
		icon: (
			<svg
				aria-hidden="true"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<circle cx="12" cy="12" r="8" />
				<path d="M12 8v4l2 2" />
			</svg>
		),
		title: "Deploy subgraph",
		desc: "Deploy your first subgraph and start indexing blockchain events.",
		href: "/platform/subgraphs",
	},
	{
		icon: (
			<svg
				aria-hidden="true"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
			</svg>
		),
		title: "Set up subscriptions",
		desc: "Stream real-time events to your backend via webhooks or WebSocket.",
		href: "https://docs.secondlayer.dev/subscriptions",
		external: true,
	},
	{
		icon: (
			<svg
				aria-hidden="true"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
				<polyline points="14,2 14,8 20,8" />
			</svg>
		),
		title: "View documentation",
		desc: "Read the full API reference and quickstart guides.",
		href: "https://docs.secondlayer.dev",
		external: true,
	},
];

export function OnboardingCard() {
	const { showOnboarding, completeOnboarding } = usePreferences();

	if (!showOnboarding) return null;

	return (
		<div className="onboarding-section">
			<div className="onboarding-header">
				<span className="onboarding-title">Get started</span>
				<button
					type="button"
					className="onboarding-dismiss"
					onClick={completeOnboarding}
				>
					Dismiss
				</button>
			</div>
			<div className="onboarding-grid">
				{CARDS.map((card) => (
					<a
						key={card.title}
						href={card.href}
						className="onboarding-card"
						{...(card.external
							? { target: "_blank", rel: "noopener noreferrer" }
							: {})}
					>
						<div className="onboarding-card-icon">{card.icon}</div>
						<div className="onboarding-card-title">
							{card.title}
							{card.external && (
								<span className="onboarding-external-arrow"> ↗</span>
							)}
						</div>
						<div className="onboarding-card-desc">{card.desc}</div>
						<span className="onboarding-card-arrow">→</span>
					</a>
				))}
			</div>
		</div>
	);
}
