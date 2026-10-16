"use client";

import {
	EXAMPLE_KEYS,
	EXAMPLE_KEYS_STALE,
	EXAMPLE_NEW_KEY,
	KEYS_EXAMPLE_NOW,
} from "@/components/account/keys/key.fixtures";
import { KeysBody } from "@/components/account/keys/keys-screen";
import { NameStep, RevealStep } from "@/components/account/keys/new-key-flow";
import {
	OnboardingSentence,
	OverviewBody,
	SUBGRAPH_HEAD,
	onboardingSteps,
} from "@/components/account/overview/overview-section";
import {
	exampleOverview,
	exampleStack,
	exampleSubgraph,
	exampleWebhooks,
	serverErrorsInsight,
} from "@/components/account/overview/overview.fixtures";
import { RowsBody } from "@/components/account/rows/rows-panel";
import { GridView } from "@/components/account/subgraphs/data-grid";
import { SubgraphRows } from "@/components/account/subgraphs/list-screen";
import {
	EXAMPLE_NOW,
	exampleColumns,
	exampleRows,
} from "@/components/account/subgraphs/subgraph.fixtures";
import { TitleRow } from "@/components/account/webhooks/detail-panel";
import { type AmountOption, AmountPicker } from "@/components/amount-picker";
import { MonoStackedBarChart } from "@/components/charts/mono-stacked-bar-chart";
import { Choice } from "@/components/choice";
import { HeatStrip } from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import {
	Checklist,
	PlaceholderRows,
} from "@/components/dashboard/shell/onboarding";
import { Logo } from "@/components/logo";
import type { RowsDay, RowsResponse } from "@/lib/rows";
import {
	DEFAULT_SORT,
	type SortState,
	type TableFilter,
	isDefaultSort,
	toggleSort,
	withFilter,
} from "@/lib/subgraph-view";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { NavItem } from "./tree";

const DESIGN_URL =
	"https://github.com/ryanwaits/secondlayer/blob/main/DESIGN.md#6-components";

/**
 * The lab's shell: top bar, story tree and the story pane. The component filter
 * lives in the bar and narrows the tree, so bar and tree share one client
 * boundary; the story itself arrives as server-rendered `children`.
 */
export function LabChrome({
	items,
	children,
}: { items: NavItem[]; children: ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const shown = needle
		? items.filter(
				(item) =>
					item.label.toLowerCase().includes(needle) ||
					item.group.toLowerCase().includes(needle),
			)
		: items;
	const groups = [...new Set(shown.map((item) => item.group))];

	return (
		<>
			<header className="lab-bar">
				<Link href="/lab" className="lab-brand">
					<Logo size={20} />
					<span>/ Lab</span>
				</Link>
				<span className="lab-chip">internal · preview only</span>
				<div className="lab-find">
					<input
						type="search"
						value={query}
						placeholder="Find a component"
						aria-label="Find a component"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && shown[0]) router.push(shown[0].href);
						}}
					/>
				</div>
				<a
					className="lab-design"
					href={DESIGN_URL}
					target="_blank"
					rel="noreferrer"
				>
					DESIGN.md §6
				</a>
			</header>
			<div className="lab-body">
				<nav className="lab-tree" aria-label="Stories">
					{groups.map((group) => (
						<div key={group} className="lab-group">
							<p className="lab-group-name">{group}</p>
							{shown
								.filter((item) => item.group === group)
								.map((item) => (
									<Link
										key={item.href}
										href={item.href}
										aria-current={pathname === item.href ? "page" : undefined}
									>
										{item.label}
									</Link>
								))}
						</div>
					))}
					{shown.length === 0 && <p className="lab-empty">No match.</p>}
				</nav>
				<select
					className="lab-select"
					aria-label="Stories"
					value={shown.some((item) => item.href === pathname) ? pathname : ""}
					onChange={(event) => router.push(event.target.value)}
				>
					<option value="" disabled>
						Pick a story
					</option>
					{groups.map((group) => (
						<optgroup key={group} label={group}>
							{shown
								.filter((item) => item.group === group)
								.map((item) => (
									<option key={item.href} value={item.href}>
										{item.label}
									</option>
								))}
						</optgroup>
					))}
				</select>
				<main className="lab-main">{children}</main>
			</div>
		</>
	);
}

const THEMES = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "both", label: "Both" },
];

const VIEWPORTS = [
	{ value: "desktop", label: "Desktop" },
	{ value: "400", label: "400" },
];

const VIEW_KEY = "lab:view";

