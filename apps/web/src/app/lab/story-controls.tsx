"use client";

import { TopupSheetBody } from "@/components/account/billing/compact-usage";
import { FirstRowsGuide } from "@/components/account/overview/first-rows-guide";
import {
	OverviewBody,
	SUBGRAPH_HEAD,
} from "@/components/account/overview/overview-section";
import {
	exampleKeys,
	exampleOverview,
	exampleRows,
	exampleStack,
	exampleSubgraph,
	exampleWebhooks,
	serverErrorsInsight,
} from "@/components/account/overview/overview.fixtures";
import {
	type PushPrefValues,
	PushSettingsView,
} from "@/components/account/push/push-settings";
import { SubgraphCompactDetail } from "@/components/account/subgraphs/compact-detail";
import { SubgraphCompactRow } from "@/components/account/subgraphs/compact-list";
import { SubgraphDetailBody } from "@/components/account/subgraphs/detail-screen";
import type { RowsRange } from "@/components/account/subgraphs/health-panels";
import { SubgraphRows } from "@/components/account/subgraphs/list-screen";
import {
	EXAMPLE_NOW,
	exampleDetail,
	exampleErrors,
	exampleHealth,
} from "@/components/account/subgraphs/subgraph.fixtures";
import { WebhookCompactDetailView } from "@/components/account/webhooks/compact-detail";
import {
	TitleRow,
	WebhookDetailBody,
} from "@/components/account/webhooks/detail-panel";
import { PayloadPanel } from "@/components/account/webhooks/payload-view";
import {
	ReplayBody,
	type ReplayView,
	replayTitle,
} from "@/components/account/webhooks/replay-sheet";
import { displayStatus } from "@/components/account/webhooks/shared";
import type { Range } from "@/components/account/webhooks/view";
import {
	FIXTURE_HOURS,
	activityFor,
	attempt,
	detail,
} from "@/components/account/webhooks/webhook.fixtures";
import { type AmountOption, AmountPicker } from "@/components/amount-picker";
import { Choice } from "@/components/choice";
import { HeatStrip } from "@/components/dashboard/charts/heat-strip";
import { Logo } from "@/components/logo";
import { ActivitySheet } from "@/components/mobile/activity-sheet";
import { HoldButton } from "@/components/mobile/hold-button";
import { Sheet, SheetPanel } from "@/components/mobile/sheet";
import { StatusPillView } from "@/components/mobile/status-pill";
import type { Activity } from "@/lib/activity";
import { EMPTY_TIP } from "@/lib/chain-tip";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { PushState } from "@/lib/push-client";
import type { SubgraphHealthData } from "@/lib/subgraphs-store";
import type { DailySpend } from "@/lib/usage";
import type { WebhookTestResult } from "@secondlayer/sdk";
import type { ChainTrigger } from "@secondlayer/sdk";
import type {
	ReplayProgress,
	ReplayRanges,
} from "@secondlayer/shared/schemas/webhooks";
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

