import { NotFoundTracker } from "@/components/not-found-tracker";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Not found · secondlayer",
	robots: { index: false, follow: false },
};

export default function NotFound() {
	return (
		<div className="homepage">
			<NotFoundTracker boundary="root" />
			<header className="page-header">
				<h1 className="page-title">404</h1>
				<p className="page-sub">that page does not exist</p>
			</header>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<div className="index-year-group">
					<div className="index-year">Try</div>
					<div className="prose www-manifest">
						<p>
							<Link href="/">Home</Link> · instant data for apps on Bitcoin.
						</p>
						<p>
							{PRODUCTS.map((p) => (
								<span key={p.href}>
									<Link href={p.href}>{p.noun}</Link>
									{" · "}
								</span>
							))}
							the five products.
						</p>
						<p>
							<Link href="/docs">Docs</Link> ·{" "}
							<Link href="/verify">Verify</Link> ·{" "}
							<Link href="/pricing">Pricing</Link>.
						</p>
					</div>
				</div>
			</section>
		</div>
	);
}
