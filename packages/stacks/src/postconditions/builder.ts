import type { ClarityValue } from "../clarity/types.ts";
import { parseContractId, validateStacksAddress } from "../utils/address.ts";
import type { IntegerType } from "../utils/encoding.ts";
import { fromHex, parsePostConditionAmount } from "./convert.ts";
import type {
	FtPostCondition,
	FungibleComparator,
	NftPostCondition,
	NonFungibleComparator,
	PoxPostCondition,
	StakingPostCondition,
	StxPostCondition,
} from "./types.ts";

class PartialPcWithPrincipal {
	constructor(private address: string) {}

	willSendEq(amount: IntegerType) {
		return new PartialPcFtWithCode(this.address, amount, "eq");
	}
	willSendGte(amount: IntegerType) {
		return new PartialPcFtWithCode(this.address, amount, "gte");
	}
	willSendGt(amount: IntegerType) {
		return new PartialPcFtWithCode(this.address, amount, "gt");
	}
	willSendLte(amount: IntegerType) {
		return new PartialPcFtWithCode(this.address, amount, "lte");
	}
	willSendLt(amount: IntegerType) {
		return new PartialPcFtWithCode(this.address, amount, "lt");
	}
	willSendAsset() {
		return new PartialPcNftWithCode(this.address, "sent");
	}
	willNotSendAsset() {
		return new PartialPcNftWithCode(this.address, "not-sent");
	}
	willMaybeSendAsset() {
		return new PartialPcNftWithCode(this.address, "maybe-sent");
	}
	willPerformPox(): PoxPostCondition {
		return {
			type: "pox-postcondition",
			address: this.address,
			condition: "will-perform",
		};
	}
	willNotPerformPox(): PoxPostCondition {
		return {
			type: "pox-postcondition",
			address: this.address,
			condition: "will-not-perform",
		};
	}
	mayPerformPox(): PoxPostCondition {
		return {
			type: "pox-postcondition",
			address: this.address,
			condition: "may-perform",
		};
	}
}

class PartialPcFtWithCode {
	constructor(
		private address: string,
		private amount: IntegerType,
		private code: FungibleComparator,
	) {}

	ustx(): StxPostCondition {
		return {
			type: "stx-postcondition",
			address: this.address,
			condition: this.code,
			amount: parsePostConditionAmount(this.amount).toString(),
		};
	}

	ustxToLock(): StakingPostCondition {
		return {
			type: "staking-postcondition",
			address: this.address,
			condition: this.code,
			amount: parsePostConditionAmount(this.amount).toString(),
		};
	}

	ft(contractId: string, tokenName: string): FtPostCondition {
		const [address, name] = contractId.split(".");
		if (!address || !validateStacksAddress(address) || !name) {
			throw new Error(`Invalid contract id: ${contractId}`);
		}
		return {
			type: "ft-postcondition",
			address: this.address,
			condition: this.code,
			amount: parsePostConditionAmount(this.amount).toString(),
			asset: `${contractId}::${tokenName}`,
		};
	}
}

class PartialPcNftWithCode {
	constructor(
		private address: string,
		private code: NonFungibleComparator,
	) {}

	nft(
		assetOrContractId: string,
		tokenNameOrAssetId: string | ClarityValue,
		assetId?: ClarityValue,
	): NftPostCondition {
		let contractAddress: string;
		let contractName: string;
		let tokenName: string;
		let id: ClarityValue;

		if (assetId !== undefined) {
			// 3 args: contractId, tokenName, assetId
			[contractAddress, contractName] = parseContractId(assetOrContractId);
			tokenName = tokenNameOrAssetId as string;
			id = assetId;
		} else {
			// 2 args: assetString (addr.contract::token), assetId
			const [principal, tName] = assetOrContractId.split("::");
			if (!principal || !tName)
				throw new Error(`Invalid asset name: ${assetOrContractId}`);
			[contractAddress, contractName] = parseContractId(principal);
			tokenName = tName;
			id = tokenNameOrAssetId as ClarityValue;
		}

		if (!validateStacksAddress(contractAddress)) {
			throw new Error(`Invalid contract address: ${contractAddress}`);
		}

		return {
			type: "nft-postcondition",
			address: this.address,
			condition: this.code,
			asset: `${contractAddress}.${contractName}::${tokenName}`,
			assetId: id,
		};
	}
}

export const Pc = {
	principal(address: string) {
		const [addr, name] = address.split(".");
		if (
			!addr ||
			!validateStacksAddress(addr) ||
			(typeof name === "string" && !name)
		) {
			throw new Error(`Invalid principal: ${address}`);
		}
		return new PartialPcWithPrincipal(address);
	},
	origin() {
		return new PartialPcWithPrincipal("origin");
	},
	fromHex,
};