/** The desktop webhook page on a failing webhook, with the drawer on its name. */
export function WebhookDetailDemo({ failing }: { failing: boolean }) {
	const [range, setRange] = useState<Range>("24h");
	const base = activityFor(12);
	const activity = failing
		? {
				...base,
				hours: base.hours.map((h, i, all) =>
					i >= all.length - 10
						? { ...h, delivered: 0, failed: 4, gaveUp: 3 }
						: h,
				),
			}
		: base;
	const [top] = FIXTURE_INSIGHTS;
	return (
		<WebhookDetailBody
			webhook={detail({ name: "alex-swaps" })}
			deliveries={[
				attempt({ id: "d3", statusCode: failing ? 502 : 200 }),
				attempt({ id: "d2", statusCode: 200, eventIndex: 2 }),
			]}
			activity={activity}
			days={undefined}
			insights={failing && top ? [top] : []}
			range={range}
			onRange={setRange}
			hour={null}
			hourDeliveries={null}
			onClearHour={() => {}}
			pauseBusy={false}
			onTogglePause={() => {}}
			onRename={async () => true}
			stackAsleep={false}
			onTest={() => toast("Test sent")}
			test={{ busy: false, result: null }}
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
			onOpenDetails={() => {}}
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

/** An opened delivery row's payload viewer, from a real delivery with no network. `kept: false` is a delivery whose payload was cleaned up; `asleep` is a paused webhook whose hosted stack stopped. */
export function PayloadViewDemo({
	kept,
	asleep = false,
}: { kept: boolean; asleep?: boolean }) {
	const response = JSON.stringify({
		args: {},
		data: PAYLOAD_STORY_SENT,
		headers: { host: "postman-echo.com", "content-type": "application/json" },
		url: "https://postman-echo.com/post",
	});
	return (
		<PayloadPanel
			load={
				asleep
					? { status: "asleep" }
					: {
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
						}
			}
			triggers={PAYLOAD_STORY_TRIGGERS}
			responseBody={response}
			statusCode={200}
			responseIsLatest
			host="postman-echo.com"
		/>
	);
}

/** The desktop subgraph page, healthy or stopped on a throwing handler. The
 *  range toggle needs state, which a server page cannot hold. */
export function SubgraphDetailDemo({ failing }: { failing: boolean }) {
	const [range, setRange] = useState<RowsRange>("24h");
	const health = exampleHealth(failing ? 3 : 0);
	const week = {
		...health,
		hours: Array.from({ length: 168 }, (_, i) => ({
			...(health.hours[i % 24] ?? health.hours[0]),
			hour: new Date(EXAMPLE_NOW - (167 - i) * 3_600_000).toISOString(),
		})) as SubgraphHealthData["hours"],
	};
	const [top] = FIXTURE_INSIGHTS;
	return (
		<SubgraphDetailBody
			detail={{
				...exampleDetail,
				status: failing ? "error" : "active",
				sync: {
					...exampleDetail.sync,
					blocksRemaining: failing ? 26 : 1,
				},
			}}
			health={health}
			weekHealth={week}
			errors={failing ? exampleErrors : []}
			insights={failing && top ? [top] : []}
			range={range}
			onRange={setRange}
			now={EXAMPLE_NOW}
		/>
	);
}

/** The phone's subgraph page, healthy or stopped on a throwing handler. */
export function SubgraphPhoneDemo({ failing }: { failing: boolean }) {
	const [top] = FIXTURE_INSIGHTS;
	return (
		<SubgraphCompactDetail
			detail={{
				...exampleDetail,
				status: failing ? "error" : "active",
				sync: { ...exampleDetail.sync, blocksRemaining: failing ? 26 : 1 },
			}}
			health={exampleHealth(failing ? 3 : 0)}
			errors={failing ? exampleErrors : []}
			insights={failing && top ? [top] : []}
			now={EXAMPLE_NOW}
		/>
	);
}

/** The Overview's three new-account views. */
export function OverviewOnboardingDemo({
	stage,
	firstRowsCode,
	firstRowsPrompt,
}: {
	stage: "no_key" | "no_reads" | "reading";
	firstRowsCode?: ReactNode;
	firstRowsPrompt?: ReactNode;
}) {
	const [now] = useState(() => new Date());
	const read = exampleKeys(now);
	const unread = read.map((k) => ({ ...k, lastUsedAt: null }));
	return (
		<OverviewBody
			{...exampleOverview(now, {
				rows: [],
				hasSubgraphs: false,
				keys: stage === "no_key" ? [] : stage === "reading" ? read : unread,
				billing: { creditsUsdMicros: "0", spentThisMonthUsdMicros: "0" },
				readUsage: null,
				stage,
				onboarding: {
					keyName: "laptop",
					flow: null,
					onCreateKey: () => {},
					firstRows: firstRowsCode ? (
						<FirstRowsGuide
							code={firstRowsCode}
							prompt={firstRowsPrompt}
							onSkip={() => {}}
						/>
					) : undefined,
				},
			})}
		/>
	);
}

export type PhoneAccountState =
	| "healthy"
	| "failing"
	| "no_key"
	| "no_reads"
	| "reading";

/** The phone's Account page on example data: one variant per state it has to get right. */
export function PhoneAccountDemo({ state }: { state: PhoneAccountState }) {
	const [now] = useState(() => new Date());
	const subgraph = exampleSubgraph(now);
	const stage =
		state === "no_key" || state === "no_reads" || state === "reading"
			? state
			: "running";
	const read = exampleKeys(now);
	const unread = read.map((k) => ({ ...k, lastUsedAt: null }));
	const early = stage !== "running";
	return (
		<>
			<OverviewBody
				{...exampleOverview(now, {
					compact: true,
					stage,
					rows: early
						? []
						: exampleWebhooks(now, { failing: state === "failing" }),
					insights: state === "failing" ? FIXTURE_INSIGHTS.slice(0, 2) : [],
					hasSubgraphs: !early,
					subgraphs: (
						<div className="msg-group">
							<SubgraphCompactRow
								item={subgraph.item}
								health={subgraph.health}
								insights={[]}
								href={`/account/subgraphs/${subgraph.item.name}`}
							/>
						</div>
					),
					keys: stage === "no_key" ? [] : stage === "no_reads" ? unread : read,
					apps: [
						{
							id: "app_1",
							clientName: "Claude Code",
							createdAt: new Date(
								now.getTime() - 20 * 86_400_000,
							).toISOString(),
							lastUsedAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
						},
					],
					onboarding: early
						? {
								keyName: "laptop",
								flow: null,
								onCreateKey: () => {},
							}
						: null,
					readUsage: stage === "running" ? exampleRows(now) : null,
				})}
			/>
			<LabToaster />
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
			insights: [serverErrorsInsight()],
		}),
		"our-errors-recovered": exampleOverview(now, {
			insights: [serverErrorsInsight(true)],
		}),
		loading: exampleOverview(now, { loading: true }),
	}[state];
	return <OverviewBody {...props} />;
}

