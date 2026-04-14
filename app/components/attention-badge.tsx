"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export function AttentionBadge() {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    async function fetchCount() {
      try {
        const res = await fetch("/api/attention");
        const data = await res.json();
        if (mounted.current && typeof data.total === "number") {
          setCount(data.total);
        }
      } catch {
        // Ignore
      }
    }

    fetchCount();

    function handleVisibility() {
      if (document.visibilityState === "visible") fetchCount();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

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
