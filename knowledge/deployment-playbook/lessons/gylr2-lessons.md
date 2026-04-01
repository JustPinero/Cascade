# GYLR2 (Get Your Life Right) — Deployment Lessons

## Stack
React Native + Expo SDK 54, Google Calendar API (OAuth), Anthropic Claude API, Redux Toolkit, AsyncStorage, EAS Build

---

## 1. Anthropic API key exposed client-side via `EXPO_PUBLIC_` prefix

### Symptom
Security review flagged that the Anthropic API key was accessible in the client app bundle.

### Root Cause
Key was stored as `EXPO_PUBLIC_ANTHROPIC_API_KEY`, which Expo embeds into the app binary. Anyone with the APK/IPA could extract the key.

### Fix
Acknowledged as a known tradeoff for the MVP. Production recommendation documented: create a backend proxy that handles all Claude API calls server-side.

### Prevention
- **Never use `EXPO_PUBLIC_` for paid API keys** — they get compiled into the app binary
- Use a backend proxy (Express, Vercel Functions, Supabase Edge Functions) to keep secrets server-side
- `EXPO_PUBLIC_` is only safe for public values (Supabase anon key, analytics IDs)
- This is the same pattern as MonsterMash lesson #1 — it applies universally

### Time to Diagnose
~N/A (caught in review, not in production)

---

## 2. iOS OAuth redirect URI requires reversed client ID domain notation

### Symptom
Google OAuth failed on iOS. The redirect URI didn't match what Google expected.

### Root Cause
iOS OAuth requires the redirect URI scheme to be the reversed domain format of the client ID:
- Client ID: `192957...apps.googleusercontent.com`
- Required scheme: `com.googleusercontent.apps.192957...`

This is an iOS-specific requirement — Android and web use standard schemes.

### Fix
Dynamic scheme generation in `app.config.js`:
```javascript
function getReversedClientId(clientId) {
  const match = clientId.match(/^(.+)\.apps\.googleusercontent\.com$/);
  return match ? `com.googleusercontent.apps.${match[1]}` : null;
}

const schemes = ['gylr'];
if (reversedClientId) schemes.push(reversedClientId);

module.exports = ({ config }) => ({ ...config, scheme: schemes });
```

And in the auth service:
```typescript
if (Platform.OS === 'ios') {
  return `${reversedClientId}:/oauth2redirect/google`;
} else {
  return makeRedirectUri({ scheme: 'gylr', path: 'oauth' });
}
```

### Prevention
- **iOS Google OAuth needs reversed client ID as URL scheme** — this is poorly documented
- Use `app.config.js` (not `app.json`) to dynamically build schemes from env vars
- Test OAuth on both iOS and Android — they use completely different redirect URI formats
- Add debug logging for redirect URIs to aid troubleshooting

### Time to Diagnose
~30 minutes

---

## 3. Token expiry needs 5-minute buffer for preemptive refresh

### Symptom
Intermittently, API calls to Google Calendar failed with 401 errors even though the user appeared to be logged in.

### Root Cause
Token was checked for expiry at exactly the expiration timestamp. Due to clock skew and network latency, the token could expire between the check and the API call.

### Fix
Added a 5-minute buffer:
```typescript
export function isTokenExpired(tokens: AuthTokens): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= tokens.expiresAt - bufferMs;
}
```

### Prevention
- **Always use a buffer (3-5 minutes) when checking token expiry**
- Refresh preemptively before the token actually expires
- This applies to all OAuth tokens, JWTs, and session tokens

### Time to Diagnose
~15 minutes (intermittent, had to catch it happening)

---

## 4. `.env.example` was incomplete — missing OAuth secret

### Symptom
New developer setup failed. Google OAuth token exchange returned an error because `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET` wasn't set.

### Root Cause
The `.env.example` template didn't include all required variables. The web client secret was only discovered during OAuth flow testing.

