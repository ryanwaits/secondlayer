import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { sbtcEventsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: sbtcEventsExporterSpec,
	enabledEnv: "SBTC_PUBLISHER_ENABLED",
	intervalMsEnv: "SBTC_PUBLISHER_INTERVAL_MS",
	label: "sBTC events",
});

export const sbtcEventsPublisherState = publisher.state;
export const startSbtcEventsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type SbtcEventsPublisherState = typeof publisher.state;
export type StartSbtcEventsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
