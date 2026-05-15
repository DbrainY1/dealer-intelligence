"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UserMenu({
  email,
  role,
}: {
  email: string;
  role: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    setOpen(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out error:", error);
      alert("Sign out failed");
      setSigningOut(false);
      return;
    }
    router.push("/");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-gray-300 hover:text-white px-3 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate max-w-[200px]">{email}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-800 bg-gray-900 shadow-lg py-2 z-50"
        >
          <div
            className="px-4 py-1.5 text-xs text-gray-500 truncate"
            title={email}
          >
            {email}
          </div>
          <div className="px-4 py-1.5 text-xs text-gray-500">
            Role: {role ?? "—"}
          </div>
          <div className="my-1.5 border-t border-gray-800" />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            role="menuitem"
            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {signingOut ? "Signing out…" : "Sign Out"}
          </button>
        </div>
      )}
    </div>
  );
}
