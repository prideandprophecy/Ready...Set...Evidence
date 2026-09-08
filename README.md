# Ready...Set...Evidence Commons

This is a parallel rebuild of Ready...Set...Evidence around a public, reusable evidence commons rather than a manufacturer-specific clinical/regulatory workspace.

## Product model

The core hierarchy is:

**Canonical paper -> cohort -> evidence slot -> competing endpoint extractions -> community selection/appraisal -> synthesis -> review/live view**

A paper exists once. Reviews point to the shared evidence rather than copying it. An evidence slot represents a semantic endpoint position such as "CRBSI, overall cohort, 90 days." Multiple competing extractions can exist under that slot. Contributors select the extraction they believe is correct, submit challenges, and preserve an immutable version history when values change.

## Why a parallel repo

Use a new GitHub repository for this app. The supplied SQL migration deliberately creates only `rse_*` tables and does not alter the existing manufacturer/regulatory tables. This lets the old app and the Commons share one Supabase project while you evaluate the pivot.

I would not create a second Supabase project yet unless you need hard isolation for billing, authentication, security testing, or production deployment. One project with separate `rse_*` tables is easier to operate during the transition and gives you a clean migration path for selected evidence later.

## Included features

- Public browsing without an account
- Supabase email/password profiles
- Public shareable contributor URLs (`/u/:username`)
- Follows and contributor activity feeds
- Gamified metrics: points, papers added, endpoints extracted, appraisals, accepted challenges, implemented changes, followers, published reviews, verified authorship
- Organizations with open/request/invite join policies
- DOI and PMID uniqueness, plus title-similarity duplicate detection
- Crossref DOI metadata lookup Edge Function
- ORCID OAuth verification Edge Functions
- Authorship claims with automatic verification when a verified profile ORCID matches trusted article author metadata
- Canonical works, cohorts, reusable outcome concepts, evidence slots, competing extractions, confirmations, challenges, and immutable extraction versions
- Independent study appraisals with a community mean/median
- Existing RAW weighting logic plus unweighted, fixed-effect, and DerSimonian-Laird random-effects synthesis
- Public live evidence views that recalculate against current consensus evidence
- Review workspaces with literature-search audit records, include/exclude decisions, frozen evidence snapshots, public publication, and review forking
- RLS policies separating public reading, authenticated contribution, ownership, organization administration, and review editing

## 1. Create the GitHub repository

Copy this folder into a new repository, for example `readysetevidence-commons`.

```bash
git init
git add .
git commit -m "Initial Evidence Commons pivot"
```

## 2. Apply the Supabase migration

Apply:

`supabase/migrations/001_rse_commons.sql`

The migration enables `pgcrypto`, `citext`, and `pg_trgm`, creates the new public schema objects, RLS policies, triggers, aggregate views, duplicate-detection RPCs, review snapshotting, and profile metrics.

Before applying it to production, run it in a Supabase branch or local development project if you use Supabase branching. The migration is intentionally isolated from the old tables, but RLS and auth triggers should still be tested with your exact project settings.

## 3. Configure the frontend

Copy `.env.example` to `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Then:

```bash
npm install
npm run dev
```

## 4. Deploy Edge Functions

Deploy:

```bash
supabase functions deploy lookup-doi
supabase functions deploy orcid-start
supabase functions deploy orcid-callback
```

Set function secrets:

```bash
supabase secrets set CROSSREF_MAILTO=you@example.com
supabase secrets set APP_ORIGIN=https://your-rse-domain.example
supabase secrets set ORCID_BASE_URL=https://orcid.org
supabase secrets set ORCID_CLIENT_ID=YOUR_ORCID_CLIENT_ID
supabase secrets set ORCID_CLIENT_SECRET=YOUR_ORCID_CLIENT_SECRET
```

For ORCID sandbox testing use `https://sandbox.orcid.org` and sandbox credentials. Register the exact callback URL:

`https://your-rse-domain.example/orcid/callback`

## 5. Supabase Auth settings

In Supabase Authentication:

