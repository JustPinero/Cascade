/**
 * Phase 18 — types + pure helpers for the dashboard's session-memory
 * panel. Lifted out of the React component so the logic is testable
 * under the existing node-environment vitest setup (no jsdom needed).
 */

export interface SessionMemoryState {
  activeFlow: string | null;
  workingMemory: Record<string, unknown>;
}

/**
 * The panel renders only when there's something to show — either an
 * activeFlow is set or workingMemory has at least one key. Used to
 * gate the JSX rendering in overseer-chat.tsx.
 */
export function hasSessionMemory(state: SessionMemoryState): boolean {
  return (
    state.activeFlow !== null ||
    Object.keys(state.workingMemory).length > 0
  );
}
