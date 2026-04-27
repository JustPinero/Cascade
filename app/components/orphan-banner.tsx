import Link from "next/link";

interface OrphanBannerProps {
  count: number;
}

export function OrphanBanner({ count }: OrphanBannerProps) {
  if (count === 0) return null;

  return (
    <div
      data-testid="orphan-banner"
      className="mb-4 flex items-center gap-3 border border-warning/60 bg-warning/5 px-4 py-3 text-sm font-mono"
    >
      <span className="text-warning">⚠</span>
      <span className="text-space-200">
        {count} project{count !== 1 ? "s" : ""} in database with no on-disk path.
      </span>
      <Link
        href="/migrate"
        className="ml-auto text-accent hover:underline whitespace-nowrap"
      >
        Repair now →
      </Link>
    </div>
  );
}
