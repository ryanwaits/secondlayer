import { AnchorFlash } from "@/components/anchor-flash";
import { CodeClient } from "@/components/code/code-client";
import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { ChainStatus } from "@/components/site/chain-status";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
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
			<Toaster
				position="bottom-right"
				// Above the chain status pill (34px + 16px inset + a gap).
				offset={{ bottom: 64, right: 16 }}
				mobileOffset={{ bottom: 64, right: 16 }}
				toastOptions={{
					unstyled: true,
					classNames: {
						toast: "wh-toast",
						title: "wh-toast-title",
						description: "wh-toast-desc",
						actionButton: "wh-toast-action",
						cancelButton: "wh-toast-cancel",
						error: "wh-toast-error",
						success: "wh-toast-success",
					},
				}}
			/>
		</div>
	);
}
