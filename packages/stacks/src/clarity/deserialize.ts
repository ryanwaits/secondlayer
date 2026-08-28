import { SerializationError } from "../errors/transaction.ts";
import { BytesReader } from "../utils/bytes-reader.ts";
import { c32address } from "../utils/c32.ts";
import {
	bytesToAscii,
	bytesToHex,
	bytesToTwosBigInt,
	bytesToUtf8,
	hexToBytes,
	without0x,
} from "../utils/encoding.ts";
import { type ClarityValue, clarityTypeFromByte } from "./types.ts";
import {
	bufferCV,
	contractPrincipalCV,
	falseCV,
	intCV,
	listCV,
	noneCV,
	responseErrorCV,
	responseOkCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	stringUtf8CV,
	trueCV,
	tupleCV,
	uintCV,
} from "./values.ts";

export function readAddress(reader: BytesReader): string {
	const version = reader.readUInt8();
	const hash160 = bytesToHex(reader.readBytes(20));
	return c32address(version, hash160);
}

export function readLPString(reader: BytesReader, prefixBytes = 1): string {
	let length = 0;
	for (let i = 0; i < prefixBytes; i++) {
		length = (length << 8) | reader.readUInt8();
	}
	return bytesToUtf8(reader.readBytes(length));
}

/** Deepest nesting the deserializer follows before refusing the input. Clarity
 *  itself caps value nesting far below this, so honest data never hits it;
 *  hostile bytes that repeat `some`/`ok`/`list` would otherwise blow the stack. */
export const MAX_CV_DEPTH = 64;

/** Every list item and tuple entry costs at least this many bytes on the wire
 *  (a type byte, plus a name-length byte for tuple entries), so a declared
 *  count that outruns the remaining bytes is corrupt before any allocation. */
const MIN_LIST_ITEM_BYTES = 1;
const MIN_TUPLE_ENTRY_BYTES = 2;

function checkCount(reader: BytesReader, count: number, minBytes: number) {
	if (count * minBytes > reader.remaining()) {
		throw new SerializationError(
			`Clarity value declares ${count} elements but only ${reader.remaining()} bytes remain`,
		);
	}
}

export function readCV(reader: BytesReader, depth = 0): ClarityValue {
	if (depth > MAX_CV_DEPTH) {
		throw new SerializationError(
			`Clarity value nests deeper than ${MAX_CV_DEPTH} levels`,
		);
	}
	const typeByte = reader.readUInt8();
	const type = clarityTypeFromByte(typeByte);

	switch (type) {
		case "int":
			return intCV(bytesToTwosBigInt(reader.readBytes(16)));

		case "uint":
			return uintCV(reader.readBytes(16));

		case "true":
			return trueCV();

		case "false":
			return falseCV();

		case "buffer": {
			const len = reader.readUInt32BE();
			return bufferCV(reader.readBytes(len));
		}

		case "none":
			return noneCV();

		case "some":
			return someCV(readCV(reader, depth + 1));

		case "ok":
			return responseOkCV(readCV(reader, depth + 1));

		case "err":
			return responseErrorCV(readCV(reader, depth + 1));

		case "address":
			return standardPrincipalCV(readAddress(reader));

		case "contract": {
			const addr = readAddress(reader);
			const name = readLPString(reader);
			return contractPrincipalCV(addr, name);
		}

		case "list": {
			const len = reader.readUInt32BE();
			checkCount(reader, len, MIN_LIST_ITEM_BYTES);
			const items: ClarityValue[] = [];
			for (let i = 0; i < len; i++) {
				items.push(readCV(reader, depth + 1));
			}
			return listCV(items);
		}

		case "tuple": {
			const len = reader.readUInt32BE();
			checkCount(reader, len, MIN_TUPLE_ENTRY_BYTES);
			const data: Record<string, ClarityValue> = {};
			for (let i = 0; i < len; i++) {
				const key = readLPString(reader);
				data[key] = readCV(reader, depth + 1);
			}
			return tupleCV(data);
		}

		case "ascii": {
			const len = reader.readUInt32BE();
			return stringAsciiCV(bytesToAscii(reader.readBytes(len)));
		}

		case "utf8": {
			const len = reader.readUInt32BE();
			return stringUtf8CV(bytesToUtf8(reader.readBytes(len)));
		}

		default:
			throw new SerializationError(
				`Cannot deserialize unknown clarity type: ${type}`,
			);
	}
}

export function deserializeCVBytes<T extends ClarityValue = ClarityValue>(
	input: Uint8Array | string,
): T {
	const bytes =
		typeof input === "string" ? hexToBytes(without0x(input)) : input;
	return readCV(new BytesReader(bytes)) as T;
}

export function deserializeCV<T extends ClarityValue = ClarityValue>(
	input: Uint8Array | string,
): T {
	return deserializeCVBytes(input);
}