export type StoryViewProps = {
	storyId: string;
	/** Each variant's frames, rendered on the server; the view only shows one. */
	variants: { id: string; label: string; node: ReactNode }[];
	width?: { min: number; max: number; value: number };
	stack?: boolean;
	/** Props, Usage and Rules panes, rendered on the server. */
	panes: { id: string; label: string; node: ReactNode }[];
};

/**
 * A frame route in an iframe, as tall as its content. Same origin, so the
 * document is readable: its height is measured on load and followed with a
 * ResizeObserver, which the cleanup disconnects.
 */
function FrameEmbed({ src, title }: { src: string; title: string }) {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const observer = useRef<ResizeObserver | null>(null);

	const attach = useCallback(() => {
		const root = ref.current?.contentDocument?.documentElement;
		if (!root) return;
		observer.current?.disconnect();
		// offsetHeight is the content's height; scrollHeight never drops below the frame's.
		const measure = () => setHeight(root.offsetHeight);
		measure();
		observer.current = new ResizeObserver(measure);
		observer.current.observe(root);
	}, []);

	// The frame may finish loading before hydration, so onLoad alone can miss it.
	useEffect(() => {
		if (ref.current?.contentDocument?.readyState === "complete") attach();
		return () => observer.current?.disconnect();
	}, [attach]);

	return (
		<iframe
			ref={ref}
			className="lab-vp"
			src={src}
			title={title}
			width={400}
			height={height || 200}
			onLoad={attach}
		/>
	);
}

/**
 * The story's controls. Every variant and pane is already in the page as
 * server markup; this component only chooses which one is visible, which theme
 * frames show and how wide the stage is. The 400 viewport swaps the inline
 * frames for iframes, since only an iframe has a viewport of its own.
 */
export function StoryView({
	storyId,
	variants,
	width,
	stack,
	panes,
}: StoryViewProps) {
	const [theme, setTheme] = useState("both");
	const [viewport, setViewport] = useState("desktop");
	const [variant, setVariant] = useState(variants[0]?.id ?? "");
	const [px, setPx] = useState(width?.value ?? 0);
	const [tab, setTab] = useState("controls");

	// Per-viewer convenience: the last theme and viewport, if storage allows.
	useEffect(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}");
			if (THEMES.some((t) => t.value === saved.theme)) setTheme(saved.theme);
			if (VIEWPORTS.some((v) => v.value === saved.viewport))
				setViewport(saved.viewport);
		} catch {
			// Storage is optional.
		}
	}, []);
	const remember = (next: { theme: string; viewport: string }) => {
		try {
			localStorage.setItem(VIEW_KEY, JSON.stringify(next));
		} catch {
			// Storage is optional.
		}
	};

	const tabs = [{ id: "controls", label: "Controls" }, ...panes];

	return (
		<>
			<div className="lab-toolbar">
				<div className="lab-field">
					<span id="lab-theme-label">Theme</span>
					<Choice
						name="lab-theme"
						labelledBy="lab-theme-label"
						options={THEMES}
						value={theme}
						onChange={(value) => {
							setTheme(value);
							remember({ theme: value, viewport });
						}}
					/>
				</div>
				<div className="lab-field">
					<span id="lab-viewport-label">Viewport</span>
					<Choice
						name="lab-viewport"
						labelledBy="lab-viewport-label"
						options={VIEWPORTS}
						value={viewport}
						onChange={(value) => {
							setViewport(value);
							remember({ theme, viewport: value });
						}}
					/>
				</div>
			</div>
			<div
				className="lab-stage"
				data-theme={theme}
				data-vp={viewport}
				data-stack={stack || undefined}
				style={width ? ({ "--lab-w": `${px}px` } as CSSProperties) : undefined}
			>
				{viewport === "400" ? (
					<div className="lab-vps">
						{THEMES.filter(
							(t) =>
								t.value !== "both" && (theme === "both" || theme === t.value),
						).map((t) => (
							<FrameEmbed
								key={`${variant}-${t.value}`}
								src={`/lab/frame/${storyId}/${variant}/${t.value}`}
								title={`${t.label} frame at 400px`}
							/>
						))}
					</div>
				) : (
					variants.map((v) => (
						<div key={v.id} hidden={v.id !== variant}>
							{v.node}
						</div>
					))
				)}
			</div>
			<div className="lab-panel">
				<div className="tabbar" role="tablist">
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							id={`lab-tab-${t.id}`}
							aria-selected={tab === t.id}
							aria-controls={`lab-pane-${t.id}`}
							onClick={() => setTab(t.id)}
						>
							{t.label}
						</button>
					))}
				</div>
				<div
					role="tabpanel"
					id="lab-pane-controls"
					aria-labelledby="lab-tab-controls"
					hidden={tab !== "controls"}
					className="lab-pane"
				>
					<div className="lab-field">
						<span id="lab-variant-label">Variant</span>
						<Choice
							name="lab-variant"
							labelledBy="lab-variant-label"
							options={variants.map((v) => ({ value: v.id, label: v.label }))}
							value={variant}
							onChange={setVariant}
						/>
					</div>
					{width && (
						<label className="lab-field lab-range">
							<span>Container width</span>
							<input
								type="range"
								min={width.min}
								max={width.max}
								value={px}
								onChange={(event) => setPx(Number(event.target.value))}
							/>
							<output>{px}px</output>
						</label>
					)}
				</div>
				{panes.map((pane) => (
					<div
						key={pane.id}
						role="tabpanel"
						id={`lab-pane-${pane.id}`}
						aria-labelledby={`lab-tab-${pane.id}`}
						hidden={tab !== pane.id}
						className="lab-pane"
					>
						{pane.node}
					</div>
				))}
			</div>
		</>
	);
}

