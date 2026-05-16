import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { bnsMarketplaceEventsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: bnsMarketplaceEventsExporterSpec,
	enabledEnv: "BNS_MARKETPLACE_EVENTS_PUBLISHER_ENABLED",
	intervalMsEnv: "BNS_MARKETPLACE_EVENTS_PUBLISHER_INTERVAL_MS",
	label: "BNS marketplace-events",
});

export const bnsMarketplaceEventsPublisherState = publisher.state;
export const startBnsMarketplaceEventsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type BnsMarketplaceEventsPublisherState = typeof publisher.state;
export type StartBnsMarketplaceEventsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
