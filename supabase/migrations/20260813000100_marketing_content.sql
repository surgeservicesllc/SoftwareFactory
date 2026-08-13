-- Marketing content.
--
-- These tables are deliberately world-readable: they hold published marketing
-- copy, not tenant data. That is expressed as an explicit `anon` SELECT policy
-- gated on `published`, never as disabled row security. Nothing here grants a
-- new write path to a browser, and no marketing table references a tenant table.
--
-- One table accepts public input: `newsletter_subscribers`. It is insert-only,
-- through a validating SECURITY DEFINER function, and `anon` cannot read it back.

create type public.marketing_resource_kind as enum (
  'guide', 'template', 'video', 'case_study', 'checklist', 'documentation', 'download'
);

create table public.marketing_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{0,62}$'),
  eyebrow text check (eyebrow is null or char_length(eyebrow) <= 80),
  headline text not null check (char_length(btrim(headline)) between 1 and 200),
  headline_accent text check (headline_accent is null or char_length(headline_accent) <= 120),
  subheadline text check (subheadline is null or char_length(subheadline) <= 600),
  seo_title text not null check (char_length(btrim(seo_title)) between 1 and 120),
  seo_description text not null check (char_length(btrim(seo_description)) between 1 and 320),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_stats (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null references public.marketing_pages(slug) on delete cascade,
  value text not null check (char_length(btrim(value)) between 1 and 24),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  icon text not null default 'sparkles' check (icon ~ '^[a-z][a-z0-9-]{0,40}$'),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_features (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null references public.marketing_pages(slug) on delete cascade,
  -- Groups a page's cards into rows: 'lifecycle', 'foundation', 'value', 'pillar', 'category'.
  group_key text not null check (group_key ~ '^[a-z][a-z0-9_-]{0,40}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 400),
  icon text not null default 'sparkles' check (icon ~ '^[a-z][a-z0-9-]{0,40}$'),
  accent text not null default 'violet' check (accent ~ '^[a-z][a-z0-9-]{0,20}$'),
  href text check (href is null or href ~ '^(/|https://)'),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_pricing_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{0,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  monthly_price_cents integer check (monthly_price_cents is null or monthly_price_cents >= 0),
  yearly_price_cents integer check (yearly_price_cents is null or yearly_price_cents >= 0),
  -- Null prices render as "Custom"; the cadence label carries the unit.
  price_note text check (price_note is null or char_length(price_note) <= 60),
  blurb text not null check (char_length(btrim(blurb)) between 1 and 240),
  cta_label text not null check (char_length(btrim(cta_label)) between 1 and 40),
  cta_href text not null check (cta_href ~ '^(/|https://)'),
  accent text not null default 'violet' check (accent ~ '^[a-z][a-z0-9-]{0,20}$'),
  highlighted boolean not null default false,
  highlight_label text check (highlight_label is null or char_length(highlight_label) <= 32),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_slug text not null references public.marketing_pricing_plans(slug) on delete cascade,
  -- Null for a row that only appears in the comparison matrix, not on the card.
  label text check (label is null or char_length(btrim(label)) between 1 and 80),
  -- Comparison-matrix cell. Null means the row is card-only.
  matrix_row text check (matrix_row is null or char_length(matrix_row) <= 60),
  matrix_value text check (matrix_value is null or char_length(matrix_value) <= 40),
  included boolean not null default true,
  show_on_card boolean not null default true,
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{0,80}$'),
  kind public.marketing_resource_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null check (char_length(btrim(summary)) between 1 and 400),
  read_time text check (read_time is null or char_length(read_time) <= 24),
  level text check (level is null or char_length(level) <= 24),
  href text not null default '#' check (href ~ '^(#|/|https://)'),
  topic text check (topic is null or char_length(topic) <= 60),
  featured boolean not null default false,
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_resource_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  icon text not null default 'sparkles' check (icon ~ '^[a-z][a-z0-9-]{0,40}$'),
  resource_count integer not null default 0 check (resource_count >= 0),
  -- 'topic' renders in the popular-topics grid; 'role' in the explore-by-role list.
  kind text not null default 'topic' check (kind in ('topic', 'role')),
  href text not null default '/resources' check (href ~ '^(/|https://)'),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  role text not null check (char_length(btrim(role)) between 1 and 80),
  bio text not null check (char_length(btrim(bio)) between 1 and 400),
  headshot_url text check (headshot_url is null or headshot_url ~ '^(/|https://)'),
  linkedin_url text check (linkedin_url is null or linkedin_url ~ '^https://'),
  twitter_url text check (twitter_url is null or twitter_url ~ '^https://'),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_testimonials (
  id uuid primary key default gen_random_uuid(),
  quote text not null check (char_length(btrim(quote)) between 1 and 600),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 80),
  author_title text not null check (char_length(btrim(author_title)) between 1 and 80),
  avatar_url text check (avatar_url is null or avatar_url ~ '^(/|https://)'),
  page_slug text references public.marketing_pages(slug) on delete cascade,
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_logos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  wordmark text not null check (char_length(btrim(wordmark)) between 1 and 40),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (
    char_length(email) between 6 and 254
    and email = lower(email)
    and email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  source text not null default 'resources' check (source ~ '^[a-z][a-z0-9-]{0,40}$'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_stats_page_idx on public.marketing_stats (page_slug, sort_order);
create index marketing_features_page_idx on public.marketing_features (page_slug, group_key, sort_order);
create index marketing_plan_features_plan_idx on public.marketing_plan_features (plan_slug, sort_order);
create index marketing_pricing_plans_sort_idx on public.marketing_pricing_plans (sort_order);
create index marketing_resources_featured_idx on public.marketing_resources (featured, sort_order);
create index marketing_resources_kind_idx on public.marketing_resources (kind, sort_order);
create index marketing_resource_topics_kind_idx on public.marketing_resource_topics (kind, sort_order);
create index marketing_team_members_sort_idx on public.marketing_team_members (sort_order);
create index marketing_testimonials_page_idx on public.marketing_testimonials (page_slug, sort_order);
create index marketing_logos_sort_idx on public.marketing_logos (sort_order);
create index newsletter_subscribers_created_idx on public.newsletter_subscribers (created_at);

do $marketing_triggers$
declare
  target_table text;
begin
  foreach target_table in array array[
    'marketing_pages', 'marketing_stats', 'marketing_features', 'marketing_pricing_plans',
    'marketing_plan_features', 'marketing_resources', 'marketing_resource_topics',
    'marketing_team_members', 'marketing_testimonials', 'marketing_logos',
    'newsletter_subscribers'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security', target_table
    );
    execute format(
      'alter table public.%I force row level security', target_table
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      target_table || '_set_updated_at', target_table
    );
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.reject_sensitive_row_data()',
      target_table || '_reject_sensitive_data', target_table
    );
    execute format('revoke all on table public.%I from anon, authenticated', target_table);
  end loop;

  -- Published marketing content is public by design. The subscriber table is
  -- excluded: it holds personal data and is never readable from a browser.
  foreach target_table in array array[
    'marketing_pages', 'marketing_stats', 'marketing_features', 'marketing_pricing_plans',
    'marketing_plan_features', 'marketing_resources', 'marketing_resource_topics',
    'marketing_team_members', 'marketing_testimonials', 'marketing_logos'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (published)',
      target_table || '_select_published', target_table
    );
    execute format('grant select on table public.%I to anon, authenticated', target_table);
  end loop;
end;
$marketing_triggers$;

comment on table public.newsletter_subscribers is
  'Public-input table. Inserts happen only through public.subscribe_to_newsletter; anon and authenticated hold no SELECT, INSERT, UPDATE, or DELETE privilege.';

-- The single public write path. Validates and normalizes the address, is
-- idempotent per email, and returns a status string rather than row data so a
-- caller cannot use it to enumerate existing subscribers.
create or replace function public.subscribe_to_newsletter(
  p_email text,
  p_source text default 'resources'
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  normalized_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_source, 'resources')));
begin
  if normalized_email = ''
    or pg_catalog.char_length(normalized_email) not between 6 and 254
    or normalized_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception using errcode = '22023', message = 'a valid email address is required';
  end if;
  if normalized_source !~ '^[a-z][a-z0-9-]{0,40}$' then
    normalized_source := 'resources';
  end if;
  if public.text_has_likely_secret(normalized_email) then
    raise exception using errcode = '22023', message = 'that value does not look like an email address';
  end if;

  insert into public.newsletter_subscribers (email, source)
  values (normalized_email, normalized_source)
  on conflict (email) do nothing;

  -- Deliberately uniform: a repeat address and a new address are indistinguishable
  -- to the caller, so the endpoint cannot be used to test whether an email is known.
  return 'subscribed';
end;
$function$;

revoke all on function public.subscribe_to_newsletter(text, text) from public;
grant execute on function public.subscribe_to_newsletter(text, text) to anon, authenticated;

comment on function public.subscribe_to_newsletter(text, text) is
  'Only public write path in the marketing schema. Idempotent per email and returns a constant status so it cannot enumerate subscribers.';

-- ---------------------------------------------------------------- seed content

insert into public.marketing_pages
  (slug, eyebrow, headline, headline_accent, subheadline, seo_title, seo_description, sort_order)
values
  ('home', 'The AI software factory',
   'Ship better software,',
   'faster, with AI.',
   'Plan, build, test, deploy and scale from one platform. AI agents, automation and best practices at every step of the lifecycle.',
   'AI Software Factory — Build, Deploy and Scale with AI',
   'An end-to-end platform that helps teams plan, build, deploy and scale better software, faster, with AI agents and automation at every step.', 0),
  ('platform', 'The complete AI-powered platform',
   'One Platform. Everything You Need to',
   'Build, Deploy and Scale.',
   'AI Software Factory provides a unified, end-to-end platform that empowers teams to build better software with AI agents, collaboration and automation at every step.',
   'Platform — AI Software Factory',
   'A unified, end-to-end platform for planning, building, testing, deploying, operating and scaling software with AI agents and automation.', 1),
  ('features', 'Every capability, in depth',
   'The features behind',
   'every great release.',
   'Explore the AI agents, automation, collaboration and governance capabilities that carry an idea from first prompt to production.',
   'Features — AI Software Factory',
   'AI agents, automation, collaboration, insight and governance capabilities that carry an idea from first prompt to production.', 2),
  ('solutions', 'Solutions',
   'See the factory',
   'in operation.',
   'A truthful operating view of connected projects, delivery controls and engineering intelligence.',
   'Solutions — AI Software Factory',
   'A live operating view of connected projects, pull requests, safety posture and engineering intelligence.', 3),
  ('pricing', 'Pricing',
   'Simple, Transparent Pricing. Built for',
   'Every Team.',
   'Choose the plan that fits your team''s needs. Upgrade, downgrade, or cancel anytime.',
   'Pricing — AI Software Factory',
   'Simple, transparent pricing for every team. Free, Basic, Pro and Enterprise plans with no setup fees and cancel anytime.', 4),
  ('resources', 'Resources',
   'Resources to help you build',
   'better software.',
   'Guides, templates, tutorials and insights from the AI Software Factory team and our community of builders.',
   'Resources — AI Software Factory',
   'Guides, templates, tutorials, case studies and downloads from the AI Software Factory team and community.', 5),
  ('about', 'About AI Software Factory',
   'We''re building the future of software development with',
   'AI at the core.',
   'AI Software Factory is an end-to-end platform that helps teams plan, build, deploy and scale better software—faster. Our mission is simple: empower builders to turn ideas into impact with AI, automation and best practices.',
   'About — AI Software Factory',
   'We are building the future of software development with AI at the core. Meet the mission, values and team behind AI Software Factory.', 6);

insert into public.marketing_stats (page_slug, value, label, icon, sort_order) values
  ('about', '25K+', 'Teams empowered', 'users', 0),
  ('about', '2M+', 'Projects built', 'code', 1),
  ('about', '100+', 'Countries', 'globe', 2),
  ('about', '99.9%', 'Platform uptime', 'zap', 3),
  ('home', '25K+', 'Teams empowered', 'users', 0),
  ('home', '2M+', 'Projects built', 'code', 1),
  ('home', '100+', 'Countries', 'globe', 2),
  ('home', '99.9%', 'Platform uptime', 'zap', 3);

insert into public.marketing_features (page_slug, group_key, title, body, icon, accent, sort_order) values
  ('platform', 'lifecycle', 'Plan', 'AI for product strategy, requirements, roadmaps and prioritization.', 'clipboard', 'violet', 0),
  ('platform', 'lifecycle', 'Build', 'AI-powered IDE, code generation, review and best practice guidance.', 'code', 'blue', 1),
  ('platform', 'lifecycle', 'Test', 'AI testing agents, automated QA, test generation and coverage.', 'shield-check', 'emerald', 2),
  ('platform', 'lifecycle', 'Deploy', 'Automated pipelines, one-click deployments and environment management.', 'cloud-upload', 'sky', 3),
  ('platform', 'lifecycle', 'Operate', 'Real-time monitoring, analytics, alerts and incident management.', 'trending-up', 'violet', 4),
  ('platform', 'lifecycle', 'Scale', 'Auto-scaling, cost optimization and performance tuning.', 'rocket', 'fuchsia', 5),
  ('platform', 'foundation', 'Enterprise Security', 'Zero-trust, SSO, RBAC, encryption and compliance.', 'shield-check', 'blue', 0),
  ('platform', 'foundation', 'Unified Data Layer', 'Connects all your data and tools in one place.', 'database', 'violet', 1),
  ('platform', 'foundation', 'AI Agents', 'Specialized agents for every stage of the software lifecycle.', 'brain', 'sky', 2),
  ('platform', 'foundation', 'Integrations', 'Seamless integrations with your favorite tools.', 'puzzle', 'fuchsia', 3),
  ('platform', 'foundation', 'Global Scale', 'Built for performance, reliability and scale.', 'globe', 'blue', 4),
  ('platform', 'foundation', 'Open & Flexible', 'Open APIs, SDKs and extensible architecture.', 'bar-chart', 'emerald', 5),
  ('platform', 'stack', 'AI Agents', 'Specialized agents that plan, write, review and verify work.', 'brain', 'sky', 0),
  ('platform', 'stack', 'Automation', 'Workflows that remove the repetitive parts of delivery.', 'zap', 'violet', 1),
  ('platform', 'stack', 'Data & Context', 'One context layer so every agent sees the same truth.', 'database', 'blue', 2),
  ('platform', 'stack', 'Security', 'Zero-trust controls applied at every boundary.', 'lock', 'fuchsia', 3),
  ('platform', 'stack', 'Infrastructure', 'Reliable, global infrastructure you do not have to run.', 'cloud', 'emerald', 4),
  ('about', 'value', 'Customer First', 'We build with empathy and obsess over our customers'' success.', 'users', 'violet', 0),
  ('about', 'value', 'Innovation', 'We push boundaries and continuously innovate to stay ahead.', 'lightbulb', 'sky', 1),
  ('about', 'value', 'Integrity', 'We act with transparency, honesty and respect in everything we do.', 'shield-check', 'blue', 2),
  ('about', 'value', 'Collaboration', 'We win together by empowering teams and sharing knowledge.', 'users', 'fuchsia', 3),
  ('about', 'value', 'Excellence', 'We are committed to quality, performance and continuous improvement.', 'star', 'emerald', 4),
  ('resources', 'category', 'Guides & Tutorials', 'Step-by-step guides to help you get started.', 'book-open', 'violet', 0),
  ('resources', 'category', 'Documentation', 'Technical docs and API references.', 'code', 'blue', 1),
  ('resources', 'category', 'Templates', 'Production-ready templates & blueprints.', 'layout', 'emerald', 2),
  ('resources', 'category', 'Videos', 'Watch tutorials, demos and expert sessions.', 'play', 'amber', 3),
  ('resources', 'category', 'Case Studies', 'Real-world stories from our customers.', 'users', 'fuchsia', 4),
  ('resources', 'category', 'Downloads', 'Ebooks, checklists and resource kits.', 'download', 'sky', 5),
  ('resources', 'pillar', 'Learn', 'In-depth guides and tutorials to accelerate your skills.', 'book-open', 'violet', 0),
  ('resources', 'pillar', 'Build', 'Templates, examples and best practices to ship faster.', 'code', 'blue', 1),
  ('resources', 'pillar', 'Connect', 'Join a community of innovators solving real problems.', 'users', 'fuchsia', 2),
  ('resources', 'pillar', 'Stay Ahead', 'Insights, trends and updates from the world of AI.', 'trending-up', 'emerald', 3),
  ('pricing', 'pillar', 'Plan', 'Strategize with AI', 'clipboard', 'violet', 0),
  ('pricing', 'pillar', 'Build', 'Ship better software', 'code', 'blue', 1),
  ('pricing', 'pillar', 'Deploy', 'One-click deployments', 'cloud-upload', 'sky', 2),
  ('pricing', 'pillar', 'Operate', 'Monitor & optimize', 'trending-up', 'emerald', 3),
  ('pricing', 'pillar', 'Scale', 'Grow without limits', 'rocket', 'fuchsia', 4),
  ('pricing', 'security', 'SOC 2 Type II Compliant', 'Independently audited controls.', 'shield-check', 'emerald', 0),
  ('pricing', 'security', 'ISO 27001 Certified', 'Certified information security management.', 'shield-check', 'emerald', 1),
  ('pricing', 'security', 'Data Encrypted in Transit and at Rest', 'Encryption everywhere by default.', 'lock', 'emerald', 2),
  ('pricing', 'security', '99.9% Platform Uptime', 'Backed by our service level agreement.', 'clock', 'emerald', 3),
  ('pricing', 'security', 'Advanced Access Controls', 'SSO, RBAC and fine-grained permissions.', 'users', 'emerald', 4),
  ('features', 'pillar', 'AI Agents', 'Specialized agents for planning, building, testing and reviewing.', 'brain', 'violet', 0),
  ('features', 'pillar', 'Automation', 'Workflows that carry work forward without babysitting.', 'zap', 'blue', 1),
  ('features', 'pillar', 'Collaboration', 'One place for humans and agents to work the same backlog.', 'users', 'fuchsia', 2),
  ('features', 'pillar', 'Insight', 'Analytics that explain velocity, quality and cost.', 'bar-chart', 'sky', 3),
  ('features', 'pillar', 'Governance', 'Approvals, audit trails and risk controls that hold.', 'shield-check', 'emerald', 4),
  ('features', 'pillar', 'Extensibility', 'Open APIs and SDKs so the platform fits your stack.', 'puzzle', 'amber', 5);

insert into public.marketing_pricing_plans
  (slug, name, monthly_price_cents, yearly_price_cents, price_note, blurb, cta_label, cta_href, accent, highlighted, highlight_label, sort_order)
values
  ('free', 'Free', 0, 0, 'forever', 'Perfect for individuals and exploring the platform.', 'Get Started', '/sign-in', 'emerald', false, null, 0),
  ('basic', 'Basic', 2900, 2320, 'user / month', 'Everything you need to build and ship great software.', 'Start Free Trial', '/sign-in', 'blue', false, null, 1),
  ('pro', 'Pro', 7900, 6320, 'user / month', 'Advanced tools for growing teams and complex products.', 'Start Free Trial', '/sign-in', 'violet', true, 'Most Popular', 2),
  ('enterprise', 'Enterprise', null, null, null, 'Built for organizations with advanced security, scale and support needs.', 'Contact Sales', '/about', 'fuchsia', false, null, 3);

insert into public.marketing_plan_features (plan_slug, label, matrix_row, matrix_value, included, sort_order) values
  ('free', '1 User', 'Users', '1', true, 0),
  ('free', '1 Project', 'Projects', '1', true, 1),
  ('free', 'AI Code Assistant (Limited)', 'AI Code Assistant', 'Limited', true, 2),
  ('free', 'Community Support', 'Priority Support', 'Community', true, 3),
  ('free', 'Basic Integrations', null, null, true, 4),
  ('free', null, 'AI Agents', null, false, 5),
  ('free', null, 'Automation & Workflows', null, false, 6),
  ('free', null, 'Advanced Analytics', null, false, 7),
  ('free', null, 'SSO & Role Management', null, false, 8),
  ('free', null, 'SLA', null, false, 9),
  ('basic', 'Up to 5 Users', 'Users', 'Up to 5', true, 0),
  ('basic', 'Unlimited Projects', 'Projects', 'Unlimited', true, 1),
  ('basic', 'AI Code Assistant', 'AI Code Assistant', null, true, 2),
  ('basic', 'Standard Integrations', null, null, true, 3),
  ('basic', 'Email Support', 'Priority Support', 'Email', true, 4),
  ('basic', 'Basic Analytics', null, null, true, 5),
  ('basic', null, 'AI Agents', null, true, 6),
  ('basic', null, 'Automation & Workflows', null, false, 7),
  ('basic', null, 'Advanced Analytics', null, true, 8),
  ('basic', null, 'SSO & Role Management', null, false, 9),
  ('basic', null, 'SLA', null, false, 10),
  ('pro', 'Up to 25 Users', 'Users', 'Up to 25', true, 0),
  ('pro', 'Unlimited Projects', 'Projects', 'Unlimited', true, 1),
  ('pro', 'Advanced AI Agents', 'AI Code Assistant', null, true, 2),
  ('pro', 'Automation & Workflows', 'Automation & Workflows', null, true, 3),
  ('pro', 'Priority Support', 'Priority Support', 'Priority', true, 4),
  ('pro', 'Advanced Analytics', 'Advanced Analytics', null, true, 5),
  ('pro', 'SSO & Role Management', 'SSO & Role Management', null, true, 6),
  ('pro', null, 'AI Agents', null, true, 7),
  ('pro', null, 'SLA', '99.9%', true, 8),
  ('enterprise', 'Unlimited Users', 'Users', 'Unlimited', true, 0),
  ('enterprise', 'Unlimited Projects', 'Projects', 'Unlimited', true, 1),
  ('enterprise', 'Custom AI Solutions', 'AI Code Assistant', null, true, 2),
  ('enterprise', 'Advanced Security & Compliance', 'SSO & Role Management', null, true, 3),
  ('enterprise', 'Dedicated Support & SLA', 'Priority Support', 'Dedicated', true, 4),
  ('enterprise', 'Onboarding & Training', 'Advanced Analytics', null, true, 5),
  ('enterprise', 'Custom Integrations', 'Automation & Workflows', null, true, 6),
  ('enterprise', null, 'AI Agents', null, true, 7),
  ('enterprise', null, 'SLA', '99.9%', true, 8);

insert into public.marketing_resources
  (slug, kind, title, summary, read_time, level, topic, featured, sort_order)
values
  ('ultimate-guide-ai-powered-software-development', 'guide',
   'The Ultimate Guide to AI-Powered Software Development',
   'Learn how to build, test and deploy software faster with AI.',
   '12 min read', 'Beginner', 'AI Agents', true, 0),
  ('ai-agent-starter-kit', 'template',
   'AI Agent Starter Kit',
   'Kickstart your project with our production-ready AI agent template.',
   null, 'All Levels', 'AI Agents', true, 1),
  ('build-your-first-ai-agent', 'video',
   'Build Your First AI Agent',
   'Watch how to build and deploy an AI agent in under 30 minutes.',
   '28 min', 'Intermediate', 'AI Agents', true, 2),
  ('how-acme-scaled-5x-faster', 'case_study',
   'How ACME Scaled 5x Faster with AI Software Factory',
   'See how ACME improved velocity and reduced costs by 60%.',
   '8 min read', 'Case Study', 'Scaling', true, 3),
  ('production-readiness-checklist', 'checklist',
   'Production Readiness Checklist',
   'Ensure your application is secure, scalable and production-ready.',
   null, 'All Levels', 'Best Practices', true, 4),
  ('platform-api-reference', 'documentation',
   'Platform API Reference',
   'Every endpoint, parameter and response shape in one place.',
   null, 'All Levels', 'DevOps & CI/CD', false, 5),
  ('automating-code-review', 'guide',
   'Automating Code Review Without Losing Judgment',
   'Where automated review helps, where it hurts, and how to tell.',
   '9 min read', 'Intermediate', 'Best Practices', false, 6),
  ('zero-downtime-deployment-playbook', 'download',
   'Zero-Downtime Deployment Playbook',
   'A practical playbook for shipping continuously without user impact.',
   null, 'Advanced', 'DevOps & CI/CD', false, 7);

insert into public.marketing_resource_topics (name, icon, resource_count, kind, sort_order) values
  ('AI Agents', 'brain', 23, 'topic', 0),
  ('Automation', 'zap', 18, 'topic', 1),
  ('DevOps & CI/CD', 'infinity', 21, 'topic', 2),
  ('Best Practices', 'gem', 27, 'topic', 3),
  ('Security', 'shield-check', 16, 'topic', 4),
  ('Scaling', 'trending-up', 19, 'topic', 5),
  ('Developers', 'users', 32, 'role', 0),
  ('DevOps Engineers', 'users', 24, 'role', 1),
  ('Product Managers', 'users', 15, 'role', 2);

insert into public.marketing_team_members (name, role, bio, linkedin_url, twitter_url, sort_order) values
  ('Daniel Hughes', 'CEO & Co-Founder',
   'Visionary leader with a passion for AI, automation and building world-class products.',
   'https://www.linkedin.com/', 'https://x.com/', 0),
  ('Sarah Chen', 'CTO & Co-Founder',
   'Engineering leader focused on scalable systems, developer experience and AI innovation.',
   'https://www.linkedin.com/', 'https://x.com/', 1),
  ('Arjun Patel', 'Head of Product',
   'Product strategist passionate about solving real problems for builders and teams.',
   'https://www.linkedin.com/', 'https://x.com/', 2),
  ('Emily Roberts', 'Head of Customer Success',
   'Customer advocate ensuring teams achieve more with the power of our platform.',
   'https://www.linkedin.com/', 'https://x.com/', 3),
  ('Mark Johnson', 'Head of Growth',
   'Growth leader driving impact and helping builders around the world succeed.',
   'https://www.linkedin.com/', 'https://x.com/', 4);

insert into public.marketing_testimonials (quote, author_name, author_title, page_slug, sort_order) values
  ('AI Software Factory has transformed how we build, deploy and scale software. Our productivity is through the roof.',
   'Alex Johnson', 'CTO, TechNova', 'pricing', 0),
  ('We went from idea to production in days instead of quarters, without giving up review or control.',
   'Priya Nair', 'VP Engineering, Northwind', 'home', 0);

insert into public.marketing_logos (name, wordmark, sort_order) values
  ('Coinbase', 'coinbase', 0),
  ('Notion', 'Notion', 1),
  ('Verkada', 'Verkada', 2),
  ('Airbnb', 'airbnb', 3),
  ('Brex', 'BREX', 4),
  ('Zapier', 'zapier', 5),
  ('Atlassian', 'ATLASSIAN', 6);
