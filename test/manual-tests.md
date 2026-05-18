# Manual Tests — pi-windows-shell

## Test 1: PowerShell version

**Prompt:**
```
Use powershell to run:
$PSVersionTable.PSVersion
```

**Expected:**
- Shows PowerShell version (e.g., `7.4.0` or `5.1.xxxxx`)
- Exit code 0
- No errors

---

## Test 2: Command discovery

**Prompt:**
```
Use win_which to find:
pwsh
```

**Expected:**
- Shows path if PowerShell 7 is installed
- Reports `FOUND: false` cleanly if not installed (no crash)

---

## Test 3: Foreground command with cwd

**Prompt:**
```
Use powershell to run:
Get-Location
```

**Expected:**
- Shows current project directory
- Exit code 0

---

## Test 4: Background ping

**Prompt:**
```
Use win_start_process with:
name: ping-test
command: "ping 127.0.0.1 -n 5"

Then use win_read_output with the returned ID.
```

**Expected:**
- Returns ID, PID, and OUTPUT_FILE
- After a few seconds, `win_read_output` shows ping results
- Exit code 0

---

## Test 5: Process status

**Prompt:**
```
Use win_process_status with the ID returned by the ping test.
```

**Expected:**
- Reports `STATUS: running` (if ping still going) or `STATUS: exited` (if finished)
- Shows NAME, COMMAND, OUTPUT_FILE, STARTED_AT

---

## Test 6: Stop process

**Prompt:**
```
Use win_start_process with:
name: sleep-test
command: "Start-Sleep -Seconds 60"

Then use win_stop_process with the returned ID.
```

**Expected:**
- Process starts
- `win_stop_process` kills it
- Reports `TREE: true, FORCE: true`
- `win_process_status` shows `STATUS: exited` afterward

---

## Test 7: List processes

**Prompt:**
```
Use win_list_processes.
```

**Expected:**
- Shows tracked processes in a table format
- Does not crash with stale PIDs
- Running processes show as `running`, exited as `exited`

---

## Test 8: Kill port

**Manual setup:** Start a local server on a known port (e.g., 8080) with `win_start_process` or manually.

**Prompt:**
```
Use win_kill_port with:
port: 8080
```

**Expected:**
- Finds PID(s) listening on the port
- Kills process tree
- Reports `PIDS_FOUND` and `KILLED`
- If no process is found, cleanly reports: "No process found listening on port 8080"

---

## Test 9: Bash untouched

**Prompt:**
```
Use bash to run:
git status --short
```

**Expected:**
- Built-in bash still works normally
- Extension did not override it
- No interference from Windows shell extension

---

## Test 10: Cleanup

**Prompt:**
```
Use win_cleanup_processes with:
removeExited: true
deleteLogs: false
```

**Expected:**
- Removes stale registry entries for exited processes
- Does NOT delete log files unless `deleteLogs` is explicitly true
- Reports `Kept running processes: <n>` correctly
