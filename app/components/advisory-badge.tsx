interface AdvisoryBadgeProps {
  hasAdvisory: boolean;
  isRead: boolean;
}

export function AdvisoryBadge({ hasAdvisory, isRead }: AdvisoryBadgeProps) {
  if (!hasAdvisory) return null;

  return (
    <span
      className={`text-[10px] font-mono px-1.5 py-0.5 border ${
        isRead
          ? "border-space-600 text-space-500"
          : "border-amber/40 text-amber pulse-warning"
      }`}
      title={isRead ? "Advisory read" : "Unread advisory"}
    >
      {isRead ? "ADV" : "ADV!"}
    </span>
  );
}
