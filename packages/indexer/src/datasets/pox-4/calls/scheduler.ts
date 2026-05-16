import { createDatasetPublisher } from "../../_shared/scheduler.ts";
import { pox4CallsExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: pox4CallsExporterSpec,
	enabledEnv: "POX4_CALLS_PUBLISHER_ENABLED",
	intervalMsEnv: "POX4_CALLS_PUBLISHER_INTERVAL_MS",
	label: "PoX-4 calls",
});

export const pox4CallsPublisherState = publisher.state;
export const startPox4CallsPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type Pox4CallsPublisherState = typeof publisher.state;
export type StartPox4CallsPublisherOptions = Parameters<
	typeof publisher.start
>[0];
