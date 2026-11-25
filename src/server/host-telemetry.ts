import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { HostTelemetry, LocalProcessInfo } from "@/domain/types";

const execFileAsync = promisify(execFile);

interface CpuTotals {
  idle: number;
  total: number;
}

let prevCpuTotals: CpuTotals | null = null;
let cachedChipModel: string | null = null;
let cachedCliStatus: {
  claude: boolean;
  gemini: boolean;
  checkedAt: number;
} | null = null;

function readCpuTotals(): CpuTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function measureCpuUsagePct(): number {
  const current = readCpuTotals();
  if (!prevCpuTotals) {
    prevCpuTotals = current;
    const load1 = os.loadavg()[0] ?? 0;
    const cores = Math.max(1, os.cpus().length);
    return Math.min(100, Math.max(1, Math.round((load1 / cores) * 100)));
  }
  const idleDelta = current.idle - prevCpuTotals.idle;
  const totalDelta = current.total - prevCpuTotals.total;
  prevCpuTotals = current;
  if (totalDelta <= 0) {
    return 2;
  }
  const busy = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.min(100, Math.max(1, Math.round(busy)));
}

async function detectChipModel(): Promise<string> {
  if (cachedChipModel) return cachedChipModel;
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "sysctl",
        ["-n", "machdep.cpu.brand_string"],
        { timeout: 1500 },
      );
      const brand = stdout.trim();
      if (brand) {
        cachedChipModel = brand;
        return brand;
      }
    } catch {
      // Fallback to os.cpus() model below if sysctl is unavailable.
    }
  }
  const firstCpu = os.cpus()[0];
  cachedChipModel = firstCpu?.model?.trim() || `${os.arch()} Host`;
  return cachedChipModel;
}

async function measureMacMemoryGb(totalGb: number): Promise<number> {
  if (process.platform !== "darwin") {
    const used = (os.totalmem() - os.freemem()) / 1024 ** 3;
    return Number(used.toFixed(1));
  }
  try {
    const { stdout } = await execFileAsync("vm_stat", [], { timeout: 1500 });
    const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch?.[1] ? Number(pageSizeMatch[1]) : 16384;
    const parsePages = (label: string): number => {
      const match = stdout.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
      return match?.[1] ? Number(match[1]) : 0;
    };
    const active = parsePages("Pages active");
    const wired = parsePages("Pages wired down");
    const compressed = parsePages("Pages occupied by compressor");
    const usedBytes = (active + wired + compressed) * pageSize;
    const usedGb = usedBytes / 1024 ** 3;
    if (usedGb > 0 && usedGb <= totalGb) {
      return Number(usedGb.toFixed(1));
    }
  } catch {
    // Fallback to os.totalmem() - os.freemem() when vm_stat fails.
  }
  const used = (os.totalmem() - os.freemem()) / 1024 ** 3;
  return Number(Math.max(0.5, used).toFixed(1));
}

