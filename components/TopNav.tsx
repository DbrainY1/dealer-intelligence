import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";

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
    <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-blue-400 font-bold text-lg tracking-tight">
          DealerIQ
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors">
            Overview
          </Link>
          <Link href="/dashboard/competitors" className="text-gray-300 hover:text-white transition-colors">
            Competitors
          </Link>
          <Link href="/dashboard/compare" className="text-gray-300 hover:text-white transition-colors">
            Compare
          </Link>
          {role === "developer" && (
            <Link href="/dashboard/settings" className="text-gray-300 hover:text-white transition-colors">
              Settings
            </Link>
          )}
        </nav>
      </div>
      {user && (
        <div className="flex items-center gap-2">
          {role && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900 text-blue-300 font-medium">
              {role}
            </span>
          )}
          <span className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
            {user.email?.[0]?.toUpperCase() ?? "U"}
          </span>
        </div>
      )}
    </header>
  );
}
