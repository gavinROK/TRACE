"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A minimal link between TRACE's two products — the original
 * developer-intelligence org graph ("/") and the infrastructure
 * control plane ("/infra") — so neither is orphaned behind a bookmark. */
export function NavBadge() {
  const pathname = usePathname();
  const onInfra = pathname?.startsWith("/infra");

  return (
    <Link
      href={onInfra ? "/" : "/infra"}
      className="fixed bottom-2 right-2 z-50 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200"
    >
      {onInfra ? "← Developer Intelligence" : "Infrastructure →"}
    </Link>
  );
}
