/**
 * Shared types for pi-windows-shell extension
 */

export interface ManagedProcess {
  id: string;
  name: string;
  pid: number;
  command: string;
  cwd: string;
  shell: "pwsh" | "powershell.exe";
  outputFile: string;
  startedAt: string;
  status: "running" | "exited" | "unknown";
  lastCheckedAt?: string;
  exitCode?: number | null;
}

export interface ProcessRegistry {
  version: string;
  processes: ManagedProcess[];
}

export interface PowerShellResult {
  shell: "pwsh" | "powershell.exe";
  cwd: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface PowerShellDiscovery {
  exe: string;
  kind: "pwsh" | "powershell.exe";
}

export interface TailResult {
  lines: string[];
  truncated: boolean;
  totalLines: number;
  linesRead: number;
  fileExists: boolean;
}

export interface CleanupResult {
  removedEntries: number;
  deletedLogs: number;
  keptRunning: number;
}