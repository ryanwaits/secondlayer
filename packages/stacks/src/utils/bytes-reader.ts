import { SerializationError } from "../errors/transaction.ts";
import { bytesToHex } from "./encoding.ts";

export class BytesReader {
	private data: Uint8Array;
	public offset = 0;

	constructor(data: Uint8Array) {
		this.data = data;
	}

	/** Bytes left after the cursor. */
	remaining(): number {
		return this.data.length - this.offset;
	}

	private ensure(length: number): void {
		if (this.offset + length > this.data.length) {
			throw new SerializationError(
				`Buffer underflow: need ${length} bytes at offset ${this.offset}, have ${this.data.length}`,
			);
		}
	}

	readUInt8(): number {
		this.ensure(1);
		// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
		return this.data[this.offset++]!;
	}

	readUInt16BE(): number {
		this.ensure(2);
		const val =
			// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
			((this.data[this.offset]! << 8) | this.data[this.offset + 1]!) >>> 0;
		this.offset += 2;
		return val;
	}

	readUInt32BE(): number {
		this.ensure(4);
		const val =
			// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
			((this.data[this.offset]! << 24) |
				// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
				(this.data[this.offset + 1]! << 16) |
				// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
				(this.data[this.offset + 2]! << 8) |
				// biome-ignore lint/style/noNonNullAssertion: bounds checked by ensure()
				this.data[this.offset + 3]!) >>>
			0;
		this.offset += 4;
		return val;
	}

	readBytes(length: number): Uint8Array {
		this.ensure(length);
		const slice = this.data.slice(this.offset, this.offset + length);
		this.offset += length;
		return slice;
	}

	readBigUInt64BE(): bigint {
		const hex = bytesToHex(this.readBytes(8));
		return hex.length > 0 ? BigInt(`0x${hex}`) : 0n;
	}
}
