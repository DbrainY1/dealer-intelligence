import TopNav from "@/components/TopNav";
import ActivityBeacon from "@/components/ActivityBeacon";
import { AccessDenied, denyUnlessRole } from "@/components/RoleGuard";
import { DEALERIQ_ROLES } from "@/lib/authz";
import type { ReactNode } from "react";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Defense in depth: accounts in the shared Supabase project without a
  // DealerIQ role (e.g. other apps' users) see nothing under /dashboard. Each
  // page and API route still performs its own check.
  const denied = await denyUnlessRole(DEALERIQ_ROLES);

  return (
    <div className="min-h-screen bg-gray-950">
      <TopNav />
      <main className="flex-1">
        {denied ? (
          <AccessDenied message="Your account doesn't have DealerIQ access yet. If you were just invited, ask your DealerIQ administrator to confirm your access." />
        ) : (
          <>
            <ActivityBeacon />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
