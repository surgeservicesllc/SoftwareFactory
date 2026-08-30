            select object_name, object_kind, present from (
              values
                ('provider_credentials', 'table', to_regclass('public.provider_credentials') is not null),
                ('provider_connect_sessions', 'table', to_regclass('public.provider_connect_sessions') is not null),
                ('provider_connect_sessions_expiry_idx', 'index', to_regclass('public.provider_connect_sessions_expiry_idx') is not null),
                ('list_provider_credentials', 'function', to_regprocedure('public.list_provider_credentials(uuid)') is not null),
                ('open_provider_connect_session', 'function', to_regprocedure('public.open_provider_connect_session(uuid,text,text,integer)') is not null),
                ('resolve_provider_connect_session', 'function', to_regprocedure('public.resolve_provider_connect_session(text)') is not null),
                ('claim_provider_connect_session', 'function', to_regprocedure('public.claim_provider_connect_session(text,text)') is not null),
                ('read_provider_credential', 'function', to_regprocedure('public.read_provider_credential(uuid,text)') is not null),
                ('forget_provider_credential', 'function', to_regprocedure('public.forget_provider_credential(uuid,text)') is not null)
            ) as inventory(object_name, object_kind, present)
            order by object_kind, object_name;
