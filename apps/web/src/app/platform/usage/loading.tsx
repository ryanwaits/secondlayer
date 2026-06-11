import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";

export default function UsageLoading() {
	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Resources"
				showRefresh={false}
			/>
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Resources</h1>
					<p className="settings-desc" style={{ opacity: 0.4 }}>
						Loading…
					</p>
				</div>
			</div>
		</>
	);
}
