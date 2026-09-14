# PRD-03 — VINII Restaurant POS (v3 additive, offline-first)

**Status:** Build-ready after Phase 0 decisions  
**Audited implementation:** `loki1514/Repo-1-` @ `889c5c725c86bde5f1776f28c899e73935d60849`  
**Revision rule:** This does not discard the earlier Restaurant PRD. It retains its feature intent and adds the boundaries, actual-code baseline, local-first architecture, configurator handoff, Figma process, phase gates and security work needed to reach an implementation score of at least 8.5/10.

## 0. Abstract — read this first

### What we are trying to achieve

Build one dependable restaurant POS that completes a sale while the internet is unavailable, routes the order to KOT/KDS, records payment, and later synchronizes safely with the existing Supabase Postgres system. The same product is installed for every restaurant; each installation creates its own local SQLite database and receives only that organization/location’s data and published configuration. We do not clone the codebase or copy a populated database per client.

### What is already figured out

- Supabase Postgres remains the online system of record and existing database evolution continues through additive migrations.
- SQLite is the POS device’s operational database; MySQL is not part of this design.
- The audited web MVP already has POS, KOT/KDS, menu, table, order, order-item, payment and restaurant-operation foundations.
- The OS already has organizations, locations, roles, module toggles, versioned workflows, onboarding work/evidence and handoffs.
- Restaurant inventory must use the shared Inventory architecture rather than a separate restaurant inventory engine.
- Approved Figma designs define the intended screen layout, interaction and visual states.
- The first slice is local sale → KOT → payment → reconnect → cloud acknowledgement, not every restaurant feature.

### What remains to be decided in Phase 0

- First supported device: Windows desktop, Android tablet, or both.
- Flutter database library and packaging target.
- Custom outbox sync versus PowerSync. The MVP recommendation is a small explicit outbox API if one-device/offline scope is limited; adopt PowerSync only after a spike proves multi-device conflict and deployment needs.
- Printer protocol/hardware and whether printing is required for the first demo.
- Exact conflict ownership for menu availability and order edits.
- Maximum offline duration and local session policy.
- Approved Figma node IDs for every V1 screen/state.

### Start and finish

**Start:** a registered device has a valid one-time bootstrap token and an approved OS configuration version.  
**Finish:** a cashier can authenticate locally, open a shift, create and modify an order, send a KOT, settle payment, restart the device without data loss, reconnect, upload each mutation exactly once, receive cloud acknowledgement, and show an auditable end-to-end order timeline.

### What this product is not

It is not a MySQL server on each device, separate cloud backend, client-specific source fork, marketplace, delivery dispatcher, accounting ledger, full Inventory OS, arbitrary workflow engine, AI source of truth, or unrestricted restaurant ERP. It does not own customer marketplace checkout, rider assignment, merchant settlement or platform subscriptions.

## 1. Provenance and authority

| Label | Meaning |
|---|---|
| **Inherited — previous model** | Broad feature list, benchmark patterns, general stack, security and ecosystem intent in the earlier PRD. |
| **Verified — repository** | Functionality directly observed at the pinned commit. |
| **Codex v3 — additive** | Offline architecture, boundaries, sync protocol, configurator contract, phase gates, Figma reconciliation and hardening requirements here. |

Authority order:

1. Signed security/data ADRs and Supabase/SQLite migrations.
2. Versioned API/event schemas plus contract tests.
3. This PRD for scope and product behavior.
4. Approved Figma nodes for layout, tokens, interactions and states.
5. The three supplied ecosystem documents for ecosystem intent.
6. Existing code as the baseline to preserve, repair, replace or defer.

Figma may change presentation and interactions. It may not silently change authorization, totals, payment finality, tenant/data ownership, offline conflict policy, order/KOT state invariants or payload schemas. Every UI ticket must cite a Figma URL/node ID or `NO_FIGMA—PRD_ONLY`.

## 2. Source requirements copied into the product context

- **Product Flow, Phase 5 — VINII Restaurant:** Restaurant dashboard, POS, tables, KOT, kitchen, menu/items, recipes, ingredients, inventory foundation, purchase, suppliers, wastage, reservations, orders, customers, promotions, price intelligence and reports must have architectural places; only the approved V1 slice is activated.
- **Product Flow, “The most important development rule”:** architecture is established once and capability is activated by version/feature flag rather than restructured later.
- **Product Architecture, “Five Master Truths”:** Restaurant and Store share Commerce OS, customer and payment truths; Restaurant inventory uses the common Inventory system.
- **viyaa routes, §9 — VINII POS:** Restaurant experience includes dashboard, POS, KOT, tables, dine-in, takeaway, delivery, menu/categories/modifiers, orders, customers, inventory, purchase, staff, CRM, loyalty, reports and settings.
- **Product Architecture, Master journey:** configure business → subscribe → create location/users/catalogue → sell → fulfil → deliver → settle → analyze.