async function checkBinaryExists(binary: string): Promise<boolean> {
  try {
    await execFileAsync("which", [binary], { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectLocalCliTools(force = false): Promise<{
  claude: boolean;
  gemini: boolean;
}> {
  const now = Date.now();
  if (!force && cachedCliStatus && now - cachedCliStatus.checkedAt < 60_000) {
    return { claude: cachedCliStatus.claude, gemini: cachedCliStatus.gemini };
  }
  const [claude, gemini] = await Promise.all([
    checkBinaryExists("claude"),
    checkBinaryExists("gemini"),
  ]);
  cachedCliStatus = { claude, gemini, checkedAt: now };
  return { claude, gemini };
}

const TRACKED_PROCESS_CATEGORIES: Record<
  string,
  { label: string; category: LocalProcessInfo["category"] }
> = {
  claude: { label: "Claude Code CLI", category: "agent" },
  gemini: { label: "Gemini CLI", category: "agent" },
  ollama: { label: "Ollama Model Server", category: "agent" },
  "next-server": { label: "Next.js Server", category: "runtime" },
  node: { label: "Node.js Runtime", category: "runtime" },
  python3: { label: "Python Worker", category: "runtime" },
  xcodebuild: { label: "Xcode Build", category: "build" },
  swift: { label: "Swift Compiler", category: "build" },
  "swift-frontend": { label: "Swift Frontend", category: "build" },
  cargo: { label: "Cargo Build", category: "build" },
};

async function collectLiveLocalProcesses(): Promise<LocalProcessInfo[]> {
  try {
    // Only inspect process binary name + resource metrics (never full CLI arguments) so secrets never leak.
    const { stdout } = await execFileAsync(
      "ps",
      ["-axo", "pid=,pcpu=,rss=,etime=,comm="],
      { timeout: 1500 },
    );

    const results: LocalProcessInfo[] = [];
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = line.match(
        /^(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/,
      );
      if (!match) continue;

      const pid = Number(match[1]);
      const cpuPct = Number(match[2]);
      const rssKb = Number(match[3]);
      const elapsed = match[4] ?? "0s";
      const commPath = match[5]?.trim() ?? "";
      // Strip macOS process title suffixes such as `next-server (v15.5.29)`.
      const executableToken = commPath.split(/\s+/)[0] ?? "";
      const base = path.basename(executableToken).toLowerCase();

      const spec = TRACKED_PROCESS_CATEGORIES[base];
      if (!spec) continue;

      const memoryMb = Math.max(1, Math.round(rssKb / 1024));
      const isSelf = pid === process.pid;
      results.push({
        pid,
        name: base,
        label: isSelf ? "RelayHUD Server (:3456)" : spec.label,
        cpuPct: Number(cpuPct.toFixed(1)),
        memoryMb,
        elapsed,
        category: spec.category,
      });
    }

    results.sort((a, b) => {
      if (a.pid === process.pid) return -1;
      if (b.pid === process.pid) return 1;
      if (a.category === "agent" && b.category !== "agent") return -1;
      if (b.category === "agent" && a.category !== "agent") return 1;
      return b.memoryMb - a.memoryMb;
    });

    return results.slice(0, 6);
  } catch {
    return [];
  }
}

export async function collectHostTelemetry(
  activeStreamCount: number,
): Promise<HostTelemetry> {
  const totalGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const [chipModel, memoryUsedGb, cliTools, localProcesses] = await Promise.all(
    [
      detectChipModel(),
      measureMacMemoryGb(totalGb),
      detectLocalCliTools(),
      collectLiveLocalProcesses(),
    ],
  );

  const cpuUsagePct = measureCpuUsagePct();
  const memRatio = totalGb > 0 ? memoryUsedGb / totalGb : 0;
  const memoryPressure: HostTelemetry["memoryPressure"] =
    memRatio >= 0.88 ? "critical" : memRatio >= 0.72 ? "warning" : "normal";

  const load = os.loadavg();
  const loadTuple: [number, number, number] = [
    Number((load[0] ?? 0).toFixed(2)),
    Number((load[1] ?? 0).toFixed(2)),
    Number((load[2] ?? 0).toFixed(2)),
  ];

  const gpuEstimatePct = Math.min(
    95,
    Math.max(1, Math.round(cpuUsagePct * 0.35 + activeStreamCount * 4)),
  );

  return {
    hostname: os.hostname().replace(/\.local$/, ""),
    chipModel,
    platform: `${process.platform}/${os.arch()}`,
    cpuUsagePct,
    gpuEstimatePct,
    memoryUsedGb,
    memoryTotalGb: totalGb,
    memoryPressure,
    loadAvg: loadTuple,
    uptimeSec: Math.round(os.uptime()),
    activeLocalProcesses: localProcesses.length,
    localProcesses,
    cliTools,
    capturedAt: new Date().toISOString(),
  };
}
