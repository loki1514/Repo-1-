"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Braces,
  History,
  Plus,
  SquarePen,
  TriangleAlert,
  X,
} from "lucide-react";
import type { OrgWorkflow } from "@/lib/tenant";
import { setWorkflowActiveAction } from "@/app/admin/workflows/actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { fromTenantDefinition } from "./definition";
import { EdgeList, FlowPreview } from "./FlowPreview";
import { WorkflowEditor, type EditorTarget } from "./WorkflowEditor";
import { ApplyToOrg } from "./ApplyToOrg";
import type { ModuleInput, RoleAccess } from "./canvas/nodeKinds";

const MODULE_BADGE: Record<string, { bg: string; fg: string }> = {
  orders: { bg: "rgb(180 238 42 / 0.16)", fg: "var(--lime-deep)" },
  pos: { bg: "rgb(88 140 255 / 0.14)", fg: "#3b6fe0" },
  kds_kot: { bg: "rgb(242 169 59 / 0.14)", fg: "var(--warn)" },
  inventory: { bg: "rgb(150 120 220 / 0.14)", fg: "#7a5cc0" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActiveToggle({ workflow }: { workflow: OrgWorkflow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const active = optimistic ?? workflow.is_active;

  function toggle() {
    haptic("medium");
    const next = !active;
    setOptimistic(next);
    setError(null);
    startTransition(async () => {
      const res = await setWorkflowActiveAction(workflow.id, next);
      if (!res.ok) {
        setOptimistic(null);
        setError(res.error ?? "Failed to update.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${active ? "Deactivate" : "Activate"} ${workflow.name}`}
        onClick={toggle}
        disabled={pending}
        className={cn(
          "press relative h-6 w-11 shrink-0 rounded-full transition-colors",
          active ? "bg-[var(--lime-deep)]" : "bg-[rgb(18_21_15_/_0.16)]",
          pending && "opacity-60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            active ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
      <span
        className={cn(
          "text-[11px] font-extrabold uppercase tracking-wide",
          active ? "text-[var(--lime-deep)]" : "text-muted",
        )}
      >
        {pending ? "…" : active ? "Active" : "Off"}
      </span>
      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--danger)]">
          <TriangleAlert size={11} /> {error}
        </span>
      )}
    </div>
  );
}

function VersionsDrawer({
  groupKey,
  versions,
  onClose,
}: {
  groupKey: string;
  versions: OrgWorkflow[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[rgb(18_21_15_/_0.45)] backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="glass absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Version history for ${groupKey}`}
      >
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="t-h2">Versions</h2>
              <p className="tnum mt-1 text-[13px] font-bold text-muted">
                {groupKey}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close versions"
              className="press glass-inset flex h-9 w-9 items-center justify-center rounded-[11px] text-muted hover:text-ink"
            >
              <X size={16} strokeWidth={2.6} />
            </button>
          </div>

          <ol className="mt-5 space-y-3">
            {versions.map((v) => (
              <li key={v.id} className="glass-inset rounded-[var(--r-lg)] p-4">
                <div className="flex items-center gap-2">
                  <span className="tnum text-[15px] font-extrabold">
                    v{v.version}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                      v.is_active
                        ? "bg-[rgb(180_238_42_/_0.18)] text-[var(--lime-deep)]"
                        : "bg-[rgb(18_21_15_/_0.06)] text-muted",
                    )}
                  >
                    {v.is_active ? "Active" : "Inactive"}
                  </span>
                  <span className="ml-auto t-small text-muted">
                    {formatDate(v.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] font-semibold text-ink-2">
                  {v.name}
                  <span className="ml-2 t-small font-normal text-muted">
                    {v.definition?.nodes?.length ?? 0} nodes ·{" "}
                    {v.definition?.edges?.length ?? 0} edges
                  </span>
                </p>
                <details className="mt-2">
                  <summary className="press inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-bold text-muted hover:text-ink">
                    <Braces size={12} strokeWidth={2.6} />
                    View definition (read-only)
                  </summary>
                  <pre className="glass-inset tnum mt-2 max-h-72 overflow-auto rounded-[11px] p-3 text-[11.5px] leading-relaxed">
                    {JSON.stringify(v.definition, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

export function WorkflowsManager({
  templates,
  organizationId = null,
  scopeLabel = "All organizations",
  roles = [],
  modules = [],
  roleAccess = [],
}: {
  templates: OrgWorkflow[];
  /** null = editing platform templates; a uuid = editing one org's workflows. */
  organizationId?: string | null;
  scopeLabel?: string;
  roles?: { slug: string; name: string }[];
  modules?: ModuleInput[];
  roleAccess?: RoleAccess[];
}) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);

  // Group every version by key; the card shows the newest one.
  const groups = useMemo(() => {
    const map = new Map<string, OrgWorkflow[]>();
    for (const t of templates) {
      const list = map.get(t.key) ?? [];
      list.push(t);
      map.set(t.key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.version - a.version);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [templates]);

  const existingKeys = useMemo(() => groups.map(([k]) => k), [groups]);

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="lime"
          size="md"
          feedback="medium"
          onClick={() => setEditor({ mode: "create" })}
        >
          <Plus size={15} strokeWidth={3} />
          New template
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="glass rounded-[var(--r-xl)] p-8 text-center">
          <p className="relative z-10 text-[15px] font-semibold text-muted">
            No workflow templates yet — create the first one.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map(([groupKey, versions]) => {
            const latest = versions[0];
            const badge = MODULE_BADGE[latest.module] ?? {
              bg: "rgb(18 21 15 / 0.06)",
              fg: "var(--ink)",
            };
            // DB rows use the tenant shape ({id, type, data:{label}}) — the
            // seeded qr_ordering template even uses a flat {label} style.
            // Normalize to the editor shape for preview + editing.
            const definition = fromTenantDefinition(latest.definition);
            return (
              <article
                key={groupKey}
                className="glass rounded-[var(--r-xl)] p-5"
              >
                <div className="relative z-10">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[16px] font-extrabold">
                        {latest.name}
                      </h2>
                      <p className="tnum truncate text-[12px] text-muted">
                        {groupKey}
                      </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <span
                        className="rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {latest.module}
                      </span>
                      <span className="tnum rounded-full border border-[var(--line-strong)] px-2.5 py-1 text-[10.5px] font-extrabold">
                        v{latest.version}
                      </span>
                    </div>
                  </div>

                  <div className="glass-inset mt-4 rounded-[var(--r-lg)] p-3.5">
                    <FlowPreview definition={definition} />
                    <div className="mt-2.5 border-t border-[var(--line-strong)] pt-2.5">
                      <EdgeList definition={definition} />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <ActiveToggle workflow={latest} />
                    <span className="t-small text-muted">
                      {definition?.nodes?.length ?? 0} nodes ·{" "}
                      {definition?.edges?.length ?? 0} edges ·{" "}
                      {versions.length} version{versions.length === 1 ? "" : "s"}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVersionsFor(groupKey)}
                      >
                        <History size={13} strokeWidth={2.6} />
                        Versions
                      </Button>
                      {organizationId && (
                        <ApplyToOrg
                          organizationId={organizationId}
                          scopeLabel={scopeLabel}
                          definition={definition}
                          workflowName={latest.name}
                        />
                      )}
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={() =>
                          setEditor({
                            mode: "edit",
                            id: latest.id,
                            key: groupKey,
                            name: latest.name,
                            module: latest.module,
                            definition,
                          })
                        }
                      >
                        <SquarePen size={13} strokeWidth={2.6} />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editor && (
        <WorkflowEditor
          target={editor}
          existingKeys={existingKeys}
          onClose={() => setEditor(null)}
          organizationId={organizationId}
          scopeLabel={scopeLabel}
          roles={roles}
          modules={modules}
          roleAccess={roleAccess}
        />
      )}

      {versionsFor && (
        <VersionsDrawer
          groupKey={versionsFor}
          versions={groups.find(([k]) => k === versionsFor)?.[1] ?? []}
          onClose={() => setVersionsFor(null)}
        />
      )}
    </>
  );
}
