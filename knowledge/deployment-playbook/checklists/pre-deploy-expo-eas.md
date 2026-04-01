# Pre-Deploy Checklist: Expo + EAS

## Before First Build
- [ ] Apple Developer Program enrolled ($99/year)
- [ ] Google Play Developer Program enrolled ($25 one-time)
- [ ] EAS project initialized: `eas init`
- [ ] `app.config.ts` has correct project ID and updates URL
- [ ] Bundle ID (iOS) and package name (Android) are unique

## Environment & Secrets
- [ ] No paid API keys in `EXPO_PUBLIC_*` variables (they're in the binary)
- [ ] Production secrets set via `eas secret:create`
- [ ] `.env.example` committed with all required variable names
- [ ] Signing credentials gitignored: `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `google-service-account.json`

## Native Dependencies
- [ ] All native deps installed via `npx expo install` (not `npm install`)
- [ ] `npx expo-doctor` passes
- [ ] `react-native-screens` version matches Expo SDK requirements
- [ ] Metro config extends (not replaces) default `watchFolders`
- [ ] pnpm monorepo: `shamefully-hoist=true` in `.npmrc`

## Auth
- [ ] Apple Sign-In included if any other OAuth is offered
- [ ] iOS OAuth redirect URI uses reversed client ID domain notation
- [ ] Platform-specific client IDs handled (`Platform.OS` branching)
- [ ] Token refresh uses 5-minute expiry buffer
- [ ] Session persisted in AsyncStorage (survives app kill)

## App Store Requirements
- [ ] iPad either properly supported or `supportsTablet: false`
- [ ] All visible features are functional (no placeholder buttons)
- [ ] Privacy policy URL configured
- [ ] App icon: 1024x1024 PNG, no transparency
- [ ] Screenshots for required device sizes
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption: false` (if HTTPS only)

## Push Notifications
- [ ] Notification setup wrapped in try-catch (Expo Go compatibility)
- [ ] Server deactivates tokens on `DeviceNotRegistered`
- [ ] Deep link payloads validated before navigation

## Backend
- [ ] Supabase on paid plan (free tier pauses after 1 week)
- [ ] RLS policies tested locally with `supabase db reset`
- [ ] No circular RLS policies (use `SECURITY DEFINER` functions)
- [ ] React Query cache invalidated after every mutation

## Testing
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Tested on `preview` build on real device
- [ ] Manually tested: offline mode, network errors, token expiry

## Build & Submit
```bash
# Preview (test on real devices first)
eas build --profile preview --platform all

# Production
eas build --profile production --platform all

# Submit
eas submit --platform ios --latest
eas submit --platform android --latest
```
