import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";
import NavLinks from "./NavLinks";
import UserMenu from "./UserMenu";

export default async function TopNav() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    role = data?.role ?? null;
  }

  return (
    <header className="sticky top-0 z-40 bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-blue-400 font-bold text-lg tracking-tight">
          DealerIQ
        </Link>
        <NavLinks role={role} />
      </div>
      {user?.email && <UserMenu email={user.email} role={role} />}
    </header>
  );
}
