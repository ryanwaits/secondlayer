import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { Suspense } from "react";
import s from "./billing.module.css";
import { CreditsTopup } from "./credits-topup";

type BillingStatus = {
	creditsUsdMicros: string;
	creditsSpentThisMonthUsdMicros: string;
	stripeCustomerId: string | null;
};

export default async function BillingPage() {
	const session = await getSessionFromCookies();
	let status: BillingStatus | null = null;

	if (session) {
		try {
			status = await apiRequest<BillingStatus>("/api/billing/status", {
				sessionToken: session,
			});
		} catch {}
	}

	if (!status) {
		return (
			<>
				<OverviewTopbar
					path={<SettingsCrumb />}
					page="Credits"
					showRefresh={false}
				/>
				<div className="settings-scroll">
					<div className="overview-inner">
						<h1 className="settings-title">Archive credits</h1>
						<p className="settings-desc">Unable to load credit balance.</p>
					</div>
				</div>
			</>
		);
	}

	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Credits"
				showRefresh={false}
			/>
			<div className="settings-scroll">
				<div className="overview-inner">
					<h1 className="settings-title">Archive credits</h1>
					<p className="settings-desc">
						Prepaid balance for official-archive bootstrap and R2 backfill. The
						signed archive is public to check.
					</p>
					<Suspense fallback={null}>
						<CreditsTopup
							balanceUsdMicros={status.creditsUsdMicros}
							spentThisMonthUsdMicros={status.creditsSpentThisMonthUsdMicros}
						/>
					</Suspense>
					{status.stripeCustomerId && (
						<p className={s.more}>
							Receipts and the saved card live in the Stripe customer portal.
						</p>
					)}
				</div>
			</div>
		</>
	);
}
