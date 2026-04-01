# justinpinero.com Portfolio — Deployment & Build Lessons
**Project:** Static portfolio site (React 18 + TypeScript + Vite)
**Collected:** 2026-03-30
**Status:** Pre-deployment (issues caught during rebuild)

---

## 1. Vitest 4.x requires Vite 6+ — peer dependency mismatch

### Symptom
`pnpm add -D vitest` installed v4.1.2 which logged unmet peer dependency warnings:
```
✕ unmet peer vite@"^6.0.0 || ^7.0.0 || ^8.0.0": found 5.4.21
```

### Root Cause
Vitest 4.x dropped support for Vite 5. The latest `vitest` tag pulls v4 which is incompatible with Vite 5 projects.

### Fix
Pin to vitest v2 which supports Vite 5:
```bash
pnpm remove vitest && pnpm add -D vitest@^2
```

### Prevention
Always check peer dependency requirements before installing test frameworks. For Vite 5 projects, use `vitest@^2`. For Vite 6+, use `vitest@^4`.

### Stack
Vite 5.4, Vitest, pnpm

### Time to Diagnose
2 minutes

---

## 2. Vite config `test` property fails TypeScript without reference directive

### Symptom
```
vite.config.ts(7,3): error TS2769: No overload matches this call.
  Object literal may only specify known properties, and 'test' does not exist in type 'UserConfigExport'.
```

### Root Cause
Vitest extends Vite's config type, but TypeScript doesn't know about it unless explicitly told. The `test` property isn't part of Vite's own type definitions.

### Fix
Add the triple-slash reference directive at the top of `vite.config.ts`:
```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
```

### Prevention
Always add `/// <reference types="vitest" />` to vite.config.ts when using Vitest with Vite. This is a one-liner that's easy to forget.

### Stack
Vite 5, Vitest 2, TypeScript 5 (strict)

### Time to Diagnose
3 minutes

---

## 3. React 18 ref type incompatibility with `useRef<T>(null)`

### Symptom
```
error TS2322: Type 'RefObject<HTMLDivElement | null>' is not assignable to type 'LegacyRef<HTMLDivElement> | undefined'.
  Type 'RefObject<HTMLDivElement | null>' is not assignable to type 'RefObject<HTMLDivElement>'.
    Type 'HTMLDivElement | null' is not assignable to type 'HTMLDivElement'.
```

### Root Cause
In React 18's type definitions, `useRef<T>(null)` returns `MutableRefObject<T | null>`. When a custom hook returns this as `RefObject<T | null>`, it doesn't satisfy the JSX `ref` prop which expects `RefObject<T>` (without null in the generic). This is a long-standing React types quirk.

### Fix
Switch from returning a ref object to returning a **callback ref**:
```typescript
// Before (breaks):
function useScrollReveal<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // ...
  return ref;
}

// After (works):
function useScrollReveal<T extends HTMLElement>(): (node: T | null) => void {
  const callbackRef = useCallback((node: T | null) => {
    if (!node) return;
    // setup IntersectionObserver on node
  }, []);
  return callbackRef;
}
```

### Prevention
For custom hooks that return refs to be attached to JSX elements, always use the **callback ref pattern** instead of `useRef`. Callback refs are fully compatible with React 18's type system and also handle dynamic element mounting/unmounting better.

### Stack
React 18, TypeScript 5 (strict mode), @types/react 18.2

### Time to Diagnose
8 minutes (tried multiple approaches: `useRef<T | null>`, changing return type annotation, before landing on callback refs)

---

## 4. React hooks rules-of-hooks violation in `.map()` callbacks

### Symptom
ESLint error:
```
React Hook "useScrollReveal" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.
```

### Root Cause
Calling `useScrollReveal()` inside a `.map()` loop within a component violates the Rules of Hooks. Even though the array is static, ESLint (correctly) flags this because hooks must be called at the top level of a component.

