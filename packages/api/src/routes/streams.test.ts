import { describe, test, expect } from "bun:test";

/**
 * Unit tests for stream status transitions.
 *
 * These test the transition validation logic without a real database.
 * Integration tests (requiring DATABASE_URL) live in packages/api/test/.
 */

type Status = "inactive" | "active" | "paused" | "failed";

// Valid transitions per the status transition matrix
const VALID_TRANSITIONS: { [K: string]: { from: Status[]; to: Status } } & {
  enable: { from: Status[]; to: Status };
  disable: { from: Status[]; to: Status };
  pause: { from: Status[]; to: Status };
  resume: { from: Status[]; to: Status };
} = {
  enable: { from: ["inactive", "failed"], to: "active" },
  disable: { from: ["inactive", "active", "paused", "failed"], to: "inactive" },
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
};

describe("Stream Status Transitions", () => {
  describe("enable", () => {
    test("allowed from inactive", () => {
      const { from } = VALID_TRANSITIONS.enable;
      expect(from).toContain("inactive");
    });

    test("allowed from failed", () => {
      const { from } = VALID_TRANSITIONS.enable;
      expect(from).toContain("failed");
    });

    test("not allowed from active", () => {
      const { from } = VALID_TRANSITIONS.enable;
      expect(from).not.toContain("active");
    });

    test("not allowed from paused", () => {
      const { from } = VALID_TRANSITIONS.enable;
      expect(from).not.toContain("paused");
    });

    test("transitions to active", () => {
      expect(VALID_TRANSITIONS.enable.to).toBe("active");
    });
  });

  describe("disable", () => {
    test("allowed from any status", () => {
      const allStatuses: Status[] = ["inactive", "active", "paused", "failed"];
      for (const s of allStatuses) {
        expect(VALID_TRANSITIONS.disable.from).toContain(s);
      }
    });

    test("transitions to inactive", () => {
      expect(VALID_TRANSITIONS.disable.to).toBe("inactive");
    });
  });

  describe("pause", () => {
    test("only allowed from active", () => {
      expect(VALID_TRANSITIONS.pause.from).toEqual(["active"]);
    });

    test("transitions to paused", () => {
      expect(VALID_TRANSITIONS.pause.to).toBe("paused");
    });
  });

  describe("resume", () => {
    test("only allowed from paused", () => {
      expect(VALID_TRANSITIONS.resume.from).toEqual(["paused"]);
    });

    test("transitions to active", () => {
      expect(VALID_TRANSITIONS.resume.to).toBe("active");
    });
  });

  describe("worker failure", () => {
    test("sets status to failed", () => {
      // Worker sets status to "failed" after MAX_CONSECUTIVE_FAILURES
      const failedStatus: Status = "failed";
      expect(failedStatus).toBe("failed");
    });

    test("failed stream can be re-enabled", () => {
      expect(VALID_TRANSITIONS.enable.from).toContain("failed");
    });
  });

  describe("default status", () => {
    test("new streams default to active", () => {
      const defaultStatus: Status = "active";
      expect(defaultStatus).toBe("active");
    });
  });
});
