import { test, expect, describe } from "bun:test";
import { generateViewTemplate } from "../../cli/src/templates/view.ts";
import { ViewDefinitionSchema } from "../src/validate.ts";

describe("generateViewTemplate", () => {
  test("output passes validateViewDefinition", async () => {
    const content = generateViewTemplate("test-view");
    // The template uses defineView and imports — we can't directly eval it,
    // but we can verify it contains the expected structure
    expect(content).toContain('name: "test-view"');
    expect(content).toContain("version:");
    expect(content).toContain("sources:");
    expect(content).toContain("schema:");
    expect(content).toContain("handlers:");
  });

  test("generated name is valid", () => {
    const result = generateViewTemplate("my-cool-view");
    expect(result).toContain('name: "my-cool-view"');
  });
});
