"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isDealerIqRole } from "@/lib/authz";

const links = [
  { href: "/dashboard", label: "Market Intel", exact: true },
  { href: "/dashboard/market", label: "The Market" },
  { href: "/dashboard/competitors", label: "Market Pulse" },
  { href: "/dashboard/compare", label: "Compare" },
  { href: "/dashboard/locations", label: "Locations" },
];

export default function NavLinks({ role, isOwner = false }: { role: string | null; isOwner?: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const hasRole = isDealerIqRole(role);
  // No DealerIQ role and not an owner → no links (the pages would deny access anyway).
  if (!hasRole && !isOwner) return null;

  return (
    <nav className="flex items-center gap-4 text-sm">
      {hasRole && links.map(({ href, label, exact }) => (
        <Link
          key={href}
          href={href}
          className={`transition-colors pb-0.5 ${
            isActive(href, exact)
              ? "text-white font-bold border-b-2 border-white"
              : "text-gray-400 hover:text-white border-b-2 border-transparent"
          }`}
        >
          {label}
        </Link>
      ))}
      {hasRole && role === "developer" && (
        <Link
          href="/dashboard/settings"
          className={`transition-colors pb-0.5 ${
            isActive("/dashboard/settings")
              ? "text-white font-bold border-b-2 border-white"
              : "text-gray-400 hover:text-white border-b-2 border-transparent"
          }`}
        >
          Settings
        </Link>
      )}
      {/* Shown only to Platform Owners (server-verified). The page and its APIs
          enforce ownership themselves; hiding the link is not the control. */}
      {isOwner && (
        <Link
          href="/super-admin"
          className={`transition-colors pb-0.5 ${
            isActive("/super-admin")
              ? "text-amber-300 font-bold border-b-2 border-amber-300"
              : "text-amber-400/80 hover:text-amber-300 border-b-2 border-transparent"
          }`}
        >
          Super Admin
        </Link>
      )}
    </nav>
  );
}
