import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import ActivityBeacon from "@/components/ActivityBeacon";
import { requireOwnerPage } from "@/lib/authz-server";
import type { ReactNode } from "react";

// Outside /dashboard on purpose: owner access does not depend on a DealerIQ
// role. The layout checks ownership (non-owners get a 404), and the page
// checks again before loading any data.
export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  await requireOwnerPage();
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <TopNav />
      <ActivityBeacon />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
