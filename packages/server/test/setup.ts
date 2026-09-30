import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test file gets an isolated data dir so importing config/db never touches ./data.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dmark-hole-test-"));
process.env.LOG_LEVEL = "silent";
