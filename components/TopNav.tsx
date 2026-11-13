import Link from "next/link";
import { getAuthContext, getIsPlatformOwner } from "@/lib/authz-server";
import NavLinks from "./NavLinks";
import UserMenu from "./UserMenu";

export default async function TopNav() {
  const { email, role } = await getAuthContext();
  const isOwner = await getIsPlatformOwner();

  return (
    <header className="sticky top-0 z-40 bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-blue-400 font-bold text-lg tracking-tight">
          DealerIQ
        </Link>
        <NavLinks role={role} isOwner={isOwner} />
      </div>
      {email && <UserMenu email={email} role={role} />}
    </header>
  );
}
