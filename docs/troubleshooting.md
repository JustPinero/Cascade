# Troubleshooting

Common issues and fixes, in rough order of frequency.

---

## 1Password

### `op` not found
You don't have the 1Password CLI installed. Install it — see [the 1Password docs](https://developer.1password.com/docs/cli/get-started/).

- **macOS:** `brew install --cask 1password-cli`
- **WSL2/Linux:** download the Linux CLI and put it on your PATH. If you're on WSL2, ALSO install 1Password Desktop on Windows and enable *Settings → Developer → "Integrate with 1Password CLI"* so `op` re-auths via Windows Hello instead of master-password typing.

### `op` is installed but `op vault list` says "not currently signed in"
Your session expired or you never signed in. Two ways to fix:

- **Interactive signin:** run `eval $(op signin)` and enter your master password + secret key.
- **Desktop integration (recommended):** open 1Password Desktop → Settings → Developer → enable *"Integrate with 1Password CLI"*. Subsequent `op` commands will use biometric auth (Touch ID / Windows Hello) via the desktop app.

On WSL2, the desktop integration path works via a socket bridge between Windows 1P Desktop and the WSL Linux CLI.

### `op read failed for op://Cascade/Cascade Runtime/anthropic_api_key`
The referenced vault or item doesn't exist. Confirm with:
```bash
op vault list
op item get "Cascade Runtime" --vault Cascade
```
If missing, create them:
```bash
op vault create Cascade
op item create \
  --category="API Credential" \
  --title="Cascade Runtime" \
  --vault=Cascade \
  "anthropic_api_key[password]=sk-ant-YOUR-KEY"
```
Or re-run `npx create-cascade` and let it handle the bootstrap.

### `pnpm dev` fails with "op: command not found" or hangs on startup
Your `.env` references `op://...` but `op` isn't on PATH, or your 1P session is expired. Run `op vault list` first to confirm `op` works; then `pnpm dev`.

---

## WSL2 (Windows)

### Terminals die under load (all terminals at once)
This is the commit-limit failure mode. Your page file is too small, so when total memory *committed* (WSL + Chrome + Claude Desktop + multiple Claude Code CLIs) exceeds the limit, Windows refuses new allocations and processes die silently. No crash in Event Viewer.

**Fix (raises the commit limit):**
1. Open **admin** PowerShell.
2. Run:
```powershell
$cs = Get-CimInstance Win32_ComputerSystem
Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$false}
$pf = Get-CimInstance Win32_PageFileSetting -Filter "Name='C:\\pagefile.sys'"
Set-CimInstance -InputObject $pf -Property @{InitialSize=32768; MaximumSize=65536}
```
3. Reboot.

**Then cap WSL so it doesn't starve Windows.** Create `%UserProfile%\.wslconfig`:
```ini
[wsl2]
memory=16GB
swap=16GB
autoMemoryReclaim=gradual
sparseVhd=true
```
Run `wsl --shutdown` in PowerShell, then reopen your WSL shell.

`autoMemoryReclaim=gradual` is the biggest win — WSL hands idle memory back to Windows every few minutes, instead of holding every byte it ever touched.

Verify with `Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory, TotalVirtualMemorySize`. `TotalVirtualMemorySize` should now reflect the new commit limit (physical + page file).

### `create-cascade` refuses to run on Windows
By design. Cascade's dispatcher uses tmux + bash; pure Windows has no equivalent. Install WSL2 (`wsl --install` from PowerShell), open a WSL shell, and re-run.

### WSL can't find `pnpm` or `node`
You installed them on Windows, not inside WSL. From WSL, run:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash
sudo apt-get install -y nodejs
corepack enable pnpm
```

---

## Claude Code hooks

### Sessions end but Cascade doesn't refresh
Your Stop hook isn't firing the webhook. Check `~/.claude/settings.json`:
```bash
cat ~/.claude/settings.json | grep -A5 Stop
```
Expected: a hook block with `command` pointing at `curl -X POST http://localhost:3000/api/webhook/session-complete …` (or similar).

Fix: run the installer again:
```bash
cd ~/Code/cascade
pnpm exec tsx scripts/install-hooks.ts
```
That script auto-repairs the hook format (old flat format → current nested format).

### Hook fires but webhook returns 500
Cascade isn't running on port 3000, or the project path in the webhook payload isn't recognized. Check:
- Is `pnpm dev` running? Visit http://localhost:3000 to confirm.
- Does the project you ran Claude in live under your `PROJECTS_DIR`? Cascade only dispatches to and tracks projects inside that directory.

---

## Port conflicts

### Port 3000 already in use
Another Next.js or Node process is bound. Find it:
```bash
lsof -iTCP:3000 -sTCP:LISTEN     # macOS/Linux
# or on Windows (in PowerShell):
Get-NetTCPConnection -LocalPort 3000
```
Kill it, or set a different port:
```bash
PORT=3001 pnpm dev
```
Update the hook webhook URL in `scripts/install-hooks.ts` if you change the port long-term.

---

## Dispatch queue

### I dispatched 6 projects but only 2 show Claude running
That's the concurrency queue doing its job. Your host RAM is in the 16–32GB range, so the default cap is 2. The other 4 panes show `[queued: projectname]` placeholders. They'll launch automatically as the first 2 finish.

Override the default:
```bash
# in .env
CASCADE_MAX_CONCURRENT_SUBAGENTS=4
```

### I want NO queueing — launch all at once
Not recommended unless you're on a machine with plenty of headroom. But:
```bash
CASCADE_MAX_CONCURRENT_SUBAGENTS=99
```

### Queue is stuck — slots never release
The Stop webhook isn't firing. See **Claude Code hooks** above. As a nuclear reset, restart Cascade — the queue is in-memory and resets on startup.

---

## Database / Prisma

### "SQLite database not found"
The db file lives at `./dev.db` (project root, NOT `prisma/dev.db`). Check:
```
DATABASE_URL="file:./dev.db"
```
in your `.env`. Then:
```bash
pnpm exec prisma db push
pnpm db:seed
```

### "Module '@/app/generated/prisma/client' not found" in tests
Prisma client hasn't been generated yet:
```bash
pnpm exec prisma generate
```

---

## Tests failing on Windows

### "Error: Command failed: git init && git add -A && git commit -m init"
Git config is missing a user.name / user.email. Run once:
```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### "isInsideProjectsDir returns false for /Users/..."
Unix paths don't resolve on Windows. These tests were written with a Mac dev environment in mind. They pass in CI (Linux) and on macOS. Safe to ignore locally on Windows.

---

## General

### Scan finds zero projects
`PROJECTS_DIR` in `.env` is wrong, or the directory is empty, or your projects don't have `CLAUDE.md` files. Cascade only imports projects with `CLAUDE.md` at the root.

### The Overseer gives short, generic answers
`ANTHROPIC_API_KEY` might be unset or stale. Confirm `op run --env-file=.env -- printenv ANTHROPIC_API_KEY` prints a value starting with `sk-ant-`.

### Everything seems slow
Check `free -h` (in WSL) or Activity Monitor (macOS). Cascade + Claude Desktop + Chrome easily hits 20GB+ in active use. If you're on 16GB total, expect friction — consider `CASCADE_MAX_CONCURRENT_SUBAGENTS=1`.
