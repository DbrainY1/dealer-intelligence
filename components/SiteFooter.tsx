import Link from "next/link";
import { getAuthContext, getIsPlatformOwner } from "@/lib/authz-server";
import { isDealerIqRole } from "@/lib/authz";
import { buildFooterModel, type FooterLink, type FooterModel } from "@/lib/footer";
import { pacificDateStr } from "@/lib/dates";

// Site footer for signed-in areas. Server component: role and owner status
// come from the verified session (shared, per-request cached lookups), so
// owner-only links never reach other users' HTML. In normal page flow — never
// fixed — so it cannot cover tables, maps or sticky controls.

const FOCUS =
  "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950";

function Item({ link }: { link: FooterLink }) {
  if (!link.href) {
    return (
      <span aria-disabled="true" className="text-gray-600 cursor-not-allowed">
        {link.label}
        {link.unavailableNote && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-gray-700">{link.unavailableNote}</span>}
      </span>
    );
  }
  const cls = `text-gray-400 hover:text-white transition-colors ${FOCUS}`;
  return link.href.startsWith("mailto:") ? (
    <a href={link.href} className={cls}>{link.label}</a>
  ) : (
    <Link href={link.href} className={cls}>{link.label}</Link>
  );
}

export default async function SiteFooter() {
  const { role } = await getAuthContext();
  const model = buildFooterModel({
    hasDealerIqRole: isDealerIqRole(role),
    isOwner: await getIsPlatformOwner(),
    year: Number(pacificDateStr().slice(0, 4)),
    build: { sha: process.env.VERCEL_GIT_COMMIT_SHA, env: process.env.VERCEL_ENV },
  });

  return <FooterView model={model} />;
}

// Presentation only — also used by tests/previews with a supplied model.
export function FooterView({ model }: { model: FooterModel }) {
  return (
    <footer className="mt-12 border-t border-gray-800 bg-gray-950">
      <div className="max-w-[1600px] px-6 py-8 grid grid-cols-2 gap-8 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 md:col-span-1 space-y-2">
          <p className="text-blue-400 font-bold text-lg tracking-tight">{model.productName}</p>
          <p className="text-gray-500 text-sm">{model.description}</p>
        </div>
        {model.columns.map((col) => (
          <nav key={col.title} aria-label={`Footer: ${col.title}`}>
            <h2 className={`text-xs font-semibold uppercase tracking-wider ${col.title === "Platform oversight" ? "text-amber-400" : "text-gray-500"}`}>
              {col.title}
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((l) => (
                <li key={l.label}><Item link={l} /></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-gray-900">
        <div className="max-w-[1600px] px-6 py-4 flex flex-col sm:flex-row sm:justify-between gap-1 text-xs text-gray-600">
          <p>{model.copyright}</p>
          {model.buildLabel && <p className="font-mono">{model.buildLabel}</p>}
        </div>
      </div>
    </footer>
  );
}
