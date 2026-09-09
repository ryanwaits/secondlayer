/**
 * Re-export: diagnosis lives in shared so the SDK and CLI cannot drift.
 */
export {
	BOOTSTRAP_STEP,
	OBSERVER_STEP,
	SELF_HOST_DOCS_STEP,
	diagnoseInstanceStatus,
	explainContextNulls,
	hasNoChainData,
} from "@secondlayer/shared/archive/instance-diagnosis";
export type {
	ContextExplanation,
	ContextProbe,
	InstanceDiagnosis,
	InstanceIssue,
	InstanceState,
	PublicStatus,
	PublicStatusDecoder,
	PublicStatusService,
} from "@secondlayer/shared/archive/instance-diagnosis";
