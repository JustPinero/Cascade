# WebSocket / Socket.io in Production

> From medipal, site-unseen, and ARC.
> WebSocket apps have deployment issues that REST APIs don't.

---

## CORS Configuration

Socket.io CORS is separate from Express CORS. Both must match.

```typescript
const origins = [env.FRONTEND_URL, env.ADMIN_URL].filter(Boolean);

// Express
app.use(cors({ origin: origins, credentials: true }));

// Socket.io — MUST use the same origins
const io = new Server(httpServer, {
  cors: { origin: origins, methods: ['GET', 'POST'], credentials: true },
});
```

**The silent failure problem:** HTTP CORS mismatches show clear browser errors. Socket.io CORS mismatches produce **no error** — the connection just doesn't happen. Add this to every client:

```typescript
socket.on('connect_error', (err) => {
  console.error('Socket connect error:', err.message);
});
```

---

## Authentication: Token Lifecycle

### Problem: JWT expires, WebSocket dies silently

The Socket.io client grabs the JWT once on mount. After token expiry (e.g., 15 minutes), the server rejects the stale token. No reconnection happens because the client still has the old token.

### Solution: Token refresh listener

```typescript
// tokenStorage.ts — emit events when tokens refresh
type Listener = (token: string) => void;
const listeners = new Set<Listener>();

export function onTokenRefresh(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyTokenRefresh(token: string) {
  listeners.forEach(fn => fn(token));
}

// SocketContext.tsx — reconnect on token refresh
useEffect(() => {
  const unsubscribe = onTokenRefresh((newToken) => {
    socket.disconnect();
    socket.auth = { token: newToken };
    socket.connect();
  });
  return unsubscribe;
}, [socket]);
```

### Better: Short-lived WebSocket tokens

Issue purpose-specific tokens for WebSocket handshake:

```typescript
// Server: /auth/ws-token endpoint
app.post('/auth/ws-token', authenticate, (req, res) => {
  const wsToken = jwt.sign(
    { sub: req.user.id, type: 'ws' },
    env.JWT_SECRET,
    { expiresIn: '60s' }  // 60-second lifetime
  );
  res.json({ token: wsToken });
});

// Client: fetch WS token before connecting
const { token } = await api.post('/auth/ws-token');
socket.auth = { token };
socket.connect();
```

---

## Race Conditions

### Multiple clients start the same operation

Use a `Set`-based mutex for single-instance servers:

```typescript
const startingOperations = new Set<string>();

socket.on('operation:start', async (data) => {
  if (activeOperations.has(id) || startingOperations.has(id)) {
    socket.emit('operation:error', { message: 'Already running' });
    return;
  }
  startingOperations.add(id);
  try {
    // ... do the work
  } finally {
    startingOperations.delete(id);
  }
});
```

For multi-instance, use Redis-based locks.

### Double event emission (leave + unmount)

User clicks "Leave" → emits event → component unmounts → cleanup emits same event again.

```typescript
const hasLeftRef = useRef(false);

const leave = useCallback(() => {
  hasLeftRef.current = true;
  socket.emit('leave', { id });
}, []);

useEffect(() => {
  return () => {
    if (!hasLeftRef.current) {
      socket.emit('leave', { id });
    }
  };
}, []);
```

---

## Socket.io URL Derivation

**Never use string replace to derive the WebSocket URL:**

```typescript
// BAD — breaks with unexpected path structures
const SOCKET_URL = API_URL.replace('/api/v1', '');

// GOOD — use URL constructor
const SOCKET_URL = new URL(process.env.NEXT_PUBLIC_API_URL!).origin;
```

---

## Memory Management

Completed operations stay in memory forever without cleanup:

```typescript
// Clean up after 5-minute grace period
setTimeout(() => {
  activeOperations.delete(operationId);
}, 5 * 60 * 1000);
```

---

## Bandwidth Optimization: Tick Diffing

For real-time apps with frequent updates (1Hz+), send diffs instead of full state:

```typescript
// Server: emit compact diffs during steady state
if (isMinorUpdate) {
  nsp.to(room).emit('tick-diff', {
    elapsedTime: tick.elapsedTime,
    changedFields: getChangedFields(prevTick, tick),
  });
} else {
  nsp.to(room).emit('tick', fullTickState);  // Full state on phase changes
}

// Client: merge diffs with last known full state
socket.on('tick-diff', (diff) => {
  setState(prev => ({ ...prev, ...diff }));
});
```

Reduces bandwidth by 80-90% (Site-Unseen #9).

---

## Checklist

- [ ] Socket.io CORS origins match Express CORS origins exactly
- [ ] `connect_error` handler logs connection failures on client
- [ ] Token refresh triggers socket disconnect/reconnect
- [ ] Consider short-lived WebSocket-specific tokens
- [ ] Race conditions guarded with Set-based mutex
- [ ] Double event emission prevented with ref guard
- [ ] Socket URL derived with `new URL().origin` (not string replace)
- [ ] Completed operations cleaned up from memory
- [ ] Validate all incoming socket event payloads with Zod
