import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { sbtcTokenEventsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: sbtcTokenEventsExporterSpec,
	enabledEnv: "SBTC_PUBLISHER_ENABLED",
	intervalMsEnv: "SBTC_PUBLISHER_INTERVAL_MS",
	label: "sBTC token-events",
});

export const sbtcTokenEventsPublisherState = publisher.state;
export const startSbtcTokenEventsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type SbtcTokenEventsPublisherState = typeof publisher.state;
export type StartSbtcTokenEventsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
