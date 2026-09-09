"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { markAllReadAction, markReadAction } from "@/app/admin/inbox/actions";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

type Note = {
  id: string;
  team: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function InboxList({ notifications }: { notifications: Note[] }) {
  const [read, setRead] = useState<Set<string>>(new Set());
  const isRead = (n: Note) => Boolean(n.read_at) || read.has(n.id);
  const unread = notifications.filter((n) => !isRead(n)).length;

  return (
    <div className="glass rounded-[var(--r-xl)] p-4">
      <div className="relative z-10">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-[14px] font-extrabold">
            <Bell size={13} /> Signals
          </h2>
          <span className="tnum rounded-full bg-[rgb(18_21_15_/_0.08)] px-1.5 py-0.5 text-[10.5px] font-extrabold">
            {unread}
          </span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={async () => {
                haptic("light");
                setRead(new Set(notifications.map((n) => n.id)));
                await markAllReadAction();
              }}
            >
              <Check size={13} strokeWidth={2.8} /> Mark all read
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="t-small mt-3 py-4 text-center text-muted">Nothing addressed to you.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {notifications.map((n) => {
              const body = (
                <>
                  <p className={cn("text-[13.5px]", isRead(n) ? "font-semibold text-muted" : "font-bold")}>
                    {n.title}
                  </p>
                  {n.body && <p className="text-[12.5px] text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">
                    {n.team ? n.team.replace(/_/g, " ") : "you"} ·{" "}
                    {new Date(n.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </>
              );
              const cls = cn(
                "glass-inset block rounded-[12px] p-3",
                !isRead(n) && "shadow-[inset_2px_0_0_0_var(--lime-deep)]",
              );
              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  className={cn(cls, "press")}
                  onClick={() => {
                    setRead((p) => new Set(p).add(n.id));
                    void markReadAction(n.id);
                  }}
                >
                  {body}
                </Link>
              ) : (
                <div key={n.id} className={cls}>{body}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