These requirements are present for backfill awareness. They do not all become functional in the first offline release.

## 3. Honest current-code baseline

| Area | Verified implementation | Decision |
|---|---|---|
| Web POS | `/org/pos`, `PosScreen`, server actions and `lib/pos.ts` | Preserve as behavior/reference prototype |
| KOT/KDS | `/org/kot`, `/org/kds`, ticket states and restaurant migration | Preserve |
| Restaurant schema | `0010_restaurant_operations.sql`: dining areas/sessions, service requests, variants, stations, bill settings, payments, channel status, order events | Preserve and normalize contracts |
| Menu/tables/orders | Earlier migration plus typed queries/mutations | Preserve |
| Seed data | `scripts/seed-pos.mjs` | Development-only; never client provisioning |
| Tenant reads | Signed-in Supabase client and RLS | Preserve/harden |
| Mutations | Several helpers use `service_role` after checking only that a user exists | Repair before production |
| Module guard | KDS uses config-driven guard; POS still has hard-coded role checks | Replace with one action-level permission source |
| Guard failure | `checkModule` deliberately fails open if control-plane tables are missing | Replace with fail-closed in production |
| Local SQLite | Not present | Build |
| Outbox/inbox/sync | Not present | Build |
| Device registration/config acknowledgement | Not present | Build |
| Multi-device conflict behavior | Not present | Decide and build |

The current product is a cloud-connected Next.js MVP. “Offline-first POS” is a new runtime layer, not a description of what the repository already does.

## 4. Product boundary and ownership

### Restaurant POS owns

- Local cashier/device session within approved offline policy.
- Local menu/table/config projection.
- Draft/open order, line, modifier, discount request and KOT creation.
- Local payment capture record and print intent; online provider confirmation remains provider/cloud truth.
- Local outbox/inbox, sync status and repair UI.
- Restaurant views of order/KOT/table/shift state.
- Hardware adapters for printer/cash drawer when selected.

### It consumes

- Identity/membership and device grant from Identity/OS.
- Published configuration and entitlement snapshot from OS Configurator.
- Catalogue, canonical orders, customers and payments from Commerce OS.
- Shared stock/ingredient projections from Inventory OS.
- Fulfilment status from Fulfilment/Delivery.

### It does not own

- Subscription billing or feature sale.
- Marketplace cart/checkout.
- Rider dispatch/route/earnings.
- Merchant settlement ledger.
- Global customer master.
- Independent restaurant inventory truth.
- Free-form client code or schema customization.

## 5. Technical architecture tree

```text
Restaurant POS
├── Device application [new local-first target]
│   ├── Figma-driven presentation
│   ├── application commands
│   ├── domain rules
│   ├── SQLite repositories
│   ├── outbox / inbox / sync worker
│   ├── printer adapter
│   └── diagnostics and recovery
├── Local SQLite [new]
│   ├── schema_migrations
│   ├── device_state / config_cache
│   ├── menu / tables / users projection
│   ├── orders / order_lines / KOTs / payments
│   ├── outbox_events
│   └── inbox_receipts / sync_checkpoint
├── Cloud adapter [extend existing]
│   ├── authenticated command API
│   ├── idempotency registry
│   ├── transactional outbox
│   ├── sync cursor/download API
│   └── Supabase Postgres + RLS
└── External handoffs
    ├── OS Configurator / device control
    ├── Commerce OS
    ├── shared Inventory
    ├── fulfilment/delivery
    └── observability/audit
```

The UI must call application commands, not SQLite or Supabase directly. Domain code must not depend on Flutter widgets. Sync must not bypass the same server-side permission and business rules used online.

## 6. Local database replication model

SQLite is a file embedded in the application. For each installation:

1. The app creates a new empty file such as `vinii_pos.db`.
2. It runs numbered SQLite migrations bundled with that app version.
3. It stores a unique `device_id`.
4. After secure bootstrap, it downloads only the assigned organization/location’s menu, tables, roles and published configuration.
5. It creates local orders and outbox rows in one SQLite transaction.
6. It uploads pending commands when online and stores acknowledgements.
7. App upgrades run later migrations; they never copy another client’s live database.

Reusable artifacts are the migration files, seed/config import logic and tests—not a populated database file. A restaurant reinstall restores from the cloud plus any approved encrypted device backup, not from another customer template.

Minimum tables:

