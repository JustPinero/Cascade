export type DeadlineUrgency = "none" | "normal" | "urgent" | "overdue";

/**
 * Format a deadline as a human-readable countdown.
 */
export function formatCountdown(deadline: Date | null): string | null {
  if (!deadline) return null;

  const diffMs = new Date(deadline).getTime() - Date.now();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "due today";
  if (diffDays > 0) return `${diffDays}d left`;
  return `${Math.abs(diffDays)}d overdue`;
}

/**
 * Check if a deadline has passed.
 */
export function isOverdue(deadline: Date | null): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

/**
 * Get urgency level for a deadline.
 */
export function getDeadlineUrgency(deadline: Date | null): DeadlineUrgency {
  if (!deadline) return "none";
  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - Date.now();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);

  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "urgent";
  return "normal";
}
