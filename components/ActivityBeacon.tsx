"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Reports which page is open so the Super Admin console can show presence and
// usage. Sends only the pathname — never the query string, fragment, form
// values or anything typed — and the server maps it to an allowlisted key.
//
// One "view" per navigation, plus a "heartbeat" every 2 minutes while the tab
// is visible (presence only; heartbeats never create activity rows). Failures
// are ignored: tracking must never affect the page.
const HEARTBEAT_MS = 2 * 60 * 1000;

function send(path: string, kind: "view" | "heartbeat") {
  fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, kind }),
    keepalive: true,
  }).catch(() => {});
}

export default function ActivityBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    send(pathname, "view");
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") send(pathname, "heartbeat");
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [pathname]);

  return null;
}
