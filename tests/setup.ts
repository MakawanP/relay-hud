import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Keep the shared vault/store singletons out of the developer's real `.data/` folder.
process.env.RELAY_HUD_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "relay-hud-test-data-"),
);
process.env.RELAY_HUD_KEYCHAIN = "off";
