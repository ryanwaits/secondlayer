import { Logo } from "@/components/logo";

/**
 * "secondlayer" named inline in prose or a headline: the logo, then the
 * word, held together on one line and sized to the surrounding text, the
 * way `ChainLink` sets a chain's mark beside its name.
 */
export function BrandName() {
	return (
		<span className="brand-name">
			<Logo className="brand-mark" />
			secondlayer
		</span>
	);
}
