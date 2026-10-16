import Link from "next/link";

export function Breadcrumb({
	parent,
	current,
	title,
}: {
	parent: { href: string; label: string };
	current: string;
	/** The full name, when `current` is a shortened one. */
	title?: string;
}) {
	return (
		<nav className="dash-crumb" aria-label="Breadcrumb">
			<Link href={parent.href}>{parent.label}</Link>
			<span className="dash-crumb-sep" aria-hidden="true">
				/
			</span>
			<span aria-current="page" title={title}>
				{current}
			</span>
		</nav>
	);
}
