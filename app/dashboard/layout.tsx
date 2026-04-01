import TopNav from "@/components/TopNav";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950">
      <TopNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
