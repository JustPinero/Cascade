"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export function AttentionBadge() {
  const [count, setCount] = useState(0);
  const countRef = { current: setCount };

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/attention");
      const data = await res.json();
      if (typeof data.total === "number") countRef.current(data.total);
    } catch {
      // Ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCount();
    function handleVisibility() {
      if (document.visibilityState === "visible") fetchCount();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchCount]);

  if (count === 0) return null;

  return (
    <Link
      href="/tasks"
      className="flex items-center justify-center min-w-[20px] h-[20px] px-1.5 text-[10px] font-mono font-bold bg-danger/20 text-danger border border-danger/40 rounded-full pulse-warning"
      title={`${count} item${count > 1 ? "s" : ""} need your attention`}
    >
      {count}
    </Link>
  );
}
