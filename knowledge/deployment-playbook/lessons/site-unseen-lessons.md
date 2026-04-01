# Site Unseen — Deployment Lessons

## Stack
React 19 + Vite (Frontend), Express + Socket.io + Prisma (Backend), PostgreSQL, Vercel (Frontend), Railway (Backend), npm workspaces monorepo

---

## 1. vercel.json must live at repo root for monorepo workspace resolution

### Symptom
Vercel build failed — couldn't resolve `@site-unseen/shared` workspace dependency when `vercel.json` was inside the `front/` subdirectory.

### Root Cause
Vercel scopes its build context to the directory containing `vercel.json`. When it was in `front/`, Vercel couldn't see the `shared/` workspace at the repo root.

### Fix
Moved `vercel.json` to the repo root with explicit workspace targeting:
```json
{
  "buildCommand": "npm install && npm run build --workspace=front",
  "outputDirectory": "front/dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Prevention
- **For monorepos on Vercel, always place `vercel.json` at the repo root**
- Set `outputDirectory` to the framework's output path relative to root
- Use `--workspace=` flag in build commands

### Time to Diagnose
~15 minutes (multiple failed Vercel builds)

---

## 2. `tsx` must be a production dependency for Railway TypeScript execution

### Symptom
Railway deployment crashed immediately — `tsx: not found` when trying to start the server via the Procfile.

### Root Cause
`tsx` (TypeScript executor) was in `devDependencies`. Railway runs `npm install --production` by default, which skips dev dependencies. The Procfile used `tsx src/index.ts` as the start command.

### Fix
Moved `tsx` from `devDependencies` to `dependencies` in `back/package.json`:
```json
{
  "dependencies": {
    "tsx": "^4.x"
  }
}
```

### Prevention
- **If your start command uses a tool, it must be in `dependencies`, not `devDependencies`**
- Alternative: compile TypeScript to JS and use `node dist/index.js` instead (avoids runtime TS dependency)
- Railway's NIXPACKS builder can be configured to keep devDeps, but that bloats the image

### Time to Diagnose
~5 minutes

---

## 3. `trust proxy` required behind Railway's reverse proxy

### Symptom
Rate limiting blocked all requests after a single user hit the limit — every request appeared to come from the same IP address.

### Root Cause
Railway routes traffic through a reverse proxy. Without `app.set("trust proxy", 1)`, Express sees the proxy's IP as the client IP, so all requests share one rate limit bucket.

### Fix
```typescript
app.set("trust proxy", 1);
```

### Prevention
- **Always set `trust proxy` when deploying Express behind a reverse proxy** (Railway, Heroku, AWS ELB, nginx)
- The `1` means "trust one hop" — appropriate for single-proxy setups
- Without this, `req.ip` returns the proxy IP, breaking rate limiting, logging, and geolocation

### Time to Diagnose
~10 minutes

---

## 4. Socket.io CORS mismatch silently kills WebSocket connections

### Symptom
Real-time simulation features didn't work in production. No error in the browser console. The Socket.io client silently failed to connect.

### Root Cause
Socket.io CORS origin was set to the wrong URL (missing `https://` prefix, or trailing slash mismatch). Unlike HTTP CORS which shows clear browser errors, Socket.io connection failures are silent by default.

### Fix
Ensure Socket.io CORS origin exactly matches the frontend URL:
```typescript
const io = new Server(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,  // Must be exact: "https://site-unseen.vercel.app"
    methods: ["GET", "POST"],
  },
});
```

### Prevention
- **Socket.io CORS must exactly match the frontend origin** — no trailing slash, correct protocol
- Add Socket.io connection error logging on the client:
  ```typescript
  socket.on("connect_error", (err) => console.error("Socket connect error:", err.message));
  ```
- Test WebSocket connection immediately after deploy

### Time to Diagnose
~20 minutes (silent failure made it hard to diagnose)

---

## 5. Node 20+ required for `crypto.randomUUID()` as global

### Symptom
CI pipeline failed with `TypeError: crypto.randomUUID is not a function` even though it worked locally.

### Root Cause
`crypto.randomUUID()` is a global function only in Node 19+. The CI was running Node 18, which requires `import { randomUUID } from 'node:crypto'`.

### Fix
Upgraded CI to Node 20:
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
```

### Prevention
- **Pin Node version in CI, package.json engines, and .nvmrc** to avoid version drift
- If using `crypto.randomUUID()`, require Node 19+ or import from `node:crypto`
- Add `engines` field to `package.json`:
  ```json
  { "engines": { "node": ">=20" } }
  ```

### Time to Diagnose
~5 minutes

---

## 6. Zombie simulations — server crash leaves RUNNING rows in DB

### Symptom
After a Railway restart, some simulations showed as "Running" forever in the UI but had no active process behind them.

### Root Cause
If the server crashes mid-simulation, the database row stays `status = RUNNING` but no in-memory interval is ticking. On restart, the app doesn't know these simulations are dead.

### Fix
Zombie recovery runs at startup, before accepting connections:
1. Find all simulations with `status = RUNNING` and `updatedAt > 10 minutes ago`
2. For each zombie: generate partial results from completed dates, mark as `FAILED`
3. Wrap each recovery in try-catch so one failure doesn't block startup

```typescript
recoverZombieSimulations()
  .catch((err) => console.error('Zombie recovery failed:', err))
  .finally(() => {
    httpServer.listen(env.PORT);
  });
