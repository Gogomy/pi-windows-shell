# Changelog

## [0.1.4] — 2026-05-18

### Changed — Minimal shell policy (breaking behavioral change)

The injected shell policy was reduced from ~80 lines to 11. The extension now only injects
Windows-awareness context (path handling, long-running commands). It no longer dictates:

- Which specific commands to use in Bash (`grep`, `find`, `sed`, `awk`, etc.)
- Bash vs PowerShell tool selection rules
- Command availability or failure handling procedures

Each registered tool now carries its own `promptGuidelines` scoped to that tool only.
This prevents conflicts with Pi's native tools (`grep`, `find`, `ls`) and other extensions.

### Fixed

- **Shell policy overreach**: Removed all Bash/PowerShell command lists that were overriding
  Pi's native tool preferences and could conflict with other extensions.
- **`rg` (ripgrep) suppressed**: The policy previously only mentioned `grep`, causing the agent
  to abandon `rg`. Fixed by removing all command lists from the global policy.
- **Overly restrictive Bash scope**: Removed "Use Bash **only** for..." language that could
  prevent the agent from using Bash for `curl`, `ssh`, `tar`, `node` scripts, etc.
- **Pi native tools blocked**: The policy listed `grep` and `find` as Bash commands,
  causing the agent to bypass Pi's native optimized tools. Fixed by removing all such lists.

### Removed

- Dead import: `clearDiscoveryCache` from `index.ts`
- Dead import: `loadRegistry` from `index.ts`
- Dead code: `checkProcessAlive()` from `process-registry.ts` (also non-functional on Windows)
- Unnecessary `if (windowsShellPolicy)` guard in `index.ts`

## [0.1.3] — 2026-05-17

### Fixed

- Inlined shell policy directly in `index.ts` instead of reading from a missing file
- Removed registry as a slash command (`/win-processes` already covers this)

## [0.1.2] — 2026-05-17

### Fixed

- npm publish configuration

## [0.1.1] — 2026-05-17

_Initial pre-release iterations._

## [0.1.0] — 2026-05-17

### Added

- Initial release
- 9 Windows tools: `powershell`, `win_start_process`, `win_process_status`,
  `win_read_output`, `win_stop_process`, `win_kill_port`, `win_which`,
  `win_list_processes`, `win_cleanup_processes`
- 3 slash commands: `/win-shell-info`, `/win-processes`, `/win-cleanup`
- Persistent process registry (`%LOCALAPPDATA%\pi-windows-shell\`)
- Automatic shell policy injection
- PowerShell version in status bar
