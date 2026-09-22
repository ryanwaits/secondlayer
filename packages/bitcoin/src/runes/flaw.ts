// Ported from ord 0.29.0 `crates/ordinals/src/flaw.rs`.

export enum Flaw {
	EdictOutput = "edict-output",
	EdictRuneId = "edict-rune-id",
	InvalidScript = "invalid-script",
	Opcode = "opcode",
	SupplyOverflow = "supply-overflow",
	TrailingIntegers = "trailing-integers",
	TruncatedField = "truncated-field",
	UnrecognizedEvenTag = "unrecognized-even-tag",
	UnrecognizedFlag = "unrecognized-flag",
	Varint = "varint",
}

/** Matches ord's `Display for Flaw` (used in logs / diagnostics, not decoding logic). */
export function flawDisplay(flaw: Flaw): string {
	switch (flaw) {
		case Flaw.EdictOutput:
			return "edict output greater than transaction output count";
		case Flaw.EdictRuneId:
			return "invalid rune ID in edict";
		case Flaw.InvalidScript:
			return "invalid script in OP_RETURN";
		case Flaw.Opcode:
			return "non-pushdata opcode in OP_RETURN";
		case Flaw.SupplyOverflow:
			return "supply overflows u128";
		case Flaw.TrailingIntegers:
			return "trailing integers in body";
		case Flaw.TruncatedField:
			return "field with missing value";
		case Flaw.UnrecognizedEvenTag:
			return "unrecognized even tag";
		case Flaw.UnrecognizedFlag:
			return "unrecognized field";
		case Flaw.Varint:
			return "invalid varint";
	}
}
