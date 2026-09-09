import {
	type InstanceDiagnosis,
	type PublicStatus,
	diagnoseInstanceStatus,
} from "@secondlayer/shared/archive/instance-diagnosis";

/** Structural `/public/status` payload. Extra fields are ignored by diagnosis. */
export type InstanceStatus = PublicStatus;

export type InstanceClient = {
	status(): Promise<InstanceStatus>;
	diagnose(): Promise<InstanceDiagnosis>;
};

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
