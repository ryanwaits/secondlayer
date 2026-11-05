import { AnchorFlash } from "@/components/anchor-flash";
import { CodeClient } from "@/components/code/code-client";
import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { ChainStatus } from "@/components/site/chain-status";
import { ToastHost } from "@/components/toast/toast-host";
import type { ReactNode } from "react";
import "./site.css";

export default function WwwLayout({ children }: { children: ReactNode }) {
	return (
		<div className="www">
			<MarketingNav />
			{children}
			<SiteFooter />
			<ChainStatus />
			<CodeClient />
			<AnchorFlash />
			<ToastHost
				position="bottom-right"
				// Above the chain status pill (34px + 16px inset + a gap).
				offset={{ bottom: 64, right: 16 }}
				// On phones toasts also clear the account tab bar (sonner's mobile
				// offset applies under 600px; marketing phones have only the chain
				// pill, so 84 is safe there too).
				mobileOffset={{ bottom: 84, right: 16 }}
			/>
		</div>
	);
}
