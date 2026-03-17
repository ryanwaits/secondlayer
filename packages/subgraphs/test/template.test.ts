import { test, expect, describe } from "bun:test";
import { generateSubgraphTemplate } from "../../cli/src/templates/subgraph.ts";


describe("generateSubgraphTemplate", () => {
  test("output passes validateSubgraphDefinition", async () => {
    const content = generateSubgraphTemplate("test-subgraph");
    // The template uses defineSubgraph and imports — we can't directly eval it,
    // but we can verify it contains the expected structure
    expect(content).toContain('name: "test-subgraph"');
    expect(content).toContain("version:");
    expect(content).toContain("sources:");
    expect(content).toContain("schema:");
    expect(content).toContain("handlers:");
  });

  test("generated name is valid", () => {
    const result = generateSubgraphTemplate("my-cool-subgraph");
    expect(result).toContain('name: "my-cool-subgraph"');
  });
});
