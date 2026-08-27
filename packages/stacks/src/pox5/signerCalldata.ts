import { deserializeCVBytes } from "../clarity/deserialize.ts";
import { serializeCVBytes } from "../clarity/serialize.ts";
import { Cl } from "../clarity/values.ts";
import { type IntegerType, hexToBytes } from "../utils/encoding.ts";
import {
	type BtcAddressRepr,
	canonicalizeBtcAddress,
	parseBtcAddress,
} from "./btcAddress.ts";

export function buildSignerCalldata(opts: {
	poxAddress: string | BtcAddressRepr;
	maxFeeSats: IntegerType;
}): Uint8Array {
	const repr = canonicalizeBtcAddress(
		typeof opts.poxAddress === "string"
			? parseBtcAddress(opts.poxAddress)
			: opts.poxAddress,
	);
	return serializeCVBytes(
		Cl.tuple({
			"pox-addr": Cl.tuple({
				version: Cl.buffer(Uint8Array.of(repr.version)),
				hashbytes: Cl.buffer(repr.hashbytes),
			}),
			"max-fee": Cl.uint(opts.maxFeeSats),
		}),
	);
}

export function parseSignerCalldata(calldata: Uint8Array | string): {
	poxAddress: BtcAddressRepr;
	maxFeeSats: bigint;
} {
	const cv = deserializeCVBytes(calldata);
	if (cv.type !== "tuple") {
		throw new Error("signer calldata is not a Clarity tuple");
	}
	const poxAddr = cv.value["pox-addr"];
	const maxFee = cv.value["max-fee"];
	if (!poxAddr || poxAddr.type !== "tuple") {
		throw new Error("signer calldata missing pox-addr tuple");
	}
	if (!maxFee || maxFee.type !== "uint") {
		throw new Error("signer calldata missing max-fee uint");
	}
	const versionCv = poxAddr.value.version;
	const hashCv = poxAddr.value.hashbytes;
	if (!versionCv || versionCv.type !== "buffer") {
		throw new Error("signer calldata pox-addr missing version buffer");
	}
	if (!hashCv || hashCv.type !== "buffer") {
		throw new Error("signer calldata pox-addr missing hashbytes buffer");
	}
	const versionBytes = hexToBytes(versionCv.value);
	if (versionBytes.length !== 1) {
		throw new Error(
			`signer calldata version must be buff 1, got ${versionBytes.length}`,
		);
	}
	const version = versionBytes[0];
	if (version === undefined) {
		throw new Error("signer calldata version buffer is empty");
	}
	return {
		poxAddress: canonicalizeBtcAddress({
			version,
			hashbytes: hexToBytes(hashCv.value),
		}),
		maxFeeSats: maxFee.value,
	};
}
