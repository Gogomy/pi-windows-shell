# Windows Shell Policy

The environment runs on Windows.

These rules are always active when choosing how to run commands.

## Shell/tool selection

Use Bash only for Git-oriented and Unix-like repository inspection workflows:

- `git status`
- `git diff`
- `git log`
- `git grep`
- patch inspection
- Unix-style text pipelines
- `grep`, `sed`, `awk`, `find`, `xargs`

Use PowerShell for Windows-native workflows:

- Windows paths such as `C:\...` or `D:\...`
- Windows environment variables such as `$env:USERPROFILE`
- `.exe`, `.cmd`, `.bat`, `.ps1`
- process management
- killing processes by PID or port
- checking installed commands with `Get-Command`
- Python virtual environments on Windows
- npm/yarn/pnpm/npx commands that resolve through `.cmd` launchers
- Windows services, registry, or system configuration
- launching Windows executables such as Godot, Blender, editors, or installers

Do not mix Bash syntax and PowerShell syntax in the same command.

Prefer `git diff` over shell-specific `diff` when inspecting repository changes.

## Windows path handling

Do not assume Windows paths are valid inside Bash.

If a command uses a Windows path such as:

```txt
C:\...
D:\...
```

use PowerShell.

Do not manually convert Windows paths to `/mnt/c/...`, `/c/...`, or `/d/...` unless the active Bash environment has already been verified to support that path style.

Do not assume WSL is available.

## Long-running commands

Do not use Bash background syntax on Windows:

```bash
npm run dev &
```

For long-running commands, background servers, file watchers, REPLs, or GUI applications, use the environment-provided Windows process tools when available:

- `win_start_process`
- `win_process_status`
- `win_read_output`
- `win_stop_process`
- `win_list_processes`

For stuck ports, use the environment-provided port tool when available:

- `win_kill_port`

Examples of long-running or blocking commands include:

- `npm run dev`
- `pnpm dev`
- `yarn dev`
- `godot . -e`
- local web servers
- file watchers
- REPLs
- GUI applications

## Command availability

Do not assume project-specific executable paths or tool names globally.

If a command is unavailable, diagnose it before retrying.

For PowerShell-native checks, use:

```powershell
Get-Command <command-name> -ErrorAction SilentlyContinue
```

If the environment provides `win_which`, it may also be used for Windows command resolution.

For Bash-only tools, use Bash diagnostics only after confirming the command is intended to run in Bash.

## Failure handling

When a command fails, do not retry blindly.

Identify:

1. Which shell/tool ran it.
2. The current working directory.
3. The exit code.
4. stderr/stdout.
5. Whether the command is Windows-native, Unix-like, or environment-provided.
6. Whether the path syntax matches the selected shell.

Then choose the corrected shell or tool before retrying.