- Enable email/password auth.
- Add your local and production URLs to allowed redirect URLs.
- Decide whether email confirmation is required.
- Do not expose the service-role key to the Vite frontend. It is used only inside Edge Functions.

The migration creates an `rse_profiles` row automatically when a new auth user is created and also backfills profiles for existing Supabase auth users.

## 6. First platform administrator

After your own profile exists, set your user as platform admin in the Supabase SQL editor:

```sql
update public.rse_profiles
set is_platform_admin = true
where id = 'YOUR_AUTH_USER_UUID';
```

Platform admin status is currently used for manual authorship-claim resolution. A dedicated moderation page can be added later.

## Contribution points

The migration assigns initial activity points as follows:

- Paper added: 5
- Endpoint extraction: 10
- Study appraisal: 8
- Challenge submitted: 4
- Challenge accepted: 12
- Review published: 20

The public profile also reports non-point metrics separately so the system does not reduce scientific contribution to a single score. The point values can be changed in the activity trigger functions.

## Duplicate protection model

### Papers

- DOI is normalized and unique.
- PMID is unique when present.
- `rse_find_possible_work_duplicates` also uses PostgreSQL trigram title similarity and publication year to flag likely duplicates before insertion.

### Endpoints

An endpoint is not treated as one globally "correct" row. `rse_evidence_slots` prevents duplicate semantic slots within a paper/cohort/outcome/timepoint/subgroup combination. `rse_extractions` then permits competing proposed values under that slot. Exact duplicate extractions are blocked using a value/source fingerprint. Contributors should confirm an existing extraction rather than creating a copy.

This is what allows disagreement without creating duplicate evidence.

## Consensus and RAW synthesis

`rse_consensus_extractions` selects one extraction per evidence slot based on contributor selections. `rse_synthesis_rows` exposes those consensus extractions along with the current mean community appraisal score. The browser synthesis module retains the original RSE quality scale used by RAW: 1 is strongest and 4 is weakest.

Published reviews call `rse_snapshot_review`, which stores immutable extraction-version IDs. A later community correction therefore changes a live evidence page but does not silently rewrite a previously published review.

## ORCID and authorship

A user can connect ORCID from their profile. The OAuth callback stores an authenticated ORCID iD and verification timestamp.

An authorship claim auto-verifies only when:

1. The user's ORCID has been authenticated through ORCID OAuth, and
2. A paper author has the same ORCID, and
3. The author ORCID came from trusted metadata (`crossref`, `orcid`, or `publisher`).

Manual author metadata does not auto-verify a claim. This prevents a user from typing their own ORCID into a manually created author row and immediately claiming a paper.

## Recommended next features

This MVP deliberately does not try to become a literature-search database. The next highest-value additions are likely:

1. PubMed/OpenAlex import and citation discovery without replacing Embase/PubMed review searches.
2. A moderation queue for authorship claims, metadata disputes, and abusive contributions.
3. Framework-specific appraisal UIs such as RoB 2, ROBINS-I, MINORS, QUADAS-2, or user-defined frameworks while keeping the normalized 1-to-4 RAW score when RAW is requested.
4. Review collaborators and organization-level permissions beyond the basic schema included here.
5. Notifications for followed researchers, challenged evidence, accepted changes, and reviews that use evidence you contributed.
6. DOI/ROR/ORCID richer identity linking and publication import from a verified ORCID record.
7. Automated PRISMA flow counts from review decisions and imported search batches.
8. Topic taxonomies and curated landing pages for areas such as vascular access.
9. Moderation/reputation weighting that distinguishes number of contributions from reliability and domain expertise.
10. DOI creation for frozen RSE review releases through a repository or DOI-registration workflow.

## Mapping from the old app

The old `SynthesisPanel` becomes the basis of `src/lib/synthesis.js` and the new Synthesize page. The old organization-scoped source/outcome model is replaced by global `rse_works`, `rse_evidence_slots`, and `rse_extractions`. Manufacturer-specific Devices, Complaints, Registrations, PMCF, document generation, and regulatory task workflows remain in the old application and are not required by this new repo.
