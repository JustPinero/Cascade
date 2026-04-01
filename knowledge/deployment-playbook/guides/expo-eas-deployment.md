# Expo / EAS Mobile Deployment Guide

> From E1C and GYLR2.
> Mobile deployment has unique concerns: app store review, native APIs,
> platform-specific auth, and OTA updates.

---

## EAS Build Profiles

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "ios": { "resourceClass": "m1-medium" },
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

**Always test with `preview` profile on real devices before `production` build.**

---

## App Store Rejection Causes (from E1C)

1. **Non-functional features** — Apple reviewers test every visible button. Remove or hide incomplete features (E1C #3)
2. **iPad blank screen** — If `supportsTablet: true`, you must support iPad. Either implement responsive design or set `supportsTablet: false` (E1C #1)
3. **Missing Apple Sign-In** — If you offer ANY third-party OAuth (Google, GitHub), Apple requires Apple Sign-In too

---

## Native Dependencies

**Always use `npx expo install`** for native packages:
```bash
npx expo install react-native-screens  # Installs SDK-compatible version
```

Never `npm install` React Native libraries — Expo SDK pins specific versions (E1C #5).

**Check compatibility:** Run `npx expo-doctor` before every EAS build.

---

## Monorepo + Metro

Extend Expo's default `watchFolders`, never replace:

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const monorepoRoot = path.resolve(__dirname, '../..');

config.watchFolders = [...(config.watchFolders || []), monorepoRoot];
// NOT: config.watchFolders = [monorepoRoot];  ← breaks expo-doctor
```

For pnpm monorepos, add `shamefully-hoist=true` to `.npmrc` (ARC #10).

---

## OAuth on Mobile

### Platform differences

| | iOS | Android | Web |
|---|---|---|---|
| Client ID | iOS-specific | Web client ID | Web client ID |
| Redirect URI | Reversed client ID scheme | Custom scheme | Standard URL |
| Secret needed | No (PKCE only) | No (PKCE only) | Yes (PKCE + secret) |

### iOS redirect URI (the tricky one)

Google OAuth on iOS requires a reversed domain URL scheme:
- Client ID: `192957...apps.googleusercontent.com`
- URL scheme: `com.googleusercontent.apps.192957...`

```javascript
// app.config.js
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const reversed = iosClientId.match(/^(.+)\.apps\.googleusercontent\.com$/);
const reversedScheme = reversed ? `com.googleusercontent.apps.${reversed[1]}` : null;

module.exports = ({ config }) => ({
  ...config,
  scheme: ['myapp', reversedScheme].filter(Boolean),
});
```

### Token refresh buffer

Always use a 5-minute buffer when checking token expiry (GYLR2 #3):
```typescript
function isTokenExpired(tokens: AuthTokens): boolean {
  const BUFFER_MS = 5 * 60 * 1000;
  return Date.now() >= tokens.expiresAt - BUFFER_MS;
}
```

---

## Push Notifications

**Expo Go doesn't support notifications** — wrap in try-catch (E1C #4):
```typescript
try {
  Notifications.setNotificationHandler({ /* ... */ });
} catch {
  // Not supported in Expo Go
}
```

**Deactivate stale tokens** server-side (E1C #10):
```typescript
if (ticket.details?.error === 'DeviceNotRegistered') {
  await db.pushTokens.update({ active: false }).where({ id: token.id });
}
```

---

## Supabase on Mobile

- Session persistence requires AsyncStorage adapter
- `detectSessionInUrl: false` for mobile (no URL session tokens)
- `autoRefreshToken: true` handles JWT refresh
- **Supabase free tier pauses after 1 week** — upgrade before launch (E1C #9)

### RLS gotchas

Complex cross-table RLS policies can cause infinite recursion (E1C #6). Use `SECURITY DEFINER` functions:
```sql
CREATE FUNCTION is_owner(resource_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM resources WHERE id = resource_id AND owner_id = auth.uid());
$$;
```

---

## Cache Invalidation with React Query

Every mutation must invalidate affected query keys (E1C #8):
```typescript
// After mutation:
queryClient.invalidateQueries({ queryKey: ['watchlists', 'mine'] });
refreshProfile();  // If mutation affects user profile
```

Never use unscoped `queryClient.invalidateQueries()` — it causes a thundering herd.

---

## Checklist

- [ ] Test on `preview` profile with real devices before `production` build
- [ ] iPad either supported properly or `supportsTablet: false`
- [ ] Apple Sign-In included if any other OAuth is offered
- [ ] Native deps installed via `npx expo install`
- [ ] `npx expo-doctor` passes
- [ ] Metro config extends (not replaces) default `watchFolders`
- [ ] OAuth redirect URIs correct per platform
- [ ] Token refresh uses 5-minute buffer
- [ ] Push notification setup wrapped in try-catch for Expo Go
- [ ] Stale push tokens deactivated on `DeviceNotRegistered`
- [ ] Supabase on paid plan before production launch
- [ ] React Query cache invalidated after every mutation
- [ ] `EXPO_PUBLIC_*` vars don't contain paid API keys
