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

export const LazyLivelineWaitingChart = dynamic(
	() =>
		import("../account/webhooks/charts/liveline-waiting-chart").then(
			(m) => m.LivelineWaitingChart,
		),
	{ ssr: false, loading: () => <ChartSkeleton height={70} /> },
);

export const LazyMonoShareBarChart = dynamic(
	() =>
		import("../account/webhooks/charts/mono-share-bar-chart").then(
			(m) => m.MonoShareBarChart,
		),
	{ ssr: false, loading: () => <ChartSkeleton height={90} /> },
);

export const LazyMonoHistogramChart = dynamic(
	() =>
		import("../account/webhooks/charts/mono-histogram-chart").then(
			(m) => m.MonoHistogramChart,
		),
	{ ssr: false, loading: () => <ChartSkeleton height={100} /> },
);

export const LazyMonoLagLineChart = dynamic(
	() =>
		import("../account/webhooks/charts/mono-lag-line-chart").then(
			(m) => m.MonoLagLineChart,
		),
	{ ssr: false, loading: () => <ChartSkeleton height={80} /> },
);
