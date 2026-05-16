import { createDatasetPublisher } from "../_shared/scheduler.ts";
import { stxTransfersExporterSpec } from "./exporter.ts";

const publisher = createDatasetPublisher({
	exporter: stxTransfersExporterSpec,
	enabledEnv: "STX_TRANSFERS_PUBLISHER_ENABLED",
	intervalMsEnv: "STX_TRANSFERS_PUBLISHER_INTERVAL_MS",
	label: "STX transfers",
});

export const stxTransfersPublisherState = publisher.state;
export const startStxTransfersPublisher = publisher.start;
export const publishNextEligibleRange = publisher.publishNextEligibleRange;

export type StxTransfersPublisherState = typeof publisher.state;
export type StartStxTransfersPublisherOptions = Parameters<
	typeof publisher.start
>[0];
