# Railway CLI Authentication — The Non-Interactive Problem

> This issue has blocked every project that deploys to Railway.
> `railway login` does not work from Claude Code, CI/CD, or any
> non-interactive terminal. This guide documents the workaround.

---

## The Problem

```
$ railway login
Cannot login in non-interactive mode

$ railway login --browserless
Cannot login in non-interactive mode
```

Railway CLI requires an interactive TTY with browser access. Claude Code's shell, GitHub Actions, Docker builds, and any automated environment can't satisfy this.

## The Fix (Simplest)

Run `railway login` in a separate terminal tab — not in Claude Code.

The login writes to `~/.railway/config.json`, which is shared across
all terminal sessions. Once authenticated in any tab, Claude Code
can use `railway` commands immediately.

```
# In a separate terminal tab:
railway login
# Browser opens, authenticate, done.

# Back in Claude Code:
railway whoami
# Works — reads the token from ~/.railway/config.json
```

**This is the recommended approach.** The token persists until it
expires (typically weeks/months). When it does, repeat in a new tab.

## Alternative: Manual Token (for CI/CD or when login is impossible)

### Step 1: Create token in browser (one-time, ~30 seconds)

1. Go to https://railway.com/account/tokens
2. Click "Create Token"
3. Name it (e.g., `cli-2026` or `claude-code`)
4. Copy the token

### Step 2: Write to Railway config

```bash
# Option A: Set as environment variable (per-session)
export RAILWAY_TOKEN="your-token-here"

# Option B: Write to config file (persists across sessions)
# The config lives at ~/.railway/config.json
# Update the user.token field:
cat ~/.railway/config.json | \
  python3 -c "import sys,json; c=json.load(sys.stdin); c['user']['token']='your-token-here'; print(json.dumps(c,indent=2))" \
  > /tmp/railway-config.json && mv /tmp/railway-config.json ~/.railway/config.json
```

### Step 3: Verify

```bash
railway whoami
# Should print your username
```

## Token Types (They're Different!)

| Token Type | Created At | Works With |
|-----------|-----------|------------|
| **Account token** | railway.com/account/tokens | GraphQL API, `railway whoami` |
| **Project token** | Project Settings → Tokens | `railway up`, `railway logs`, most CLI commands |

**The gotcha:** Account tokens work for `whoami` but NOT for `railway up`, `railway link`, or `railway logs`. Those need project tokens.

### Creating a project token from an account token:

```bash
curl -s -H "Authorization: Bearer $ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { projectTokenCreate(input: { projectId: \"YOUR_PROJECT_ID\", environmentId: \"YOUR_ENV_ID\", name: \"cli-deploy\" }) }"
  }' \
  https://backboard.railway.com/graphql/v2
```

## For the Kickoff Template

When a new project uses Railway, the kickoff sequence should:

1. Check if `railway whoami` works
2. If not, prompt the user to create a token at railway.com/account/tokens
3. Write the token to `~/.railway/config.json`
4. Run `railway link` to connect the project
5. Create a project-scoped token for CI/CD use

## Token Expiry

Railway account tokens stored in `~/.railway/config.json` expire. When they do:
- `railway whoami` returns "Unauthorized"
- All CLI commands fail
- The config file still exists with the old token

**Fix:** Repeat Step 1 and Step 2. There's no refresh mechanism.

## CI/CD: Use RAILWAY_TOKEN env var

In GitHub Actions:
```yaml
- name: Deploy to Railway
  env:
    RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
  run: railway up --detach --service my-service
```

The `RAILWAY_TOKEN` env var takes precedence over the config file. Use a project-scoped token here, not an account token.
