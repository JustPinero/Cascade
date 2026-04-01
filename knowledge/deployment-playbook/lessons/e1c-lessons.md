# E1C (Every1's a Critic) — Deployment Lessons

## Stack
React Native + Expo SDK 54, Supabase (PostgreSQL, Auth, Storage, Edge Functions), EAS Build/Submit, TypeScript (strict), Apple Sign-In

---

## 1. iPad blank screen caused App Store rejection

### Symptom
App Store review team rejected the app — launched to an indefinite blank screen on iPad Air 11".

### Root Cause
Responsive layout wasn't implemented. Static `Dimensions.get('window')` values caused layout to fail on iPad aspect ratios. The app only worked on iPhone-sized screens.

### Fix
Initially disabled iPad support (`supportsTablet: false`), then re-enabled after implementing responsive design:
- `useResponsive` hook returns `isTablet` based on screen width
- `ContentContainer` component caps width at 960px on tablets
- Applied to 35+ screens and components

### Prevention
- **Either support tablets properly from the start or set `supportsTablet: false`**
- Test on iPad simulator before any App Store submission
- Apple reviewers test on all supported device classes

### Time to Diagnose
~2 hours (failed review, debug, disable, then redesign)

---

## 2. Metro config override breaks `expo-doctor` and EAS builds

### Symptom
EAS builds failed during health check initialization. `expo-doctor` reported Metro configuration errors.

### Root Cause
Monorepo Metro config replaced Expo's default `watchFolders` instead of extending them:
```javascript
// WRONG:
config.watchFolders = [monorepoRoot];
```

### Fix
Preserve defaults before adding:
```javascript
config.watchFolders = [...(config.watchFolders || []), monorepoRoot];
```

### Prevention
- **Never override Expo's Metro defaults — always spread existing values first**
- Run `npx expo-doctor` before every EAS build
- This is specific to monorepo Expo setups

### Time to Diagnose
~15 minutes

---

## 3. Broken Google Sign-In button causes App Store rejection

### Symptom
App Store review rejected the app because the Google Sign-In button was non-functional.

### Root Cause
Google OAuth integration was incomplete — the button existed but the flow wasn't wired up. Apple requires all visible features to work during review.

### Fix
Removed Google Sign-In entirely, kept only Apple Sign-In (which Apple requires if you offer any third-party OAuth).

### Prevention
- **Never ship a non-functional OAuth button** — Apple reviewers will test every visible feature
- Apple requires Apple Sign-In if you offer ANY other OAuth provider
- Remove incomplete features before submission, don't just hide them

### Time to Diagnose
~N/A (review feedback was clear)

---

## 4. `expo-notifications` crashes in Expo Go

### Symptom
App crashed during development when running in Expo Go. Stack trace pointed to `Notifications.setNotificationHandler()`.

### Root Cause
Expo Go doesn't fully support `expo-notifications`. The notification handler setup throws when native modules aren't available.

### Fix
Wrapped all notification setup in try-catch:
```typescript
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch {
  // expo-notifications not fully supported in Expo Go
}
```

### Prevention
- **Wrap optional native APIs in try-catch** when they need to work in Expo Go
- Test notifications on EAS development builds, not Expo Go
- Check `Constants.appOwnership` to detect Expo Go vs standalone

### Time to Diagnose
~5 minutes

---

## 5. `react-native-screens` version incompatible with Expo SDK

### Symptom
Build error — `react-native-screens` threw native module errors during EAS build.

### Root Cause
`react-native-screens@^4.23.0` was installed, but Expo SDK 54 requires `~4.16.0`. Expo SDK versions pin specific native dependency versions.

### Fix
Downgraded to the Expo-compatible version:
```bash
npx expo install react-native-screens
```

### Prevention
- **Always use `npx expo install` for native dependencies** — it installs the SDK-compatible version
- Never manually `npm install` React Native libraries in Expo projects
- Check `expo doctor` output for version mismatches

### Time to Diagnose
~5 minutes

---

## 6. Supabase RLS infinite recursion — queries hang forever

### Symptom
Database queries hung indefinitely. No error returned — the query just never completed.

### Root Cause
`watchlists` SELECT policy called `is_watchlist_member()` which queried `watchlist_members`, whose SELECT policy called `is_watchlist_owner()` which queried `watchlists` — circular reference.

### Fix
Used `SECURITY DEFINER` functions to break the cycle:
```sql
CREATE OR REPLACE FUNCTION public.is_watchlist_owner(wl_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.watchlists
    WHERE id = wl_id AND owner_id = auth.uid()
  );
$$;
```

