-- =============================================================================
-- InsiderPulse — 10-K / 10-Q reports
-- -----------------------------------------------------------------------------
-- Tables for the filing-report pipeline (the analyze-filings Edge Function):
--
--   filings          every 10-K / 10-Q found on EDGAR for a tracked company
--   filing_reports   one analysed report per filing (score, change counts, cost)
--   report_items     the risks and positives, each with its verbatim quote
--   report_metrics   headline numbers from the SEC's XBRL data
--   analysis_calls   one row per model call: cost ledger and daily cap
--
-- Full section text is NOT stored (it would outgrow the free database tier);
-- each quote keeps its character offsets in the section text, which the
-- pipeline can rebuild from the filing on EDGAR.
--
-- The Report Score is computed here from numbers that code produced (XBRL
-- changes, risk counts from the change detector, text similarity). The model's
-- own judgements (severity, outlook) are shown in the app but never scored.
--
-- The cron job that runs analyze-filings is added with the function itself.
-- =============================================================================

-- 1. Filings -------------------------------------------------------------------

create table if not exists public.filings (
  id               uuid        primary key default gen_random_uuid(),
  company_id       uuid        not null references public.companies (id) on delete cascade,
  accession_number varchar(25) not null unique,
  form             text        not null,
  fiscal_year      smallint,
  fiscal_period    text,
  period_end       date,
  filed_at         timestamptz not null,
  primary_doc_url  text        not null,
  status           text        not null default 'discovered',
  attempts         smallint    not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint filings_accession_format check (accession_number ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint filings_form check (form in ('10-K', '10-Q', '10-K/A', '10-Q/A')),
  constraint filings_fiscal_period check (fiscal_period is null or fiscal_period in ('FY', 'Q1', 'Q2', 'Q3', 'Q4')),
  constraint filings_primary_doc_url check (primary_doc_url like 'https://www.sec.gov/Archives/edgar/data/%'),
  -- discovered: waiting for analysis · analyzed: has a report · no_sections: nothing to
  -- analyse (e.g. a Part III 10-K/A) · failed: gave up after retries · skipped: out of scope
  constraint filings_status check (status in ('discovered', 'analyzed', 'no_sections', 'failed', 'skipped')),
  constraint filings_attempts check (attempts >= 0)
);

comment on table public.filings is '10-K / 10-Q filings found on EDGAR for tracked companies.';

create index if not exists filings_company_filed_idx on public.filings (company_id, filed_at desc);
create index if not exists filings_pending_idx on public.filings (filed_at) where status = 'discovered';

drop trigger if exists filings_set_updated_at on public.filings;
create trigger filings_set_updated_at
  before update on public.filings
  for each row execute function public.set_updated_at();

-- 2. Reports -------------------------------------------------------------------

create table if not exists public.filing_reports (
  id                     uuid         primary key default gen_random_uuid(),
  filing_id              uuid         not null unique references public.filings (id) on delete cascade,
  company_id             uuid         not null references public.companies (id) on delete cascade,
  -- The report this one was compared with (same form, previous period).
  prior_report_id        uuid         references public.filing_reports (id) on delete set null,
  -- needs_review: too many quotes failed verification; kept for debugging, never shown.
  status                 text         not null default 'published',
  report_score           smallint,
  score_label            text,
  score_components       jsonb        not null default '[]'::jsonb,
  -- Written by the model; shown, not scored.
  summary                text,
  outlook                text,
  -- From the change detector (code, no model).
  risk_factors_unchanged boolean      not null default false,
  risk_similarity        numeric(5,4),
  risk_changed_share     numeric(5,4),
  mdna_similarity        numeric(5,4),
  new_risks              smallint     not null default 0,
  changed_risks          smallint     not null default 0,
  removed_risks          smallint     not null default 0,
  unchanged_risks        smallint     not null default 0,
  -- Cost of producing the report.
  model                  text,
  prompt_version         text,
  input_tokens           integer      not null default 0,
  output_tokens          integer      not null default 0,
  cost_usd               numeric(10,6) not null default 0,
  created_at             timestamptz  not null default now(),
  constraint filing_reports_status check (status in ('published', 'needs_review')),
  constraint filing_reports_score check (report_score is null or report_score between 0 and 100),
  constraint filing_reports_label check (score_label is null or score_label in ('Strong', 'Mixed', 'Weak', 'Concerning')),
  constraint filing_reports_outlook check (outlook is null or outlook in ('improving', 'stable', 'deteriorating')),
  constraint filing_reports_summary_length check (summary is null or char_length(summary) <= 600),
  constraint filing_reports_similarity check (
    (risk_similarity is null or risk_similarity between 0 and 1)
    and (risk_changed_share is null or risk_changed_share between 0 and 1)
    and (mdna_similarity is null or mdna_similarity between 0 and 1)
  ),
  constraint filing_reports_counts check (least(new_risks, changed_risks, removed_risks, unchanged_risks) >= 0),
  constraint filing_reports_cost check (input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0),
  constraint filing_reports_not_own_prior check (prior_report_id is null or prior_report_id <> id)
);

comment on table public.filing_reports is 'One analysed 10-K / 10-Q: Report Score, change counts and cost.';
comment on column public.filing_reports.risk_similarity is
  'Cosine similarity of this filing''s Risk Factors with the prior period''s (1 = same wording).';
comment on column public.filing_reports.risk_changed_share is
  'Share of the Risk Factors'' words in new or reworded paragraphs (0..1).';

create index if not exists filing_reports_company_idx on public.filing_reports (company_id, created_at desc);
create index if not exists filing_reports_feed_idx on public.filing_reports (created_at desc) where status = 'published';
create index if not exists filing_reports_prior_idx on public.filing_reports (prior_report_id);

-- 3. Report items --------------------------------------------------------------

create table if not exists public.report_items (
  id             uuid        primary key default gen_random_uuid(),
  report_id      uuid        not null references public.filing_reports (id) on delete cascade,
  kind           text        not null,
  change         text        not null,
  severity       text,
  category       text        not null default 'other',
  title          text        not null,
  why_it_matters text,
  -- Verbatim from the filing; null for removed risks (they are no longer in it).
  quote          text,
  section        text        not null,
  -- Character offsets of the quote in the section text, set by the quote checker.
  quote_start    integer,
  quote_end      integer,
  page           smallint,
  verified       boolean     not null default false,
  prior_item_id  uuid        references public.report_items (id) on delete set null,
  sort_order     smallint    not null default 0,
  created_at     timestamptz not null default now(),
  constraint report_items_kind check (kind in ('risk', 'positive')),
  constraint report_items_change check (change in ('new', 'changed', 'unchanged', 'removed')),
  constraint report_items_severity check (
    (kind = 'risk' and severity in ('high', 'medium', 'low')) or (kind = 'positive' and severity is null)
  ),
  constraint report_items_category check (category in (
    'demand', 'competition', 'regulation', 'supply_chain', 'financial', 'legal', 'operations', 'macro', 'technology', 'other'
  )),
  constraint report_items_section check (section in ('risk_factors', 'mdna')),
  constraint report_items_title_length check (char_length(title) between 1 and 160),
  constraint report_items_why_length check (why_it_matters is null or char_length(why_it_matters) <= 400),
  constraint report_items_quote_length check (quote is null or char_length(quote) between 1 and 1500),
  constraint report_items_offsets check (
    (quote_start is null and quote_end is null) or (quote_start >= 0 and quote_end > quote_start)
  ),
  -- A verified item has a quote that was found in the filing.
  constraint report_items_verified_quote check (not verified or (quote is not null and quote_start is not null)),
  constraint report_items_removed_has_no_quote check (change <> 'removed' or quote is null)
);

comment on table public.report_items is 'Risks and positives of a report, each backed by a verbatim quote from the filing.';

create index if not exists report_items_report_idx on public.report_items (report_id, sort_order);
create index if not exists report_items_prior_idx on public.report_items (prior_item_id);

-- 4. Metrics -------------------------------------------------------------------

create table if not exists public.report_metrics (
  filing_id        uuid    not null references public.filings (id) on delete cascade,
  metric           text    not null,
  value            numeric not null,
  unit             text    not null,
  period_start     date,
  period_end       date    not null,
  prior_value      numeric,
  prior_period_end date,
  yoy_value        numeric,
  yoy_period_end   date,
  concept          text    not null,
  primary key (filing_id, metric),
  constraint report_metrics_metric check (metric in (
    'revenue', 'operating_income', 'net_income', 'operating_cash_flow', 'eps_diluted', 'cash', 'total_debt', 'shares_outstanding'
  )),
  constraint report_metrics_unit check (unit in ('USD', 'USD/shares', 'shares'))
);

comment on table public.report_metrics is 'Headline numbers of a filing from SEC XBRL company facts, with prior-period and year-ago values.';

-- 5. Model calls ---------------------------------------------------------------

create table if not exists public.analysis_calls (
  id            bigint        generated always as identity primary key,
  filing_id     uuid          references public.filings (id) on delete set null,
  section       text,
  model         text          not null,
  input_tokens  integer       not null default 0,
  output_tokens integer       not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  ok            boolean       not null default true,
  error         text,
  created_at    timestamptz   not null default now(),
  constraint analysis_calls_cost check (input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0)
);

comment on table public.analysis_calls is 'One row per model call by analyze-filings: cost ledger and daily cap (internal).';

create index if not exists analysis_calls_created_idx on public.analysis_calls (created_at);

-- Calls and spend so far today (UTC), for the function's daily cap.
create or replace function public.analysis_usage_today()
returns table (calls bigint, cost_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), coalesce(sum(c.cost_usd), 0)
    from public.analysis_calls c
   where c.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

-- 6. Report Score --------------------------------------------------------------
-- Starting weights, to be replaced by weights fitted against later stock returns:
--   revenue growth (YoY)        25   -10% or worse = 0, flat = 12.5, +15% or better = 25
--   operating cash flow (YoY)   20   same scale; negative cash flow = 0
--   profitability               20   profit and growing 20, profit and shrinking 13,
--                                    loss but narrowing 7, loss widening 0
--   risk changes                25   25 - 5 per new risk - 2 per reworded risk + 2 per removed risk
--   language stability          10   share of Risk Factors rewritten: none = 10, half or more = 0
-- A component without data scores half its points and is marked unavailable.

create or replace function public.report_score_ramp(change numeric, low numeric, high numeric, max_points numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  -- Piecewise linear: low -> 0, 0 -> half, high -> max.
  select case
    when change is null then null
    when change <= low then 0
    when change >= high then max_points
    when change < 0 then max_points / 2 * (change - low) / (0 - low)
    else max_points / 2 + max_points / 2 * change / high
  end;
$$;

create or replace function public.compute_report_score(target_report_id uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.filing_reports%rowtype;
  rev        public.report_metrics%rowtype;
  ocf        public.report_metrics%rowtype;
  ni         public.report_metrics%rowtype;
  rev_change numeric;
  ocf_change numeric;
  pts        numeric;
  total      numeric := 0;
  components jsonb := '[]'::jsonb;
  score      smallint;
  label      text;
begin
  select * into r from public.filing_reports where id = target_report_id;
  if not found then
    raise exception 'filing report % not found', target_report_id;
  end if;
  select * into rev from public.report_metrics where filing_id = r.filing_id and metric = 'revenue';
  select * into ocf from public.report_metrics where filing_id = r.filing_id and metric = 'operating_cash_flow';
  select * into ni  from public.report_metrics where filing_id = r.filing_id and metric = 'net_income';

  -- Revenue growth.
  rev_change := case when rev.yoy_value is not null and rev.yoy_value <> 0
                     then (rev.value - rev.yoy_value) / abs(rev.yoy_value) end;
  pts := public.report_score_ramp(rev_change, -0.10, 0.15, 25);
  components := components || jsonb_build_object(
    'key', 'revenue_growth', 'label', 'Revenue growth', 'max', 25,
    'points', round(coalesce(pts, 12.5), 1), 'available', pts is not null, 'value', round(rev_change, 4));
  total := total + coalesce(pts, 12.5);

  -- Operating cash flow.
  ocf_change := case when ocf.yoy_value is not null and ocf.yoy_value <> 0
                     then (ocf.value - ocf.yoy_value) / abs(ocf.yoy_value) end;
  pts := case when ocf.value is not null and ocf.value < 0 then 0
              else public.report_score_ramp(ocf_change, -0.10, 0.15, 20) end;
  components := components || jsonb_build_object(
    'key', 'cash_flow', 'label', 'Operating cash flow', 'max', 20,
    'points', round(coalesce(pts, 10), 1), 'available', pts is not null, 'value', round(ocf_change, 4));
  total := total + coalesce(pts, 10);

  -- Profitability.
  pts := case
    when ni.value is null or ni.yoy_value is null then null
    when ni.value > 0 and ni.value >= ni.yoy_value then 20
    when ni.value > 0 then 13
    when ni.value > ni.yoy_value then 7
    else 0
  end;
  components := components || jsonb_build_object(
    'key', 'profitability', 'label', 'Profitability', 'max', 20,
    'points', coalesce(pts, 10), 'available', pts is not null,
    'value', case when ni.value is not null then sign(ni.value) end);
  total := total + coalesce(pts, 10);

  -- Risk changes (counts from the change detector).
  pts := greatest(0, least(25, 25 - 5 * r.new_risks - 2 * r.changed_risks + 2 * r.removed_risks));
  components := components || jsonb_build_object(
    'key', 'risk_changes', 'label', 'New and changed risks', 'max', 25, 'points', pts, 'available', true,
    'value', jsonb_build_object('new', r.new_risks, 'changed', r.changed_risks, 'removed', r.removed_risks));
  total := total + pts;

  -- Language stability (how much of Risk Factors was rewritten).
  pts := case
    when r.risk_factors_unchanged then 10
    when r.risk_changed_share is null then null
    else greatest(0, 10 - 20 * r.risk_changed_share)
  end;
  components := components || jsonb_build_object(
    'key', 'language_stability', 'label', 'Risk language stability', 'max', 10,
    'points', round(coalesce(pts, 5), 1), 'available', pts is not null, 'value', r.risk_changed_share);
  total := total + coalesce(pts, 5);

  score := round(greatest(0, least(100, total)));
  label := case when score >= 70 then 'Strong' when score >= 55 then 'Mixed' when score >= 40 then 'Weak' else 'Concerning' end;
  update public.filing_reports
     set report_score = score, score_label = label, score_components = components
   where id = target_report_id;
  return score;
end;
$$;

comment on function public.compute_report_score(uuid) is
  'Report Score (0-100) from XBRL changes and change-detector counts; stores the components for "How this score is built".';

-- 7. Reads for the app ----------------------------------------------------------
-- security invoker: Row Level Security below decides what callers see.

create or replace function public.report_json(target_report_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'company_id', r.company_id,
    'filing', jsonb_build_object(
      'id', f.id, 'accession_number', f.accession_number, 'form', f.form,
      'fiscal_year', f.fiscal_year, 'fiscal_period', f.fiscal_period, 'period_end', f.period_end,
      'filed_at', f.filed_at, 'url', f.primary_doc_url),
    'report_score', r.report_score,
    'score_label', r.score_label,
    'score_components', r.score_components,
    'prior', (select jsonb_build_object('id', p.id, 'report_score', p.report_score, 'score_label', p.score_label,
                                        'fiscal_year', pf.fiscal_year, 'fiscal_period', pf.fiscal_period, 'form', pf.form)
                from public.filing_reports p join public.filings pf on pf.id = p.filing_id
               where p.id = r.prior_report_id),
    'summary', r.summary,
    'outlook', r.outlook,
    'risk_factors_unchanged', r.risk_factors_unchanged,
    'risk_similarity', r.risk_similarity,
    'risk_changed_share', r.risk_changed_share,
    'counts', jsonb_build_object(
      'new_risks', r.new_risks, 'changed_risks', r.changed_risks,
      'removed_risks', r.removed_risks, 'unchanged_risks', r.unchanged_risks,
      'positives', (select count(*) from public.report_items i
                     where i.report_id = r.id and i.kind = 'positive' and i.verified)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'kind', i.kind, 'change', i.change, 'severity', i.severity, 'category', i.category,
               'title', i.title, 'why_it_matters', i.why_it_matters, 'quote', i.quote,
               'section', i.section, 'page', i.page)
             order by i.sort_order, i.title)
        from public.report_items i
       -- Unverified items are never shown; removed risks have no quote to verify.
       where i.report_id = r.id and (i.verified or i.change = 'removed')), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(jsonb_build_object(
               'metric', m.metric, 'value', m.value, 'unit', m.unit,
               'period_start', m.period_start, 'period_end', m.period_end,
               'prior_value', m.prior_value, 'prior_period_end', m.prior_period_end,
               'yoy_value', m.yoy_value, 'yoy_period_end', m.yoy_period_end) order by m.metric)
        from public.report_metrics m
       where m.filing_id = r.filing_id), '[]'::jsonb),
    'created_at', r.created_at
  )
  from public.filing_reports r
  join public.filings f on f.id = r.filing_id
  where r.id = target_report_id;