### Fix
Extract the mapped item into its own component:
```typescript
// Before (breaks):
function Skills() {
  return skills.map((group, i) => {
    const ref = useScrollReveal({ staggerIndex: i }); // ❌ hook in callback
    return <div ref={ref}>...</div>;
  });
}

// After (works):
function SkillCard({ group, index }: Props) {
  const ref = useScrollReveal({ staggerIndex: index }); // ✅ hook in component
  return <div ref={ref}>...</div>;
}

function Skills() {
  return skills.map((group, i) => <SkillCard key={group.category} group={group} index={i} />);
}
```

### Prevention
Any time you need a hook per list item, extract a child component. This is a fundamental React pattern. Lint catches it, but it's faster to get it right from the start.

### Stack
React 18, ESLint, eslint-plugin-react-hooks

### Time to Diagnose
1 minute (lint error is clear)

---

## 5. Data layer migration breaks existing components with strict TypeScript

### Symptom
Multiple TypeScript errors when restructuring data files:
```
error TS2339: Property 'technologies' does not exist on type 'Project'.
error TS2339: Property 'phone' does not exist on type '{ email: string; location: string; }'.
```

### Root Cause
When migrating from a single `portfolioData.ts` to separate typed data files, the new interfaces used different field names (`tech` vs `technologies`, `role` vs `position`, `period` vs `duration`). Existing components imported the old types and accessed the old field names.

### Fix
Two approaches used:
1. **Bridge file** — `portfolioData.ts` re-exports from new data files with field name mapping (temporary, for components not yet rewritten)
2. **Direct fix** — Update component references to use new field names where the component was being rewritten anyway

### Prevention
When doing a phased data migration in strict TypeScript:
- Keep old interfaces alive via a bridge/adapter until all consumers are updated
- Or rename all consumers in the same commit as the type change
- Never change interface field names without grep-checking all usages first

### Stack
TypeScript 5 (strict), React 18

### Time to Diagnose
5 minutes

---

## 6. npm to pnpm migration — must delete package-lock.json

### Symptom
Not an error, but a hygiene issue. After switching from npm to pnpm, both `package-lock.json` and `pnpm-lock.yaml` existed in the repo.

### Root Cause
`pnpm install` creates its own lockfile but doesn't remove the npm one. Having both can confuse CI and other developers.

### Fix
```bash
rm package-lock.json
pnpm install
# commit only pnpm-lock.yaml
```

### Prevention
When switching package managers, always:
1. Delete the old lockfile
2. Delete `node_modules/`
3. Run fresh install with the new manager
4. Update CI to use the new manager
5. Update README commands

### Stack
npm, pnpm, CI/CD

### Time to Diagnose
0 minutes (proactive)

---

## 7. `pnpm test --run` fails — vitest doesn't accept args through pnpm script passthrough

### Symptom
```
ERROR  Unknown option: 'run'
```

### Root Cause
`pnpm test --run` doesn't pass `--run` to vitest correctly. The `test` script is defined as `"test": "vitest"` which runs in watch mode by default. The `--run` flag needs to be passed after `--`.

### Fix
Use `npx vitest run` directly in scripts/validate.sh instead of `pnpm test --run`:
```bash
# In validate.sh:
npx vitest run
```

### Prevention
For CI/validation scripts, call test runners directly via `npx` rather than through npm/pnpm script indirection. This avoids argument passthrough issues.

### Stack
Vitest, pnpm

### Time to Diagnose
1 minute

---

# Summary

**Total issues found:** 7

**Top 3 most time-consuming to diagnose:**
1. React 18 ref type incompatibility (8 min) — tried 3 approaches before callback refs
2. Data layer migration type breaks (5 min) — cascade of TS errors across multiple files
3. Vitest config type error (3 min) — non-obvious fix (triple-slash directive)

**Patterns:**
- **3 of 7 were TypeScript strict mode issues** (#2, #3, #5) — strict mode catches real bugs but increases friction during refactors. Worth it, but budget time for it.
- **2 of 7 were tooling version mismatches** (#1, #7) — always check peer deps and test CLI argument passthrough in scripts.
- **1 was a React patterns issue** (#4) — hooks-in-loops is a known footgun, always extract sub-components for mapped items with hooks.
