import type { ClarityValue } from "../clarity/types.ts";

/**
 * Numeric `(err uN)` codes from pox-5. Missing numbers were never assigned
 * on-chain. Pair with {@link parsePox5Error} / {@link describePox5Error}.
 */
export const Pox5ErrorCode = {
	Unauthorized: 1,
	CannotSetupBondTooSoon: 2,
	CannotSetupBondTooLate: 3,
	BondAlreadySetup: 4,
	StakerAlreadyAdded: 5,
	BondNotFound: 7,
	InsufficientStx: 8,
	AlreadyRegistered: 9,
	TooMuchSats: 10,
	NotAllowlisted: 11,
	SignerKeyGrantUsed: 12,
	InvalidSignatureRecover: 13,
	InvalidSignaturePubkey: 14,
	SignerKeyGrantNotFound: 17,
	AlreadyStaked: 19,
	InvalidNumCycles: 20,
	SignerNotFound: 23,
	InvalidStartBurnHeight: 24,
	UnauthorizedSignerRegistration: 26,
	NotStaking: 27,
	UnstakeInPreparePhase: 28,
	InvalidBondPeriodOrdering: 29,
	DistributionAlreadyComputed: 30,
	BondNotActive: 31,
	NoClaimableRewards: 32,
	ActiveBondNotIncluded: 33,
	NotBondParticipant: 34,
	CannotAnnounceL1EarlyUnlock: 35,
	InvalidOldSignerManager: 36,
	InvalidUnstakeSbtcAmount: 37,
	CannotUnstakeSbtc: 38,
	ReadTxOutOfBounds: 39,
	InvalidBtcHeader: 40,
	InvalidMerkleProof: 41,
	InvalidLockupScript: 42,
	BondAlreadyStarted: 43,
	UpdateBondSameSigner: 44,
	InvalidLockupAmount: 45,
	DuplicateLockupOutpoint: 46,
	StakeInPreparePhase: 47,
	RolloverTooEarly: 48,
	ReentrantCall: 49,
	L1EarlyExitAlreadyAnnounced: 50,
	InsufficientReserveBalance: 51,
	InvalidUnlockHeight: 52,
	RewardsPaused: 53,
} as const;

export type Pox5ErrorCode = (typeof Pox5ErrorCode)[keyof typeof Pox5ErrorCode];

