"use client";

import { BillingBody } from "@/components/account/billing/billing-screen";
import { LimitsAndEmails } from "@/components/account/billing/limits-and-emails";
import { AddCredits, useCheckout } from "@/components/account/credits-panel";
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
import { WebhookCompactDetail } from "@/components/account/webhooks/compact-detail";
import { WebhooksCompactList } from "@/components/account/webhooks/compact-list";
import { TitleRow } from "@/components/account/webhooks/detail-panel";
import { PayloadPanel } from "@/components/account/webhooks/payload-view";
import {
	type WebhookRowModel,
	rowModel,
} from "@/components/account/webhooks/rows";
import {
	countByDisplayStatus,
	displayStatus,
} from "@/components/account/webhooks/shared";
import {
	FIXTURE_HOURS,
	activityFor,
	attempt,
	detail,
	summary,
} from "@/components/account/webhooks/webhook.fixtures";
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
import { HoldButton } from "@/components/mobile/hold-button";
import { Sheet } from "@/components/mobile/sheet";
import { SwipeGroup, SwipeRow } from "@/components/mobile/swipe-row";
import type { RowsDay, RowsResponse } from "@/lib/rows";
import {
	DEFAULT_SORT,
	type SortState,
	type TableFilter,
	isDefaultSort,
	toggleSort,
	withFilter,
} from "@/lib/subgraph-view";
import type { WebhookTestResult } from "@secondlayer/sdk";
import type { ChainTrigger } from "@secondlayer/sdk";
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
import { Toaster, toast } from "sonner";
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

const PAYLOAD_STORY_SENT = {
	type: "chain.print_event.apply",
	timestamp: "2026-10-16T17:39:14.000Z",
	data: {
		event: {
			data: {
				topic: "print",
				value: {
					topic: "unstake",
					signer:
						"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
					staker: "SP134V7CBZZ4C356R2WTNE1522GGCZJ6YRN2A5SWG",
					"amount-ustx": "100000000000",
					"unlock-cycle": "146",
					"first-reward-cycle": "143",
					"unlock-burn-height": "972650",
				},
				raw_value:
					"0x0c000000070b616d6f756e742d75737478010000000000000000000000174876e8001266697273742d7265776172642d6379636c65010000000000000000000000000000008f067369676e65720616296a283b358830510c486f90c13d924b92a6590e1e66617374706f6f6c2d6d61783530302d7369676e65722d6d616e61676572067374616b65720516464d9d8bffc8c194d817355704a21420cfc8dec505746f7069630d00000007756e7374616b6512756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000ed76a0c756e6c6f636b2d6379636c650100000000000000000000000000000092",
				contract_id: "SP000000000000000000002Q6VF78.pox-5",
			},
			type: "contract_event",
			tx_id:
				"0x9b5aa03c09d0c7f0939d0398e60ac7a521b23c3ce92a9781e9bbfe86604dcc41",
			event_index: 2,
		},
		tx_id: "0x9b5aa03c09d0c7f0939d0398e60ac7a521b23c3ce92a9781e9bbfe86604dcc41",
		action: "apply",
		trigger: "print_event",
		canonical: true,
		block_hash:
			"0xb2b876c112e5525d2ce463732a34ecd64ad7507cbdf85f21a26a050028b89d1d",
		block_time: "2026-10-16T17:39:03.000Z",
		block_height: 9227006,
	},
};

const PAYLOAD_STORY_TRIGGERS: ChainTrigger[] = [
	{
		type: "print_event",
		contractId: "SP000000000000000000002Q6VF78.pox-5",
		where: {
			signer: [
				"SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP.fastpool-1-signer-manager",
				"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
			],
		},
	},
];

