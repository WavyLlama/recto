-- Recto v7: creator pseudo on shared sets, pseudo/photo keys that Google cannot overwrite.
-- Run after supabase-v3.sql (safe to re-run).

alter table public.shared_decks add column if not exists author_name text check (char_length(author_name) <= 40);
alter table public.shared_decks add column if not exists author_avatar text check (author_avatar ~ '^https://' and char_length(author_avatar) <= 600);
grant insert (author_name, author_avatar) on public.shared_decks to authenticated;
grant update (author_name, author_avatar) on public.shared_decks to authenticated;

drop function if exists public.get_shared(text);
create function public.get_shared(slug text)
returns table (id text, title text, card_count int, public boolean, data jsonb, updated_at timestamptz, mine boolean, author_name text, author_avatar text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.card_count, s.public, s.data, s.updated_at, coalesce(s.owner = auth.uid(), false), s.author_name, s.author_avatar
  from public.shared_decks s
  where s.id = slug and (not s.hidden or s.owner = auth.uid() or public.is_admin());
$$;
grant execute on function public.get_shared(text) to anon, authenticated;

drop function if exists public.admin_reports();
create function public.admin_reports()
returns table (id bigint, shared_id text, title text, hidden boolean, public boolean, reason text, created_at timestamptz, reporter_email text, author_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select r.id, r.shared_id, s.title, s.hidden, s.public, r.reason, r.created_at, u.email::text, s.author_name
    from public.reports r
    join public.shared_decks s on s.id = r.shared_id
    left join auth.users u on u.id = r.reporter
    where not r.resolved
    order by r.created_at desc;
end $$;

-- Pseudo and photo now live under "pseudo" and "photo" (empty string = removed on purpose).
drop function if exists public.admin_users();
create function public.admin_users()
returns table (id uuid, email text, name text, avatar_url text, created_at timestamptz, last_sign_in_at timestamptz, decks bigint, cards bigint, is_admin boolean, ai_today int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select u.id, u.email::text,
      coalesce(u.raw_user_meta_data->>'pseudo', u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name'),
      coalesce(u.raw_user_meta_data->>'photo', u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
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

revoke execute on function public.admin_users(), public.admin_reports() from public, anon;
grant execute on function public.admin_users(), public.admin_reports() to authenticated;