/** The heat strip's click callback is a function, which a server page cannot pass. */
export function HeatStripDemo({
	hours,
	now,
}: { hours: readonly { n: number; f: number }[]; now: number }) {
	const [clicked, setClicked] = useState<number | null>(null);
	return (
		<div style={{ display: "grid", gap: 12 }}>
			<HeatStrip
				hours={hours}
				now={now}
				label="Deliveries by hour, last 7 days"
				onCellClick={setClicked}
			/>
			<span
				style={{ font: "400 12px var(--font-mono-stack)", color: "var(--sub)" }}
			>
				{clicked === null ? "Click a cell" : `Opened hour ${clicked}`}
			</span>
		</div>
	);
}

/** Cost by unit: the stacked bar takes formatter functions, so it needs a client boundary. */
export function StackedCostDemo({
	data,
}: { data: { day: string; rows: number; events: number; storage: number }[] }) {
	return (
		<div style={{ display: "grid", gap: 10 }}>
			<Legend
				items={[
					{ swatch: "square", label: "Rows", color: "var(--ch-a)" },
					{ swatch: "square", label: "Events", color: "var(--ch-b)" },
					{ swatch: "square", label: "Storage", color: "var(--ch-c)" },
				]}
			/>
			<MonoStackedBarChart
				data={data}
				height={150}
				xAxisDataKey="day"
				xAxisTicks={[data[0]?.day ?? "", data.at(-1)?.day ?? ""]}
				xAxisTickFormatter={(v) => String(v)}
				yAxisTicks={[0, 0.5, 1]}
				yAxisTickFormatter={(v) => `$${v.toFixed(2)}`}
				series={[
					{ dataKey: "rows", name: "Rows", color: "var(--ch-a)" },
					{ dataKey: "events", name: "Events", color: "var(--ch-b)" },
					{ dataKey: "storage", name: "Storage", color: "var(--ch-c)" },
				]}
			/>
		</div>
	);
}

/** AmountPicker is controlled, so its story needs state a server page cannot hold. */
export function AmountDemo({
	name,
	options,
	initial,
}: {
	name: string;
	options: readonly AmountOption[];
	initial: string;
}) {
	const [value, setValue] = useState(initial);
	return (
		<AmountPicker
			name={name}
			legend="Amount"
			options={options}
			value={value}
			onChange={setValue}
		/>
	);
}

/** The webhook title row: `onRename` is a function, which a server page cannot pass. */
export function WebhookHeaderDemo({
	name,
	managedBy,
}: { name: string; managedBy: string | null }) {
	const [saved, setSaved] = useState(name);
	return (
		<TitleRow
			name={saved}
			tone="ok"
			managedBy={managedBy}
			onRename={async (next) => {
				setSaved(next);
				return true;
			}}
		/>
	);
}

const ROWS_STORY_NOW = new Date("2026-10-15T12:00:00.000Z");

