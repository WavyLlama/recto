-- Recto v3: pseudo and photo in the admin list. Run after supabase-v2.sql (safe to re-run).
drop function if exists public.admin_users();
create function public.admin_users()
returns table (id uuid, email text, name text, avatar_url text, created_at timestamptz, last_sign_in_at timestamptz, decks bigint, cards bigint, is_admin boolean, ai_today int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select u.id, u.email::text, (u.raw_user_meta_data->>'name')::text, (u.raw_user_meta_data->>'avatar_url')::text,
      u.created_at, u.last_sign_in_at,
      count(d.id) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'),
      coalesce(sum(jsonb_array_length(d.data->'cards')) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'), 0)::bigint,
      exists (select 1 from public.admins a where a.user_id = u.id),
      coalesce((select x.n from public.ai_usage x where x.user_id = u.id and x.day = current_date), 0)
    from auth.users u
    left join public.decks d on d.user_id = u.id
    group by u.id
    order by u.created_at desc;
end $$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
