import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Built-in Claude Code tools denied for dispatched prompts. RelayHUD only needs plain
 * text completions; tool access would let a prompt read files on this Mac.
 */
export const CLAUDE_CLI_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "SlashCommand",
  "Skill",
];

export interface CliSandbox {
  cwd: string;
  cleanup: () => void;
}

/**
 * Creates an empty, private working directory for one CLI job. Running the CLIs from the
 * RelayHUD folder would put `.data/` (vault + master key) inside their workspace.
 */
export function createCliSandbox(): CliSandbox {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "relay-hud-cli-"));
  fs.chmodSync(cwd, 0o700);
  return {
    cwd,
    cleanup: () => {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          `[relay-hud] Could not remove CLI sandbox ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

/** Strips RelayHUD / OAuth secrets from the environment handed to child CLIs. */
export function buildSanitizedCliEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(safe)) {
    if (key.startsWith("RELAY_HUD_") || key.startsWith("GOOGLE_OAUTH_")) {
      delete safe[key];
    }
  }
  return safe;
}
