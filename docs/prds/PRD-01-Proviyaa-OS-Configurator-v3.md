# PRD-01 — Proviyaa OS Configurator (v3 additive revision)

**Status:** Build-ready after Phase 0 decisions  
**Audited implementation:** `loki1514/Repo-1-` @ `889c5c725c86bde5f1776f28c899e73935d60849`  
**Revision rule:** Existing PRD intent is retained. Sections labelled **Codex v3** are the additive corrections and take precedence where they conflict with the earlier draft.

## 0. Abstract — read this first

### What we are trying to achieve

Turn a sold restaurant account into a configured, auditable, deployable POS without creating a custom code fork for each client. Sales captures the need; Customer Success validates it; the Configurator selects an approved product preset, applies controlled per-client settings, previews the difference, publishes a version, and hands a device-safe configuration package to the POS.

### What is already figured out

- The ecosystem is multi-tenant and configuration-led.
- A product is built once, registered, packaged, subscribed, entitled, configured, and operated.
- The effective configuration must follow: platform default → market/region → plan → organization → location → role → user; the most-specific valid value wins.
- The current repository already implements organizations, locations, roles, module registry/toggles, versioned workflow definitions, workflow preview/apply, requirements, evidence, work items, handoffs, onboarding stages, and an atomic onboarding cascade.
- A restaurant POS surface, KOT/KDS surfaces, restaurant tables, orders, order items, payments and restaurant configuration tables already exist in the web MVP.

### What is not figured out and must be decided in Phase 0

- Whether the first device app is Flutter desktop, Flutter Android, or both.
- Whether synchronization is a small custom outbox API for the MVP or PowerSync from the start.
- Which Figma file/page/node is approved for each screen.
- The precise plan/pack/add-on catalogue and limits for the first sale.
- Device-loss policy and maximum permitted offline duration.

### Start and finish

**Start:** a paid/won deal and confirmed requirements exist for an organization.  
**Finish:** an approved immutable configuration version is published, a device is registered, the POS bootstraps its own SQLite database, the configuration checksum is acknowledged, and go-live evidence closes the onboarding chain.

### What this product is not

It is not a website builder, arbitrary low-code database designer, AI runtime orchestrator, source-code generator per customer, replacement for Commerce OS, or a mechanism for bypassing permissions. It must never allow a tenant to change core tables, tax/payment truth, mandatory order states, audit rules, tenant isolation or sync invariants.

## 1. Provenance and authority

| Label | Meaning |
|---|---|
| **Inherited — previous model** | Vision, module catalogue, market patterns, stack direction and broad control-plane scope from the earlier PRD. |
| **Verified — repository** | Behavior directly observed at the pinned commit above. |
| **Codex v3 — additive** | Boundaries, configurator lifecycle, deployable package, phase gates, handoffs, offline backfill and security corrections introduced here. |

When sources disagree, use this order:

1. Signed security/data ADRs and database migrations.
2. Versioned API/Event/Config schemas and automated contract tests.
3. This PRD for product behavior and scope.
4. Approved Figma nodes for layout, visual tokens and interaction states.
5. The three supplied ecosystem documents for product intent.
6. Existing code as the migration baseline—not automatically as the desired design.

Figma is the final source of truth for approved UI and interactions. It is not the authority for authorization, data ownership, accounting, order states, offline conflict policy or API payloads. Every implementation ticket must include a Figma URL/node ID or explicitly state `NO_FIGMA—PRD_ONLY`.

## 2. Source requirements carried into this PRD

- **Product Flow, “The most important development rule” and Phases 0–2:** build the complete architectural contracts once, activate capabilities by version, and freeze IDs, tenancy, permissions, APIs, events and configuration before feature expansion.
- **Product Architecture, §§2–3, 8–10:** Master governs organizations, subscriptions, features, configuration, workflows, permissions, releases and audit; actual access derives from plan/pack/add-on/market/business type/role.
- **viyaa routes, §§3–5:** a feature proceeds through register → version → test/beta → publish → price/eligibility → subscription → entitlement → activation → configuration → production.
- **Product Architecture, “Five Master Truths”:** Store and Restaurant use shared Commerce and Inventory truths; AI recommends but does not become the source of truth.

These are restated here so Hermes does not need to infer the ecosystem contract from another repo.

## 3. Current repository baseline

