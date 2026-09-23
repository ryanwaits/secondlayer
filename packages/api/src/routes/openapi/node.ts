import { ERROR_401, WRITE_SECURITY, json200, jsonError, pp } from "./shared.ts";

export const nodePaths = {
	"/api/node/contracts/{contract_id}/abi": {
		get: {
			tags: ["node"],
			summary: "Clarity contract ABI, proxied from the local Stacks node",
			description:
				"Fetches the contract's interface from the Stacks node this instance follows (`/v2/contracts/interface`) and returns it unchanged. Nothing is cached. Self-hosted only; needs the instance token whenever one is set.",
			security: WRITE_SECURITY,
			parameters: [
				{
					...pp(
						"contract_id",
						"Contract principal, `<address>.<name>`. A value without a `.` does not match the route and gets 404.",
					),
					schema: {
						type: "string",
						example: "SP3D23QJG4S1G6TBXSPFR0N3PMF53WXA50XTX9W0M.zeus-a",
					},
				},
			],
			responses: {
				"200": json200(
					{ $ref: "#/components/schemas/ContractAbi" },
					"The contract's ABI as the node reports it",
				),
				"401": jsonError(ERROR_401),
				"404": jsonError(
					"The node has no contract with that id, or the id has no `.`",
				),
				"502": jsonError(
					"The node could not be reached or answered with an error; `error` carries its message",
				),
			},
		},
	},
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const nodeSchemas = {
	ContractAbi: {
		type: "object",
		description:
			"A Clarity contract interface, exactly as the Stacks node's `/v2/contracts/interface` returns it.",
		properties: {
			functions: {
				type: "array",
				items: { type: "object" },
				description:
					"Every function: `name`, `access` (`public`, `read_only` or `private`), `args` and `outputs`.",
			},
			variables: {
				type: "array",
				items: { type: "object" },
				description:
					"Data vars and constants: `name`, `type`, and `access` (`variable` or `constant`).",
			},
			maps: {
				type: "array",
				items: { type: "object" },
				description: "Data maps: `name`, `key` type and `value` type.",
			},
			fungible_tokens: {
				type: "array",
				items: { type: "object" },
				description: "Fungible tokens the contract defines, by `name`.",
			},
			non_fungible_tokens: {
				type: "array",
				items: { type: "object" },
				description:
					"Non-fungible tokens the contract defines: `name` and `type`.",
			},
			epoch: {
				type: "string",
				description:
					"Stacks epoch the contract was deployed in, e.g. `Epoch2_05`.",
			},
			clarity_version: {
				type: "string",
				description: "Clarity version it was deployed with, e.g. `Clarity1`.",
			},
		},
		example: {
			functions: [
				{
					name: "check-is-owner",
					access: "private",
					args: [],
					outputs: {
						type: { response: { ok: "bool", error: "uint128" } },
					},
				},
				{
					name: "start-zeus",
					access: "public",
					args: [
						{ name: "dx", type: "uint128" },
						{ name: "min-dy", type: "uint128" },
						{ name: "offset", type: "uint128" },
					],
					outputs: {
						type: { response: { ok: "bool", error: "uint128" } },
					},
				},
			],
			variables: [
				{
					name: "ERR-NOT-AUTHORIZED",
					type: { response: { ok: "none", error: "uint128" } },
					access: "constant",
				},
				{ name: "contract-owner", type: "principal", access: "variable" },
			],
			maps: [],
			fungible_tokens: [],
			non_fungible_tokens: [],
			epoch: "Epoch2_05",
			clarity_version: "Clarity1",
		},
	},
};
