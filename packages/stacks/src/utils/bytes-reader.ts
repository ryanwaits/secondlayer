import { bytesToHex } from "./encoding.ts";

export class BytesReader {
	private data: Uint8Array;
	public offset = 0;

	constructor(data: Uint8Array) {
		this.data = data;
	}

	readUInt8(): number {
		return this.data[this.offset++]!;
	}

	readUInt16BE(): number {
		const val =
			((this.data[this.offset]! << 8) | this.data[this.offset + 1]!) >>> 0;
		this.offset += 2;
		return val;
	}

	readUInt32BE(): number {
		const val =
			((this.data[this.offset]! << 24) |
				(this.data[this.offset + 1]! << 16) |
				(this.data[this.offset + 2]! << 8) |
				this.data[this.offset + 3]!) >>>
			0;
		this.offset += 4;
		return val;
	}

	readBytes(length: number): Uint8Array {
		if (this.offset + length > this.data.length) {
			throw new Error(
				`Buffer underflow: need ${length} bytes at offset ${this.offset}, have ${this.data.length}`,
			);
		}
		const slice = this.data.slice(this.offset, this.offset + length);
		this.offset += length;
		return slice;
	}

	readBigUInt64BE(): bigint {
		const hex = bytesToHex(this.readBytes(8));
		return hex.length > 0 ? BigInt(`0x${hex}`) : 0n;
	}
}
