"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "../skeletons";

/**
 * `next/dynamic` wrappers for every chart on the detail page (plan 073).
 * `recharts` alone is a 137 KB gzipped chunk; none of these five charts are
 * needed for the page's first paint (stats, the tables, the diagnosis text
 * all render without them), so they load in their own chunk behind a
 * skeleton sized to each chart's own height, instead of blocking the whole
 * page's first-load JS.
 */

export const LazyMonoStackedBarChart = dynamic(
	() => import("./mono-stacked-bar-chart").then((m) => m.MonoStackedBarChart),
	{ ssr: false, loading: () => <ChartSkeleton height={120} /> },
);

export const LazyLivelineWaitingChart = dynamic(
	() => import("./liveline-waiting-chart").then((m) => m.LivelineWaitingChart),
	{ ssr: false, loading: () => <ChartSkeleton height={70} /> },
);

export const LazyMonoShareBarChart = dynamic(
	() => import("./mono-share-bar-chart").then((m) => m.MonoShareBarChart),
	{ ssr: false, loading: () => <ChartSkeleton height={90} /> },
);

export const LazyMonoHistogramChart = dynamic(
	() => import("./mono-histogram-chart").then((m) => m.MonoHistogramChart),
	{ ssr: false, loading: () => <ChartSkeleton height={100} /> },
);

export const LazyMonoLagLineChart = dynamic(
	() => import("./mono-lag-line-chart").then((m) => m.MonoLagLineChart),
	{ ssr: false, loading: () => <ChartSkeleton height={80} /> },
);
