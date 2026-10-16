import Link from "next/link";

export type DashboardTab = { href: string; label: string; ready: boolean };

export const DASHBOARD_TABS: DashboardTab[] = [
	{ href: "/account", label: "Overview", ready: true },
	{ href: "/account/rows", label: "Rows", ready: true },
	{ href: "/account/webhooks", label: "Webhooks", ready: true },
	{ href: "/account/subgraphs", label: "Subgraphs", ready: true },
	{ href: "/account/keys", label: "Keys", ready: true },
	{ href: "/account/credits", label: "Billing", ready: true },
];

/** Overview is `/account` itself, so it only matches exactly. */
export function isCurrent(pathname: string | null, href: string): boolean {
	if (!pathname) return false;
	if (href === "/account") return pathname === href;
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardTabs({
	pathname,
	failingWebhooks,
}: {
	pathname: string;
	failingWebhooks?: number;
}) {
	return (
		<nav className="dash-tabs" aria-label="Account">
			{DASHBOARD_TABS.filter((t) => t.ready).map((t) => (
				<Link
					key={t.href}
					href={t.href}
					aria-current={isCurrent(pathname, t.href) ? "page" : undefined}
				>
					{t.label}
					{t.href === "/account/webhooks" &&
					failingWebhooks !== undefined &&
					failingWebhooks > 0 ? (
						<span
							className="dash-tab-n"
							aria-label={`${failingWebhooks} failing`}
						>
							{failingWebhooks}
						</span>
					) : null}
				</Link>
			))}
		</nav>
	);
}
