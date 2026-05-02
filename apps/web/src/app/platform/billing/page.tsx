import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { BillingCaps } from "@/lib/billing";
import type { UsageResponse } from "@/lib/usage";
import { PLANS, PLAN_IDS } from "@secondlayer/shared/pricing";
import { BillingView } from "./billing-view";
import { resolvePlanFromStripe } from "./resolve-plan";

interface Account {
	id: string;
	email: string;
	plan: string;
}

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	storageUsedMb: number | null;
	apiUrl: string;
	suspendedAt: string | null;
	createdAt: string;
}

interface TenantRuntime {
	slug: string;
	plan: string;
	containers: Array<{
		name: string;
		state: string;
		cpuUsage?: number;
		memoryUsageBytes?: number;
		memoryLimitBytes?: number;
	}>;
	storageUsedMb?: number;
	storageLimitMb: number;
}

export default async function BillingPage({
	searchParams,
}: {
	searchParams: Promise<{ upgrade?: string }>;
}) {
	const session = await getSessionFromCookies();
	if (!session) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Sign in to manage your billing.</p>
					</div>
				</div>
			</>
		);
	}

	const [account, tenantData, caps, usage] = await Promise.all([
		apiRequest<Account>("/api/accounts/me", { sessionToken: session }).catch(
			() => null,
		),
		apiRequest<{ tenant: TenantSummary; runtime: TenantRuntime | null }>(
			"/api/tenants/me",
			{
				sessionToken: session,
				tags: ["tenant"],
			},
		).catch((err) => {
			if (err instanceof ApiError && err.status === 404) return null;
			return null;
		}),
		apiRequest<BillingCaps>("/api/billing/caps", {
			sessionToken: session,
		}).catch(() => null),
		apiRequest<UsageResponse>("/api/accounts/usage", {
			sessionToken: session,
		}).catch(() => null),
	]);

	if (!account) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Unable to load billing data.</p>
					</div>
				</div>
			</>
		);
	}

	// Fast-resolve: when the user returns from a successful Stripe Checkout,
	// the webhook may not have fired yet. Do a one-shot Stripe read + plan
	// write synchronously so the paid view renders on first paint.
	const sp = await searchParams;
	if (sp.upgrade === "success" && account.plan === "hobby") {
		const resolved = await resolvePlanFromStripe(session);
		if (resolved && resolved !== "hobby") {
			account.plan = resolved;
		}
	}

	return (
		<>
			<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<BillingView
						initialTenant={tenantData?.tenant ?? null}
						initialRuntime={tenantData?.runtime ?? null}
						account={account}
						caps={caps}
						usage={usage}
						sessionToken={session}
						plans={PLANS}
						planIds={PLAN_IDS}
					/>
				</div>
			</div>
		</>
	);
}
