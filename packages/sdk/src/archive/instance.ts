import {
	type InstanceDiagnosis,
	type PublicStatus,
	diagnoseInstanceStatus,
} from "@secondlayer/shared/archive/instance-diagnosis";

/** Structural `/public/status` payload. Extra fields are ignored by diagnosis. */
export type InstanceStatus = PublicStatus;

export type InstanceClient = {
	/**
	 * Get the instance's public status report.
	 *
	 * Reads `GET /public/status`: the overall status, chain tip, chain integrity, and the state of each service and decoder.
	 */
	status(): Promise<InstanceStatus>;
	/**
	 * Turn the status report into a verdict with next steps.
	 *
	 * Resolves to a `state` (`healthy`, `empty-index`, or `degraded`), the API's own `overall` status, and a list of issues, each with the commands that resolve it. A fresh instance with no blocks indexed reads as `empty-index`, not broken.
	 */
	diagnose(): Promise<InstanceDiagnosis>;
};

/** What to verify against, and the optional block range. */
export type ArchiveVerifyInput = {
	against: string;
	target?: string;
	fromBlock?: number;
	toBlock?: number;
	insecure?: boolean;
	publicKeyPem?: string;
};

export type ArchiveVerifyRangeStatus =
	| "match"
	| "digest-mismatch"
	| "count-mismatch"
	| "missing";

/** Whether the archive is clean, diverged, or unanchored, by range. */
export type ArchiveVerifyResult = {
	status: "clean" | "diverged" | "unanchored";
	target: string;
	against: string;
	signature: { verified: boolean; reason?: string };
	coverage?: { from_block: number; to_block: number };
	ranges: Array<{
		dataset: string;
		from_block: number;
		to_block: number;
		status: ArchiveVerifyRangeStatus;
		expected_digest: string | null;
		actual_digest: string | null;
	}>;
	reason?: string;
};

type RequestFn = <T>(
	method: string,
	path: string,
	body?: unknown,
) => Promise<T>;

/** Instance `POST /v1/archive/verify`. Hits `baseUrl`, never `archiveOpsUrl`. */
export function createArchiveVerify(
	request: RequestFn,
): (input: ArchiveVerifyInput) => Promise<ArchiveVerifyResult> {
	return (input) =>
		request("POST", "/v1/archive/verify", {
			against: input.against,
			target: input.target ?? "raw",
			from_block: input.fromBlock,
			to_block: input.toBlock,
			insecure: input.insecure,
			public_key_pem: input.publicKeyPem,
		});
}

export function createInstanceClient(request: RequestFn): InstanceClient {
	async function status(): Promise<InstanceStatus> {
		return request("GET", "/public/status");
	}
	async function diagnose(): Promise<InstanceDiagnosis> {
		return diagnoseInstanceStatus(await status());
	}
	return { status, diagnose };
}
