import type { ReactNode } from "react";
import type { MobileTabId } from "./mobile-shell";

function Svg({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={22}
			height={22}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

/** The five bottom-tab icons. */
export function TabIcon({ id }: { id: MobileTabId }) {
	switch (id) {
		case "pulse":
			return (
				<Svg>
					<path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
				</Svg>
			);
		case "insights":
			return (
				<Svg>
					<path d="M4 5h16M4 12h10M4 19h7" />
					<circle cx="18.5" cy="16.5" r="2.5" />
				</Svg>
			);
		case "webhooks":
			return (
				<Svg>
					<circle cx="6" cy="12" r="2.5" />
					<path d="M8.5 12H19M15 8l4 4-4 4" />
				</Svg>
			);
		case "subgraphs":
			return (
				<Svg>
					<rect x="4" y="4" width="16" height="16" rx="2" />
					<path d="M4 10h16M10 10v10" />
				</Svg>
			);
		case "account":
			return (
				<Svg>
					<circle cx="12" cy="8.5" r="3.5" />
					<path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" />
				</Svg>
			);
	}
}
