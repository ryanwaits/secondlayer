import Link from "next/link";
import type { ReactNode } from "react";

const CLASS = {
	primary: "btn btn-pri",
	secondary: "btn btn-sec",
	ghost: "btn btn-ghost",
} as const;

/** Flat 4px-radius button. Primary is blue and means an action. */
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
		>
			{children}
		</Link>
	);
}
