import Link from "next/link";
import type { ReactNode } from "react";

const CLASS = {
	primary: "btn btn-pri",
	secondary: "btn btn-sec",
	ghost: "btn btn-ghost",
} as const;

/** Flat 4px-radius button. Primary is blue and means an action. External hrefs open in a new tab. */
export function ButtonLink({
	href,
	variant = "primary",
	small,
	children,
}: {
	href: string;
	variant?: keyof typeof CLASS;
	small?: boolean;
	children: ReactNode;
}) {
	return (
		<Link
			href={href}
			className={small ? `${CLASS[variant]} btn-sm` : CLASS[variant]}
			{...(/^https?:\/\//.test(href) && {
				target: "_blank",
				rel: "noopener noreferrer",
			})}
		>
			{children}
		</Link>
	);
}
