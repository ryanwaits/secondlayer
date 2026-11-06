import { Logo } from "@/components/logo";
import Link from "next/link";

/**
 * An official vendor logo, unmodified: the dark asset on light ground, the
 * light asset on dark ground. Theme swap is CSS-only (.rh-logo-*).
 */
export function VendorLogo({
	light,
	dark,
	alt,
	height,
	ratio,
}: {
	light: string;
	dark: string;
	alt: string;
	height: number;
	ratio: number;
}) {
	const width = Math.round(height * ratio);
	return (
		<>
			<img
				className="rh-logo rh-logo-on-light"
				src={light}
				alt={alt}
				width={width}
				height={height}
			/>
			<img
				className="rh-logo rh-logo-on-dark"
				src={dark}
				alt={alt}
				width={width}
				height={height}
			/>
		</>
	);
}

export const ROBINHOOD_CHAIN_LOGO = {
	light: "/robinhood-chain/logo-black.svg",
	dark: "/robinhood-chain/logo-white.svg",
	alt: "Robinhood Chain",
	ratio: 1576 / 207,
};

export const STACKS_LOGO = {
	light: "/stacks/logo-black.svg",
	dark: "/stacks/logo-white.png",
	alt: "Stacks",
	ratio: 431 / 83,
};

/**
 * Standalone chrome for the bridge pages (no MarketingNav): secondlayer mark
 * left, the official Robinhood Chain logo alone on the right. Their brand
 * rules (docs.robinhood.com/chain/brand-guidelines) forbid combining the logo
 * with other branding or text and any recolor, so it is an unmodified asset
 * from their pack, shown black on white / white on dark, never styled.
 */
export function RhHeader() {
	return (
		<header className="rh-nav">
			<div className="shell">
				<Link href="/" className="rh-brand">
					<Logo size={22} />
					<span>secondlayer</span>
				</Link>
				<div className="rh-dest">
					<span className="cap rh-dest-label">Compatible with</span>
					<VendorLogo {...ROBINHOOD_CHAIN_LOGO} height={20} />
				</div>
			</div>
		</header>
	);
}

export function RhFooter() {
	return (
		<footer className="rh-footer">
			<div className="shell">
				<span className="mono">stacks ⇄ 4663</span>
				<Link href="/" className="rh-built-by">
					<span>Built by</span>
					<Logo size={17} />
					<span className="rh-built-by-name">secondlayer</span>
				</Link>
				<span className="rh-tm">
					Robinhood Chain and the Robinhood Chain logo are trademarks of
					Robinhood Markets, Inc. The Stacks name and logo belong to their
					owner. Both are used here only to identify compatibility. This bridge
					is an independent project, not an official Robinhood or Stacks
					product, and is not sponsored or endorsed by either.
				</span>
			</div>
		</footer>
	);
}
