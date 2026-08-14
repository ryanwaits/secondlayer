import Link from "next/link";

/** Primary CTA for the mobile bars (marketing + docs). */
export function MobileNavCta({ className }: { className: string }) {
	return (
		<Link href="/docs/self-host" className={className}>
			Self-host
		</Link>
	);
}
