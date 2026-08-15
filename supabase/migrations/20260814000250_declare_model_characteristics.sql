-- Let an owner declare a model's strength and context limit without writing SQL.
--
-- `20260814000200` added the columns; nothing could set them except a hand
-- written UPDATE, which meant the Resource Manager was permanently unable to
-- find an eligible worker for anything demanding. That is correct behavior
-- (undeclared fails closed) but it is not a state anyone can leave.
--
-- This is a separate function rather than two more parameters on
-- `upsert_provider_model_configuration`. Adding parameters there would not
-- replace that function — PostgreSQL keys functions by signature, so it would
-- create a second overload alongside the original, and calls with the old
-- argument count would silently keep hitting the old one while calls that
-- omitted the new defaults became ambiguous. A distinct name avoids that
-- entirely, and declaring what a model *is* is a different act from
-- configuring whether it is enabled and what it costs.
--
-- Passing null clears a declaration, which must stay possible: an owner who
-- realises they declared the wrong tier needs to be able to say "I no longer
-- claim this" rather than being forced to substitute another guess.

create or replace function public.declare_model_characteristics(
  p_organization_id uuid,
  p_provider text,
  p_model text,
  p_strength_tier text default null,
  p_context_limit_tokens integer default null
)
-- OUT parameters are named distinctly from the table's columns. Sharing a name
-- makes every unqualified reference inside the body ambiguous, and plpgsql
-- reports that only at call time.
returns table (
  declared_provider text,
  declared_model text,
  declared_strength_tier text,
  declared_context_limit_tokens integer,
  fully_declared boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  updated_row public.provider_model_configurations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- Same authority as configuring the model itself: owner or administrator.
  -- Declaring a tier decides what work the model may be given, so it is not a
  -- member-level action.
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  if p_provider is null or p_provider not in ('anthropic', 'openai') then
    raise exception using errcode = '22023', message = 'provider must be anthropic or openai';
  end if;

  if p_strength_tier is not null
    and p_strength_tier not in ('economical', 'balanced', 'strong') then
    raise exception using errcode = '22023',
      message = 'strength tier must be economical, balanced, or strong';
  end if;

  if p_context_limit_tokens is not null and p_context_limit_tokens < 1 then
    raise exception using errcode = '22023',
      message = 'a context limit must be at least one token';
  end if;

  update public.provider_model_configurations
  set strength_tier = p_strength_tier,
    context_limit_tokens = p_context_limit_tokens,
    updated_at = now()
  where organization_id = p_organization_id
    and provider = p_provider::public.connection_provider
    and model = p_model
  returning * into updated_row;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'that model is not in this organization catalogue';
  end if;

  return query select
    updated_row.provider::text,
    updated_row.model,
    updated_row.strength_tier,
    updated_row.context_limit_tokens,
    (updated_row.strength_tier is not null and updated_row.context_limit_tokens is not null);
end;
$function$;

comment on function public.declare_model_characteristics(uuid, text, text, text, integer) is
  'Owner or administrator declaration of a model strength tier and context limit. Null clears a declaration, which keeps "I no longer claim this" expressible. Separate from upsert_provider_model_configuration so adding parameters there cannot create an ambiguous overload.';

revoke all on function public.declare_model_characteristics(uuid, text, text, text, integer)
  from public, anon, service_role;
grant execute on function public.declare_model_characteristics(uuid, text, text, text, integer)
  to authenticated;