/** An opened delivery row's payload viewer, from a real delivery with no network. `kept: false` is a delivery whose payload was cleaned up. */
export function PayloadViewDemo({ kept }: { kept: boolean }) {
	const response = JSON.stringify({
		args: {},
		data: PAYLOAD_STORY_SENT,
		headers: { host: "postman-echo.com", "content-type": "application/json" },
		url: "https://postman-echo.com/post",
	});
	return (
		<PayloadPanel
			load={{
				status: "ok",
				detail: {
					id: "d1",
					attempt: 1,
					statusCode: 200,
					durationMs: 163,
					dispatchedAt: "2026-10-16T17:39:14.000Z",
					errorMessage: null,
					responseBody: response,
					responseHeaders: null,
					outboxId: null,
					outboxStatus: null,
					eventType: "print_event",
					txId: PAYLOAD_STORY_SENT.data.tx_id,
					blockHeight: PAYLOAD_STORY_SENT.data.block_height,
					blockTime: PAYLOAD_STORY_SENT.data.block_time,
					eventIndex: 2,
					payload: kept ? PAYLOAD_STORY_SENT : null,
				},
			}}
			triggers={PAYLOAD_STORY_TRIGGERS}
			responseBody={response}
			statusCode={200}
			responseIsLatest
			host="postman-echo.com"
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
export function RowsEmptyDemo({ firstRun }: { firstRun: boolean }) {
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
			keyState={firstRun ? "first" : "active"}
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

export type BillingDemoState = "normal" | "fresh";

const BILLING_NOW = new Date("2026-10-16T12:00:00.000Z");

function billingDaily() {
	const out = [];
	for (let d = 1; d <= 16; d++) {
		const date = `2026-10-${String(d).padStart(2, "0")}`;
		out.push({
			date,
			unit: "memory.gb_hour",
			usdMicros: String(90_000 + d * 4_000),
		});
		out.push({
			date,
			unit: "rows.delivered",
			usdMicros: String((d % 5) * 11_000),
		});
	}
	return out;
}

/** The Billing screen on example data: the Add credits panel and the limits are live, so the amount row and the limit field can be tried. */
export function BillingDemo({ state }: { state: BillingDemoState }) {
	const co = useCheckout();
	const fresh = state === "fresh";
	const billing = fresh
		? { creditsUsdMicros: "0", spentThisMonthUsdMicros: "0" }
		: { creditsUsdMicros: "28060000", spentThisMonthUsdMicros: "11340000" };
	const burn = fresh ? null : { rateDayUsdMicros: "146145", windowHours: 24 };
	const [capUsd, setCapUsd] = useState<number | null>(fresh ? null : 100);
	return (
		<BillingBody
			now={BILLING_NOW}
			billing={billing}
			burn={burn}
			service={
				fresh ? null : { state: "running", lastChargedAt: null, memory24h: [] }
			}
			usage={
				fresh
					? []
					: [
							{
								unit: "rows.delivered",
								quantity: "2400000",
								usdMicros: "1400000",
							},
							{ unit: "memory.gb_hour", quantity: "310", usdMicros: "8680000" },
							{
								unit: "webhook.event",
								quantity: "126000",
								usdMicros: "1260000",
							},
						]
			}
			daily={fresh ? [] : billingDaily()}
			capUsd={capUsd}
			onCapChange={setCapUsd}
			credits={
				fresh
					? []
					: [
							{
								occurredAt: "2026-10-09T10:00:00.000Z",
								kind: "topup",
								source: "stripe",
								usdMicros: "25000000",
							},
							{
								occurredAt: "2026-10-01T10:00:00.000Z",
								kind: "grant",
								source: "welcome",
								usdMicros: "5000000",
							},
						]
			}
			addCredits={
				<AddCredits co={co} billing={billing} burn={burn} stopped={false} />
			}
			settings={
				<LimitsAndEmails
					capUsd={capUsd}
					onCapChange={setCapUsd}
					spentUsd={Number(billing.spentThisMonthUsdMicros) / 1_000_000}
				/>
			}
		/>
	);
}

/** Lab-only toast host: the Lab sits outside (www), which mounts the app's one Toaster. */
export function LabToaster() {
	return (
		<Toaster
			position="bottom-center"
			toastOptions={{
				unstyled: true,
				classNames: { toast: "wh-toast", title: "wh-toast-title" },
			}}
		/>
	);
}

const LONG_ERROR =
	"POST https://hooks.example.com/stacks/ingest/very/long/path/that/keeps/going -> 500 Internal Server Error: upstream connect error or disconnect/reset before headers. reset reason: connection termination";

/** Opens a `Sheet` from a button; `detents` picks the auto or the half/full variant. */
export function SheetDemo({ variant }: { variant: "auto" | "detents" }) {
	const [open, setOpen] = useState(false);
	return (
		<div style={{ display: "grid", gap: 12, padding: 16 }}>
			<button
				type="button"
				className="btn"
				onClick={() => setOpen(true)}
				style={{ justifySelf: "start" }}
			>
				Open sheet
			</button>
			<Sheet
				open={open}
				onClose={() => setOpen(false)}
				eyebrow="Webhook · ci-runner"
				title={variant === "auto" ? "Delivery paused" : "Delivery failed"}
				detents={variant === "auto" ? "auto" : ["half", "full"]}
			>
				{variant === "auto" ? (
					<p style={{ margin: 0, color: "var(--sub)", fontSize: 14 }}>
						Deliveries resume when you replay them.
					</p>
				) : (
					<>
						<pre
							style={{
								margin: 0,
								padding: "10px 12px",
								border: "1px solid var(--line)",
								borderRadius: 8,
								font: "12px/1.55 var(--font-mono-stack)",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								color: "var(--alarm)",
							}}
						>
							{LONG_ERROR}
						</pre>
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<p
								key={n}
								style={{ margin: 0, color: "var(--sub)", fontSize: 14 }}
							>
								Attempt {n} of 6 failed with the same response.
							</p>
						))}
					</>
				)}
			</Sheet>
			<LabToaster />
		</div>
	);
}