$$;

-- The company's latest report (by period end, then filing time), or null.
create or replace function public.get_company_report(target_company_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.report_json(r.id)
    from public.filing_reports r
    join public.filings f on f.id = r.filing_id
   where r.company_id = target_company_id
   order by f.period_end desc nulls last, f.filed_at desc
   limit 1;
$$;

create or replace function public.get_filing_report(target_report_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.report_json(target_report_id);
$$;

-- Newest reports first, for the feed. `before` pages by filing time.
create or replace function public.get_report_feed(max_rows integer default 20, before timestamptz default null)
returns table (
  report_id      uuid,
  company_id     uuid,
  ticker         varchar(10),
  company_name   text,
  form           text,
  fiscal_year    smallint,
  fiscal_period  text,
  filed_at       timestamptz,
  report_score   smallint,
  score_label    text,
  prior_score    smallint,
  new_risks      smallint,
  biggest_change text,
  revenue_yoy    numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, c.id, c.ticker, c.company_name, f.form, f.fiscal_year, f.fiscal_period, f.filed_at,
         r.report_score, r.score_label, p.report_score, r.new_risks,
         -- The headline: the most severe new risk, else the first positive.
         (select i.title from public.report_items i
           where i.report_id = r.id and i.verified
             and ((i.kind = 'risk' and i.change = 'new') or i.kind = 'positive')
           order by (i.kind = 'risk') desc,
                    case i.severity when 'high' then 0 when 'medium' then 1 else 2 end,
                    i.sort_order
           limit 1),
         (select round((m.value - m.yoy_value) / abs(m.yoy_value), 4) from public.report_metrics m
           where m.filing_id = f.id and m.metric = 'revenue' and m.yoy_value is not null and m.yoy_value <> 0)
    from public.filing_reports r
    join public.filings f   on f.id = r.filing_id
    join public.companies c on c.id = r.company_id
    left join public.filing_reports p on p.id = r.prior_report_id
   where before is null or f.filed_at < before
   order by f.filed_at desc
   limit least(greatest(coalesce(max_rows, 20), 1), 100);
$$;

-- 8. Row Level Security -----------------------------------------------------------

alter table public.filings        enable row level security;
alter table public.filing_reports enable row level security;
alter table public.report_items   enable row level security;
alter table public.report_metrics enable row level security;
alter table public.analysis_calls enable row level security;

drop policy if exists "Filings are publicly readable" on public.filings;
create policy "Filings are publicly readable"
  on public.filings for select to anon, authenticated using (true);

-- Reports held back for review are not visible to the app.
drop policy if exists "Published reports are publicly readable" on public.filing_reports;
create policy "Published reports are publicly readable"
  on public.filing_reports for select to anon, authenticated using (status = 'published');

drop policy if exists "Items of published reports are publicly readable" on public.report_items;
create policy "Items of published reports are publicly readable"
  on public.report_items for select to anon, authenticated
  using (exists (select 1 from public.filing_reports r where r.id = report_id and r.status = 'published'));

drop policy if exists "Report metrics are publicly readable" on public.report_metrics;
create policy "Report metrics are publicly readable"
  on public.report_metrics for select to anon, authenticated using (true);

-- analysis_calls has no policy: only the service role (which bypasses RLS) reads it.

revoke all on public.filings, public.filing_reports, public.report_items, public.report_metrics, public.analysis_calls
  from anon, authenticated;
grant select on public.filings, public.filing_reports, public.report_items, public.report_metrics
  to anon, authenticated;
grant all on public.filings, public.filing_reports, public.report_items, public.report_metrics, public.analysis_calls
  to service_role;
grant usage, select on sequence public.analysis_calls_id_seq to service_role;

revoke execute on function public.compute_report_score(uuid) from public, anon, authenticated;
revoke execute on function public.analysis_usage_today() from public, anon, authenticated;
grant execute on function public.compute_report_score(uuid), public.analysis_usage_today() to service_role;
grant execute on function public.report_score_ramp(numeric, numeric, numeric, numeric) to anon, authenticated, service_role;
grant execute on function public.report_json(uuid), public.get_company_report(uuid), public.get_filing_report(uuid),
  public.get_report_feed(integer, timestamptz) to anon, authenticated, service_role;
