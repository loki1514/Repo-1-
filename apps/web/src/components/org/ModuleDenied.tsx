import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Shown when a member opens a screen their role is not configured for.
 *
 * Named as a configuration outcome, not a failure: nothing has gone wrong, the
 * organization simply has not given this role this module. Saying which
 * module, and who can change it, is the difference between a dead end and a
 * one-message fix.
 */
export function ModuleDenied({
  title,
  roleName,
}: {
  title: string;
  roleName: string;
}) {
  return (
    <div className="glass mt-8 rounded-[var(--r-xl)] p-8 text-center">
      <div className="relative z-10 mx-auto max-w-sm">
        <Lock size={24} strokeWidth={2} style={{ color: "var(--warn)" }} className="mx-auto" />
        <h1 className="t-h3 mt-4">{title} is switched off for your role</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Your organization has not given <strong>{roleName.replace("_", " ")}</strong> access
          to this screen. An admin can change that from the workflow builder or the
          permissions matrix — it takes a moment and applies immediately.
        </p>
        <Link
          href="/org"
          className="press glass-inset mt-5 inline-flex h-10 items-center rounded-[12px] px-4 text-[13.5px] font-bold"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
