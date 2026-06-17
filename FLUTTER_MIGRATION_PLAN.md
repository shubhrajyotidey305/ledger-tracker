# Ledger Tracker → Production Flutter App — Architecture & Migration Plan

_Target: one Flutter codebase for **Web + iOS + Android**, backed by **Supabase**, local-first with real accounts. Draft v1, June 2026._

---

## 1. What "production-ready" means here

The current app is a single-file HTML/JS tracker with local storage and a shared-secret Cloudflare KV sync. The logic is solid and tested; the gaps that block "production" are not in the UI, they're in the platform:

- **Real accounts** — email/OAuth auth, not a guessable secret phrase.
- **Per-user data isolation** — server-enforced, so one user can never read another's data.
- **Server-side validation & integrity** — amounts, ownership, referential rules.
- **Robust offline + multi-device sync** — proper conflict resolution, not last-writer-wins on a single blob.
- **Quality bar** — typed models, unit/widget tests, CI, crash reporting, store-ready builds.

The Flutter rewrite is the visible part; **the backend is ~80% of the actual production work.** Good news: the domain logic (balances, debt simplification, budget amortization, billed/unbilled cards, the `mtime` merge rule) is already specified and test-covered, so it ports to Dart with low risk.

---

## 2. Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Flutter 3.4x stable** (web + iOS + Android) | One codebase, native mobile feel, web build included. |
| Language | **Dart 3** (sound null safety, sealed classes) | Sealed classes model the transaction variants cleanly. |
| Web renderer | **CanvasKit** default; evaluate **WASM/skwasm** | skwasm gives better startup/frame perf; needs WasmGC browsers (Chromium 119+). Ship CanvasKit, opt into WASM once tested. |
| State management | **Riverpod** | Async providers map naturally onto auth state + a local DB stream. |
| Local database | **Drift** (SQLite) | Typed, reactive queries; same DB the sync layer uses. |
| Backend | **Supabase** (Postgres + Auth + RLS) | Auth + DB + row-level security with the least glue for per-user local-first data. SDK: `supabase_flutter` v2. |
| Sync engine | **PowerSync** (phase 2) over Supabase | Offline-first SQLite↔Postgres sync, real-time, no polling. Integrates with Drift + Riverpod. Phase 1 can ship a simpler manual sync (see §6). |
| Routing | **go_router** | Declarative, deep-link/web-URL friendly. |
| Money | **integer minor units (paise)** + a `Money` value type | Never store money as floating point. Migrate ₹ doubles → paise on import. |

---

## 3. Architecture overview (local-first)

```
┌──────────────────────────── Flutter app (web/iOS/Android) ───────────────────────────┐
│  UI (widgets)  →  Riverpod providers  →  Repositories  →  Drift (local SQLite)        │
│                                   │                                                   │
│                          Domain layer (pure Dart, tested)                             │
│                          balances · debt simplify · budget slice · card model         │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │  sync (PowerSync / manual)
                                ┌────────▼─────────┐
                                │     Supabase     │  Auth · Postgres · RLS · (Edge Fns)
                                └──────────────────┘
```

Principle: **the UI only ever reads from the local Drift DB.** Writes go to Drift immediately (instant UI), then sync to Supabase in the background. This preserves the current app's "works offline, feels instant" behavior while adding real accounts.

---

## 4. Project structure

```
lib/
  main.dart
  app.dart                      # MaterialApp.router, theme
  core/
    money.dart                  # Money value type (paise), formatting (₹, en-IN)
    result.dart, errors.dart
  domain/                       # PURE DART, no Flutter/DB imports → unit tested
    models/                     # Transaction (sealed), Card, Group, Budget, Settings
    balances.dart               # cashDelta, cardDelta, walletDelta, personDelta
    cards.dart                  # cardBilled/unbilled/balance, due-date logic
    budget.dart                 # budgetSliceForMonth (spread/spreadDays amortization)
    debts.dart                  # groupNet, simplifyDebts, pairwiseDebts, netToPairs
    merge.dart                  # mtime + categorized-wins conflict rule
  data/
    local/                      # Drift tables, DAOs
    remote/                     # Supabase client, sync adapter
    repositories/               # TransactionRepo, CardRepo, GroupRepo, BudgetRepo
  features/
    auth/  dashboard/  entry/  cards/  groups/  budget/  onboarding/  settings/
  routing/router.dart
test/
  domain/                       # ported from the current JS test scenarios
integration_test/
```

