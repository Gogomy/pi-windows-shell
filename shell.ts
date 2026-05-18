/**
 * PowerShell discovery and foreground execution
 */

import { spawn } from "node:child_process";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PowerShellResult, PowerShellDiscovery } from "./types.js";
import { truncateOutput } from "./output.js";

let cachedDiscovery: PowerShellDiscovery | null = null;

/**
 * Discover available PowerShell installation.
 * Prefer pwsh (PowerShell 7+), fallback to powershell.exe (Windows PowerShell).
 */
export async function findPowerShell(): Promise<PowerShellDiscovery> {
  if (cachedDiscovery) {
    return cachedDiscovery;
  }

  // Try pwsh first (PowerShell 7+)
  try {
    const result = await spawnPowerShell("pwsh", "Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source", 5000);
    if (result.exitCode === 0 && result.stdout.trim()) {
      cachedDiscovery = { exe: "pwsh", kind: "pwsh" };
      return cachedDiscovery;
    }
  } catch {
    // pwsh not available
  }

  // Fallback to Windows PowerShell
  try {
    const result = await spawnPowerShell("powershell.exe", "Get-Command powershell.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source", 5000);
    if (result.exitCode === 0 && result.stdout.trim()) {
      cachedDiscovery = { exe: "powershell.exe", kind: "powershell.exe" };
      return cachedDiscovery;
    }
  } catch {
    // powershell.exe not available
  }

  // Last resort: assume powershell.exe is available
  cachedDiscovery = { exe: "powershell.exe", kind: "powershell.exe" };
  return cachedDiscovery;
}

/**
 * Clear the PowerShell discovery cache.
 */
export function clearDiscoveryCache(): void {
  cachedDiscovery = null;
}

/**
 * Spawn a PowerShell command and capture output.
 */
function spawnPowerShell(
  shellExe: string,
  command: string,
  timeoutMs: number
): Promise<PowerShellResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        shell: shellExe.includes("pwsh") ? "pwsh" : "powershell.exe",
        cwd: "",
        command,
        exitCode: -1,
        stdout: "",
        stderr: "Command timed out",
        timedOut: true,
        truncated: false,
      });
    }, timeoutMs);

    const proc = spawn(shellExe, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      command,
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        shell: shellExe.includes("pwsh") ? "pwsh" : "powershell.exe",
        cwd: "",
        command,
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut: false,
        truncated: false,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        shell: shellExe.includes("pwsh") ? "pwsh" : "powershell.exe",
        cwd: "",
        command,
        exitCode: -1,
        stdout: "",
        stderr: error.message,
        timedOut: false,
        truncated: false,
      });
    });
  });
}

/**
 * Execute a PowerShell command in foreground with full options.
 */
export async function executePowerShell(options: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxLines?: number;
}): Promise<PowerShellResult> {
  const discovery = await findPowerShell();
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs ?? 120000;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        shell: discovery.kind,
        cwd,
        command: options.command,
        exitCode: -1,
        stdout: "",
        stderr: "Command timed out",
        timedOut: true,
        truncated: false,
      });
    }, timeoutMs);

    const proc = spawn(discovery.exe, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      options.command,
    ], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      
      // Truncate output if needed
      const maxBytes = options.maxOutputBytes ?? 50000;
      const maxLines = options.maxLines ?? 2000;
      
      const truncatedStdout = truncateOutput(stdout, { maxBytes, maxLines });
      const truncatedStderr = truncateOutput(stderr, { maxBytes: 10000, maxLines: 200 });

      resolve({
        shell: discovery.kind,
        cwd,
        command: options.command,
        exitCode: code ?? -1,
        stdout: truncatedStdout.text,
        stderr: truncatedStderr.text,
        timedOut: false,
        truncated: truncatedStdout.truncated,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        shell: discovery.kind,
        cwd,
        command: options.command,
        exitCode: -1,
        stdout: "",
        stderr: error.message,
        timedOut: false,
        truncated: false,
      });
    });
  });
}

/**
 * Start a detached PowerShell process and write output to a file.
 * Uses fs.openSync for a numeric file descriptor passed directly to spawn stdio —
 * the OS handles the I/O natively, avoiding Node.js stream/pipeline quirks on Windows.
 */
export async function startDetachedProcess(options: {
  command: string;
  cwd?: string;
  outputFile: string;
  append?: boolean;
}): Promise<{ pid: number; shell: "pwsh" | "powershell.exe" }> {
  const discovery = await findPowerShell();
  const cwd = options.cwd || process.cwd();
  const flags = options.append !== false ? "a" : "w";

  // Ensure parent directory exists for the output file
  mkdirSync(dirname(options.outputFile), { recursive: true });

  return new Promise((resolve, reject) => {
    let fdOut: number;
    let fdErr: number;
    try {
      fdOut = openSync(options.outputFile, flags);
      fdErr = openSync(options.outputFile, flags);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      reject(new Error(`Failed to open output file: ${msg}`));
      return;
    }

    const proc = spawn(discovery.exe, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      options.command,
    ], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", fdOut, fdErr],
    });

    proc.on("error", (error: Error) => {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
      reject(new Error(`Failed to spawn ${discovery.exe}: ${error.message}`));
    });

    proc.on("close", () => {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
    });

    if (!proc.pid) {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
      reject(new Error(`Failed to spawn ${discovery.exe}: no PID returned`));
      return;
    }

    proc.unref();
    resolve({ pid: proc.pid, shell: discovery.kind });
  });
}

/**
 * Get version info about the discovered PowerShell.
 */
export async function getPowerShellVersion(): Promise<string | null> {
  try {
    const result = await spawnPowerShell(
      (await findPowerShell()).exe,
      "$PSVersionTable.PSVersion.ToString()",
      10000
    );
    
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}