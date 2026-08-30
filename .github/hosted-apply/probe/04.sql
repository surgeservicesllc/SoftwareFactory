            select observed_at, status, left(coalesce(detail, ''), 200) as detail
              from public.ai_account_usage_observations
             order by observed_at desc
             limit 5;
