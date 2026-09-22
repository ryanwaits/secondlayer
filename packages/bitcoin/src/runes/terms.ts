// Ported from ord 0.29.0 `crates/ordinals/src/terms.rs`.

export interface Terms {
	amount?: bigint;
	cap?: bigint;
	height: [bigint | undefined, bigint | undefined];
	offset: [bigint | undefined, bigint | undefined];
}

export function defaultTerms(): Terms {
	return {
		amount: undefined,
		cap: undefined,
		height: [undefined, undefined],
		offset: [undefined, undefined],
	};
}