/** Made-up reads for the Rows story: a month that runs out of free rows on Oct 6, or one that never does. */
function rowsStoryData(exhausted: boolean): RowsResponse {
	const today = Date.UTC(2026, 9, 15);
	const daily: RowsDay[] = [];
	let monthRows = 0;
	let exhaustedOn: string | null = null;
	for (let i = 0; i < 30; i++) {
		const date = new Date(today - (29 - i) * 86_400_000)
			.toISOString()
			.slice(0, 10);
		const wobble = (i * 37) % 9;
		let freeRows = 14_000 + wobble * 3_000;
		let paidRows = 0;
		if (exhausted && date >= "2026-10-01") {
			if (date < "2026-10-06") freeRows = 150_000;
			else if (date === "2026-10-06") {
				freeRows = 250_000;
				paidRows = 400_000;
			} else {
				freeRows = 0;
				paidRows = 30_000 + wobble * 6_000;
			}
		}
		const rows = freeRows + paidRows;
		if (date >= "2026-10-01") {
			if (!exhaustedOn && monthRows + rows >= 1_000_000) exhaustedOn = date;
			monthRows += rows;
		}
		daily.push({
			date,
			source: "index",
			rows,
			freeRows,
			paidRows,
			calls: Math.ceil(rows / 400),
			paidUsdMicros: String(paidRows * 5),
		});
	}
	const paidRows = daily.reduce(
		(sum, d) => (d.date >= "2026-10-01" ? sum + d.paidRows : sum),
		0,
	);
	return {
		allowance: {
			monthly: 1_000_000,
			usedThisMonth: monthRows,
			exhaustedOn,
			paidRowsThisMonth: paidRows,
			paidUsdMicrosThisMonth: String(paidRows * 5),
			resetsOn: "2026-11-01",
		},
		daily,
		hourlyToday: [],
		bySource: [
			{ source: "index", rows: 1_240_000, calls: 3_100 },
			{ source: "streams", rows: 310, calls: 8 },
		],
		histogram: [
			{ bucket: "1-9", calls: 1_900, rows: 5_000 },
			{ bucket: "10-99", calls: 420, rows: 18_000 },
			{ bucket: "100-499", calls: 260, rows: 70_000 },
			{ bucket: "500-999", calls: 60, rows: 45_000 },
			{ bucket: "1000+", calls: 480, rows: 480_000 },
		],
		errors: exhausted
			? [
					{
						status: 404,
						code: "NOT_FOUND",
						path: `/v1/proofs/tx/${"ab12".repeat(16)}`,
						count: 12,
						last: "2026-10-15T09:00:00.000Z",
					},
					{
						status: 400,
						code: "BAD_REQUEST",
						path: "/v1/index/events",
						count: 5,
						last: "2026-10-15T08:00:00.000Z",
					},
					{
						status: 500,
						code: "INTERNAL",
						path: "/v1/index/events",
						count: 2,
						last: "2026-10-15T07:00:00.000Z",
					},
				]
			: [],
	};
}

/** The subgraph data grid on fixture rows, no network: sort, filter chips and
 *  the open-row panel work; the live tail is shown as a fresh dot on the top
 *  row. The callbacks are functions, which a server page cannot pass. */
export function SubgraphGridDemo({ openFirst }: { openFirst?: boolean }) {
	const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
	const [filters, setFilters] = useState<TableFilter[]>([]);
	const [openKey, setOpenKey] = useState<string | null>(
		openFirst ? String(exampleRows(1)[0]?._id) : null,
	);
	const sorted = [...exampleRows(25)]
		.filter((row) => filters.every((f) => String(row[f.column]) === f.value))
		.sort((a, b) => {
			const x = String(a[sort.column] ?? "");
			const y = String(b[sort.column] ?? "");
			const order = x.localeCompare(y, "en", { numeric: true });
			return sort.order === "desc" ? -order : order;
		});
	return (
		<GridView
			name="sbtc-deposits"
			table="transfers"
			columns={exampleColumns}
			rowCount={412_880}
			rows={sorted}
			error={null}
			sort={sort}
			filters={filters}
			live={isDefaultSort(sort)}
			page={1}
			hasNext
			loading={false}
			fresh={new Set([String(sorted[0]?._id)])}
			openKey={openKey}
			now={EXAMPLE_NOW}
			onSort={(column) => setSort((prev) => toggleSort(prev, column))}
			onFilter={(filter) => {
				setFilters((prev) => withFilter(prev, filter));
				setOpenKey(null);
			}}
			onRemoveFilter={(column) =>
				setFilters((prev) => prev.filter((f) => f.column !== column))
			}
			onToggleRow={(key) => setOpenKey((prev) => (prev === key ? null : key))}
			onNext={() => {}}
			onNewest={() => {}}
			onRetry={() => {}}
		/>
	);
}

