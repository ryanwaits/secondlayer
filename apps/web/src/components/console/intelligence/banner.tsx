interface BannerAction {
	label: string;
	onClick: () => void;
}

interface BannerProps {
	variant?: "warning" | "info";
	children: React.ReactNode;
	action?: BannerAction;
}

const variantClass: Record<string, string> = {
	warning: "sl-banner-warning",
	info: "sl-banner-info",
};

export function Banner({ variant = "info", children, action }: BannerProps) {
	return (
		<div className={`sl-banner ${variantClass[variant] ?? ""}`}>
			<div className="sl-banner-text">{children}</div>
			{action && (
				<button type="button" className="dash-btn" onClick={action.onClick}>
					{action.label}
				</button>
			)}
		</div>
	);
}
