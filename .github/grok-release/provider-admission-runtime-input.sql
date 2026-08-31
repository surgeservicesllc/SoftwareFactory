begin;

create temp table grok_provider_admission_release_input (
  plan jsonb not null,
  release_sha text not null,
  canary_key text not null
) on commit drop;

insert into grok_provider_admission_release_input (
  plan,
  release_sha,
  canary_key
) values (
  :'canary_plan'::jsonb,
  :'release_sha',
  :'canary_key'
);
