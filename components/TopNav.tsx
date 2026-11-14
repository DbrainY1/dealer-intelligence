import Link from "next/link";
import { getAuthContext, getIsPlatformOwner } from "@/lib/authz-server";
import NavLinks from "./NavLinks";
import UserMenu from "./UserMenu";

// Server component. The owner link is rendered here — never in the client
// NavLinks bundle — so its label and route reach only Platform Owners' HTML.
// `current` lets the Super Admin layout highlight it (no client pathname needed).
export default async function TopNav({ current }: { current?: "super-admin" } = {}) {
  const { email, role } = await getAuthContext();
  const isOwner = await getIsPlatformOwner();

  return (
    <header className="sticky top-0 z-40 bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-blue-400 font-bold text-lg tracking-tight">
          DealerIQ
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <NavLinks role={role} />
          {isOwner && (
            <Link
              href="/super-admin"
              aria-current={current === "super-admin" ? "page" : undefined}
              className={`transition-colors pb-0.5 ${
                current === "super-admin"
                  ? "text-amber-300 font-bold border-b-2 border-amber-300"
                  : "text-amber-400/80 hover:text-amber-300 border-b-2 border-transparent"
              }`}
            >
              Super Admin
            </Link>
          )}
        </div>
      </div>
      {email && <UserMenu email={email} role={role} />}
    </header>
  );
}
