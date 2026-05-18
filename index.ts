/**
 * pi-windows-shell — Windows PowerShell and process-management extension for Pi.
 *
 * Registers 9 explicit tools for PowerShell execution and Windows process management.
 * Does NOT override bash, read, write, or edit.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findPowerShell,
  executePowerShell,
  getPowerShellVersion,
  clearDiscoveryCache,
  startDetachedProcess,
} from "./shell.js";
import {
  loadRegistry,
  addProcess,
  updateProcess,
  getProcess,
  getAllProcesses,
  cleanupRegistry,
} from "./process-registry.js";
import { tailFile } from "./output.js";
import {
  getBaseDir,
  getLogsDir,
  getDefaultOutputFile,
  ensureDir,
  generateProcessId,
  getRegistryPath,
} from "./paths.js";
import type { ManagedProcess } from "./types.js";

// Load the Windows shell policy at extension init time
const __dirname = dirname(fileURLToPath(import.meta.url));
const policyPath = resolve(__dirname, "prompts", "windows-shell-policy.md");
let windowsShellPolicy = "";
try {
  windowsShellPolicy = readFileSync(policyPath, "utf-8");
} catch {
  // Policy file not found — extension still works, just without the policy injection
}

export default function (pi: ExtensionAPI) {
  // ── Status bar ──────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    try {
      const discovery = await findPowerShell();
      const version = await getPowerShellVersion();
      const label = version
        ? `WinShell: ${discovery.kind} ${version}`
        : `WinShell: ${discovery.kind}`;
      ctx.ui.setStatus("win-shell", label);
    } catch {
      ctx.ui.setStatus("win-shell", "WinShell: not found");
    }
  });

  // ── System prompt injection ─────────────────────────────────
  if (windowsShellPolicy) {
    pi.on("before_agent_start", async (event) => {
      return {
        systemPrompt: event.systemPrompt + "\n\n" + windowsShellPolicy,
      };
    });
  }

  // ── Slash commands ──────────────────────────────────────────

  pi.registerCommand("win-processes", {
    description: "Show tracked Windows background processes",
    handler: async (_args, ctx) => {
      const processes = await getAllProcesses();
      if (processes.length === 0) {
        ctx.ui.notify("No tracked processes.", "info");
        return;
      }
      const lines = processes.map(
        (p) => `[${p.status}] ${p.id}  PID:${p.pid}  ${p.name}  ${p.command.slice(0, 60)}`
      );
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("win-cleanup", {
    description: "Clean up stale process registry entries",
    handler: async (_args, ctx) => {
      const result = await cleanupRegistry({
        removeExited: true,
        deleteLogs: false,
        olderThanDays: 7,
      });
      ctx.ui.notify(
        `Removed ${result.removedEntries} entries, kept ${result.keptRunning} running.`,
        "info"
      );
    },
  });

  pi.registerCommand("win-shell-info", {
    description: "Show discovered PowerShell and data paths",
    handler: async (_args, ctx) => {
      try {
        const discovery = await findPowerShell();
        const version = await getPowerShellVersion();
        const info = [
          `Shell: ${discovery.exe} (${discovery.kind})`,
          `Version: ${version ?? "unknown"}`,
          `Registry: ${getRegistryPath()}`,
          `Logs: ${getLogsDir()}`,
          `Base: ${getBaseDir()}`,
        ];
        ctx.ui.notify(info.join("\n"), "info");
      } catch (error) {
        ctx.ui.notify(
          `Failed: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    },
  });

  // ══════════════════════════════════════════════════════════════
  // Tools
  // ══════════════════════════════════════════════════════════════

  // ── powershell ──────────────────────────────────────────────

  pi.registerTool({
    name: "powershell",
    label: "PowerShell",
    description:
      "Run a foreground PowerShell command on Windows. Use for Windows-native commands: Windows paths (C:\\\\, D:\\\\)" +
      ", $env variables, .exe/.cmd/.bat/.ps1 execution, and Windows system inspection. " +
      "Returns stdout, stderr, and exit code. Default timeout: 120s. Output truncated at 50KB/2000 lines.",
    promptSnippet: "Run a PowerShell command on Windows (foreground, up to 120s, output truncated at 50KB/2000 lines)",
    promptGuidelines: [
      "Use powershell for Windows-native commands: Windows paths, $env variables, .exe/.cmd/.bat/.ps1 execution, process diagnostics, and Windows registry/system inspection.",
      "Do NOT use powershell for long-running dev servers — use win_start_process instead.",
      "Use bash (not powershell) for git diff, git status, git log, git grep, and Unix-like repository workflows (grep, sed, awk, find, xargs).",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "PowerShell command to execute" }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory (defaults to project root)" })
      ),
      timeoutMs: Type.Optional(
        Type.Number({ description: "Timeout in milliseconds (default: 120000)" })
      ),
      maxOutputBytes: Type.Optional(
        Type.Number({ description: "Maximum output bytes (default: 50000)" })
      ),
      maxLines: Type.Optional(
        Type.Number({ description: "Maximum output lines (default: 2000)" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const result = await executePowerShell({
          command: params.command,
          cwd: params.cwd ?? ctx.cwd,
          timeoutMs: params.timeoutMs,
          maxOutputBytes: params.maxOutputBytes,
          maxLines: params.maxLines,
        });

        const parts: string[] = [];
        parts.push(`Shell: ${result.shell}`);
        parts.push(`CWD: ${result.cwd}`);
        if (result.timedOut) parts.push("[Command timed out]");
        if (result.truncated) parts.push("[Output truncated]");
        parts.push(`Exit code: ${result.exitCode}`);

        if (result.stdout) {
          parts.push(`\nSTDOUT:\n${result.stdout}`);
        }
        if (result.stderr) {
          parts.push(`\nSTDERR:\n${result.stderr}`);
        }

        return {
          content: [{ type: "text", text: parts.join("\n") }],
          details: { ...result },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `powershell failed:\nCommand: ${params.command}\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_start_process ───────────────────────────────────────

  pi.registerTool({
    name: "win_start_process",
    label: "Start Process",
    description:
      "Start a long-running/background Windows process and capture output to a persistent log file. " +
      "Use for dev servers, watchers, long-running scripts — anything that should not block Pi. " +
      "Returns a stable ID, PID, and output file path.",
    promptSnippet: "Start a background Windows process (detached, output logged to file)",
    promptGuidelines: [
      "Use win_start_process for long-running Windows commands or background servers instead of Bash background syntax like `npm run dev &`.",
      "After win_start_process returns OUTPUT_FILE, use win_read_output to inspect logs.",
      "Use win_process_status to check whether the process is still alive.",
      "Use win_stop_process to stop a PID or ID returned by win_start_process.",
    ],
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Human-readable name for the process" })),
      command: Type.String({ description: "PowerShell command to run in background" }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory (defaults to project root)" })
      ),
      outputFile: Type.Optional(
        Type.String({ description: "Custom output file path (default: auto-generated)" })
      ),
      append: Type.Optional(
        Type.Boolean({ description: "Append to output file instead of overwriting (default: true)" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const processName = params.name || params.command.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_");
        const id = generateProcessId(processName);
        const outputFile =
          params.outputFile || getDefaultOutputFile(processName);

        await ensureDir(getLogsDir());

        const { pid, shell } = await startDetachedProcess({
          command: params.command,
          cwd: params.cwd ?? ctx.cwd,
          outputFile,
          append: params.append,
        });

        const entry: ManagedProcess = {
          id,
          name: processName,
          pid,
          command: params.command,
          cwd: params.cwd ?? ctx.cwd,
          shell,
          outputFile,
          startedAt: new Date().toISOString(),
          status: "running",
        };

        await addProcess(entry);

        const text = [
          "Started process.",
          `ID: ${id}`,
          `NAME: ${processName}`,
          `PID: ${pid}`,
          `CWD: ${params.cwd ?? ctx.cwd}`,
          `OUTPUT_FILE: ${outputFile}`,
          `COMMAND: ${params.command}`,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { id, pid, outputFile, shell },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_start_process failed:\nCommand: ${params.command}\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_process_status ──────────────────────────────────────

  pi.registerTool({
    name: "win_process_status",
    label: "Process Status",
    description:
      "Check whether a managed process (by registry ID) or arbitrary PID is alive. " +
      "Updates the registry status if checking by ID.",
    promptSnippet: "Check if a background process is still running (by ID or PID)",
    promptGuidelines: [
      "Use win_process_status to check whether a process started by win_start_process is still running.",
      "Provide either id (registry ID from win_start_process) or pid (numeric process ID).",
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ description: "Registry ID returned by win_start_process" })
      ),
      pid: Type.Optional(Type.Number({ description: "Raw Windows process ID" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (!params.id && !params.pid) {
          return {
            content: [
              {
                type: "text",
                text: "win_process_status requires either id or pid parameter.",
              },
            ],
            details: {},
          };
        }

        let entry: ManagedProcess | null = null;
        let pid: number;

        if (params.id) {
          entry = await getProcess(params.id);
          if (!entry) {
            return {
              content: [
                { type: "text", text: `No process found with ID: ${params.id}` },
              ],
              details: {},
            };
          }
          pid = entry.pid;
        } else {
          pid = params.pid!;
        }

        // Check if PID is alive using PowerShell
        const result = await executePowerShell({
          command: `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
          timeoutMs: 10000,
          cwd: ctx.cwd,
        });

        const alive = result.exitCode === 0 && result.stdout.trim().length > 0;
        const status = alive ? ("running" as const) : ("exited" as const);

        // Update registry if checking by ID
        if (entry) {
          await updateProcess(entry.id, {
            status,
            lastCheckedAt: new Date().toISOString(),
          });
        }

        const text = [
          `ID: ${entry?.id ?? "n/a"}`,
          `PID: ${pid}`,
          `STATUS: ${status}`,
          ...(entry
            ? [
                `NAME: ${entry.name}`,
                `COMMAND: ${entry.command}`,
                `OUTPUT_FILE: ${entry.outputFile}`,
                `STARTED_AT: ${entry.startedAt}`,
              ]
            : []),
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { id: entry?.id, pid, status, alive },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_process_status failed:\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_read_output ─────────────────────────────────────────

  pi.registerTool({
    name: "win_read_output",
    label: "Read Output",
    description:
      "Read output logs from a process started by win_start_process. " +
      "Reads tail lines by default to avoid dumping huge logs. " +
      "Provide either a registry ID or a direct output file path.",
    promptSnippet: "Read tail of a background process log (by ID or file path)",
    promptGuidelines: [
      "Use win_read_output to inspect the log file returned by win_start_process.",
      "Prefer tailLines 100 unless the user asks for more.",
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ description: "Registry ID returned by win_start_process" })
      ),
      outputFile: Type.Optional(
        Type.String({ description: "Direct path to the output log file" })
      ),
      tailLines: Type.Optional(
        Type.Number({ description: "Number of tail lines to read (default: 100)" })
      ),
      maxBytes: Type.Optional(
        Type.Number({ description: "Maximum bytes to read (default: 50000)" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      try {
        if (!params.id && !params.outputFile) {
          return {
            content: [
              {
                type: "text",
                text: "win_read_output requires either id or outputFile parameter.",
              },
            ],
            details: {},
          };
        }

        let outputFile: string;

        if (params.id) {
          const entry = await getProcess(params.id);
          if (!entry) {
            return {
              content: [
                { type: "text", text: `No process found with ID: ${params.id}` },
              ],
              details: {},
            };
          }
          outputFile = entry.outputFile;
        } else {
          outputFile = params.outputFile!;
        }

        const tailResult = await tailFile(outputFile, {
          lines: params.tailLines ?? 100,
          maxBytes: params.maxBytes ?? 50000,
        });

        if (!tailResult.fileExists) {
          return {
            content: [
              {
                type: "text",
                text: `Output file does not exist yet.\nThe process may not have written output.\nFile: ${outputFile}`,
              },
            ],
            details: { outputFile },
          };
        }

        if (tailResult.lines.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Output file exists but is empty (0 bytes).\nThe process may not have written output yet.\nFile: ${outputFile}`,
              },
            ],
            details: { outputFile },
          };
        }

        const text = [
          `OUTPUT_FILE: ${outputFile}`,
          `LINES_SHOWN: ${tailResult.linesRead}`,
          `TRUNCATED: ${tailResult.truncated}`,
          "",
          tailResult.lines.join("\n"),
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { outputFile, ...tailResult },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_read_output failed:\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_stop_process ────────────────────────────────────────

  pi.registerTool({
    name: "win_stop_process",
    label: "Stop Process",
    description:
      "Stop a process by registry ID or PID. " +
      "Uses taskkill /T /F by default to kill the full process tree. " +
      "Updates the registry if stopped by ID.",
    promptSnippet: "Stop a background process (by ID or PID, kills process tree by default)",
    promptGuidelines: [
      "Use win_stop_process to stop a PID or ID returned by win_start_process.",
      "Use tree=true (default) for dev servers that may spawn child processes.",
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ description: "Registry ID returned by win_start_process" })
      ),
      pid: Type.Optional(Type.Number({ description: "Raw Windows process ID" })),
      force: Type.Optional(Type.Boolean({ description: "Force kill (default: true)" })),
      tree: Type.Optional(Type.Boolean({ description: "Kill process tree (default: true)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (!params.id && !params.pid) {
          return {
            content: [
              {
                type: "text",
                text: "win_stop_process requires either id or pid parameter.",
              },
            ],
            details: {},
          };
        }

        let entry: ManagedProcess | null = null;
        let pid: number;

        if (params.id) {
          entry = await getProcess(params.id);
          if (!entry) {
            return {
              content: [
                { type: "text", text: `No process found with ID: ${params.id}` },
              ],
              details: {},
            };
          }
          pid = entry.pid;
        } else {
          pid = params.pid!;
        }

        const force = params.force !== false;
        const tree = params.tree !== false;

        // Kill the process
        if (tree) {
          const killResult = await executePowerShell({
            command: `taskkill /PID ${pid} /T${force ? " /F" : ""}`,
            timeoutMs: 15000,
            cwd: ctx.cwd,
          });

          if (killResult.exitCode !== 0 && killResult.exitCode !== 128) {
            // 128 means already exited — that's fine
            const alreadyGone =
              killResult.stderr.includes("not found") ||
              killResult.stderr.includes("no running");
            if (!alreadyGone) {
              const info = [
                `Attempted to kill PID ${pid} (tree=${tree}, force=${force})`,
                `Exit code: ${killResult.exitCode}`,
                `STDERR: ${killResult.stderr}`,
              ].join("\n");
              return {
                content: [{ type: "text", text: info }],
                details: { pid, killed: false, exitCode: killResult.exitCode },
              };
            }
          }
        } else {
          await executePowerShell({
            command: `Stop-Process -Id ${pid}${force ? " -Force" : ""} -ErrorAction SilentlyContinue`,
            timeoutMs: 15000,
            cwd: ctx.cwd,
          });
        }

        // Update registry
        if (entry) {
          await updateProcess(entry.id, {
            status: "exited",
            lastCheckedAt: new Date().toISOString(),
          });
        }

        const text = [
          "Stopped process.",
          `ID: ${entry?.id ?? "n/a"}`,
          `PID: ${pid}`,
          `TREE: ${tree}`,
          `FORCE: ${force}`,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { id: entry?.id, pid, killed: true, tree, force },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_stop_process failed:\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_list_processes ──────────────────────────────────────

  pi.registerTool({
    name: "win_list_processes",
    label: "List Processes",
    description:
      "List processes tracked by the extension registry. " +
      "Optionally refreshes status by checking each PID.",
    promptSnippet: "List tracked background processes with status",
    promptGuidelines: [
      "Use win_list_processes to see background processes previously started by win_start_process.",
    ],
    parameters: Type.Object({
      includeExited: Type.Optional(
        Type.Boolean({ description: "Include exited processes (default: false)" })
      ),
      refresh: Type.Optional(
        Type.Boolean({ description: "Check each PID live before reporting (default: true)" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const includeExited = params.includeExited ?? false;
        const refresh = params.refresh ?? true;

        let processes = await getAllProcesses();

        // Refresh statuses if requested
        if (refresh) {
          for (const proc of processes) {
            try {
              const result = await executePowerShell({
                command: `Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
                timeoutMs: 5000,
                cwd: ctx.cwd,
              });
              const alive =
                result.exitCode === 0 && result.stdout.trim().length > 0;
              const newStatus = alive ? ("running" as const) : ("exited" as const);
              if (newStatus !== proc.status) {
                await updateProcess(proc.id, {
                  status: newStatus,
                  lastCheckedAt: new Date().toISOString(),
                });
              }
            } catch {
              // Skip processes we can't check
            }
          }
          // Reload after updates
          processes = await getAllProcesses();
        }

        // Filter
        const filtered = includeExited
          ? processes
          : processes.filter((p) => p.status !== "exited");

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No tracked processes." +
                  (includeExited ? " (including exited)" : ""),
              },
            ],
            details: { count: 0 },
          };
        }

        const header = "ID | NAME | PID | STATUS | STARTED_AT | CWD";
        const separator = "-".repeat(header.length);
        const rows = filtered.map(
          (p) =>
            `${p.id} | ${p.name.slice(0, 20)} | ${p.pid} | ${p.status} | ${p.startedAt.slice(0, 19)} | ${p.cwd.slice(0, 40)}`
        );
        const text = [header, separator, ...rows, "", `Total: ${filtered.length} process(es)`].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { count: filtered.length, processes: filtered },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_list_processes failed:\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_kill_port ───────────────────────────────────────────

  pi.registerTool({
    name: "win_kill_port",
    label: "Kill Port",
    description:
      "Find and kill Windows processes listening on a TCP port. " +
      "Uses Get-NetTCPConnection, falls back to netstat.",
    promptSnippet: "Kill Windows processes listening on a TCP port",
    promptGuidelines: [
      "Use win_kill_port when a Windows dev server port is stuck or already in use.",
    ],
    parameters: Type.Object({
      port: Type.Number({ description: "TCP port number to free" }),
      force: Type.Optional(Type.Boolean({ description: "Force kill (default: true)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const port = params.port;
        const force = params.force !== false;

        // Try Get-NetTCPConnection first (PowerShell 4+)
        let pidsResult = await executePowerShell({
          command: `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
          timeoutMs: 15000,
          cwd: ctx.cwd,
        });

        // Fallback to netstat if Get-NetTCPConnection fails
        if (pidsResult.exitCode !== 0 || !pidsResult.stdout.trim()) {
          const netstatResult = await executePowerShell({
            command: `netstat -ano | findstr :${port}`,
            timeoutMs: 15000,
            cwd: ctx.cwd,
          });

          if (netstatResult.exitCode !== 0 || !netstatResult.stdout.trim()) {
            return {
              content: [
                {
                  type: "text",
                  text: `No process found listening on port ${port}.`,
                },
              ],
              details: { port, pidsFound: [] },
            };
          }

          // Parse netstat output to extract PIDs
          const lines = netstatResult.stdout
            .split(/\r?\n/)
            .filter((l) => l.trim());
          const pidSet = new Set<number>();
          for (const line of lines) {
            const match = line.match(/:(\d+)\s+.*\s+(\d+)\s*$/);
            if (match && parseInt(match[1]) === port) {
              pidSet.add(parseInt(match[2]));
            }
          }
          const pids = Array.from(pidSet);

          if (pids.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No process found listening on port ${port}.`,
                },
              ],
              details: { port, pidsFound: [] },
            };
          }

          // Kill found PIDs
          const killed: number[] = [];
          for (const pid of pids) {
            const killResult = await executePowerShell({
              command: `taskkill /PID ${pid} /T${force ? " /F" : ""}`,
              timeoutMs: 10000,
              cwd: ctx.cwd,
            });
            if (killResult.exitCode === 0 || killResult.exitCode === 128) {
              killed.push(pid);
            }
          }

          const text = [
            `PORT: ${port}`,
            `PIDS_FOUND: ${pids.join(", ")}`,
            `KILLED: ${killed.length > 0 ? killed.join(", ") : "none"}`,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: { port, pidsFound: pids, killed },
          };
        }

        // Parse Get-NetTCPConnection output
        const pids = pidsResult.stdout
          .split(/\r?\n/)
          .map((l) => parseInt(l.trim()))
          .filter((n) => !isNaN(n) && n > 0);

        if (pids.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No process found listening on port ${port}.`,
              },
            ],
            details: { port, pidsFound: [] },
          };
        }

        // Kill found PIDs
        const killed: number[] = [];
        for (const pid of pids) {
          const killResult = await executePowerShell({
            command: `taskkill /PID ${pid} /T${force ? " /F" : ""}`,
            timeoutMs: 10000,
            cwd: ctx.cwd,
          });
          if (killResult.exitCode === 0 || killResult.exitCode === 128) {
            killed.push(pid);
          }
        }

        const text = [
          `PORT: ${port}`,
          `PIDS_FOUND: ${pids.join(", ")}`,
          `KILLED: ${killed.length > 0 ? killed.join(", ") : "none"}`,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { port, pidsFound: pids, killed },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_kill_port failed:\nPort: ${params.port}\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_which ───────────────────────────────────────────────

  pi.registerTool({
    name: "win_which",
    label: "Which",
    description:
      "Discover commands on Windows using PowerShell Get-Command. " +
      "Returns the source path, version, and command type. " +
      "Falls back to cmd `where` if PowerShell is unavailable.",
    promptSnippet: "Find the location of a Windows command (like which on Unix)",
    promptGuidelines: [
      "Use win_which before assuming a Windows command path.",
      "Use win_which when a command fails with 'not found' or is unavailable.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Command name to locate" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const command = params.command;

        // Try PowerShell Get-Command
        const psResult = await executePowerShell({
          command: `Get-Command ${command} -ErrorAction SilentlyContinue | Format-List Source,Version,CommandType,Name`,
          timeoutMs: 15000,
          cwd: ctx.cwd,
        });

        if (psResult.exitCode === 0 && psResult.stdout.trim()) {
          // Parse Format-List output
          const lines = psResult.stdout.split(/\r?\n/).filter((l) => l.trim());
          const parsed: Record<string, string> = {};
          for (const line of lines) {
            const match = line.match(/^(\w+)\s*:\s*(.+)$/);
            if (match) {
              parsed[match[1].toLowerCase()] = match[2].trim();
            }
          }

          const text = [
            `COMMAND: ${command}`,
            `FOUND: true`,
            `SOURCE: ${parsed.source ?? "unknown"}`,
            `VERSION: ${parsed.version ?? "unknown"}`,
            `COMMAND_TYPE: ${parsed.commandtype ?? "unknown"}`,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: {
              command,
              found: true,
              source: parsed.source,
              version: parsed.version,
              commandType: parsed.commandtype,
            },
          };
        }

        // Fallback to cmd where
        const cmdResult = await executePowerShell({
          command: `cmd /c "where ${command} 2>nul"`,
          timeoutMs: 10000,
          cwd: ctx.cwd,
        });

        if (cmdResult.exitCode === 0 && cmdResult.stdout.trim()) {
          const paths = cmdResult.stdout
            .split(/\r?\n/)
            .filter((l) => l.trim());
          const text = [
            `COMMAND: ${command}`,
            `FOUND: true`,
            `SOURCE: ${paths[0]}`,
            `ALL_LOCATIONS:\n${paths.join("\n")}`,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: { command, found: true, source: paths[0], allPaths: paths },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `COMMAND: ${command}\nFOUND: false`,
            },
          ],
          details: { command, found: false },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_which failed:\nCommand: ${params.command}\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });

  // ── win_cleanup_processes ───────────────────────────────────

  pi.registerTool({
    name: "win_cleanup_processes",
    label: "Cleanup Processes",
    description:
      "Clean stale registry entries and optionally delete old log files. " +
      "Removes exited process records and logs older than the specified days.",
    promptSnippet: "Remove stale process records and old log files",
    promptGuidelines: [
      "Use win_cleanup_processes to remove stale process records and optionally old log files.",
    ],
    parameters: Type.Object({
      removeExited: Type.Optional(
        Type.Boolean({ description: "Remove exited process entries (default: true)" })
      ),
      deleteLogs: Type.Optional(
        Type.Boolean({ description: "Delete old log files (default: false)" })
      ),
      olderThanDays: Type.Optional(
        Type.Number({ description: "Age threshold in days for log deletion (default: 7)" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      try {
        const result = await cleanupRegistry({
          removeExited: params.removeExited ?? true,
          deleteLogs: params.deleteLogs ?? false,
          olderThanDays: params.olderThanDays ?? 7,
        });

        const text = [
          "CLEANUP SUMMARY",
          `Removed registry entries: ${result.removedEntries}`,
          `Deleted log files: ${result.deletedLogs}`,
          `Kept running processes: ${result.keptRunning}`,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: result,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `win_cleanup_processes failed:\nError: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });
}