### Prevention
- **Complex cross-table RLS policies MUST use `SECURITY DEFINER` functions** to bypass RLS on the underlying table
- Test RLS policies locally with `supabase db reset` before deploying
- Draw out RLS dependency graphs for tables that reference each other
- This is a Supabase-specific footgun — PostgreSQL RLS + Supabase auth creates these cycles easily

### Time to Diagnose
~45 minutes (silent hang, no error message)

---

## 7. Supabase Storage avatar upload RLS — wrong owner check

### Symptom
Users couldn't update their avatar. Upload returned a permissions error.

### Root Cause
RLS policy tried to parse user ID from the file path (`'avatars/' || auth.uid() || '/*'`), but Supabase Storage automatically sets the `owner_id` field on uploaded objects.

### Fix
Changed policy to use the auto-set `owner_id`:
```sql
CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND owner_id = auth.uid()::text);
```

### Prevention
- **Supabase Storage auto-manages `owner_id`** — use it instead of parsing paths
- Don't encode user IDs in file paths for authorization — that's fragile
- Test Storage RLS with the Supabase dashboard SQL editor before deploying

### Time to Diagnose
~15 minutes

---

## 8. Missing cache invalidation after mutations — stale UI data

### Symptom
After actions like rating a movie, purchasing a cosmetic, or marking a movie as watched, the UI showed stale data. Karma points didn't update. Purchased items didn't appear.

### Root Cause
Mutations called the API but didn't invalidate React Query cache keys. The UI continued displaying cached pre-mutation data.

### Fix
Added scoped cache invalidation after every mutation:
```typescript
// After marking watched:
queryClient.invalidateQueries({ queryKey: ['watchlists', 'mine'] });
refreshProfile();  // Updates karma display

// After creating rating:
queryClient.invalidateQueries({ queryKey: ['user-ratings-tmdb'] });
refreshProfile();
```

### Prevention
- **Every mutation must invalidate all affected query keys**
- Use scoped invalidation (`queryKey: ['specific', 'key']`), never unscoped `invalidateQueries()`
- Create a checklist of which mutations affect which queries
- Unscoped invalidation causes thundering herd on slow connections

### Time to Diagnose
~10 minutes per occurrence (multiple instances found)

---

## 9. Supabase free tier auto-pauses after 1 week of inactivity

### Symptom
Production app stopped working — all API calls returned errors. Supabase dashboard showed the project was "paused."

### Root Cause
Supabase's free tier automatically pauses projects after 1 week of inactivity. Once paused, the database is unreachable until manually unpaused.

### Fix
Upgraded to Supabase paid plan before production launch.

### Prevention
- **Upgrade Supabase to paid plan BEFORE any production deployment**
- Free tier is for development/prototyping only
- Add monitoring to catch if the project gets paused (e.g., health check alerts)

### Time to Diagnose
~2 minutes (dashboard was clear)

---

## 10. Push token deactivation — stale tokens waste API calls

### Symptom
Expo push notification sends were failing for some users. Server logs showed `DeviceNotRegistered` errors.

### Root Cause
Users uninstalled the app or revoked notification permissions, but their push tokens remained active in the database. Every notification attempt to stale tokens failed.

### Fix
Deactivate tokens that return `DeviceNotRegistered`:
```typescript
for (const ticket of tickets) {
  if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
    tokensToDeactivate.push(tokens[i].id);
  }
}
await supabase.from('push_tokens')
  .update({ active: false })
  .in('id', tokensToDeactivate);
```

### Prevention
- **Always deactivate push tokens that fail with `DeviceNotRegistered`**
- Check Expo push receipts for additional failure modes
- Periodically clean up inactive tokens

### Time to Diagnose
~10 minutes

---

# Summary

**Total issues found:** 10

**Top 3 most time-consuming to diagnose:**
1. **Supabase RLS infinite recursion** (~45 min) — silent hang with no error; required understanding the full RLS dependency graph
2. **iPad blank screen / App Store rejection** (~2 hours) — required implementing responsive design system across 35+ components
3. **Metro config override** (~15 min) — broke EAS builds, needed to understand Expo's default config structure

**Patterns identified:**
- **3 Supabase-specific issues** (#6, #7, #9) — RLS policies, Storage ownership, and free tier pausing are all Supabase-specific gotchas
- **2 App Store rejection issues** (#1, #3) — Apple reviewers test thoroughly; incomplete features and untested device classes cause rejections
- **2 Expo/React Native version issues** (#2, #5) — Expo SDK pins specific versions; always use `npx expo install`
- **1 cache invalidation issue** (#8) — React Query cache must be manually invalidated after mutations
- **1 push notification issue** (#10) — stale tokens accumulate; deactivate on failure
