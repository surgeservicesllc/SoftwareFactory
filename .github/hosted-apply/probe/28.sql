select bot.id, bot.name, bot.provider, bot.model, bot.readiness,
       left(coalesce(bot.readiness_detail, ''), 60) as readiness_detail,
       bot.ai_account_id is not null as has_account,
       account.provider as account_provider, account.auth_method,
       account.status as account_status, account.last_verified_at
  from public.bots bot
  left join public.ai_accounts account on account.id = bot.ai_account_id
 order by bot.created_at;
