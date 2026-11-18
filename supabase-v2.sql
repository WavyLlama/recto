-- Recto v2: statistics, sharing, reports, images, AI quota, admin tools.
-- Run once in the Supabase SQL editor after supabase.sql (safe to re-run).

-- is_admin() is used inside row policies that anonymous visitors also go through.
grant execute on function public.is_admin() to anon;

-- Study history (streak, daily goal), one row per account.
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.profiles to authenticated;

-- Settings: daily AI limit per account.
alter table public.settings add column if not exists ai_daily_limit int not null default 30 check (ai_daily_limit between 0 and 1000);
grant update (ai_daily_limit) on public.settings to authenticated;

-- Shared sets: a public copy of a deck, opened with #s/<id>.
create table if not exists public.shared_decks (
  id text primary key check (id ~ '^[a-z0-9]{8,24}$'),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id text not null,
  title text not null default '' check (char_length(title) <= 200),
  card_count int not null default 0,
  public boolean not null default false,
  hidden boolean not null default false,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists shared_decks_public on public.shared_decks (updated_at desc) where public and not hidden;
alter table public.shared_decks enable row level security;
drop policy if exists "list public or own" on public.shared_decks;
create policy "list public or own" on public.shared_decks for select to anon, authenticated
  using ((public and not hidden) or owner = auth.uid() or public.is_admin());
drop policy if exists "owner inserts" on public.shared_decks;
create policy "owner inserts" on public.shared_decks for insert to authenticated with check (owner = auth.uid());
drop policy if exists "owner updates" on public.shared_decks;
create policy "owner updates" on public.shared_decks for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "owner or admin deletes" on public.shared_decks;
create policy "owner or admin deletes" on public.shared_decks for delete to authenticated using (owner = auth.uid() or public.is_admin());
grant select on public.shared_decks to anon, authenticated;
grant insert (id, deck_id, title, card_count, public, data) on public.shared_decks to authenticated;
grant update (title, card_count, public, data, updated_at) on public.shared_decks to authenticated;
grant delete on public.shared_decks to authenticated;

-- A link that is not public still opens for whoever has it (but cannot be listed).
create or replace function public.get_shared(slug text)
returns table (id text, title text, card_count int, public boolean, data jsonb, updated_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.card_count, s.public, s.data, s.updated_at, coalesce(s.owner = auth.uid(), false)
  from public.shared_decks s
  where s.id = slug and (not s.hidden or s.owner = auth.uid() or public.is_admin());
$$;
grant execute on function public.get_shared(text) to anon, authenticated;

-- Reports on public sets, read only by admins.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  shared_id text not null references public.shared_decks (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
alter table public.reports enable row level security;
drop policy if exists "report as self" on public.reports;
create policy "report as self" on public.reports for insert to authenticated with check (reporter = auth.uid());
grant insert (shared_id, reason) on public.reports to authenticated;

-- AI quota: counted by the Edge Function through ai_take_quota().
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.ai_take_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare used int; lim int;
begin
  if auth.uid() is null then return false; end if;
  select ai_daily_limit into lim from public.settings where id = 1;
  insert into public.ai_usage (user_id, day, n) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set n = public.ai_usage.n + 1
  returning n into used;
  return used <= coalesce(lim, 30);
end $$;

-- Admin tools.
drop function if exists public.admin_users();
create function public.admin_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, decks bigint, cards bigint, is_admin boolean, ai_today int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
      count(d.id) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'),
      coalesce(sum(jsonb_array_length(d.data->'cards')) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'), 0)::bigint,
      exists (select 1 from public.admins a where a.user_id = u.id),
      coalesce((select x.n from public.ai_usage x where x.user_id = u.id and x.day = current_date), 0)
    from auth.users u
    left join public.decks d on d.user_id = u.id
    group by u.id
    order by u.created_at desc;
end $$;

create or replace function public.admin_set_password(target uuid, password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if char_length(password) < 8 then raise exception 'Le mot de passe doit faire au moins 8 caractères.'; end if;
  update auth.users set encrypted_password = extensions.crypt(password, extensions.gen_salt('bf')), updated_at = now() where id = target;
end $$;

create or replace function public.admin_reports()
returns table (id bigint, shared_id text, title text, hidden boolean, public boolean, reason text, created_at timestamptz, reporter_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select r.id, r.shared_id, s.title, s.hidden, s.public, r.reason, r.created_at, u.email::text
    from public.reports r
    join public.shared_decks s on s.id = r.shared_id
    left join auth.users u on u.id = r.reporter
    where not r.resolved
    order by r.created_at desc;
end $$;

create or replace function public.admin_moderate(slug text, action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if action = 'hide' then
    update public.shared_decks set hidden = true where id = slug;
    update public.reports set resolved = true where shared_id = slug;
  elsif action = 'unhide' then
    update public.shared_decks set hidden = false where id = slug;
  elsif action = 'delete' then
    delete from public.shared_decks where id = slug;
  else
    raise exception 'Action inconnue.';
  end if;
end $$;

create or replace function public.admin_resolve_report(report_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  update public.reports set resolved = true where id = report_id;
end $$;

revoke execute on function public.admin_users(), public.admin_set_password(uuid, text), public.admin_reports(),
  public.admin_moderate(text, text), public.admin_resolve_report(bigint), public.ai_take_quota() from public, anon;
grant execute on function public.admin_users(), public.admin_set_password(uuid, text), public.admin_reports(),
  public.admin_moderate(text, text), public.admin_resolve_report(bigint), public.ai_take_quota() to authenticated;

-- Card images: public bucket, each account writes only in its own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
drop policy if exists "recto images read own" on storage.objects;
create policy "recto images read own" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recto images insert" on storage.objects;
create policy "recto images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recto images delete" on storage.objects;
create policy "recto images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
