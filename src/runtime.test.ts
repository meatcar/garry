import { describe, expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";

describe("bun runtime", () => {
  test("rejects the Brotli block-switch fixture", () => {
    const stream = Buffer.from("200010414141fcffff07002228f00b60f7f41f000000", "hex");
    expect(() => brotliDecompressSync(stream)).toThrow(expect.objectContaining({ errno: -17 }));
  });
});
