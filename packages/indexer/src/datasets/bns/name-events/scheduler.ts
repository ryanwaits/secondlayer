import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { bnsNameEventsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: bnsNameEventsExporterSpec,
	enabledEnv: "BNS_NAME_EVENTS_PUBLISHER_ENABLED",
	intervalMsEnv: "BNS_NAME_EVENTS_PUBLISHER_INTERVAL_MS",
	label: "BNS name-events",
});

export const bnsNameEventsPublisherState = publisher.state;
export const startBnsNameEventsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type BnsNameEventsPublisherState = typeof publisher.state;
export type StartBnsNameEventsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