### Fix
Updated `.env.example` to include all required vars:
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your_web_client_id
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET=your_web_client_secret
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your_ios_client_id
EXPO_PUBLIC_ANTHROPIC_API_KEY=your_claude_api_key_here
```

### Prevention
- **Keep `.env.example` in sync with every env var the app uses**
- Test from-scratch setup (clone repo, copy `.env.example`, fill values) before shipping
- Consider a startup validation function that checks all required vars

### Time to Diagnose
~5 minutes

---

## 5. Web vs iOS OAuth: different token exchange requirements

### Symptom
OAuth worked on iOS but failed on web platform. Token exchange returned "invalid_client."

### Root Cause
iOS uses PKCE flow (code verifier only, no client secret). Web platform requires the client secret in addition to the code verifier. The code didn't differentiate between platforms.

### Fix
Conditionally include client secret:
```typescript
const tokenRequest: AuthSession.AccessTokenRequestConfig = {
  clientId: getClientId(),
  code: result.params['code'],
  redirectUri: getRedirectUri(),
  extraParams: { code_verifier: request.codeVerifier ?? '' },
};

if (Platform.OS === 'web' && googleConfig.webClientSecret) {
  tokenRequest.clientSecret = googleConfig.webClientSecret;
}
```

### Prevention
- **OAuth token exchange requirements differ by platform** — always branch on `Platform.OS`
- iOS: PKCE only (no secret needed, Apple enforces this)
- Web: PKCE + client secret
- Android: Similar to iOS for native apps
- Document which credentials each platform needs

### Time to Diagnose
~20 minutes

---

## 6. Claude API request timeout — no abort controller

### Symptom
Occasionally the app would appear frozen while waiting for a Claude API response. No timeout, no error — just spinning forever.

### Root Cause
`fetch()` to Claude's API had no timeout. If the API was slow or the network was degraded, the request hung indefinitely.

### Fix
Added AbortController with 15-second timeout:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);

try {
  const response = await fetch(CLAUDE_API_URL, {
    signal: controller.signal,
    // ...
  });
} catch (error) {
  if (error.name === 'AbortError') {
    throw new ClaudeAPIError('Request timed out', 'TIMEOUT');
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
```

### Prevention
- **Always set timeouts on external API calls** — use AbortController
- 15 seconds is reasonable for LLM APIs; 5-10 seconds for typical REST APIs
- Clean up the timeout in `finally` to prevent memory leaks
- Show user-friendly timeout messages

### Time to Diagnose
~5 minutes

---

## 7. Client-side rate limiting prevents API cost overruns

### Symptom
Not a bug — a proactive cost control measure. Without rate limiting, a user could rapidly trigger Claude API calls (each costing money).

### Implementation
```typescript
const RATE_LIMIT_MS = 10000; // 10 seconds between requests
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache

// Cache key based on actual data content
function createCacheKey(allocations, timePeriod, personality) {
  const dataHash = allocations
    .map(a => `${a.category}:${a.totalMinutes}`)
    .sort()
    .join('|');
  return `${timePeriod}-${personality}-${dataHash}`;
}
```

### Prevention
- **Implement client-side rate limiting for any paid API** — both per-request throttle and response caching
- Use content-based cache keys (hash of request data), not just timestamps
- Show countdown timers in the UI when rate limited
- This doesn't replace server-side rate limiting (which is still needed for security)

### Time to Diagnose
~N/A (proactive)

---

## 8. Signing credentials not gitignored initially

### Symptom
Git status showed `google-service-account.json` and keystore files as untracked — they could have been accidentally committed.

### Root Cause
`.gitignore` didn't include signing credentials and service account files.

### Fix
Added to `.gitignore`:
```gitignore
google-service-account.json
*.keystore
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.pem
```

### Prevention
- **Add signing credential patterns to `.gitignore` at project creation** — not after they exist
- Google service account JSON, Apple provisioning profiles, and keystores should NEVER be committed
- If accidentally committed, rotate the credentials immediately

### Time to Diagnose
~2 minutes

---

# Summary

**Total issues found:** 8

**Top 3 most time-consuming to diagnose:**
1. **iOS OAuth reversed client ID** (~30 min) — poorly documented iOS requirement for URL schemes
2. **Web vs iOS OAuth secret requirement** (~20 min) — platform-specific token exchange differences
3. **Token expiry race condition** (~15 min) — intermittent, needed to catch during the narrow window

**Patterns identified:**
- **3 OAuth/auth issues** (#2, #3, #5) — Google OAuth is surprisingly platform-specific; each platform has different requirements for redirect URIs, secrets, and PKCE
- **2 API security/cost issues** (#1, #7) — paid API keys need backend proxies and client-side rate limiting
- **1 timeout issue** (#6) — external API calls must have timeouts; LLM APIs are especially prone to slow responses
- **1 env var documentation issue** (#4) — `.env.example` must be kept in sync
- **1 credential management issue** (#8) — gitignore signing credentials from day one
