set search_path = pg_catalog;
select routine.oid::regprocedure::text as signature,
       md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
       pg_get_userbyid(routine.proowner) as owner,
       routine_language.lanname as language,
       routine.prokind,
       routine.provolatile,
       routine.prosecdef as security_definer,
       routine.proconfig,
       routine.proacl
  from (values (
    'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'
  )) expected(signature)
  left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
  left join pg_language routine_language on routine_language.oid = routine.prolang;