/** Three swipe rows in one group: two with Pause and Replay, one with a lone Revoke. */
export function SwipeRowDemo() {
	const rows = [
		{ id: "a", name: "ci-runner", two: true },
		{ id: "b", name: "mainnet-prod", two: true },
		{ id: "c", name: "staging-read", two: false },
	];
	return (
		<div style={{ padding: 16 }}>
			<div
				style={{
					border: "1px solid var(--line)",
					borderRadius: 8,
					overflow: "hidden",
				}}
			>
				<SwipeGroup>
					{rows.map((row) => (
						<SwipeRow
							key={row.id}
							id={row.id}
							onTap={() => toast(`Opened ${row.name}`)}
							actions={
								row.two
									? [
											{
												label: "Pause",
												tone: "neutral",
												onAction: () => toast(`Paused ${row.name}`),
											},
											{
												label: "Replay",
												tone: "pri",
												onAction: () => toast(`Replaying ${row.name}`),
											},
										]
									: [
											{
												label: "Revoke",
												tone: "alarm",
												onAction: () => toast(`Revoked ${row.name}`),
											},
										]
							}
						>
							<div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
								<div style={{ fontSize: 14, fontWeight: 500 }}>{row.name}</div>
								<div style={{ fontSize: 13, color: "var(--sub)" }}>
									Last delivery 2m ago
								</div>
							</div>
						</SwipeRow>
					))}
				</SwipeGroup>
			</div>
			<LabToaster />
		</div>
	);
}

/** One `HoldButton` that toasts when the hold completes. */
export function HoldButtonDemo() {
	return (
		<div style={{ padding: 16 }}>
			<HoldButton
				label="Hold to revoke ci-runner"
				onConfirm={() => toast("Revoked ci-runner.")}
			/>
			<LabToaster />
		</div>
	);
}

const PHONE_SERIES = {
	delivered: new Array<number>(168).fill(3),
	failed: new Array<number>(168).fill(0),
};

function phoneRow(
	over: Parameters<typeof summary>[0],
	state?: WebhookRowModel["state"],
): WebhookRowModel {
	const model = rowModel(summary(over), PHONE_SERIES, FIXTURE_HOURS, []);
	return state ? { ...model, state } : model;
}

const PHONE_ROWS_HEALTHY: WebhookRowModel[] = [
	phoneRow({ id: "wh_1", name: "sbtc-deposits" }),
	phoneRow({ id: "wh_2", name: "amm-swaps" }),
	phoneRow({ id: "wh_3", name: "nft-mints" }),
	phoneRow({ id: "wh_4", name: "pox-stackers", status: "paused" }),
];

const PHONE_ROWS_FAILING: WebhookRowModel[] = [
	phoneRow(
		{
			id: "wh_1",
			name: "sbtc-deposits",
			status: "paused",
			circuitOpenedAt: "2026-10-15T11:40:00.000Z",
			circuitFailures: 20,
		},
		{ tone: "alarm", text: "Server not answering · 214 waiting", bad: true },
	),
	...PHONE_ROWS_HEALTHY.slice(1, 3),
];

