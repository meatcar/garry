import { describe, expect, test } from "bun:test";

import { telemetryEnv } from "./commands.ts";

describe("telemetryEnv", () => {
  test("no-op when unset or explicitly zero", () => {
    expect(telemetryEnv(undefined)).toEqual({});
    expect(telemetryEnv("")).toEqual({});
    expect(telemetryEnv("0")).toEqual({});
  });

  test("any other value opts the whole stack out", () => {
    for (const value of ["1", "true", "yes"]) {
      expect(telemetryEnv(value)).toEqual({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        GSTACK_TELEMETRY_OFF: "1",
      });
    }
  });
});
