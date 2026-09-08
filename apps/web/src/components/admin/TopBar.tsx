"use client";

import { Bell, LogOut, Search } from "lucide-react";
import { haptic } from "@/lib/haptics";

export function TopBar({
  email,
  name,
  role,
}: {
  email: string;
  name?: string;
  role?: string;
}) {
  const initials = (name ?? email)
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 -mx-4 mb-7 bg-[linear-gradient(180deg,var(--canvas)_0%,var(--canvas)_78%,transparent_100%)] px-4 pb-5 pt-4 md:-mx-6 md:px-6">
      <div className="glass flex items-center gap-3 rounded-[20px] p-2.5">
        <div className="relative z-10 flex flex-1 items-center gap-2.5">
          <label className="glass-inset flex h-10 flex-1 items-center gap-2.5 rounded-[13px] px-3.5 sm:max-w-sm">
            <Search size={15} className="shrink-0 text-muted" />
            <input
              type="search"
              placeholder="Search organizations, users, locations…"
              aria-label="Search"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted/75"
            />
          </label>
        </div>

        <div className="relative z-10 flex items-center gap-2">
          <button
            aria-label="Notifications"
            onPointerDown={() => haptic("light")}
            className="press relative inline-flex h-10 w-10 items-center justify-center rounded-[13px] text-muted hover:bg-[rgb(18_21_15_/_0.06)] hover:text-ink"
          >
            <Bell size={17} />
            <span
              className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full ring-2"
              style={{
                background: "var(--danger)",
                // @ts-expect-error -- CSS custom property is valid here
                "--tw-ring-color": "var(--canvas)",
              }}
            />
          </button>

          <div className="mx-0.5 hidden h-7 w-px bg-[var(--line)] sm:block" />

          <div className="flex items-center gap-2.5 pr-1">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold"
              style={{
                background: "#14170f",
                color: "var(--lime)",
              }}
            >
              {initials}
            </span>
            <span className="hidden leading-tight lg:block">
              <span className="block text-[13px] font-bold">
                {name ?? "Super Admin"}
              </span>
              <span className="block max-w-[190px] truncate text-[11.5px] text-muted">
                {role ? `${role} · ${email}` : email}
              </span>
            </span>
          </div>

          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              onPointerDown={() => haptic("light")}
              className="press inline-flex h-10 w-10 items-center justify-center rounded-[13px] text-muted hover:bg-[rgb(226_86_75_/_0.1)] hover:text-[var(--danger)]"
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
