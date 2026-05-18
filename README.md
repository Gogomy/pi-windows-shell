# pi-windows-shell — Pi Extension

[![npm](https://img.shields.io/npm/v/@gogomi/pi-windows-shell)](https://www.npmjs.com/package/@gogomi/pi-windows-shell)

Windows PowerShell and process-management extension for [Pi Agent](https://pi.dev). Gives Pi explicit tools for PowerShell execution and long-running process management on Windows, while keeping the built-in `bash` tool fully functional for Git and Unix-like workflows.

## Features

- **Foreground PowerShell** — Windows paths, `$env` variables, `.exe`/`.cmd`/`.bat`/`.ps1`, system inspection
- **Background process lifecycle** — start, monitor, read output, stop, and list detached processes
- **Port management** — find and kill processes by TCP port
- **Command discovery** — locate Windows commands with `Get-Command`
- **Persistent process registry** — survives Pi restarts (`%LOCALAPPDATA%\pi-windows-shell\`)
- **Automatic shell policy** — injected into every system prompt, guides Pi on Bash vs PowerShell usage
- **Status bar** — shows discovered PowerShell version

## Install

```bash
pi install npm:@gogomi/pi-windows-shell
```

Reload Pi after install: `/reload`

## Usage

### Slash Commands (you)

```txt
/win-shell-info    → discovered PowerShell, registry path, logs path
/win-processes     → tracked background processes
/win-cleanup       → remove stale registry entries
```

### Agent Tools (called automatically by the agent)

| Tool | Description |
|------|-------------|
| `powershell` | Run a foreground PowerShell command (120s timeout, 50KB/2000 lines) |
| `win_start_process` | Start a background process, output logged to file |
| `win_process_status` | Check if a process is alive by ID or PID |
| `win_read_output` | Read tail of a background process log |
| `win_stop_process` | Stop a process tree by ID or PID |
| `win_kill_port` | Find and kill processes listening on a TCP port |
| `win_which` | Discover command paths with `Get-Command` |
| `win_list_processes` | List tracked background processes |
| `win_cleanup_processes` | Remove stale registry entries and old logs |

## Shell policy

The extension injects a minimal Windows-awareness policy into the system prompt:

- **Path handling** → don't pass `C:\` paths to Bash, don't assume WSL
- **Long-running** → use `win_start_process` instead of `npm run dev &`

Each tool also has its own `promptGuidelines` telling the agent when to use it. The extension does NOT dictate how to use Bash, git, grep, find, or other Pi-native tools.

## Structure

```
index.ts                  ← Pi extension (9 tools + 3 commands + policy injection)
shell.ts                  ← PowerShell discovery and foreground/background execution
process-registry.ts       ← Persistent JSON registry for managed processes
output.ts                 ← Output truncation and tail reading
paths.ts                  ← Registry and log path helpers
types.ts                  ← Shared TypeScript interfaces
```

## Requirements

- Node.js ≥ 18
- Windows with PowerShell 5+ (PowerShell 7 recommended)