- `schema_migrations(version, applied_at)`
- `device_state(device_id, organization_id, location_id, config_version, last_cursor)`
- projections: `local_users`, `menu_categories`, `menu_items`, `modifier_groups`, `dining_tables`
- operations: `orders`, `order_lines`, `kot_tickets`, `payments`, `shifts`
- sync: `outbox_events(event_id, command_type, aggregate_id, payload, status, attempts, next_attempt_at, created_at)`
- `inbox_receipts(event_id, received_at)`
- `sync_conflicts(id, aggregate_type, aggregate_id, reason, local_payload, remote_payload, status)`

All primary/event IDs are generated on-device using UUIDv7/ULID. Never depend on a central sequential ID to create an offline order; human display numbers may be device-prefixed and reconciled separately.

## 7. Offline rules and conflicts

- Order creation/line changes/KOT creation are atomic with their outbox record.
- Upload uses idempotency key = local event ID. Server persists the command result and outbox event in one transaction.
- Retrying a command returns the original result; it does not duplicate orders, KOTs or payments.
- Server assigns a monotonically comparable sync cursor for downloads.
- Inbox processing is idempotent and transactional.
- **Orders already created locally:** device owns edits until submitted; after kitchen submission, only allowed state transitions/manager overrides apply.
- **Menu/price/tax/config:** cloud-published version wins for new orders. An open order retains its captured price/tax snapshot.
- **Payment:** never auto-merge competing payment finality. Duplicate/ambiguous payments enter reconciliation.
- **Deletion:** use tombstones; do not rely on hard delete syncing.
- **Clock:** never use device wall-clock alone for ordering events.
- If the device exceeds the approved offline window, it may finish open bills but blocks actions defined as online-required (refund, new privilege, config change).

## 8. Configurator handoff

The OS publishes an immutable, signed, device-scoped manifest containing modules, roles, restaurant settings, menu/table/kitchen projection version, theme/glass tokens and limits. POS validates schema, signature, org/location/device scope and entitlement before applying it.

| Configuration | Applies locally | Refresh behavior |
|---|---|---|
| Menu/table/station data | Yes | Cursor-based download |
| Role/action permissions | Yes, cached with expiry | Refresh on reconnect; sensitive actions online-only if stale |
| Printer routing | Yes | Apply after device capability validation |
| Bill/tax display | Yes | New orders only after version switch |
| Workflow template | Relevant decisions only | Server is authoritative for approvals |
| Theme/glass tokens | Yes | Never override contrast/safety fallback |
| Suspension | Cached policy + online event | Block new operations per agreed grace policy; preserve local evidence |

## 9. API and event handoffs

| Producer → Consumer | Contract | Required behavior |
|---|---|---|
| POS → Device API | `POST /v1/devices/bootstrap` | One-time scoped token; returns config and initial sync cursor |
| POS → Sync API | `POST /v1/sync/commands:batch` | Ordered local events, idempotency, partial result per event |
| Sync API → POS | `GET /v1/sync/changes?cursor=…` | Location-scoped changes and next cursor |
| POS → Commerce | `order.created.v1`, `order.submitted.v1` | Captured totals/config version/correlation |
| POS → Kitchen | `kot.created.v1` | Idempotent ticket and station routing |
| Kitchen → POS/Commerce | `kot.status.changed.v1` | Valid state transition only |
| POS → Payments | `payment.recorded.v1` | Method, amount, status; no card secret storage |
| Commerce → Fulfilment | `order.ready_for_fulfilment.v1` | Only after restaurant readiness rules |
| OS → POS | `config.version.published.v1` | Device fetches signed manifest |
| OS → POS | `organization.access.changed.v1` | Suspension/entitlement change |
| POS → OS | `device.sync.health.v1` | Lag, queue depth, last success, schema/config versions |

Every command/event includes `event_id`, `schema_version`, `organization_id`, `location_id`, `device_id`, `actor_id`, `occurred_at`, `correlation_id`, `causation_id` and payload. OpenAPI and JSON Schema live in a shared contracts package and are pinned by version in every repo.

## 10. Security corrections required before live use

- Replace “signed-in user + service_role mutation” with a server command that resolves membership, org/location scope and action permission before any privileged write.
- Ensure record IDs in updates are joined/checked against the resolved organization; never trust `organizationId` supplied by the client.
- Fail closed when module/permission tables are unavailable in production.
- Keep Supabase service-role keys server-only; never store them on POS devices.
- Store device credentials in OS secure storage; encrypt SQLite or sensitive fields where the target platform supports it.
- Do not store card PAN/CVV; use terminal/provider tokens.
- Rate-limit bootstrap/sync, rotate device credentials, support revoke and audit all overrides.
- Test cross-tenant reads/writes, mass assignment, replay, duplicate payment, clock skew, damaged DB, downgrade, lost device and prolonged offline behavior.
- Backups/restores and schema migrations must be tested before rollout.

