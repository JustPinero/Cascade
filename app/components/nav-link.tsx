"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  tooltip?: string;
}

export function NavLink({ href, label, icon, tooltip }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      title={tooltip}
      className={`
        group flex items-center gap-3 px-3 py-2.5 text-sm font-medium
        transition-all duration-150 border-l-2
        ${
          isActive
            ? "border-cyan text-text-bright bg-cyan/8"
            : "border-transparent text-text hover:text-text-bright hover:border-cyan-dim hover:bg-space-600/50"
        }
      `}
    >
      <span
        className={`w-5 h-5 flex-shrink-0 ${isActive ? "text-cyan" : "text-text group-hover:text-cyan-dim"}`}
      >
        {icon}
      </span>
      <span className="sidebar-label">{label}</span>
    </Link>
  );
}
