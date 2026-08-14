import { ConsoleSidebar, type InstanceMeta } from "./sidebar";

export function ConsoleShell({
	meta,
	children,
}: {
	meta: InstanceMeta;
	children: React.ReactNode;
}) {
	return (
		<div className="dash">
			<ConsoleSidebar meta={meta} />
			<main className="main-col">{children}</main>
		</div>
	);
}