export type BillingDemoState = "normal" | "fresh";

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
	const [requeued, setRequeued] = useState<number | null>(null);
	const [replayOpen, setReplayOpen] = useState(false);
	return (
		<>
			<WebhookCompactDetailView
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
				insights={failing ? FIXTURE_INSIGHTS.slice(0, 1) : []}
				stackAsleep={false}
				recovery={{
					dead: { count: 3, since: null },
					requeue: {
						busy: false,
						requeued,
						onRequeue: () => {
							setRequeued(3);
							toast.success("Requeued 3. They go out with live events.");
						},
					},
				}}
				replay={null}
				onReplay={() => setReplayOpen(true)}
			/>
			<LocalReplaySheet
				start="picker"
				open={replayOpen}
				onClose={() => setReplayOpen(false)}
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

const ACCOUNT_NOW = new Date("2026-10-17T12:00:00.000Z");

/** Daily spend: `early` a day for days 1 to 10, `late` a day for days 11 to 17. */
function accountDaily(early: number, late: number): DailySpend[] {
	return Array.from({ length: 17 }, (_, i) => ({
		date: `2026-10-${String(i + 1).padStart(2, "0")}`,
		unit: "rows.delivered",
		usdMicros: String(Math.round((i < 10 ? early : late) * 1_000_000)),
	}));
}

const ACCOUNT_USAGE = {
	healthy: {
		billing: {
			creditsUsdMicros: "38400000",
			spentThisMonthUsdMicros: "14200000",
		},
		capUsd: 50 as number | null,
		daily: accountDaily(0.83, 0.843),
		rows: "3200000",
		rate: "2000000",
	},
	"near-cap": {
		billing: {
			creditsUsdMicros: "9900000",
			spentThisMonthUsdMicros: "40100000",
		},
		capUsd: 50 as number | null,
		daily: accountDaily(2.26, 2.5),
		rows: "8400000",
		rate: "2360000",
	},
	"no-cap": {
		billing: {
			creditsUsdMicros: "38400000",
			spentThisMonthUsdMicros: "14200000",
		},
		capUsd: null as number | null,
		daily: accountDaily(0.83, 0.843),
		rows: "3200000",
		rate: "2000000",
	},
};

type AccountScenario = keyof typeof ACCOUNT_USAGE;

function accountUsageProps(scenario: AccountScenario) {
	const s = ACCOUNT_USAGE[scenario];
	return {
		now: ACCOUNT_NOW,
		billing: s.billing,
		capUsd: s.capUsd,
		usage: [
			{ unit: "rows.delivered", quantity: s.rows, usdMicros: "0" },
			{ unit: "webhook.event", quantity: "300400", usdMicros: "0" },
		],
		daily: s.daily,
		burn: { rateDayUsdMicros: s.rate, windowHours: 24 },
		service: { state: "running" as const, lastChargedAt: null, memory24h: [] },
	};
}

/** A fake checkout: picks an amount, never leaves the Lab. */
function useLabCheckout() {
	const [amount, setAmount] = useState(25);
	return {
		amount,
		valid: true,
		choose: (next: number | null) => next !== null && setAmount(next),
		busy: false,
		error: null,
		checkout: async () => {
			toast("Opens Stripe Checkout, then returns here");
		},
	};
}

/** The top-up sheet's markup at a fixed height. */
export function TopupSheetDemo() {
	const co = useLabCheckout();
	const props = accountUsageProps("near-cap");
	return (
		<>
			<SheetPanel eyebrow="Balance $9.90" title="Top up" detent="auto">
				<TopupSheetBody co={co} billing={props.billing} burn={props.burn} />
			</SheetPanel>
			<LabToaster />
		</>
	);
}

const PUSH_DEFAULTS: PushPrefValues = {
	webhookFailing: true,
	subgraphStopped: true,
	subgraphNotServing: true,
	replayDone: true,
	spendCap: false,
	keyRepeat: false,
};

/** The phone's Push segment in one device state; the switches flip locally. */
export function LocalPushSettings({ state }: { state: PushState }) {
	const [prefs, setPrefs] = useState(PUSH_DEFAULTS);
	const [current, setCurrent] = useState(state);
	return (
		<>
			<PushSettingsView
				state={current}
				prefs={prefs}
				ios={state === "needs_install"}
				onToggle={(key) => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
				onTurnOn={() => setCurrent("on")}
				onTurnOff={() => setCurrent("off")}
			/>
		</>
	);
}

/* ---------- Replay and status pill ---------- */

const REPLAY_RANGES: ReplayRanges = {
	tip: 9_612_408,
	presets: [
		{ blocks: 100, fromBlock: 9_612_309, toBlock: 9_612_408, knownEvents: 380 },
		{
			blocks: 1000,
			fromBlock: 9_611_409,
			toBlock: 9_612_408,
			knownEvents: 3812,
		},
		{
			blocks: 10000,
			fromBlock: 9_602_409,
			toBlock: 9_612_408,
			knownEvents: 84_210,
		},
	],
	deadSinceFailing: { since: null, count: 22 },
};

const REPLAY_TOTAL = 3812;
const REPLAY_GAVE_UP = 22;

function replayProgress(patch: Partial<ReplayProgress> = {}): ReplayProgress {
	return {
		replayId: "0123456789abcdef",
		webhookId: "wh_1",
		status: "running",
		fromBlock: 9_611_409,
		toBlock: 9_612_408,
		total: REPLAY_TOTAL,
		processed: 1452,
		pending: REPLAY_TOTAL - 1452,
		delivered: null,
		gaveUp: null,
		startedAt: "2026-10-18T10:00:00.000Z",
		finishedAt: null,
		error: null,
		...patch,
	};
}

const replayDone = (gaveUp: number): ReplayProgress =>
	replayProgress({
		status: "done",
		processed: REPLAY_TOTAL,
		pending: 0,
		delivered: REPLAY_TOTAL - gaveUp,
		gaveUp,
		finishedAt: "2026-10-18T10:07:00.000Z",
	});

type ReplayStart = "picker" | "gated" | "running" | "done";

/**
 * The replay sheet with a fake server: pick a range, watch it run, see it
 * finish, requeue what gave up. It has the same shape as `ReplaySheet` (one
 * `Sheet`, only its body changes), so the "Tick" button shows that progress
 * updates never replay the slide-up. Ticks also run on a timer when `ticking`.
 */
export function LocalReplaySheet({
	start,
	open: controlledOpen,
	onClose,
	ticking = false,
}: {
	start: ReplayStart;
	open?: boolean;
	onClose?: () => void;
	ticking?: boolean;
}) {
	const [ownOpen, setOwnOpen] = useState(true);
	const open = controlledOpen ?? ownOpen;
	const close = onClose ?? (() => setOwnOpen(false));
	const [selected, setSelected] = useState(1000);
	const [progress, setProgress] = useState<ReplayProgress | null>(
		start === "running"
			? replayProgress()
			: start === "done"
				? replayDone(REPLAY_GAVE_UP)
				: null,
	);
	const [requeueBusy, setRequeueBusy] = useState(false);

	const tick = useCallback(() => {
		setProgress((p) => {
			if (!p) return p;
			if (p.status === "scanning") return { ...p, status: "running" };
			if (p.status !== "running") return p;
			const processed = Math.min(p.total, p.processed + 190);
			if (processed < p.total) {
				return { ...p, processed, pending: p.total - processed };
			}
			const gaveUp = p.gaveUp === 0 ? 0 : REPLAY_GAVE_UP;
			return {
				...p,
				status: "done",
				processed: p.total,
				pending: 0,
				delivered: p.total - gaveUp,
				gaveUp,
				finishedAt: "2026-10-18T10:07:00.000Z",
			};
		});
	}, []);

	useEffect(() => {
		if (!ticking) return;
		const id = setInterval(tick, 1200);
		return () => clearInterval(id);
	}, [ticking, tick]);

	let view: ReplayView;
	if (progress) {
		view = {
			kind: "progress",
			progress,
			minutesLeft:
				progress.status === "running"
					? Math.max(1, Math.round((progress.total - progress.processed) / 640))
					: null,
			requeueBusy,
		};
	} else if (start === "gated") {
		view = { kind: "gated" };
	} else {
		view = { kind: "picker", ranges: REPLAY_RANGES, selected, busy: false };
	}

	return (
		<>
			<div style={{ display: "flex", gap: 8, padding: 16 }}>
				<button
					type="button"
					className="btn"
					onClick={() => setOwnOpen(true)}
					style={{ justifySelf: "start" }}
				>
					Open sheet
				</button>
				<button type="button" className="btn" data-lab="tick" onClick={tick}>
					Tick
				</button>
			</div>
			<Sheet
				open={open}
				onClose={close}
				eyebrow={<span className="mrp-mono">sbtc-deposits</span>}
				title={replayTitle(view)}
			>
				<div className="mrp">
					<ReplayBody
						view={view}
						onClose={close}
						onSelect={setSelected}
						onStart={() => {
							setProgress(replayProgress({ status: "scanning", processed: 0 }));
							setTimeout(tick, 600);
						}}
						onRequeue={() => {
							setRequeueBusy(true);
							setTimeout(() => {
								setRequeueBusy(false);
								toast.success(
									`Requeued ${REPLAY_GAVE_UP}. They go out with live events.`,
								);
								setProgress(
									replayProgress({
										gaveUp: 0,
										processed: REPLAY_TOTAL - REPLAY_GAVE_UP,
										pending: REPLAY_GAVE_UP,
									}),
								);
							}, 400);
						}}
					/>
				</div>
			</Sheet>
			<LabToaster />
		</>
	);
}

const STALLED_4: Activity = {
	kind: "chain",
	state: { kind: "stalled", minutes: 4, bitcoinSince: null },
	level: 2,
};
const BEHIND_18: Activity = {
	kind: "chain",
	state: { kind: "behind", blocks: 18 },
	level: 1,
};
const OFFLINE: Activity = {
	kind: "chain",
	state: { kind: "unreachable" },
	level: 4,
};
const REPLAY_RUNNING: Activity = {
	kind: "replay",
	progress: replayProgress(),
};
const REPLAY_FINISHED: Activity = {
	kind: "replay",
	progress: replayDone(REPLAY_GAVE_UP),
};

const PILL_TIP = {
	...EMPTY_TIP,
	height: 9_612_408,
	nodeTip: 9_612_426,
	bitcoin: 972_418,
	bitcoinSeenAt: Date.now() - 3 * 60_000,
};

/** The status pill beside a screen title, with the Activity drawer behind it. */
export function PillHeaderDemo({
	items,
	openDrawer = false,
}: {
	items: readonly Activity[];
	openDrawer?: boolean;
}) {
	const [open, setOpen] = useState(openDrawer);
	const [shown, setShown] = useState(items);
	return (
		<>
			{/* The header hides itself above 640px; the Lab shows it at any width. */}
			<header className="m-head" style={{ display: "block" }}>
				<div className="m-head-row">
					<h1 className="m-title">Webhooks</h1>
					<StatusPillView items={shown} onOpen={() => setOpen(true)} />
				</div>
			</header>
			<ActivitySheet
				open={open}
				onClose={() => setOpen(false)}
				items={shown}
				tip={PILL_TIP}
				now={Date.now()}
				webhookName={() => "sbtc-deposits"}
				onDismissChain={() =>
					setShown((all) => all.filter((a) => a.kind !== "chain"))
				}
				onClear={() =>
					setShown((all) => all.filter((a) => a.kind !== "replay"))
				}
			/>
		</>
	);
}

/** Every label the pill can wear, one title row each. */
export function PillStatesDemo() {
	const rows: Array<[string, readonly Activity[]]> = [
		["Replay running", [REPLAY_RUNNING]],
		[
			"Replay queued",
			[
				{
					kind: "replay",
					progress: replayProgress({
						status: "scanning",
						processed: 0,
					}),
				},
			],
		],
		["Stalled", [STALLED_4]],
		["Behind", [BEHIND_18]],
		["Offline", [OFFLINE]],
		["Replay done", [REPLAY_FINISHED]],
		[
			"Replay failed",
			[
				{
					kind: "replay",
					progress: replayProgress({
						status: "failed",
						error: "scan timed out",
					}),
				},
			],
		],
		["Replay and a stalled chain", [REPLAY_RUNNING, STALLED_4]],
	];
	return (
		<div style={{ display: "grid", gap: 14, padding: "12px 20px" }}>
			{rows.map(([label, items]) => (
				<div
					key={label}
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 12,
					}}
				>
					<span style={{ fontSize: 13, color: "var(--sub)" }}>{label}</span>
					<StatusPillView items={items} onOpen={() => {}} />
				</div>
			))}
		</div>
	);
}

/** A running replay and a stalled chain: the pill reads "Replay 38%" with "+1". */
export const PILL_REPLAY_AND_STALLED: readonly Activity[] = [
	REPLAY_RUNNING,
	STALLED_4,
];