/** The Rows screen: `onRetry` is a function, which a server page cannot pass. */
export function RowsDemo({ exhausted }: { exhausted: boolean }) {
	return (
		<RowsBody
			status="ok"
			data={rowsStoryData(exhausted)}
			now={ROWS_STORY_NOW}
			onRetry={() => {}}
		/>
	);
}

/** A new account's empty Rows screen, with and without a key. */
export function RowsEmptyDemo({ noKey }: { noKey: boolean }) {
	const data = rowsStoryData(false);
	return (
		<RowsBody
			status="ok"
			data={{
				...data,
				allowance: { ...data.allowance, usedThisMonth: 0 },
				daily: [],
				hourlyToday: [],
				bySource: [],
				errors: [],
			}}
			now={ROWS_STORY_NOW}
			onRetry={() => {}}
			noKey={noKey}
		/>
	);
}

/** The Overview's new-account checklist at each stage. */
export function OverviewOnboardingDemo({
	stage,
}: { stage: "no-key" | "key-made" | "reading" }) {
	const progress = {
		key: stage !== "no-key",
		read: stage === "reading",
		push: false,
		complete: false,
	};
	const model = { progress, keyName: "laptop", flow: null };
	return (
		<>
			<OnboardingSentence progress={progress} />
			<Checklist steps={onboardingSteps(model)} />
			{stage === "no-key" ? (
				<PlaceholderRows
					rows={[
						{ state: 72, count: 40 },
						{ state: 58, count: 52 },
					]}
					note="These fill in as you go."
				/>
			) : null}
		</>
	);
}

export type OverviewDemoState =
	| "today"
	| "webhook-failing"
	| "stack-stopped"
	| "asleep"
	| "with-subgraph"
	| "no-keys"
	| "our-errors"
	| "our-errors-recovered"
	| "loading";

/** The whole Overview on example data, one variant per state it has to get right. */
export function OverviewDemo({ state }: { state: OverviewDemoState }) {
	const [now] = useState(() => new Date());
	const subgraph = exampleSubgraph(now);
	const props = {
		today: exampleOverview(now),
		"webhook-failing": exampleOverview(now, {
			rows: exampleWebhooks(now, { failing: true }),
		}),
		"stack-stopped": exampleOverview(now, {
			stack: exampleStack("stopped", now),
			billing: { creditsUsdMicros: "0", spentThisMonthUsdMicros: "1910000" },
		}),
		asleep: exampleOverview(now, {
			rows: null,
			asleep: true,
			stack: exampleStack("stopped", now),
		}),
		"with-subgraph": exampleOverview(now, {
			subgraphs: (
				<SubgraphRows
					items={[subgraph.item]}
					health={{ [subgraph.item.name]: subgraph.health }}
					head={SUBGRAPH_HEAD}
				/>
			),
		}),
		"no-keys": exampleOverview(now, { keys: [] }),
		"our-errors": exampleOverview(now, {
			accountInsights: [serverErrorsInsight()],
		}),
		"our-errors-recovered": exampleOverview(now, {
			accountInsights: [serverErrorsInsight(true)],
		}),
		loading: exampleOverview(now, { loading: true }),
	}[state];
	return <OverviewBody {...props} />;
}

/** The Keys screen and the create flow: callbacks are functions, which a server page cannot pass. */
export function KeysDemo({
	view,
}: {
	view:
		| "all-in-use"
		| "stale"
		| "open"
		| "name"
		| "name-repeat"
		| "reveal"
		| "empty";
}) {
	const noop = () => {};
	if (view === "empty") {
		return (
			<KeysBody
				keys={[]}
				now={KEYS_EXAMPLE_NOW}
				onNew={noop}
				flow={<NameStep onSubmit={noop} />}
			/>
		);
	}
	if (view === "name" || view === "name-repeat") {
		return (
			<NameStep
				initialName={view === "name-repeat" ? "ci" : ""}
				existingNames={["prod-indexer", "ci", "laptop"]}
				onSubmit={noop}
				onCancel={noop}
			/>
		);
	}
	if (view === "reveal") {
		return <RevealStep value={EXAMPLE_NEW_KEY} name="laptop" onDone={noop} />;
	}
	return (
		<KeysBody
			keys={view === "stale" ? EXAMPLE_KEYS_STALE : EXAMPLE_KEYS}
			now={KEYS_EXAMPLE_NOW}
			onNew={noop}
			initialOpen={view === "open" ? "a1b2c3d4" : null}
		/>
	);
}
