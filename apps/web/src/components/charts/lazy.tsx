"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "./chart-skeleton";

/**
 * `next/dynamic` wrappers for every recharts-based chart on the webhooks and
 * credits pages. `recharts` alone is a 137 KB gzipped chunk; none of these
 * charts are needed for their page's first paint (stats, tables, the
 * runway/banner text all render without them), so they load in their own
 * chunk behind a skeleton sized to each chart's own height, instead of
 * blocking the whole page's first-load JS.
 */

export const LazyMonoStackedBarChart = dynamic(
	() => import("./mono-stacked-bar-chart").then((m) => m.MonoStackedBarChart),
	{ ssr: false, loading: () => <ChartSkeleton height={120} /> },
);

export const LazyMonoAreaLineChart = dynamic(
	() => import("./mono-area-line-chart").then((m) => m.MonoAreaLineChart),
	{ ssr: false, loading: () => <ChartSkeleton height={144} /> },
);

export const LazyBandBarChart = dynamic(
	() =>
		import("../dashboard/charts/band-bar-chart").then((m) => m.BandBarChart),
	{ ssr: false, loading: () => <ChartSkeleton height={180} /> },
);

export const LazyContextLineChart = dynamic(
	() =>
		import("../dashboard/charts/context-line-chart").then(
			(m) => m.ContextLineChart,
		),
	{ ssr: false, loading: () => <ChartSkeleton height={130} /> },
);

export const LazySpendChart = dynamic(
	() => import("../dashboard/charts/spend-chart").then((m) => m.SpendChart),
	{ ssr: false, loading: () => <ChartSkeleton height={150} /> },
);