```

### Prevention
- **Any stateful process that survives in the DB must have a recovery mechanism**
- Run recovery before `listen()` so clients don't see stale state
- Always `.catch()` recovery errors — never let them block startup
- Add a composite index on `[status, updatedAt]` for the recovery query

### Time to Diagnose
~30 minutes (required understanding the full simulation lifecycle)

---

## 7. Race condition — multiple clients start the same simulation

### Symptom
Occasionally a simulation would run twice simultaneously, producing duplicate results and corrupted state.

### Root Cause
Two clients could emit `simulation:start` for the same simulation ID. Both pass the "is it already running?" check before either sets the active flag.

### Fix
Added a `Set`-based mutex to prevent concurrent starts:
```typescript
const startingSimulations = new Set<string>();

socket.on("simulation:start", async (data) => {
  if (activeSimulations.has(id) || startingSimulations.has(id)) {
    socket.emit("simulation:error", { message: "Already running" });
    return;
  }
  startingSimulations.add(id);  // Lock
  try {
    // ... start simulation
  } finally {
    startingSimulations.delete(id);  // Unlock
  }
});
```

### Prevention
- **Always guard async operations with a synchronous lock** when multiple clients can trigger them
- A `Set` works for single-process; use Redis-based locks for multi-instance

### Time to Diagnose
~15 minutes

---

## 8. Double socket event emission — leave + unmount = negative viewer count

### Symptom
Viewer count for simulations sometimes went negative (e.g., "-1 watching").

### Root Cause
Clicking "Leave" emitted `simulation:leave`, then React's cleanup function on unmount emitted it again. The server decremented the viewer count twice.

### Fix
Used a ref to track explicit leave:
```typescript
const hasLeftRef = useRef(false);

const leave = useCallback(() => {
  hasLeftRef.current = true;
  socket.emit("simulation:leave", { simulationId });
}, []);

useEffect(() => {
  return () => {
    if (!hasLeftRef.current) {
      socket.emit("simulation:leave", { simulationId });
    }
  };
}, []);
```

### Prevention
- **When a socket event can be triggered by both user action and cleanup, deduplicate with a ref**
- Never trust that cleanup functions won't run after explicit user actions

### Time to Diagnose
~10 minutes

---

## 9. Tick diffing reduces WebSocket bandwidth by 80-90%

### Symptom
Not a bug — a performance optimization. Full simulation state broadcasts were ~20-30KB per tick at 1Hz, causing lag with multiple connected clients.

### Fix
During the dating phase (most ticks), emit compact diffs instead of full state:
- Only send changed fields: `dateMinutesElapsed`, `endedEarly`, `roundNumber`
- Client merges diffs with last known full tick
- On phase change, emit full tick for safety

### Prevention
- **For real-time apps, design diff-based updates from the start** — retrofitting is harder
- Always send a full state snapshot on reconnect or phase change
- Client must handle both full ticks and diffs

### Time to Diagnose
~N/A (proactive optimization)

---

## 10. Atomic DB transactions for simulation completion

### Symptom
Intermittently, a simulation would show as "Completed" but have no results, or have results but status still "Running."

### Root Cause
Simulation completion wrote dates, results, and status update as three separate queries. If the server crashed between any of them, the data was inconsistent.

### Fix
Wrapped all three writes in a Prisma transaction:
```typescript
await prisma.$transaction(async (tx) => {
  await tx.simulatedDate.createMany({ data: dates });
  await tx.simulationResult.create({ data: result });
  await tx.simulation.update({ data: { status: "COMPLETED" } });
});
```

### Prevention
- **Any multi-step state change that must be all-or-nothing needs a transaction**
- Only emit success events to clients after the transaction commits

### Time to Diagnose
~10 minutes

---

# Summary

**Total issues found:** 10

**Top 3 most time-consuming to diagnose:**
1. **Zombie simulation recovery** (~30 min) — required understanding full lifecycle and designing a recovery strategy
2. **Socket.io CORS silent failure** (~20 min) — no error messages made it hard to pinpoint
3. **Race condition on simulation start** (~15 min) — needed to reason about concurrent socket events

**Patterns identified:**
- **3 real-time/Socket.io issues** (#4, #7, #8) — WebSocket apps have a whole class of deployment issues that REST APIs don't: CORS silence, race conditions, event deduplication
- **2 monorepo/build issues** (#1, #2) — workspace resolution and dependency scoping continue to be a pain
- **2 data consistency issues** (#6, #10) — stateful processes need crash recovery and atomic state transitions
- **1 reverse proxy issue** (#3) — `trust proxy` is always needed behind PaaS proxies
