import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz-server";
import { decideAccess, type DealerIqRole } from "@/lib/authz";

interface RoleGuardProps {
  roles: readonly DealerIqRole[];
  children: React.ReactNode;
}

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="p-6">
      <div className="max-w-lg bg-gray-900 border border-gray-800 rounded-xl px-6 py-5">
        <h1 className="text-white text-base font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-gray-400 text-sm mt-1">
          {message ?? "Your account isn't authorized for this area of DealerIQ. If you think this is a mistake, contact your DealerIQ administrator."}
        </p>
      </div>
    </div>
  );
}

// Early-return form for pages that load data before rendering:
//   const denied = await denyUnlessRole(DEALERIQ_ROLES);
//   if (denied) return denied;
// Redirects to login when there is no session.
export async function denyUnlessRole(roles: readonly DealerIqRole[]): Promise<React.ReactElement | null> {
  const decision = decideAccess(await getAuthContext(), roles);
  if (decision === "unauthenticated") redirect("/");
  return decision === "forbidden" ? <AccessDenied /> : null;
}

export default async function RoleGuard({ roles, children }: RoleGuardProps) {
  const denied = await denyUnlessRole(roles);
  return denied ?? <>{children}</>;
}
