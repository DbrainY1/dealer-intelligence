"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Market Intel", exact: true },
  { href: "/dashboard/competitors", label: "Market Pulse" },
  { href: "/dashboard/compare", label: "Compare" },
  { href: "/dashboard/locations", label: "Locations" },
];

export default function NavLinks({ role }: { role: string | null }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-4 text-sm">
      {links.map(({ href, label, exact }) => (
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
      {role === "developer" && (
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
    </nav>
  );
}
