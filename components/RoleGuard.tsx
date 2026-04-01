import { createServerSupabase } from "@/lib/supabase-server";

interface RoleGuardProps {
  roles: string[];
  children: React.ReactNode;
}

export default async function RoleGuard({ roles, children }: RoleGuardProps) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <div className="text-red-400 p-4">Not authorized</div>;

  const { data: userRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!userRole || !roles.includes(userRole.role)) {
    return <div className="text-red-400 p-4">Not authorized</div>;
  }

  return <>{children}</>;
}
