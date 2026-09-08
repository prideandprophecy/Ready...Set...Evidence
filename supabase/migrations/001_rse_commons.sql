-- Ready...Set...Evidence Commons
-- Parallel schema for a public, collaborative evidence platform.
-- Existing manufacturer/regulatory tables are intentionally untouched.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create or replace function public.rse_normalize_doi(v text)
returns text
language sql
immutable
as $$
  select nullif(
    lower(
      regexp_replace(
        regexp_replace(trim(coalesce(v, '')), '^https?://(dx\.)?doi\.org/', '', 'i'),
        '^doi:\s*', '', 'i'
      )
    ),
    ''
  );
$$;

create or replace function public.rse_normalize_orcid(v text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      regexp_replace(
        regexp_replace(trim(coalesce(v, '')), '^https?://orcid\.org/', '', 'i'),
        '[^0-9X-]', '', 'g'
      )
    ),
    ''
  );
$$;

create or replace function public.rse_slugify(v text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.rse_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.rse_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name text,
  bio text,
  affiliation text,
  website_url text,
  avatar_url text,
  location text,
  expertise text[] not null default '{}',
  orcid text,
  orcid_normalized text generated always as (public.rse_normalize_orcid(orcid)) stored,
  orcid_verified_at timestamptz,
  is_public boolean not null default true,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rse_profiles_orcid_unique
  on public.rse_profiles(orcid_normalized)
  where orcid_normalized is not null;

create table if not exists public.rse_organizations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  website_url text,
  logo_url text,
  organization_type text not null default 'research_group'
    check (organization_type in ('research_group','university','company','nonprofit','government','journal','other')),
  join_policy text not null default 'request'
    check (join_policy in ('open','request','invite')),
  is_verified boolean not null default false,
  created_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rse_org_members (
  org_id uuid not null references public.rse_organizations(id) on delete cascade,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.rse_follows (
  follower_id uuid not null references public.rse_profiles(id) on delete cascade,
  following_id uuid not null references public.rse_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.rse_works (
  id uuid primary key default gen_random_uuid(),
  doi text,
  doi_normalized text generated always as (public.rse_normalize_doi(doi)) stored,
  pmid text,
  title text not null,
  abstract text,
  journal text,
  publication_year int check (publication_year between 1600 and 2200),
  work_type text not null default 'journal_article',
  url text,
  citation text,
  metadata_source text not null default 'manual',
  metadata_verified boolean not null default false,
  is_public boolean not null default true,
  added_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rse_works_doi_unique
  on public.rse_works(doi_normalized)
  where doi_normalized is not null;
create unique index if not exists rse_works_pmid_unique
  on public.rse_works(lower(pmid))
  where nullif(trim(pmid), '') is not null;
create index if not exists rse_works_title_trgm_idx on public.rse_works using gin (title gin_trgm_ops);
create index if not exists rse_works_year_idx on public.rse_works(publication_year);

create table if not exists public.rse_work_authors (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.rse_works(id) on delete cascade,
  author_order int not null default 1,
  full_name text not null,
  given_name text,
  family_name text,
  orcid text,
  orcid_normalized text generated always as (public.rse_normalize_orcid(orcid)) stored,
  affiliation text,
  metadata_source text not null default 'manual',
  linked_profile_id uuid references public.rse_profiles(id) on delete set null,
  created_by uuid references public.rse_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (work_id, author_order)
);
create index if not exists rse_work_authors_orcid_idx on public.rse_work_authors(orcid_normalized);

create table if not exists public.rse_authorship_claims (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.rse_works(id) on delete cascade,
  work_author_id uuid references public.rse_work_authors(id) on delete set null,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  verification_method text,
  note text,
  reviewed_by uuid references public.rse_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (work_id, user_id)
);

create table if not exists public.rse_cohorts (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.rse_works(id) on delete cascade,
  label text not null,
  description text,
  patient_population text,
  intervention text,
  comparator text,
  indication text,
  sample_size numeric,
  created_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, label)
);

create table if not exists public.rse_outcome_concepts (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  label text not null,
  description text,
  default_outcome_type text check (default_outcome_type in ('continuous','proportion','rate')),
  created_by uuid references public.rse_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists rse_outcome_concepts_label_unique on public.rse_outcome_concepts(lower(label));

create table if not exists public.rse_evidence_slots (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.rse_works(id) on delete cascade,
  cohort_id uuid not null references public.rse_cohorts(id) on delete cascade,
  outcome_concept_id uuid not null references public.rse_outcome_concepts(id) on delete restrict,
  outcome_type text not null check (outcome_type in ('continuous','proportion','rate')),
  timepoint_label text not null default '',
  subgroup_label text not null default '',
  timepoint_normalized text generated always as (lower(trim(timepoint_label))) stored,
  subgroup_normalized text generated always as (lower(trim(subgroup_label))) stored,
  units text,
  notes text,
  created_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (work_id, cohort_id, outcome_concept_id, outcome_type, timepoint_normalized, subgroup_normalized)
);

create table if not exists public.rse_extractions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.rse_evidence_slots(id) on delete cascade,
  mean numeric,
  sd numeric,
  n numeric,
  events numeric,
  total_exposure numeric,
  reported_value numeric,
  ci_lower numeric,
  ci_upper numeric,
  source_locator text,
  extraction_notes text,
  fingerprint text,
  last_change_reason text,
  created_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rse_extractions_slot_fingerprint_unique
  on public.rse_extractions(slot_id, fingerprint)
  where fingerprint is not null;

create table if not exists public.rse_extraction_versions (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.rse_extractions(id) on delete cascade,
  version_no int not null,
  payload jsonb not null,
  changed_by uuid references public.rse_profiles(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (extraction_id, version_no)
);

create table if not exists public.rse_extraction_votes (
  slot_id uuid not null references public.rse_evidence_slots(id) on delete cascade,
  extraction_id uuid not null references public.rse_extractions(id) on delete cascade,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot_id, user_id)
);

create table if not exists public.rse_challenges (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.rse_extractions(id) on delete cascade,
  created_by uuid not null references public.rse_profiles(id) on delete cascade,
  reason_code text not null default 'other',
  rationale text not null,
  status text not null default 'open' check (status in ('open','accepted','rejected','withdrawn')),
  resolution_notes text,
  resolved_by uuid references public.rse_profiles(id) on delete set null,
  resulting_version_id uuid references public.rse_extraction_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.rse_appraisal_frameworks (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  response_schema jsonb not null default '[]'::jsonb,
  is_public boolean not null default true,
  created_by uuid references public.rse_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.rse_appraisals (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.rse_works(id) on delete cascade,
  framework_id uuid not null references public.rse_appraisal_frameworks(id) on delete restrict,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  quality_score numeric not null check (quality_score >= 1 and quality_score <= 4),
  responses jsonb not null default '{}'::jsonb,
  rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, framework_id, user_id)
);

create table if not exists public.rse_reviews (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  title text not null,
  review_type text not null default 'systematic_review'
    check (review_type in ('systematic_review','rapid_review','scoping_review','live_review','comparison')),
  research_question text,
  abstract text,
  protocol_text text,
  methods_text text,
  inclusion_criteria text,
  exclusion_criteria text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  visibility text not null default 'private' check (visibility in ('public','unlisted','private')),
  owner_user_id uuid not null references public.rse_profiles(id) on delete restrict,
  owner_org_id uuid references public.rse_organizations(id) on delete set null,
  version_tag text not null default '0.1',
  published_at timestamptz,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rse_review_members (
  review_id uuid not null references public.rse_reviews(id) on delete cascade,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  role text not null default 'contributor' check (role in ('owner','editor','contributor','viewer')),
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists public.rse_review_searches (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.rse_reviews(id) on delete cascade,
  database_name text not null,
  search_string text not null,
  date_run date,
  date_from date,
  date_to date,
  result_count int,
  notes text,
  created_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.rse_review_work_links (
  review_id uuid not null references public.rse_reviews(id) on delete cascade,
  work_id uuid not null references public.rse_works(id) on delete cascade,
  decision text not null default 'include' check (decision in ('include','exclude','awaiting')),
  exclusion_reason text,
  added_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (review_id, work_id)
);

create table if not exists public.rse_review_extraction_links (
  review_id uuid not null references public.rse_reviews(id) on delete cascade,
  extraction_version_id uuid not null references public.rse_extraction_versions(id) on delete restrict,
  selected_by uuid not null references public.rse_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (review_id, extraction_version_id)
);

create table if not exists public.rse_live_views (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  title text not null,
  description text,
  outcome_concept_id uuid not null references public.rse_outcome_concepts(id) on delete restrict,
  filters jsonb not null default '{}'::jsonb,
  weighting text not null default 'raw' check (weighting in ('unweighted','fe_iv','re_dl','raw')),
  rate_scale text not null default 'per_1000_days' check (rate_scale in ('per_day','per_1000_days','per_year')),
  proportion_as_percent boolean not null default true,
  owner_user_id uuid not null references public.rse_profiles(id) on delete restrict,
  owner_org_id uuid references public.rse_organizations(id) on delete set null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rse_activity_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.rse_profiles(id) on delete set null,
  event_type text not null,
  object_type text not null,
  object_id uuid,
  work_id uuid references public.rse_works(id) on delete cascade,
  review_id uuid references public.rse_reviews(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  points int not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rse_activity_actor_created_idx on public.rse_activity_events(actor_id, created_at desc);
create index if not exists rse_activity_created_idx on public.rse_activity_events(created_at desc);

create table if not exists public.rse_oauth_states (
  state text primary key,
  user_id uuid not null references public.rse_profiles(id) on delete cascade,
  provider text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Generic update timestamps
create trigger rse_profiles_touch before update on public.rse_profiles for each row execute function public.rse_set_updated_at();
create trigger rse_organizations_touch before update on public.rse_organizations for each row execute function public.rse_set_updated_at();
create trigger rse_works_touch before update on public.rse_works for each row execute function public.rse_set_updated_at();
create trigger rse_cohorts_touch before update on public.rse_cohorts for each row execute function public.rse_set_updated_at();
create trigger rse_extractions_touch before update on public.rse_extractions for each row execute function public.rse_set_updated_at();
create trigger rse_appraisals_touch before update on public.rse_appraisals for each row execute function public.rse_set_updated_at();
create trigger rse_reviews_touch before update on public.rse_reviews for each row execute function public.rse_set_updated_at();
create trigger rse_live_views_touch before update on public.rse_live_views for each row execute function public.rse_set_updated_at();

-- Create a public profile when a Supabase auth user signs up.
create or replace function public.rse_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  final_username text;
begin
  base_username := public.rse_slugify(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'researcher'));
  if base_username = '' then base_username := 'researcher'; end if;
  final_username := left(base_username, 40) || '-' || left(replace(new.id::text, '-', ''), 6);

  insert into public.rse_profiles(id, username, display_name)
  values (
    new.id,
    final_username,
    nullif(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists rse_on_auth_user_created on auth.users;
create trigger rse_on_auth_user_created
  after insert on auth.users
  for each row execute function public.rse_handle_new_auth_user();


insert into public.rse_profiles(id, username, display_name)
select u.id,
       ('researcher-' || left(replace(u.id::text,'-',''),6))::citext,
       nullif(coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name',''),'')
from auth.users u
where not exists(select 1 from public.rse_profiles p where p.id=u.id)
on conflict do nothing;

-- Extraction fingerprinting and immutable version history.
create or replace function public.rse_set_extraction_fingerprint()
returns trigger
language plpgsql
as $$
begin
  new.fingerprint := md5(concat_ws('|',
    coalesce(new.mean::text,''), coalesce(new.sd::text,''), coalesce(new.n::text,''),
    coalesce(new.events::text,''), coalesce(new.total_exposure::text,''),
    coalesce(new.reported_value::text,''), coalesce(new.ci_lower::text,''), coalesce(new.ci_upper::text,''),
    lower(trim(coalesce(new.source_locator,'')))
  ));
  return new;
end;
$$;
create trigger rse_extractions_fingerprint
  before insert or update of mean, sd, n, events, total_exposure, reported_value, ci_lower, ci_upper, source_locator
  on public.rse_extractions
  for each row execute function public.rse_set_extraction_fingerprint();

create or replace function public.rse_version_extraction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version int;
  actor uuid;
begin
  select coalesce(max(version_no),0)+1 into next_version
  from public.rse_extraction_versions where extraction_id = new.id;

  actor := coalesce(auth.uid(), new.created_by);
  insert into public.rse_extraction_versions(extraction_id, version_no, payload, changed_by, change_reason)
  values (
    new.id,
    next_version,
    jsonb_build_object(
      'slot_id', new.slot_id,
      'mean', new.mean,
      'sd', new.sd,
      'n', new.n,
      'events', new.events,
      'total_exposure', new.total_exposure,
      'reported_value', new.reported_value,
      'ci_lower', new.ci_lower,
      'ci_upper', new.ci_upper,
      'source_locator', new.source_locator,
      'extraction_notes', new.extraction_notes,
      'fingerprint', new.fingerprint
    ),
    actor,
    new.last_change_reason
  );
  return new;
end;
$$;
create trigger rse_extractions_version_insert
  after insert on public.rse_extractions
  for each row execute function public.rse_version_extraction();
create trigger rse_extractions_version_update
  after update of mean, sd, n, events, total_exposure, reported_value, ci_lower, ci_upper, source_locator, extraction_notes
  on public.rse_extractions
  for each row execute function public.rse_version_extraction();

create or replace function public.rse_validate_extraction_vote()
returns trigger
language plpgsql
as $$
declare
  actual_slot uuid;
begin
  select slot_id into actual_slot from public.rse_extractions where id = new.extraction_id;
  if actual_slot is distinct from new.slot_id then
    raise exception 'Extraction does not belong to the selected evidence slot';
  end if;
  return new;
end;
$$;
create trigger rse_vote_slot_guard before insert or update on public.rse_extraction_votes
for each row execute function public.rse_validate_extraction_vote();

-- Activity event helper.
create or replace function public.rse_add_activity(
  p_actor uuid,
  p_event_type text,
  p_object_type text,
  p_object_id uuid,
  p_work_id uuid default null,
  p_review_id uuid default null,
  p_points int default 0,
  p_metadata jsonb default '{}'::jsonb,
  p_is_public boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rse_activity_events(actor_id,event_type,object_type,object_id,work_id,review_id,points,metadata,is_public)
  values (p_actor,p_event_type,p_object_type,p_object_id,p_work_id,p_review_id,p_points,coalesce(p_metadata,'{}'::jsonb),p_is_public);
end;
$$;

create or replace function public.rse_activity_on_work()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.rse_add_activity(new.added_by,'paper_added','work',new.id,new.id,null,5,jsonb_build_object('title',new.title),new.is_public);
  return new;
end; $$;
create trigger rse_work_activity after insert on public.rse_works for each row execute function public.rse_activity_on_work();

create or replace function public.rse_activity_on_extraction()
returns trigger language plpgsql security definer set search_path=public as $$
declare w uuid;
begin
  select work_id into w from public.rse_evidence_slots where id = new.slot_id;
  perform public.rse_add_activity(new.created_by,'endpoint_extracted','extraction',new.id,w,null,10,'{}'::jsonb,true);
  return new;
end; $$;
create trigger rse_extraction_activity after insert on public.rse_extractions for each row execute function public.rse_activity_on_extraction();

create or replace function public.rse_activity_on_appraisal()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.rse_add_activity(new.user_id,'appraisal_added','appraisal',new.id,new.work_id,null,8,jsonb_build_object('quality_score',new.quality_score),true);
  return new;
end; $$;
create trigger rse_appraisal_activity after insert on public.rse_appraisals for each row execute function public.rse_activity_on_appraisal();

create or replace function public.rse_activity_on_challenge()
returns trigger language plpgsql security definer set search_path=public as $$
declare w uuid;
begin
  select s.work_id into w
  from public.rse_extractions e join public.rse_evidence_slots s on s.id=e.slot_id
  where e.id=new.extraction_id;
  perform public.rse_add_activity(new.created_by,'challenge_added','challenge',new.id,w,null,4,jsonb_build_object('reason_code',new.reason_code),true);
  return new;
end; $$;
create trigger rse_challenge_activity after insert on public.rse_challenges for each row execute function public.rse_activity_on_challenge();

create or replace function public.rse_activity_on_challenge_resolution()
returns trigger language plpgsql security definer set search_path=public as $$
declare w uuid;
begin
  if old.status <> 'accepted' and new.status = 'accepted' then
    select s.work_id into w
    from public.rse_extractions e join public.rse_evidence_slots s on s.id=e.slot_id
    where e.id=new.extraction_id;
    perform public.rse_add_activity(new.created_by,'challenge_accepted','challenge',new.id,w,null,12,'{}'::jsonb,true);
  end if;
  return new;
end; $$;
create trigger rse_challenge_resolution_activity after update of status on public.rse_challenges
for each row execute function public.rse_activity_on_challenge_resolution();

create or replace function public.rse_activity_on_review_publish()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status <> 'published' and new.status = 'published' then
    perform public.rse_add_activity(new.owner_user_id,'review_published','review',new.id,null,new.id,20,jsonb_build_object('title',new.title),new.visibility='public');
  end if;
  return new;
end; $$;
create trigger rse_review_publish_activity after update of status on public.rse_reviews
for each row execute function public.rse_activity_on_review_publish();

-- Duplicate detection.
create or replace function public.rse_find_possible_work_duplicates(
  p_doi text default null,
  p_pmid text default null,
  p_title text default null,
  p_year int default null
)
returns table(id uuid, title text, publication_year int, doi text, pmid text, match_reason text, similarity_score real)
language sql
stable
security definer
set search_path=public
as $$
  with candidates as (
    select w.*,
      case
        when public.rse_normalize_doi(p_doi) is not null and w.doi_normalized = public.rse_normalize_doi(p_doi) then 'DOI'
        when nullif(trim(p_pmid),'') is not null and lower(w.pmid) = lower(trim(p_pmid)) then 'PMID'
        else 'TITLE'
      end as match_reason,
      case when nullif(trim(p_title),'') is null then 0::real else similarity(lower(w.title), lower(trim(p_title))) end as similarity_score
    from public.rse_works w
    where w.is_public
      and (
        (public.rse_normalize_doi(p_doi) is not null and w.doi_normalized = public.rse_normalize_doi(p_doi))
        or (nullif(trim(p_pmid),'') is not null and lower(w.pmid) = lower(trim(p_pmid)))
        or (nullif(trim(p_title),'') is not null and similarity(lower(w.title), lower(trim(p_title))) >= 0.78
            and (p_year is null or w.publication_year is null or abs(w.publication_year - p_year) <= 1))
      )
  )
  select id,title,publication_year,doi,pmid,match_reason,similarity_score
  from candidates
  order by case match_reason when 'DOI' then 1 when 'PMID' then 2 else 3 end, similarity_score desc
  limit 10;
$$;

-- Organization join flow.
create or replace function public.rse_join_organization(p_org_id uuid)
returns public.rse_org_members
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid();
  policy text;
  row_out public.rse_org_members;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select join_policy into policy from public.rse_organizations where id=p_org_id;
  if policy is null then raise exception 'Organization not found'; end if;
  if policy = 'invite' then raise exception 'This organization is invite-only'; end if;

  insert into public.rse_org_members(org_id,user_id,role,status,joined_at)
  values (p_org_id,uid,'member',case when policy='open' then 'active' else 'pending' end,case when policy='open' then now() else null end)
  on conflict (org_id,user_id) do update set
    status = case when public.rse_org_members.status='rejected' then excluded.status else public.rse_org_members.status end,
    joined_at = case when excluded.status='active' then coalesce(public.rse_org_members.joined_at,now()) else public.rse_org_members.joined_at end
  returning * into row_out;
  return row_out;
end;
$$;

create or replace function public.rse_add_org_owner()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.rse_org_members(org_id,user_id,role,status,joined_at)
  values(new.id,new.created_by,'owner','active',now())
  on conflict (org_id,user_id) do nothing;
  return new;
end;
$$;
create trigger rse_org_owner_after_insert after insert on public.rse_organizations
for each row execute function public.rse_add_org_owner();

create or replace function public.rse_is_org_admin(p_org_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.rse_org_members
    where org_id=p_org_id and user_id=p_user_id and status='active' and role in ('owner','admin')
  );
$$;

create or replace function public.rse_is_review_member(p_review_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.rse_reviews r where r.id=p_review_id and r.owner_user_id=p_user_id
  ) or exists(
    select 1 from public.rse_review_members m where m.review_id=p_review_id and m.user_id=p_user_id and m.role in ('owner','editor','contributor')
  );
$$;

-- Authorship claim. Auto-verification requires a verified ORCID on the profile and trusted author metadata.
create or replace function public.rse_claim_authorship(p_work_id uuid)
returns public.rse_authorship_claims
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid();
  p_orcid text;
  verified_at timestamptz;
  author_row public.rse_work_authors;
  claim_row public.rse_authorship_claims;
  auto_verify boolean := false;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select orcid_normalized, orcid_verified_at into p_orcid, verified_at from public.rse_profiles where id=uid;

  if p_orcid is not null and verified_at is not null then
    select * into author_row from public.rse_work_authors
    where work_id=p_work_id and orcid_normalized=p_orcid and metadata_source in ('crossref','orcid','publisher')
    order by author_order limit 1;
    auto_verify := author_row.id is not null;
  end if;

  insert into public.rse_authorship_claims(work_id,work_author_id,user_id,status,verification_method,reviewed_at)
  values (p_work_id,author_row.id,uid,case when auto_verify then 'verified' else 'pending' end,
          case when auto_verify then 'verified_orcid_match' else 'manual_review' end,
          case when auto_verify then now() else null end)
  on conflict (work_id,user_id) do update set
    work_author_id=coalesce(public.rse_authorship_claims.work_author_id,excluded.work_author_id),
    status=case when public.rse_authorship_claims.status='rejected' and auto_verify then 'verified' else public.rse_authorship_claims.status end,
    verification_method=case when auto_verify then 'verified_orcid_match' else public.rse_authorship_claims.verification_method end,
    reviewed_at=case when auto_verify then now() else public.rse_authorship_claims.reviewed_at end
  returning * into claim_row;

  if auto_verify then
    update public.rse_work_authors set linked_profile_id=uid where id=author_row.id;
  end if;
  return claim_row;
end;
$$;

create or replace function public.rse_resolve_authorship_claim(p_claim_id uuid, p_status text, p_note text default null)
returns public.rse_authorship_claims
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  admin boolean;
  c public.rse_authorship_claims;
begin
  select is_platform_admin into admin from public.rse_profiles where id=uid;
  if coalesce(admin,false)=false then raise exception 'Platform admin required'; end if;
  if p_status not in ('verified','rejected') then raise exception 'Invalid status'; end if;
  update public.rse_authorship_claims set status=p_status,note=p_note,reviewed_by=uid,reviewed_at=now()
  where id=p_claim_id returning * into c;
  if c.id is null then raise exception 'Claim not found'; end if;
  if p_status='verified' and c.work_author_id is not null then
    update public.rse_work_authors set linked_profile_id=c.user_id where id=c.work_author_id;
  end if;
  return c;
end;
$$;

-- Consensus extraction: one preferred extraction per evidence slot, based on user selections.
create or replace view public.rse_extraction_vote_counts as
select e.id extraction_id, e.slot_id, count(v.user_id)::int vote_count
from public.rse_extractions e
left join public.rse_extraction_votes v on v.extraction_id=e.id
group by e.id,e.slot_id;

create or replace view public.rse_consensus_extractions as
with ranked as (
  select e.*, coalesce(vc.vote_count,0) vote_count,
         row_number() over(partition by e.slot_id order by coalesce(vc.vote_count,0) desc, e.created_at asc, e.id) as rn
  from public.rse_extractions e
  left join public.rse_extraction_vote_counts vc on vc.extraction_id=e.id
)
select * from ranked where rn=1;

create or replace view public.rse_community_appraisals as
select work_id,
       avg(quality_score)::numeric(6,3) as community_quality_score,
       percentile_cont(0.5) within group (order by quality_score)::numeric(6,3) as median_quality_score,
       count(*)::int as appraisal_count
from public.rse_appraisals
group by work_id;

create or replace view public.rse_synthesis_rows as
select
  ce.id extraction_id,
  ce.slot_id,
  ce.vote_count,
  s.work_id,
  w.title work_title,
  w.publication_year,
  w.work_type,
  c.id cohort_id,
  c.label cohort_label,
  c.patient_population,
  c.intervention,
  c.comparator,
  c.indication,
  oc.id outcome_concept_id,
  oc.label outcome_label,
  s.outcome_type,
  s.timepoint_label,
  s.subgroup_label,
  s.units,
  ce.mean,ce.sd,ce.n,ce.events,ce.total_exposure,ce.reported_value,ce.ci_lower,ce.ci_upper,
  coalesce(a.community_quality_score,3)::numeric as community_quality_score,
  coalesce(a.appraisal_count,0)::int as appraisal_count
from public.rse_consensus_extractions ce
join public.rse_evidence_slots s on s.id=ce.slot_id
join public.rse_works w on w.id=s.work_id and w.is_public
join public.rse_cohorts c on c.id=s.cohort_id
join public.rse_outcome_concepts oc on oc.id=s.outcome_concept_id
left join public.rse_community_appraisals a on a.work_id=s.work_id;

create or replace view public.rse_profile_metrics as
select
  p.id,
  count(distinct w.id)::int papers_added,
  count(distinct e.id)::int endpoints_extracted,
  count(distinct ap.id)::int appraisals_completed,
  count(distinct ch.id)::int challenges_submitted,
  count(distinct case when ch.status='accepted' then ch.id end)::int challenges_accepted,
  count(distinct case when ev.version_no>1 and ev.changed_by=p.id then ev.id end)::int changes_implemented,
  count(distinct case when r.status='published' then r.id end)::int reviews_published,
  count(distinct ac.id) filter (where ac.status='verified')::int verified_authorships,
  (select count(*)::int from public.rse_follows f where f.following_id=p.id) followers,
  (select count(*)::int from public.rse_follows f where f.follower_id=p.id) following,
  coalesce((select sum(points)::int from public.rse_activity_events ae where ae.actor_id=p.id),0) points
from public.rse_profiles p
left join public.rse_works w on w.added_by=p.id
left join public.rse_extractions e on e.created_by=p.id
left join public.rse_appraisals ap on ap.user_id=p.id
left join public.rse_challenges ch on ch.created_by=p.id
left join public.rse_extraction_versions ev on ev.changed_by=p.id
left join public.rse_reviews r on r.owner_user_id=p.id
left join public.rse_authorship_claims ac on ac.user_id=p.id
group by p.id;

create or replace function public.rse_global_metrics()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'papers', (select count(*) from public.rse_works where is_public),
    'endpoints', (select count(*) from public.rse_extractions),
    'evidence_slots', (select count(*) from public.rse_evidence_slots),
    'appraisals', (select count(*) from public.rse_appraisals),
    'contributors', (select count(*) from public.rse_profiles where is_public),
    'published_reviews', (select count(*) from public.rse_reviews where status='published' and visibility='public')
  );
$$;

create or replace function public.rse_snapshot_review(p_review_id uuid)
returns int
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  inserted_count int:=0;
begin
  if uid is null or not public.rse_is_review_member(p_review_id,uid) then raise exception 'Review editor access required'; end if;
  delete from public.rse_review_extraction_links where review_id=p_review_id;

  insert into public.rse_review_extraction_links(review_id,extraction_version_id,selected_by)
  select p_review_id, v.id, uid
  from public.rse_review_work_links rw
  join public.rse_evidence_slots s on s.work_id=rw.work_id
  join public.rse_consensus_extractions ce on ce.slot_id=s.id
  join lateral (
    select ev.id from public.rse_extraction_versions ev
    where ev.extraction_id=ce.id order by ev.version_no desc limit 1
  ) v on true
  where rw.review_id=p_review_id and rw.decision='include';

  get diagnostics inserted_count = row_count;
  update public.rse_reviews set frozen_at=now() where id=p_review_id;
  return inserted_count;
end;
$$;

create or replace function public.rse_fork_review(p_review_id uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  src public.rse_reviews;
  new_id uuid:=gen_random_uuid();
  new_slug text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select * into src from public.rse_reviews where id=p_review_id and (visibility in ('public','unlisted') or owner_user_id=uid);
  if src.id is null then raise exception 'Review not found or inaccessible'; end if;
  new_slug := public.rse_slugify(src.title) || '-fork-' || left(replace(new_id::text,'-',''),6);
  insert into public.rse_reviews(id,slug,title,review_type,research_question,abstract,protocol_text,methods_text,inclusion_criteria,exclusion_criteria,status,visibility,owner_user_id,version_tag)
  values(new_id,new_slug,src.title || ' (fork)',src.review_type,src.research_question,src.abstract,src.protocol_text,src.methods_text,src.inclusion_criteria,src.exclusion_criteria,'draft','private',uid,'0.1');
  insert into public.rse_review_work_links(review_id,work_id,decision,exclusion_reason,added_by)
  select new_id,work_id,decision,exclusion_reason,uid from public.rse_review_work_links where review_id=p_review_id;
  insert into public.rse_review_searches(review_id,database_name,search_string,date_run,date_from,date_to,result_count,notes,created_by)
  select new_id,database_name,search_string,date_run,date_from,date_to,result_count,notes,uid from public.rse_review_searches where review_id=p_review_id;
  return new_id;
end;
$$;

-- Seed a neutral framework that preserves the existing 1-best to 4-worst RAW quality scale.
insert into public.rse_appraisal_frameworks(slug,name,description,response_schema,is_public)
values (
  'rse-custom-1-to-4',
  'RSE Custom Appraisal (1-4)',
  'A flexible appraisal record using the Ready...Set...Evidence quality scale where 1 is strongest and 4 is weakest. Projects may store framework-specific criterion responses in the response payload.',
  '[]'::jsonb,
  true
)
on conflict (slug) do nothing;

-- RLS
alter table public.rse_profiles enable row level security;
alter table public.rse_organizations enable row level security;
alter table public.rse_org_members enable row level security;
alter table public.rse_follows enable row level security;
alter table public.rse_works enable row level security;
alter table public.rse_work_authors enable row level security;
alter table public.rse_authorship_claims enable row level security;
alter table public.rse_cohorts enable row level security;
alter table public.rse_outcome_concepts enable row level security;
alter table public.rse_evidence_slots enable row level security;
alter table public.rse_extractions enable row level security;
alter table public.rse_extraction_versions enable row level security;
alter table public.rse_extraction_votes enable row level security;
alter table public.rse_challenges enable row level security;
alter table public.rse_appraisal_frameworks enable row level security;
alter table public.rse_appraisals enable row level security;
alter table public.rse_reviews enable row level security;
alter table public.rse_review_members enable row level security;
alter table public.rse_review_searches enable row level security;
alter table public.rse_review_work_links enable row level security;
alter table public.rse_review_extraction_links enable row level security;
alter table public.rse_live_views enable row level security;
alter table public.rse_activity_events enable row level security;
alter table public.rse_oauth_states enable row level security;

-- Public profile and research content reads.
create policy rse_profiles_public_read on public.rse_profiles for select using (is_public or id=auth.uid());
create policy rse_profiles_self_update on public.rse_profiles for update using (id=auth.uid()) with check (id=auth.uid());

create policy rse_orgs_public_read on public.rse_organizations for select using (true);
create policy rse_orgs_auth_insert on public.rse_organizations for insert to authenticated with check (created_by=auth.uid());
create policy rse_orgs_admin_update on public.rse_organizations for update to authenticated using (created_by=auth.uid() or public.rse_is_org_admin(id,auth.uid()));

create policy rse_org_members_read on public.rse_org_members for select using (status='active' or user_id=auth.uid() or public.rse_is_org_admin(org_id,auth.uid()));
create policy rse_org_members_admin_update on public.rse_org_members for update to authenticated using (public.rse_is_org_admin(org_id,auth.uid())) with check (public.rse_is_org_admin(org_id,auth.uid()));
create policy rse_org_members_creator_insert on public.rse_org_members for insert to authenticated with check (
  (user_id=auth.uid() and role='owner' and status='active' and exists(select 1 from public.rse_organizations o where o.id=org_id and o.created_by=auth.uid()))
  or public.rse_is_org_admin(org_id,auth.uid())
);

create policy rse_follows_public_read on public.rse_follows for select using (true);
create policy rse_follows_self_insert on public.rse_follows for insert to authenticated with check (follower_id=auth.uid());
create policy rse_follows_self_delete on public.rse_follows for delete to authenticated using (follower_id=auth.uid());

create policy rse_works_public_read on public.rse_works for select using (is_public or added_by=auth.uid());
create policy rse_works_auth_insert on public.rse_works for insert to authenticated with check (added_by=auth.uid());
create policy rse_works_creator_update on public.rse_works for update to authenticated using (added_by=auth.uid()) with check (added_by=auth.uid());

create policy rse_work_authors_read on public.rse_work_authors for select using (exists(select 1 from public.rse_works w where w.id=work_id and (w.is_public or w.added_by=auth.uid())));
create policy rse_work_authors_auth_insert on public.rse_work_authors for insert to authenticated with check (
  created_by=auth.uid() and (
    exists(select 1 from public.rse_works w where w.id=work_id and w.added_by=auth.uid())
    or exists(select 1 from public.rse_profiles p where p.id=auth.uid() and p.is_platform_admin)
  )
);
create policy rse_work_authors_creator_update on public.rse_work_authors for update to authenticated using (created_by=auth.uid());

create policy rse_claims_self_read on public.rse_authorship_claims for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.rse_profiles p where p.id=auth.uid() and p.is_platform_admin));
create policy rse_claims_self_insert on public.rse_authorship_claims for insert to authenticated with check (user_id=auth.uid());

create policy rse_cohorts_public_read on public.rse_cohorts for select using (exists(select 1 from public.rse_works w where w.id=work_id and w.is_public));
create policy rse_cohorts_auth_insert on public.rse_cohorts for insert to authenticated with check (created_by=auth.uid());
create policy rse_cohorts_creator_update on public.rse_cohorts for update to authenticated using (created_by=auth.uid());

create policy rse_outcomes_public_read on public.rse_outcome_concepts for select using (true);
create policy rse_outcomes_auth_insert on public.rse_outcome_concepts for insert to authenticated with check (created_by=auth.uid());

create policy rse_slots_public_read on public.rse_evidence_slots for select using (exists(select 1 from public.rse_works w where w.id=work_id and w.is_public));
create policy rse_slots_auth_insert on public.rse_evidence_slots for insert to authenticated with check (created_by=auth.uid());

create policy rse_extractions_public_read on public.rse_extractions for select using (
  exists(select 1 from public.rse_evidence_slots s join public.rse_works w on w.id=s.work_id where s.id=slot_id and w.is_public)
);
create policy rse_extractions_auth_insert on public.rse_extractions for insert to authenticated with check (created_by=auth.uid());
create policy rse_extractions_creator_update on public.rse_extractions for update to authenticated using (created_by=auth.uid()) with check (created_by=auth.uid());

create policy rse_versions_public_read on public.rse_extraction_versions for select using (
  exists(select 1 from public.rse_extractions e join public.rse_evidence_slots s on s.id=e.slot_id join public.rse_works w on w.id=s.work_id where e.id=extraction_id and w.is_public)
);

create policy rse_votes_public_read on public.rse_extraction_votes for select using (true);
create policy rse_votes_self_insert on public.rse_extraction_votes for insert to authenticated with check (user_id=auth.uid());
create policy rse_votes_self_update on public.rse_extraction_votes for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy rse_votes_self_delete on public.rse_extraction_votes for delete to authenticated using (user_id=auth.uid());

create policy rse_challenges_public_read on public.rse_challenges for select using (true);
create policy rse_challenges_auth_insert on public.rse_challenges for insert to authenticated with check (created_by=auth.uid());
create policy rse_challenges_creator_update on public.rse_challenges for update to authenticated
  using (created_by=auth.uid() and status in ('open','withdrawn'))
  with check (created_by=auth.uid() and status in ('open','withdrawn'));
create policy rse_challenges_extraction_owner_resolve on public.rse_challenges for update to authenticated using (
  exists(select 1 from public.rse_extractions e where e.id=extraction_id and e.created_by=auth.uid())
);

create policy rse_frameworks_public_read on public.rse_appraisal_frameworks for select using (is_public or created_by=auth.uid());
create policy rse_frameworks_auth_insert on public.rse_appraisal_frameworks for insert to authenticated with check (created_by=auth.uid());

create policy rse_appraisals_public_read on public.rse_appraisals for select using (exists(select 1 from public.rse_works w where w.id=work_id and w.is_public));
create policy rse_appraisals_self_insert on public.rse_appraisals for insert to authenticated with check (user_id=auth.uid());
create policy rse_appraisals_self_update on public.rse_appraisals for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy rse_reviews_read on public.rse_reviews for select using (
  visibility in ('public','unlisted') or owner_user_id=auth.uid() or public.rse_is_review_member(id,auth.uid())
);
create policy rse_reviews_auth_insert on public.rse_reviews for insert to authenticated with check (owner_user_id=auth.uid());
create policy rse_reviews_member_update on public.rse_reviews for update to authenticated using (public.rse_is_review_member(id,auth.uid()));
create policy rse_review_members_read on public.rse_review_members for select using (public.rse_is_review_member(review_id,auth.uid()) or exists(select 1 from public.rse_reviews r where r.id=review_id and r.visibility='public'));
create policy rse_review_members_editor_insert on public.rse_review_members for insert to authenticated with check (public.rse_is_review_member(review_id,auth.uid()));

create policy rse_review_searches_read on public.rse_review_searches for select using (exists(select 1 from public.rse_reviews r where r.id=review_id and (r.visibility in ('public','unlisted') or public.rse_is_review_member(r.id,auth.uid()))));
create policy rse_review_searches_editor_insert on public.rse_review_searches for insert to authenticated with check (public.rse_is_review_member(review_id,auth.uid()) and created_by=auth.uid());
create policy rse_review_searches_editor_delete on public.rse_review_searches for delete to authenticated using (public.rse_is_review_member(review_id,auth.uid()));

create policy rse_review_work_read on public.rse_review_work_links for select using (exists(select 1 from public.rse_reviews r where r.id=review_id and (r.visibility in ('public','unlisted') or public.rse_is_review_member(r.id,auth.uid()))));
create policy rse_review_work_editor_insert on public.rse_review_work_links for insert to authenticated with check (public.rse_is_review_member(review_id,auth.uid()) and added_by=auth.uid());
create policy rse_review_work_editor_update on public.rse_review_work_links for update to authenticated using (public.rse_is_review_member(review_id,auth.uid()));
create policy rse_review_work_editor_delete on public.rse_review_work_links for delete to authenticated using (public.rse_is_review_member(review_id,auth.uid()));

create policy rse_review_extraction_read on public.rse_review_extraction_links for select using (exists(select 1 from public.rse_reviews r where r.id=review_id and (r.visibility in ('public','unlisted') or public.rse_is_review_member(r.id,auth.uid()))));

create policy rse_live_views_public_read on public.rse_live_views for select using (is_public or owner_user_id=auth.uid());
create policy rse_live_views_auth_insert on public.rse_live_views for insert to authenticated with check (owner_user_id=auth.uid());
create policy rse_live_views_owner_update on public.rse_live_views for update to authenticated using (owner_user_id=auth.uid());

create policy rse_activity_public_read on public.rse_activity_events for select using (is_public or actor_id=auth.uid());

create policy rse_oauth_states_self_read on public.rse_oauth_states for select to authenticated using (user_id=auth.uid());

-- Grant view/RPC access used by the browser client.
grant select on public.rse_extraction_vote_counts to anon, authenticated;
grant select on public.rse_consensus_extractions to anon, authenticated;
grant select on public.rse_community_appraisals to anon, authenticated;
grant select on public.rse_synthesis_rows to anon, authenticated;
grant select on public.rse_profile_metrics to anon, authenticated;
grant execute on function public.rse_global_metrics() to anon, authenticated;
grant execute on function public.rse_find_possible_work_duplicates(text,text,text,int) to anon, authenticated;
grant execute on function public.rse_join_organization(uuid) to authenticated;
grant execute on function public.rse_claim_authorship(uuid) to authenticated;
grant execute on function public.rse_resolve_authorship_claim(uuid,text,text) to authenticated;
grant execute on function public.rse_snapshot_review(uuid) to authenticated;
grant execute on function public.rse_fork_review(uuid) to authenticated;
