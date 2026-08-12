import { describe, expect, it } from "vitest";

import {
  AUTOMATION_DEFAULTS,
  DEMO_DATA_LABEL,
  NOT_CONNECTED_LABEL,
} from "@/lib/constants";

describe("safe application defaults", () => {
  it("defaults all potentially destructive automation capabilities to off", () => {
    expect(AUTOMATION_DEFAULTS).toEqual({
      autonomousMode: false,
      maximumAutonomousRisk: "GREEN",
      autoApprove: false,
      autoMerge: false,
      autoDeploy: false,
      autoRollback: false,
    });
  });

  it("provides unambiguous disconnected and demo labels", () => {
    expect(DEMO_DATA_LABEL).toBe("Demo Data");
    expect(NOT_CONNECTED_LABEL).toBe("Not Connected");
  });
});