export const POX5_ERROR_NAMES: Record<Pox5ErrorCode, string> = {
	[Pox5ErrorCode.Unauthorized]: "ERR_UNAUTHORIZED",
	[Pox5ErrorCode.CannotSetupBondTooSoon]: "ERR_CANNOT_SETUP_BOND_TOO_SOON",
	[Pox5ErrorCode.CannotSetupBondTooLate]: "ERR_CANNOT_SETUP_BOND_TOO_LATE",
	[Pox5ErrorCode.BondAlreadySetup]: "ERR_BOND_ALREADY_SETUP",
	[Pox5ErrorCode.StakerAlreadyAdded]: "ERR_STAKER_ALREADY_ADDED",
	[Pox5ErrorCode.BondNotFound]: "ERR_BOND_NOT_FOUND",
	[Pox5ErrorCode.InsufficientStx]: "ERR_INSUFFICIENT_STX",
	[Pox5ErrorCode.AlreadyRegistered]: "ERR_ALREADY_REGISTERED",
	[Pox5ErrorCode.TooMuchSats]: "ERR_TOO_MUCH_SATS",
	[Pox5ErrorCode.NotAllowlisted]: "ERR_NOT_ALLOWLISTED",
	[Pox5ErrorCode.SignerKeyGrantUsed]: "ERR_SIGNER_KEY_GRANT_USED",
	[Pox5ErrorCode.InvalidSignatureRecover]: "ERR_INVALID_SIGNATURE_RECOVER",
	[Pox5ErrorCode.InvalidSignaturePubkey]: "ERR_INVALID_SIGNATURE_PUBKEY",
	[Pox5ErrorCode.SignerKeyGrantNotFound]: "ERR_SIGNER_KEY_GRANT_NOT_FOUND",
	[Pox5ErrorCode.AlreadyStaked]: "ERR_ALREADY_STAKED",
	[Pox5ErrorCode.InvalidNumCycles]: "ERR_INVALID_NUM_CYCLES",
	[Pox5ErrorCode.SignerNotFound]: "ERR_SIGNER_NOT_FOUND",
	[Pox5ErrorCode.InvalidStartBurnHeight]: "ERR_INVALID_START_BURN_HEIGHT",
	[Pox5ErrorCode.UnauthorizedSignerRegistration]:
		"ERR_UNAUTHORIZED_SIGNER_REGISTRATION",
	[Pox5ErrorCode.NotStaking]: "ERR_NOT_STAKING",
	[Pox5ErrorCode.UnstakeInPreparePhase]: "ERR_UNSTAKE_IN_PREPARE_PHASE",
	[Pox5ErrorCode.InvalidBondPeriodOrdering]: "ERR_INVALID_BOND_PERIOD_ORDERING",
	[Pox5ErrorCode.DistributionAlreadyComputed]:
		"ERR_DISTRIBUTION_ALREADY_COMPUTED",
	[Pox5ErrorCode.BondNotActive]: "ERR_BOND_NOT_ACTIVE",
	[Pox5ErrorCode.NoClaimableRewards]: "ERR_NO_CLAIMABLE_REWARDS",
	[Pox5ErrorCode.ActiveBondNotIncluded]: "ERR_ACTIVE_BOND_NOT_INCLUDED",
	[Pox5ErrorCode.NotBondParticipant]: "ERR_NOT_BOND_PARTICIPANT",
	[Pox5ErrorCode.CannotAnnounceL1EarlyUnlock]:
		"ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK",
	[Pox5ErrorCode.InvalidOldSignerManager]: "ERR_INVALID_OLD_SIGNER_MANAGER",
	[Pox5ErrorCode.InvalidUnstakeSbtcAmount]: "ERR_INVALID_UNSTAKE_SBTC_AMOUNT",
	[Pox5ErrorCode.CannotUnstakeSbtc]: "ERR_CANNOT_UNSTAKE_SBTC",
	[Pox5ErrorCode.ReadTxOutOfBounds]: "ERR_READ_TX_OUT_OF_BOUNDS",
	[Pox5ErrorCode.InvalidBtcHeader]: "ERR_INVALID_BTC_HEADER",
	[Pox5ErrorCode.InvalidMerkleProof]: "ERR_INVALID_MERKLE_PROOF",
	[Pox5ErrorCode.InvalidLockupScript]: "ERR_INVALID_LOCKUP_SCRIPT",
	[Pox5ErrorCode.BondAlreadyStarted]: "ERR_BOND_ALREADY_STARTED",
	[Pox5ErrorCode.UpdateBondSameSigner]: "ERR_UPDATE_BOND_SAME_SIGNER",
	[Pox5ErrorCode.InvalidLockupAmount]: "ERR_INVALID_LOCKUP_AMOUNT",
	[Pox5ErrorCode.DuplicateLockupOutpoint]: "ERR_DUPLICATE_LOCKUP_OUTPOINT",
	[Pox5ErrorCode.StakeInPreparePhase]: "ERR_STAKE_IN_PREPARE_PHASE",
	[Pox5ErrorCode.RolloverTooEarly]: "ERR_ROLLOVER_TOO_EARLY",
	[Pox5ErrorCode.ReentrantCall]: "ERR_REENTRANT_CALL",
	[Pox5ErrorCode.L1EarlyExitAlreadyAnnounced]:
		"ERR_L1_EARLY_EXIT_ALREADY_ANNOUNCED",
	[Pox5ErrorCode.InsufficientReserveBalance]:
		"ERR_INSUFFICIENT_RESERVE_BALANCE",
	[Pox5ErrorCode.InvalidUnlockHeight]: "ERR_INVALID_UNLOCK_HEIGHT",
	[Pox5ErrorCode.RewardsPaused]: "ERR_REWARDS_PAUSED",
};

