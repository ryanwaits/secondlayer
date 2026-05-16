import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { bnsNamespaceEventsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: bnsNamespaceEventsExporterSpec,
	enabledEnv: "BNS_NAMESPACE_EVENTS_PUBLISHER_ENABLED",
	intervalMsEnv: "BNS_NAMESPACE_EVENTS_PUBLISHER_INTERVAL_MS",
	label: "BNS namespace-events",
});

export const bnsNamespaceEventsPublisherState = publisher.state;
export const startBnsNamespaceEventsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type BnsNamespaceEventsPublisherState = typeof publisher.state;
export type StartBnsNamespaceEventsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
