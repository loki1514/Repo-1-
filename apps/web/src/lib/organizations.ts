import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { slugify } from "@/lib/slug";
import { generatePassword } from "@/lib/password";

export type OrgType = "franchise" | "investor";
export type OrgStatus = "onboarding" | "active" | "suspended";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  type: OrgType;
  status: OrgStatus;
  legal_name: string | null;
  gstin: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source_lead_id: string | null;
  onboarding_stage: string | null;
  created_at: string;
};

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, slug, type, status, legal_name, gstin, contact_email, contact_phone, source_lead_id, onboarding_stage, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listOrganizations: ${error.message}`);
  return data ?? [];
}

/**
 * Which leads have already become an organization, and which one — the org
 * row is the proof, so there is no mirrored "converted" flag on leads to
 * keep in sync.
 */
export async function listConvertedOrgsByLead(): Promise<
  Map<string, { id: string; name: string; slug: string }>
> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, slug, source_lead_id")
    .not("source_lead_id", "is", null);
  if (error) throw new Error(`listConvertedOrgsByLead: ${error.message}`);

  const byLead = new Map<string, { id: string; name: string; slug: string }>();
  for (const r of data ?? []) {
    byLead.set(r.source_lead_id as string, { id: r.id, name: r.name, slug: r.slug });
  }
  return byLead;
}

export async function getOrganization(id: string): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, slug, type, status, legal_name, gstin, contact_email, contact_phone, source_lead_id, onboarding_stage, created_at, theme",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getOrganization: ${error.message}`);
  return data;
}

export type OrgAdmin = {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
};

export async function getOrgAdmin(organizationId: string): Promise<OrgAdmin | null> {
  const { data, error } = await supabaseAdmin
    .from("org_users")
    .select("id, user_id, email, created_at, roles!inner(slug)")
    .eq("organization_id", organizationId)
    .eq("roles.slug", "org_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getOrgAdmin: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    user_id: data.user_id,
    email: data.email,
    created_at: data.created_at,
  };
}

/** Overwrites the admin's Supabase Auth password. Shown once, same as at creation. */
export async function regenerateAdminPassword(
  organizationId: string,
): Promise<{ email: string; password: string }> {
  const admin = await getOrgAdmin(organizationId);
  if (!admin) throw new Error("This organization has no admin login yet.");

  const password = generatePassword();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(admin.user_id, {
    password,
  });

  if (error) throw new Error(`regenerateAdminPassword: ${error.message}`);
  return { email: admin.email, password };
}

export type CreateOrganizationInput = {
  name: string;
  type: OrgType;
  legalName?: string;
  gstin?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Mandatory — every organization gets one admin login at creation time. */
  adminEmail: string;
  adminPassword: string;
  /** Set when this org is built from a won deal — touchpoint 3 -> 4. */
  sourceLeadId?: string | null;
};

export type CreatedOrganization = {
  organization: Organization;
  admin: { email: string; password: string };
};

async function insertOrganizationRow(
  input: CreateOrganizationInput,
): Promise<Organization> {
  const name = input.name.trim();
  const baseSlug = slugify(name);

  // Slugs are unique; retry with a numeric suffix on collision rather than
  // failing the whole create for something the user doesn't control.
  let slug = baseSlug;
  for (let attempt = 0; attempt < 25; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .insert({
        name,
        slug,
        type: input.type,
        legal_name: input.legalName?.trim() || null,
        gstin: input.gstin?.trim().toUpperCase() || null,
        contact_email: input.contactEmail?.trim() || null,
        contact_phone: input.contactPhone?.trim() || null,
        source_lead_id: input.sourceLeadId || null,
      })
      .select(
        "id, name, slug, type, status, legal_name, gstin, contact_email, contact_phone, source_lead_id, onboarding_stage, created_at",
      )
      .single();

    if (!error) return data;

    // Unique violation on the slug — try the next suffix.
    if (error.code === "23505" && error.message.includes("slug")) {
      slug = `${baseSlug}-${attempt + 2}`;
      continue;
    }

    // Unique violation on source_lead_id — this lead already became an organization.
    if (error.code === "23505" && error.message.includes("source_lead_id")) {
      throw new Error("createOrganization: This lead has already been converted to an organization.");
    }

    throw new Error(`createOrganization: ${error.message}`);
  }

  throw new Error("Could not find an available slug. Try a different name.");
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required.");

  const baseSlug = slugify(name);
  if (!baseSlug) throw new Error("Organization name must contain letters or numbers.");

  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!adminEmail) throw new Error("An admin email is required.");
  if (!input.adminPassword || input.adminPassword.length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  const organization = await insertOrganizationRow(input);

  // Auth user + membership come after the org row exists, so a failure here
  // leaves an onboarding organization with no admin yet — visible and
  // recoverable — rather than an orphaned auth user with no organization.
  const { data: authUser, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: input.adminPassword,
      email_confirm: true,
      user_metadata: { organization_id: organization.id, role: "org_admin" },
    });

  if (authError || !authUser.user) {
    throw new Error(
      `Organization "${organization.name}" was created, but the admin login could not be. ` +
        `${authError?.message ?? "Unknown error"} — add an admin from the organization page.`,
    );
  }

  const { data: role } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("slug", "org_admin")
    .single();

  const { error: membershipError } = await supabaseAdmin
    .from("org_users")
    .insert({
      organization_id: organization.id,
      user_id: authUser.user.id,
      role_id: role!.id,
      email: adminEmail,
    });

  if (membershipError) {
    throw new Error(
      `Organization "${organization.name}" and its admin login were created, ` +
        `but linking them failed: ${membershipError.message}`,
    );
  }

  return {
    organization,
    admin: { email: adminEmail, password: input.adminPassword },
  };
}