| Capability | Evidence at audited commit | Decision |
|---|---|---|
| OS work engine | `0016_os_kernel.sql`: work items, activities, handoffs, requirements, notifications, onboarding stage | Preserve |
| Evidence and gates | `0018_os_hardening.sql`, `lib/os/orchestrator.ts` | Preserve and extend |
| Workflow versions | `org_workflows`, workflow actions create a new version | Preserve |
| Module/role preview | `lib/workflow-apply.ts::planFromWorkflow` | Preserve |
| Apply workflow | Server rebuilds the plan and applies module/role changes | Harden |
| Requirement clarification | `decideRequirement` routes a real task back to Sales | Preserve |
| Location and role setup | Organization OS actions | Preserve |
| Deployable config package | No immutable published package/checksum/device acknowledgement found | Build |
| Entitlement-to-config enforcement | Module toggles exist; full commercial binding not proven | Build |
| Device registration/bootstrap | Not found | Build |
| Rollback/approval separation | Not proven | Build |
| Offline delivery | Not present in current Next.js configurator | Build |

Important correction: the current workflow canvas configures module visibility and role access. It is not yet the complete client configurator.

## 4. Product boundary and ownership

### OS Configurator owns

- Requirement disposition: configuration, training, process change, product gap, development issue or deferred.
- Approved presets and configuration inheritance.
- Organization/location/role overrides.
- Entitlement validation before activation.
- Preview, validation, approval, publish, rollback and audit.
- Device registration and delivery of a signed/versioned bootstrap manifest.
- Handoff evidence from Sales → Onboarding → Customer Success → Operations.

### Other systems own

- **Commerce OS:** orders, payments, refunds, customers and settlements.
- **Restaurant POS:** local SQLite runtime, order capture, KOT and device sync.
- **Identity:** authentication, session and membership.
- **Figma:** approved visual composition and interaction.
- **Hermes:** implementation workflow only; it is not production orchestration.
- **NotebookLM:** requirements/context retrieval only; it is not transactional truth.

## 5. Technical architecture tree

```text
Proviyaa OS
├── Sales and onboarding kernel [existing]
│   ├── requirements / requirement_events
│   ├── work_items / work_evidence
│   ├── handoffs / activities
│   └── onboarding_stage
├── Commercial control [partly existing / verify]
│   ├── plans / packs / add-ons
│   ├── subscriptions
│   └── entitlement snapshot
├── Configurator [extend]
│   ├── preset catalogue
│   ├── inheritance resolver
│   ├── workflow + module + role editor
│   ├── preview and validation
│   ├── approval and immutable publish
│   └── rollback
├── Device control [new]
│   ├── device registration
│   ├── bootstrap token
│   ├── config manifest + checksum
│   └── acknowledgement / revoke
└── Contracts [new]
    ├── config.schema.json
    ├── OpenAPI
    ├── event schemas
    └── compatibility tests
```

## 6. Configurator lifecycle

1. **Capture:** Sales attaches source wording and promises to the organization.
2. **Validate:** Customer Success confirms/rejects each requirement or routes clarification back to Sales.
3. **Classify:** each confirmed requirement becomes configuration, training, process, product gap or development issue.
4. **Entitle:** resolve the paid plan/pack/add-ons into an immutable entitlement snapshot.
5. **Preset:** select `restaurant_quick_service`, `restaurant_table_service` or another approved preset; do not start from a blank canvas in V1.
6. **Override:** apply organization, location and role settings within the permitted schema.
7. **Preview:** show effective values, source layer, module/role changes, validation failures, and the previous-vs-next diff.
8. **Approve:** Customer Success approves business correctness; a separate platform role approves production publication.
9. **Publish:** create an immutable `config_version` with schema version, entitlement snapshot, content hash, author, approvals and timestamp.
10. **Deliver:** register a POS device and issue a one-time bootstrap token.
11. **Acknowledge:** device downloads its scoped manifest, validates signature/schema, creates or migrates local SQLite, applies seed/config data and reports checksum.
12. **Go live:** evidence confirms menu, printer/KOT, user roles, offline sale, reconnection and sync; onboarding becomes active.

### Configurable in V1

Modules, navigation visibility, branding and approved glass tokens, menu/tables/kitchen stations, printer routing, bill settings, order channels, role permissions, workflow templates, location settings, limits and integration enablement.

### Never configurable

Tenant IDs, RLS, schema definitions, payment finality, audit deletion, core order state invariants, event/idempotency keys, encryption, sync conflict rules, executable SQL/JavaScript, arbitrary external URLs, or service-role credentials.

## 7. Configuration contract

A published manifest must contain:

```json
{
  "config_version_id": "uuid",
  "schema_version": 1,
  "organization_id": "uuid",
  "location_id": "uuid",
  "device_id": "uuid",
  "entitlement_snapshot_id": "uuid",
  "effective": {
    "modules": {},
    "roles": {},
    "restaurant": {},
    "theme": {}
  },
  "issued_at": "RFC3339",
  "expires_at": "RFC3339",
  "content_sha256": "hex",
  "signature": "server-signature"
}
```