---

## 5. Data model

### 5.1 Dart domain (sealed transaction)

```dart
sealed class Txn {
  final String id;          // uuid
  final DateTime date;
  final Money amount;
  final String? note;
  final DateTime updatedAt;  // ← the current `mtime`
  final bool deleted;        // tombstone for sync
}
class Expense extends Txn { Category category; PaySource src; String? cardId;
  bool paidByOther; Money yourShare; List<Split> splits; Money cashback;
  CashbackDest cashbackTo; int spreadMonths; int? spreadDays; bool household; }
class Income / Lend / Repay / Transfer / CardPay / Cashback / Opening
       / GroupExpense / GroupSettle extends Txn { ... }
```

Sealed classes give exhaustive `switch` in the balance functions — the compiler enforces that every transaction type is handled, which the JS version couldn't.

### 5.2 Supabase Postgres schema (RLS on every table)

```sql
-- profiles: 1:1 with auth.users
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  starting_cash_paise bigint not null default 0,
  onboarded boolean not null default false,
  active_group_id uuid,
  settings jsonb not null default '{}',   -- simplifyDebts, etc.
  updated_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null,                     -- expense|income|...|group|group-settle
  date date not null,
  amount_paise bigint not null,
  category text,
  group_id uuid references groups(id) on delete set null,
  data jsonb not null default '{}',       -- variant fields: splits, shares, src,
                                          --   cardId, paidBy, dir, cashback, spread…
  deleted boolean not null default false, -- tombstone
  updated_at timestamptz not null default now()
);
create index on transactions (user_id, date);

create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,                     -- BANK-XXXX
  billed_paise bigint not null default 0,
  unbilled_paise bigint not null default 0,
  bill_day int, due_day int,
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  members jsonb not null default '[]',
  opening_pairs jsonb not null default '[]',
  start_date date,
  updated_at timestamptz not null default now()
);

create table budgets (
  user_id uuid not null references auth.users on delete cascade,
  category text not null,
  amount_paise bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

-- RLS: identical pattern on each table
alter table transactions enable row level security;
create policy "own rows" on transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Notes:
- **Hybrid normalization**: stable core columns (type, date, amount, category) plus a `data jsonb` for the variant fields. This mirrors the flexible JS object and keeps the port simple, while still letting Postgres index/query the common fields.
- **Budgets are global per category** today (not per-month). Kept that way; a `month` column can be added later if you want per-month budgets.
- Every row carries `updated_at` (= `mtime`) and `deleted` so sync conflict resolution works the same as today.

---

## 6. Sync strategy

The current merge rule is good and we keep it: **newest `updated_at` wins per id; on a tie, a row that has a category beats one that doesn't** (categories are additive). Tombstones (`deleted=true`) replace the `S.deleted` array.

- **Phase 1 — manual sync (fast to ship):** Drift is the source of truth for the UI. On login/foreground, pull changed rows since last cursor, merge with the rule above, push local dirty rows. This is the current model, but per-row (not one blob) and per-user (RLS). Good enough for a single user across devices.
- **Phase 2 — PowerSync (production-grade):** Replace the manual layer with PowerSync's SQLite↔Postgres engine for real-time, conflict-aware, offline-first sync. Drift connects via `SqliteAsyncDriftConnection`; Riverpod manages connect/disconnect on auth-state changes.

Auth: Supabase email magic-link + Google/Apple OAuth (Apple sign-in is required for iOS App Store if you offer other social logins). Anonymous sign-in is available if you want "try before signup," upgraded to a real account later.

---

## 7. Domain logic to port (already tested)

These move to pure Dart in `domain/` and get the existing test scenarios as Dart unit tests:

- `cashDelta`, `cardDelta`, `walletDelta`, `personDelta(Map)` — per-transaction effects.
- `cardBilled / cardUnbilled / cardOpening / cardBalance` + due-date logic.
- `budgetSliceForMonth` — month spread + day-pack (28/56/84/365) amortization.
- `groupNet`, `simplifyDebts`, `pairwiseDebts`, `netToPairs` — group ledger + Splitwise-matching simplification.
- The **source-wise "spent this month"** split (Bank/Card/Wallet/Split) and the **card old-liability vs this-month** split.
- The sync **merge rule**.

Porting these first, behind tests, de-risks everything else.

---

## 8. Migrating your existing data

No data loss path from today's app:

1. In the current app, **Copy backup** → produces the full JSON snapshot (txns, budgets, settings incl. cards/groups/cardMeta/startingCash).
2. New app ships an **Import** screen that accepts that exact JSON.
3. Importer maps: ₹ doubles → paise; `S.txns` → `transactions` rows (variant fields into `data`); `cardMeta` → `cards`; `groups` → `groups`; `budgets` → `budgets`; `startingCash`/`onboarded` → `profile`. Generates `updated_at` from `mtime` where present.
4. Writes to local Drift, then syncs up. Round-trip verified against a known backup before launch.

---

## 9. Phased roadmap

1. **Foundations** — Flutter project, theme, routing, CI. Port `domain/` + tests. _(No UI yet; logic proven.)_
2. **Local app** — Drift schema, repositories, dashboard + add-entry + cards + groups + budget UI reading from local DB. Import-from-backup. Ships as a working **local-only** app on all three platforms.
3. **Accounts + sync** — Supabase project, schema + RLS, auth screens, Phase-1 manual sync. Multi-device works.
4. **Production sync + hardening** — PowerSync, error/crash reporting (Sentry), edge-case tests, accessibility, perf (web bundle, WASM eval).
5. **Release** — Web deploy (Cloudflare Pages or Supabase hosting), TestFlight + Play internal testing, store listings, then public.

Each phase is independently shippable; you always have a working app.

---

## 10. Testing, CI/CD, deployment

- **Tests:** `domain/` unit tests (port the JS scenarios) · repository tests against in-memory Drift · key widget tests · a couple of `integration_test` flows (onboard, add expense, settle).
- **CI:** GitHub Actions — `flutter analyze`, `flutter test`, build web + Android on every PR.
- **Web:** `flutter build web` → Cloudflare Pages (keeps your host) or Supabase static hosting. Same-origin `/` so existing-style PWA install works.
- **Mobile:** Fastlane for signing/upload → TestFlight (iOS) and Play internal track (Android).
- **Observability:** Sentry for crashes; Supabase logs/metrics for the backend.

---

## 11. Risks & open decisions

- **Flutter web load size** — first paint is heavier than the current single HTML file. Mitigate with CanvasKit caching / deferred loading; measure before committing to WASM.
- **PowerSync cost/complexity** — has a free tier; if it's overkill, the Phase-1 manual sync can remain for a single-user product. Decide at Phase 4.
- **iOS releases need an Apple Developer account** ($99/yr) and Apple sign-in if you add social logins.
- **Per-month budgets** — currently global; confirm whether production should track budgets per month (schema-ready, small change).
- **Multi-user groups** — today "groups" are your private view of who owes whom. True shared/collaborative groups (other users in the same group) is a much larger feature — out of scope unless you want it.

---

## 12. Rough cost

Low to start: Supabase free tier, Cloudflare Pages free, GitHub Actions free minutes. Paid items appear at scale or for stores: Apple Developer ($99/yr), Google Play (one-time $25), Supabase Pro (~$25/mo) and PowerSync only if/when you exceed free limits.

---

### Suggested next step

Approve the stack and Phase 1 scope. I'll then scaffold the Flutter project and port the `domain/` logic with its tests first — the lowest-risk, highest-leverage starting point — and we build the local app UI on top from there.
