-- Recto database. Run the whole file once in the Supabase SQL editor (safe to re-run).

-- Decks: one row per set, readable and writable only by its owner.
create table if not exists public.decks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.decks enable row level security;
drop policy if exists "own decks" on public.decks;
create policy "own decks" on public.decks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admins. The first account ever created becomes admin (see on_signup_after).
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Site settings: a single row everyone can read, only admins can change.
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  signups_open boolean not null default true,
  announcement text not null default '' check (char_length(announcement) <= 280)
);
insert into public.settings (id) values (1) on conflict do nothing;
alter table public.settings enable row level security;
drop policy if exists "everyone reads settings" on public.settings;
create policy "everyone reads settings" on public.settings for select to anon, authenticated using (true);
drop policy if exists "admins update settings" on public.settings;
create policy "admins update settings" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Sign-up rules, enforced by the database whatever the page does.
create or replace function public.on_signup_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.admins)
     and not coalesce((select signups_open from public.settings where id = 1), true) then
    raise exception 'Les inscriptions sont fermées.';
  end if;
  return new;
end $$;
drop trigger if exists recto_signup_before on auth.users;
create trigger recto_signup_before before insert on auth.users
  for each row execute function public.on_signup_before();

create or replace function public.on_signup_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id) values (new.id);
  end if;
  return new;
end $$;
drop trigger if exists recto_signup_after on auth.users;
create trigger recto_signup_after after insert on auth.users
  for each row execute function public.on_signup_after();

-- Admin functions: each one checks is_admin() itself.
create or replace function public.admin_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, decks bigint, cards bigint, is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
      count(d.id) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'),
      coalesce(sum(jsonb_array_length(d.data->'cards')) filter (where coalesce(d.data->>'deleted', 'false') <> 'true'), 0)::bigint,
      exists (select 1 from public.admins a where a.user_id = u.id)
    from auth.users u
    left join public.decks d on d.user_id = u.id
    group by u.id
    order by u.created_at desc;
end $$;

create or replace function public.admin_set_admin(target uuid, make boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if target = auth.uid() then raise exception 'Tu ne peux pas changer tes propres droits.'; end if;
  if make then
    insert into public.admins (user_id) values (target) on conflict do nothing;
  else
    delete from public.admins where user_id = target;
  end if;
end $$;

create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if target = auth.uid() then raise exception 'Supprime ton propre compte depuis la page Mon compte.'; end if;
  delete from auth.users where id = target;
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.admin_users(), public.admin_set_admin(uuid, boolean),
  public.admin_delete_user(uuid), public.delete_my_account(), public.is_admin() from public, anon;
grant execute on function public.admin_users(), public.admin_set_admin(uuid, boolean),
  public.admin_delete_user(uuid), public.delete_my_account(), public.is_admin() to authenticated;
revoke execute on function public.on_signup_before(), public.on_signup_after() from public, anon, authenticated;
