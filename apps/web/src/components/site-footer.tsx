import Link from "next/link";

/**
 * Slim, single-line footer used on www marketing pages.
 *
 * Status link points to the HTML status page (`/status`) — not the JSON
 * API surface (`/public/status`) — so customers/Hiro can bookmark a
 * glanceable view.
 */
export function SiteFooter() {
	return (
		<footer className="www-footer">
			<div className="www-footer-line">
				<span>secondlayer · the data plane for Stacks</span>
				<span>
					<Link href="/status">status</Link>
					{" · "}
					<Link href="/docs">docs</Link>
					{" · "}
					<Link href="/pricing">pricing</Link>
					{" · "}
					<Link href="/">home</Link>
				</span>
			</div>
		</footer>
	);
}
