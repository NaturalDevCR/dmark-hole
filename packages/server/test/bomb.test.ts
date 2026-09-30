import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractDocuments } from "../src/dmarc/extract.js";

describe("decompression limits", () => {
  it("rejects a gzip bomb without inflating it", async () => {
    // ~200 MB of zeros compresses to ~200 KB.
    const bomb = gzipSync(Buffer.alloc(200 * 1024 * 1024));
    const before = process.memoryUsage().arrayBuffers;
    const r = await extractDocuments(bomb, "bomb.xml.gz");
    expect(r.documents).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/cannot decompress/);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(150 * 1024 * 1024);
  });
});