/** The phone list with local state, so swipe, Pause and Undo work with no server. */
export function LocalWebhooksList({
	failing: oneFailing,
}: { failing: boolean }) {
	const [rows, setRows] = useState(
		oneFailing ? PHONE_ROWS_FAILING : PHONE_ROWS_HEALTHY,
	);
	const setPaused = (id: string, paused: boolean) =>
		setRows((all) =>
			all.map((r) =>
				r.webhook.id === id
					? {
							...r,
							webhook: {
								...r.webhook,
								status: paused ? "paused" : "active",
								circuitOpenedAt: null,
								circuitFailures: 0,
							},
							state: paused
								? { tone: "idle", text: "Paused", bad: false }
								: { tone: "ok", text: "Delivering", bad: false },
						}
					: r,
			),
		);
	return (
		<>
			<WebhooksCompactList
				rows={rows}
				failing={countByDisplayStatus(
					rows.map((r) => r.webhook),
					"error",
				)}
				busyId={null}
				onOpen={() => {}}
				onTogglePause={(row) => {
					const { id, name } = row.webhook;
					if (displayStatus(row.webhook) === "active") {
						setPaused(id, true);
						toast(`Paused ${name}. Events wait for you.`, {
							duration: 5000,
							action: { label: "Undo", onClick: () => setPaused(id, false) },
						});
					} else {
						setPaused(id, false);
						toast.success(`Resumed ${name}`);
					}
				}}
			/>
			<LabToaster />
		</>
	);
}

/** The phone detail with a local test and resume, so the three steps can be walked. */
export function LocalWebhookDetail({
	failing: startsFailing,
	tested = false,
}: { failing: boolean; tested?: boolean }) {
	const [webhook, setWebhook] = useState(
		detail(startsFailing ? FAILING_DETAIL : { name: "sbtc-deposits" }),
	);
	const [test, setTest] = useState<{
		busy: boolean;
		result: WebhookTestResult | null;
	}>({ busy: false, result: tested ? TEST_PASSED : null });
	const failing = displayStatus(webhook) === "error";
	const failedHours = FIXTURE_HOURS.slice(-3);
	const activity = activityFor(3, {
		waiting: failing ? 214 : 0,
		hours: FIXTURE_HOURS.map((hour) => ({
			hour,
			delivered: failing && failedHours.includes(hour) ? 0 : 3,
			waiting: 0,
			gaveUp: 0,
			failed: failing && failedHours.includes(hour) ? 6 : 0,
		})),
	});
	const rows = [
		attempt({
			id: "d_4",
			statusCode: failing ? 502 : 200,
			durationMs: failing ? 30_000 : 184,
			blockHeight: 9_000_004,
		}),
		attempt({
			id: "d_3",
			statusCode: failing ? 502 : 200,
			durationMs: failing ? 30_000 : 171,
			blockHeight: 9_000_003,
		}),
		attempt({ id: "d_2", blockHeight: 9_000_002 }),
		attempt({ id: "d_1", blockHeight: 9_000_001 }),
	];
	return (
		<>
			<WebhookCompactDetail
				webhook={webhook}
				activity={activity}
				deliveries={rows}
				pauseBusy={false}
				onTogglePause={() =>
					setWebhook((w) =>
						w.status === "paused"
							? {
									...w,
									status: "active",
									circuitOpenedAt: null,
									circuitFailures: 0,
									lastError: null,
								}
							: { ...w, status: "paused" },
					)
				}
				test={test}
				onTest={() => {
					setTest({ busy: false, result: TEST_PASSED });
					toast.success("Test got 200 in 184 ms");
				}}
			/>
			<LabToaster />
		</>
	);
}

const TEST_PASSED: WebhookTestResult = {
	ok: true,
	statusCode: 200,
	error: null,
	durationMs: 184,
	deliveryId: "d_test",
};

const FAILING_DETAIL = {
	name: "sbtc-deposits",
	status: "paused",
	circuitOpenedAt: "2026-10-15T11:40:00.000Z",
	circuitFailures: 20,
	lastError: "502 Bad Gateway",
} as const;
