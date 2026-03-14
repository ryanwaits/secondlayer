/** Minimal map type matching ABI shape */
interface AbiMap {
  name: string;
}

/** Minimal function type matching ABI shape */
interface AbiFunction {
  name: string;
}

/**
 * Generates a copy-pasteable agent prompt for creating a Secondlayer view.
 */
export function generateAgentPrompt(
  contractId: string,
  selectedEvents: readonly AbiMap[],
  selectedFunctions: readonly AbiFunction[],
): string {
  const contractParts = contractId.split(".");
  const contractName = contractParts[contractParts.length - 1] ?? contractId;

  const lines: string[] = [
    `Create a Secondlayer view for contract ${contractId}.`,
    "",
  ];

  if (selectedEvents.length > 0) {
    lines.push(`Index these events: ${selectedEvents.map((e) => e.name).join(", ")}`);
  }

  if (selectedFunctions.length > 0) {
    lines.push(`Index these functions: ${selectedFunctions.map((f) => f.name).join(", ")}`);
  }

  lines.push("");
  lines.push(
    `Use \`sl views scaffold ${contractId} -o views/${contractName}.ts\``,
    "to generate the base scaffold, then customize the handlers.",
  );

  return lines.join("\n");
}
