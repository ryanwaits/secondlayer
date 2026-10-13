import { CodeClient } from "@/components/code/code-client";
import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./site.css";

export default function WwwLayout({ children }: { children: ReactNode }) {
	return (
		<div className="www">
			<MarketingNav />
			{children}
			<SiteFooter />
			<CodeClient />
			<Toaster
				position="bottom-right"
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
