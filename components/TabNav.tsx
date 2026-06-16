"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "overview & models", hint: "reference benchmark" },
  { href: "/demo", label: "demo runs", hint: "run agents live" },
  { href: "/benchmark", label: "benchmarking", hint: "compare models" },
];

export default function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="tabnav">
      <div className="tabnav-inner">
        {TABS.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`tab ${active ? "active" : ""}`}
            >
              <span className="tab-label">{t.label}</span>
              <span className="tab-hint">{t.hint}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
