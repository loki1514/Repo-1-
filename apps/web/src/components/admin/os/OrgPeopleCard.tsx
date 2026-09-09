"use client";

import { useState } from "react";
import { LoaderCircle, TriangleAlert, UserCog } from "lucide-react";
import { setOrgUserRoleAction } from "@/app/admin/organizations/[id]/os-actions";
import { haptic } from "@/lib/haptics";

type Person = {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  role_id: string | null;
  role_name: string | null;
};

/**
 * Day 2 §5 and §6, and FR-04 — the people attached to this organization and
 * the organization-scoped role each of them holds. The role list is the
 * fifteen from the taxonomy, not the five restaurant operating roles.
 */
export function OrgPeopleCard({
  organizationId,
  people,
  roles,
}: {
  organizationId: string;
  people: Person[];
  roles: { id: string; name: string; slug: string }[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(userRowId: string, roleId: string) {
    haptic("medium");
    setPending(userRowId);
    setError(null);
    const res = await setOrgUserRoleAction(organizationId, userRowId, roleId);
    setPending(null);
    if (!res.ok) setError(res.error);
    else haptic("success");
  }

  return (
    <div className="glass rounded-[var(--r-xl)] p-5">
      <div className="relative z-10">
        <div className="flex items-baseline gap-2">
          <UserCog size={15} className="translate-y-[2px] text-[var(--lime-deep)]" />
          <h2 className="t-h3">People &amp; roles</h2>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          Who belongs to this organization, and what each of them is allowed to do.
          Use Invite links above to add someone new.
        </p>

        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--danger)]">
            <TriangleAlert size={14} /> {error}
          </p>
        )}

        {people.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-muted">
            Nobody yet. The organization admin is created with the organization; everyone
            else joins through an invite link.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {people.map((p) => (
              <div
                key={p.id}
                className="glass-inset flex flex-wrap items-center gap-3 rounded-[13px] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold">{p.full_name ?? p.email}</p>
                  <p className="text-[12px] text-muted">{p.email}</p>
                </div>
                <span className="rounded-full bg-[rgb(18_21_15_/_0.07)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  {p.status}
                </span>
                <select
                  value={p.role_id ?? ""}
                  disabled={pending === p.id}
                  onChange={(e) => change(p.id, e.target.value)}
                  className="glass-inset h-9 rounded-[10px] px-2.5 text-[12.5px] outline-none"
                >
                  <option value="">No role</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {pending === p.id && <LoaderCircle size={14} className="animate-spin text-muted" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
