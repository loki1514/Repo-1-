"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  createOrganization,
  regenerateAdminPassword,
  type OrgType,
} from "@/lib/organizations";
import { createInvite } from "@/lib/invites";
import { generatePassword } from "@/lib/password";
import { convertLeadToOrganization } from "@/lib/os/orchestrator";

export type CreateOrgState = {
  ok: boolean;
  error: string | null;
  /** Present only right after a successful create — shown once, never stored client-side. */
  created: {
    orgName: string;
    adminEmail: string;
    adminPassword: string;
    organizationId: string | null;
    /** What the OS did on its own after the org existed. Empty for a manual create. */
    cascade: string[];
  } | null;
};

export async function createOrganizationAction(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  try {
    await requirePlatformAdmin();

    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "") as OrgType;
    const legalName = String(formData.get("legalName") ?? "");
    const gstin = String(formData.get("gstin") ?? "");
    const contactEmail = String(formData.get("contactEmail") ?? "");
    const contactPhone = String(formData.get("contactPhone") ?? "");
    const adminEmail = String(formData.get("adminEmail") ?? "").trim();
    const sourceLeadId = String(formData.get("sourceLeadId") ?? "").trim() || null;

    if (!name) return { ok: false, error: "Organization name is required.", created: null };
    if (type !== "franchise" && type !== "investor") {
      return { ok: false, error: "Choose an organization type.", created: null };
    }
    if (!adminEmail) {
      return { ok: false, error: "An admin email is required.", created: null };
    }

    const adminPassword = generatePassword();

    // A conversion is not a create. When this org comes from a won deal the
    // orchestrator owns it: requirements, handoff, first work item, signals
    // and timeline all follow from one press of this button.
    if (sourceLeadId) {
      const admin = await requirePlatformAdmin();
      const result = await convertLeadToOrganization({
        leadId: sourceLeadId,
        name,
        type,
        adminEmail,
        adminPassword,
        contactEmail,
        contactPhone,
        legalName,
        gstin,
        actor: admin.id,
      });

      revalidatePath("/admin/organizations");
      revalidatePath("/admin");
      revalidatePath("/admin/growth");
      revalidatePath(`/admin/organizations/${result.organizationId}`);

      return {
        ok: true,
        error: null,
        created: {
          orgName: result.organizationName,
          adminEmail: result.adminEmail,
          adminPassword: result.adminPassword,
          organizationId: result.organizationId,
          cascade: result.cascade,
        },
      };
    }

    const { organization, admin } = await createOrganization({
      name,
      type,
      legalName,
      gstin,
      contactEmail,
      contactPhone,
      adminEmail,
      adminPassword,
      sourceLeadId,
    });

    revalidatePath("/admin/organizations");
    revalidatePath("/admin");

    return {
      ok: true,
      error: null,
      created: {
        orgName: organization.name,
        adminEmail: admin.email,
        adminPassword: admin.password,
        organizationId: organization.id,
        cascade: [],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    const clean = message.replace(/^createOrganization:\s*/, "");
    return { ok: false, error: clean, created: null };
  }
}

export type RegenerateState = {
  ok: boolean;
  error: string | null;
  credentials: { email: string; password: string } | null;
};

export async function regeneratePasswordAction(
  organizationId: string,
  _prev: RegenerateState,
): Promise<RegenerateState> {
  try {
    await requirePlatformAdmin();
    const credentials = await regenerateAdminPassword(organizationId);
    return { ok: true, error: null, credentials };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message.replace(/^regenerateAdminPassword:\s*/, ""), credentials: null };
  }
}

export type InviteState = {
  ok: boolean;
  error: string | null;
  /** Absolute signup URL — shown once in the UI for copying. */
  url: string | null;
};

export async function createInviteAction(
  organizationId: string,
  roleId: string,
  _prev: InviteState,
): Promise<InviteState> {
  try {
    const admin = await requirePlatformAdmin();

    if (!roleId) return { ok: false, error: "Choose a role first.", url: null };

    const { token } = await createInvite(organizationId, roleId, admin.email);

    const host = (await headers()).get("host") ?? "";
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    const url = `${proto}://${host}/invite/${token}`;

    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true, error: null, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message.replace(/^createInvite:\s*/, ""), url: null };
  }
}