const POX5_ERROR_DESCRIPTIONS: Record<Pox5ErrorCode, string> = {
	[Pox5ErrorCode.Unauthorized]: "Caller is not authorized.",
	[Pox5ErrorCode.CannotSetupBondTooSoon]: "Bond setup window has not opened.",
	[Pox5ErrorCode.CannotSetupBondTooLate]: "Bond setup window has closed.",
	[Pox5ErrorCode.BondAlreadySetup]: "This bond period is already set up.",
	[Pox5ErrorCode.StakerAlreadyAdded]: "Staker is already on this bond.",
	[Pox5ErrorCode.BondNotFound]: "No bond at this index.",
	[Pox5ErrorCode.InsufficientStx]: "Not enough STX for this operation.",
	[Pox5ErrorCode.AlreadyRegistered]:
		"Staker already has an overlapping position.",
	[Pox5ErrorCode.TooMuchSats]: "Sats amount exceeds the allowlist maximum.",
	[Pox5ErrorCode.NotAllowlisted]: "Principal is not on the bond allowlist.",
	[Pox5ErrorCode.SignerKeyGrantUsed]:
		"This signer-key grant was already consumed.",
	[Pox5ErrorCode.InvalidSignatureRecover]:
		"Could not recover a public key from the signature.",
	[Pox5ErrorCode.InvalidSignaturePubkey]:
		"Recovered public key does not match the signer key.",
	[Pox5ErrorCode.SignerKeyGrantNotFound]: "No grant found for this signer key.",
	[Pox5ErrorCode.AlreadyStaked]: "Principal already has an overlapping stake.",
	[Pox5ErrorCode.InvalidNumCycles]: "Cycle count is outside the allowed range.",
	[Pox5ErrorCode.SignerNotFound]: "No signer found for this principal.",
	[Pox5ErrorCode.InvalidStartBurnHeight]:
		"Start burn height must fall in the current reward cycle.",
	[Pox5ErrorCode.UnauthorizedSignerRegistration]:
		"Caller is not authorized to register this signer.",
	[Pox5ErrorCode.NotStaking]: "Principal is not currently staking.",
	[Pox5ErrorCode.UnstakeInPreparePhase]:
		"Unstaking is not allowed in the prepare phase.",
	[Pox5ErrorCode.InvalidBondPeriodOrdering]:
		"Bond periods were supplied out of order.",
	[Pox5ErrorCode.DistributionAlreadyComputed]:
		"Reward distribution already computed for this period.",
	[Pox5ErrorCode.BondNotActive]: "Bond is not currently active.",
	[Pox5ErrorCode.NoClaimableRewards]: "No claimable rewards for this caller.",
	[Pox5ErrorCode.ActiveBondNotIncluded]:
		"The currently active bond was not included in the list.",
	[Pox5ErrorCode.NotBondParticipant]: "Caller is not in a bond.",
	[Pox5ErrorCode.CannotAnnounceL1EarlyUnlock]:
		"Early-exit announce is not valid for this membership.",
	[Pox5ErrorCode.InvalidOldSignerManager]:
		"old-signer-manager does not match the staker's current signer.",
	[Pox5ErrorCode.InvalidUnstakeSbtcAmount]: "sBTC unstake amount is invalid.",
	[Pox5ErrorCode.CannotUnstakeSbtc]: "Bond participant did not stake sBTC.",
	[Pox5ErrorCode.ReadTxOutOfBounds]: "Lockup proof buffer was truncated.",
	[Pox5ErrorCode.InvalidBtcHeader]:
		"Bitcoin header in the lockup proof is invalid.",
	[Pox5ErrorCode.InvalidMerkleProof]:
		"Merkle proof in the lockup proof is invalid.",
	[Pox5ErrorCode.InvalidLockupScript]: "Lockup output script does not match.",
	[Pox5ErrorCode.BondAlreadyStarted]:
		"Cannot register after the bond has started.",
	[Pox5ErrorCode.UpdateBondSameSigner]:
		"update-bond-registration cannot keep the same signer.",
	[Pox5ErrorCode.InvalidLockupAmount]:
		"Lockup output amount does not match sats.",
	[Pox5ErrorCode.DuplicateLockupOutpoint]:
		"The same Bitcoin outpoint appeared twice in the lockup list.",
	[Pox5ErrorCode.StakeInPreparePhase]:
		"Cannot modify next-cycle stake during the prepare phase.",
	[Pox5ErrorCode.RolloverTooEarly]: "Bond rollover is too early.",
	[Pox5ErrorCode.ReentrantCall]:
		"Reentrant call into pox-5 while a trait call is in flight.",
	[Pox5ErrorCode.L1EarlyExitAlreadyAnnounced]:
		"L1 early exit already announced for this bond period.",
	[Pox5ErrorCode.InsufficientReserveBalance]:
		"Reserve withdrawal exceeds the balance.",
	[Pox5ErrorCode.InvalidUnlockHeight]:
		"Unlock height is below the bond minimum or at/above 500,000,000.",
	[Pox5ErrorCode.RewardsPaused]: "Signer reward claims are paused.",
};

/** Extract `(err uN)` from a Clarity value or Hiro `repr` string. */
export function parsePox5Error(
	result: ClarityValue | string | undefined,
): number | undefined {
	if (result == null) return undefined;
	if (typeof result === "string") {
		const match = result.trim().match(/^\(err u(\d+)\)$/);
		return match ? Number(match[1]) : undefined;
	}
	if (result.type !== "err") return undefined;
	return result.value.type === "uint" ? Number(result.value.value) : undefined;
}

export function describePox5Error(
	code: number | bigint,
): { code: number; name: string; description: string } | undefined {
	const n = Number(code) as Pox5ErrorCode;
	const name = POX5_ERROR_NAMES[n];
	if (!name) return undefined;
	return { code: n, name, description: POX5_ERROR_DESCRIPTIONS[n] };
}