The device may cache the last valid manifest. Expiry must not destroy an active offline bill; it blocks privileged/newly prohibited actions according to the agreed offline policy and reconciles on connection.

## 8. API and event handoffs

| Producer → Consumer | Contract | Required behavior |
|---|---|---|
| Sales → OS | `POST /v1/orgs/{id}/requirements` | Preserve source wording and author |
| OS → Commerce/Apps | `GET /v1/orgs/{id}/entitlements/effective` | Server-side enforcement; UI hiding alone is insufficient |
| Configurator → Reviewer | `POST /v1/config-drafts/{id}/validate` | Return errors, warnings and effective diff |
| Approver → Config service | `POST /v1/config-drafts/{id}/publish` | Idempotency key; immutable result |
| POS → Device service | `POST /v1/devices/bootstrap` | One-time token; scoped org/location/device |
| Device service → POS | `GET /v1/devices/{id}/manifest` | ETag/hash/signature; only entitled fields |
| POS → OS | `POST /v1/devices/{id}/ack` | Report config/schema/checksum and health |
| Config service → ecosystem | `config.version.published.v1` | Outbox event with correlation and causation IDs |
| OS → ecosystem | `organization.access.changed.v1` | Suspension/entitlement change; auditable |
| POS → OS | `device.sync.health.v1` | Lag, last upload/download, local schema version |

All commands require authentication, authorization, `organization_id`, `location_id` where applicable, idempotency key, correlation ID, schema version and audit actor.

## 9. Phase plan and gates

| Phase | Build | Exit gate |
|---|---|---|
| 0 — Freeze | Figma links, product boundaries, schema/API/event IDs, device target, sync choice | ADRs approved; unresolved items have owners |
| 1 — Secure baseline | Replace fail-open module behavior; action permissions; eliminate unsafe service-role paths | Cross-tenant and privilege tests pass |
| 2 — Draft/preview | Presets, inheritance, entitlement resolver, effective diff | Same inputs produce deterministic output |
| 3 — Publish | approvals, immutable version, hash/signature, rollback | Published config cannot be mutated |
| 4 — Device bootstrap | registration, one-time token, scoped manifest, ack/revoke | Clean device reaches ready state without manual DB copying |
| 5 — POS integration | SQLite migration/seed/config application and config refresh | Offline sale works with cached valid config |
| 6 — Figma conformance | map every built state to approved node; accessibility/glass review | Design delta register is empty or approved |
| 7 — Live handoff | training/readiness evidence and support ownership | Organization active with rollback runbook |

## 10. Glass UI rule

Use glass only for non-critical shells, overlays and hierarchy where the approved Figma explicitly shows it. POS totals, payment, KOT priority, destructive actions, offline/sync health and accessibility-critical text require opaque/high-contrast surfaces. Provide reduced-transparency and reduced-motion fallbacks. Visual tokens are configurable; interaction safety is not.

## 11. Hermes roles and handoffs

Hermes runs these roles sequentially; each role consumes committed artifacts and produces a reviewable handoff.

| Role | Input | Output / handoff |
|---|---|---|
| Source custodian | Three source docs + this PRD | Requirement IDs and traceability matrix |
| Repo auditor | Pinned commit | Preserve/repair/build matrix; no assumed features |
| Figma reconciler | Approved nodes + route list | Screen-state/delta register |
| Contract architect | Decisions and ownership | OpenAPI, events, config schema and ADRs |
| DB/security engineer | Contracts | Migrations, RLS/policies, threat tests |
| Configurator engineer | Schemas + Figma | Draft/preview/publish/device flows |
| Integration engineer | Versioned contracts | POS bootstrap and acknowledgement |
| QA/release reviewer | All evidence | Gate report, rollback test and release manifest |

No role may hand off uncommitted schema changes or undocumented payloads. A handoff includes commit SHA, changed contracts, migration version, test evidence, Figma nodes, known risks and rollback.

## 12. Acceptance criteria

- A client is configured without cloning source code or copying another client’s data.
- Entitlements constrain configuration and runtime access.
- Preview shows the exact effective diff and its inheritance source.
- Publish is immutable, approved, auditable and reversible.
- A clean POS device creates its own local SQLite database from migrations and downloads only scoped seed/config data.
- A revoked/suspended org cannot gain access by stale UI state.
- Offline billing remains operational within the approved offline window; reconnect is idempotent.
- Every release can be traced to source requirement, PRD rule, Figma node, API/schema version, commit and test evidence.

## 13. Deferred

Arbitrary tenant-authored workflows, AI-generated executable configurations, cross-repo automatic deployment, advanced usage billing, full UI/UX studio and customer-specific source forks are deferred until the fixed presets and publication pipeline are proven.
