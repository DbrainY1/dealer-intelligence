import Link from "next/link";
import BreadcrumbNav from "./BreadcrumbNav";

interface SidebarProps {
  title: string;
  backHref?: string;
  crumbs?: { label: string; href?: string }[];
}

export default function Sidebar({ title, backHref, crumbs }: SidebarProps) {
  return (
    <aside className="bg-gray-900 border-r border-gray-800 w-56 min-h-full p-4 flex flex-col gap-4">
      {backHref && (
        <Link
          href={backHref}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          ← Back
        </Link>
      )}
      <h2 className="text-white font-semibold text-base">{title}</h2>
      {crumbs && <BreadcrumbNav crumbs={crumbs} />}
    </aside>
  );
}
