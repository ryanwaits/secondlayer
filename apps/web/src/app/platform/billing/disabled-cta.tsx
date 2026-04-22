"use client";

/**
 * "Coming soon" stand-ins for the upgrade button + portal rows.
 *
 * Phase 1 of the billing page ships without Stripe env vars set on prod,
 * so upgrade/portal can't actually succeed. These components render the
 * visual state but short-circuit the interaction. Phase 2 swaps them for
 * the live versions in one place.
 */

const EARLY_ACCESS_TITLE =
	"Self-serve billing launches soon — email hey@secondlayer.tools for early access.";

export function DisabledUpgradeButton({
	label,
	variant = "primary",
}: {
	label: string;
	variant?: "primary" | "ghost";
}) {
	const className =
		variant === "primary" ? "settings-btn primary" : "settings-btn";
	return (
		<button
			type="button"
			className={className}
			disabled
			title={EARLY_ACCESS_TITLE}
			aria-label={label}
		>
			{label}
		</button>
	);
}

export function DisabledPortalRow({
	label,
	sub,
}: {
	label: string;
	sub: string;
}) {
	return (
		<div
			className="plan-card disabled"
			title={EARLY_ACCESS_TITLE}
			aria-disabled="true"
		>
			<div>
				<div className="plan-card-name">{label}</div>
				<div className="plan-card-sub">{sub}</div>
			</div>
			<span
				style={{
					fontFamily: "var(--font-mono-stack)",
					fontSize: 11,
					color: "var(--text-muted)",
				}}
			>
				Coming soon
			</span>
		</div>
	);
}