## 11. Figma reconciliation and glass

Before each UI phase, the Figma reconciler produces a table: `route/screen → Figma node → PRD requirement → existing component → delta → decision`. No design drift is silently accepted. If Figma adds a behavior, update the PRD/contract first; if it changes only composition/tokens, update implementation and the delta register.

Glass is permitted for app chrome, non-critical cards and overlays only when approved in Figma. Use opaque/high-contrast surfaces for totals, payment, offline/sync warnings, KOT urgency, destructive actions and long-form text. Support reduced transparency/motion, keyboard focus, touch targets and sunlight/low-quality display conditions. Offline/sync health must be text plus icon/status—not color or translucency alone.

## 12. Phase plan

| Phase | Build | Exit gate |
|---|---|---|
| 0 — Freeze | Device target, Figma nodes, sync ADR, IDs/schemas, hardware and offline window | Decisions signed; contract skeleton committed |
| 1 — Secure cloud baseline | Tenant/action permissions, fail-closed guard, trusted totals/state rules | Cross-tenant and privilege suite passes |
| 2 — Local shell | Flutter/app shell, SQLite migrations, repositories, device identity, restart recovery | Clean install and upgrade tests pass |
| 3 — Offline sale | shift, menu/table, order/lines, captured totals, KOT, cash/UPI record, outbox | Full flow succeeds with network disabled |
| 4 — Sync | bootstrap, batch commands, idempotency, cursor downloads, tombstones, diagnostics | Disconnect/retry/restart causes zero duplicates/loss |
| 5 — Configurator | signed manifest, roles/modules/theme/printer settings, ack/revoke | Device matches published effective config |
| 6 — Figma/hardware | approved states, glass/accessibility, printer/cash drawer if selected | Visual/state matrix and hardware test pass |
| 7 — Ecosystem slice | Commerce audit timeline and fulfilment-ready handoff | One order traceable end-to-end |
| 8 — Pilot | backup/restore, telemetry, support/rollback, one restaurant pilot | Acceptance signed and rollback rehearsed |

Features from the full module catalogue not needed for this slice remain registered as `FOUNDATION`, `FEATURE_GATED` or `DEFERRED`; they are not dummy buttons in the billing workflow.

## 13. Hermes roles and handoffs

| Role | Input | Output |
|---|---|---|
| Source custodian | Three source docs + PRD | Requirement/ID traceability |
| Repo auditor | Pinned commit | Preserve/repair/build matrix |
| Figma reconciler | Approved Figma file | Screen/state delta register |
| Architecture lead | Decisions | ADRs, ownership and architecture tree |
| DB/sync engineer | ADRs/contracts | Supabase + SQLite migrations, OpenAPI/events |
| POS engineer | Figma + domain APIs | Offline application slice |
| Integration engineer | Contract versions | OS/Commerce/Kitchen/Fulfilment adapters |
| Security/QA reviewer | Build and threat model | Gate evidence, offline chaos and tenant tests |
| Release owner | All evidence | Version manifest, migration/rollback and pilot handoff |

Each handoff contains commit SHA, schema/API versions, migrations, Figma node IDs, tests, known risks, recovery steps and next owner. Hermes may coordinate these roles, but no agent invents a payload or silently edits a shared contract.

## 14. Acceptance criteria

- A clean installation creates SQLite by running versioned migrations; no MySQL and no copied customer DB.
- POS completes the defined sale/KOT/payment flow with the network physically disabled.
- Restart during each step loses no committed sale or outbox item.
- Reconnect/retry uploads each command exactly once from the business perspective.
- Cloud data is scoped to the correct organization/location and RLS/action tests reject cross-tenant access.
- Open orders retain their price/tax/config snapshot when cloud configuration changes.
- A published OS configuration is verified and acknowledged by the device.
- Figma screen/state coverage is complete and glass never reduces critical readability.
- The order can be traced across POS, KOT, Commerce and fulfilment using one correlation ID.
- Backup/restore, migration failure, device revocation and rollback are demonstrated.

## 15. Deferred and product gaps

Recipes/ingredient deduction, advanced inventory, purchasing/GRN, reservations, loyalty, aggregator integrations, advanced promotions, multi-device peer coordination, card-present hardware, AI recommendations and full delivery are deferred unless required for the pilot. Their IDs/contracts may be reserved, but they must not delay the offline sale slice.
