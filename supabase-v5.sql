-- Recto v14: error journal for the admin. Run after supabase-v4.sql (safe to re-run).
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  message text not null check (char_length(message) <= 500),
  detail text check (char_length(detail) <= 2000),
  page text check (char_length(page) <= 200),
  agent text check (char_length(agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists client_errors_created on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
drop policy if exists "report own errors" on public.client_errors;
create policy "report own errors" on public.client_errors for insert to authenticated with check (user_id = auth.uid());
grant insert (message, detail, page, agent) on public.client_errors to authenticated;

-- Keep 30 days only.
create or replace function public.prune_client_errors() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.client_errors where created_at < now() - interval '30 days';
  return null;
end $$;
drop trigger if exists prune_client_errors on public.client_errors;
create trigger prune_client_errors after insert on public.client_errors
  for each statement execute function public.prune_client_errors();
revoke execute on function public.prune_client_errors() from public, anon, authenticated;

create or replace function public.admin_errors()
returns table (id bigint, created_at timestamptz, email text, name text, message text, detail text, page text, agent text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
    select e.id, e.created_at, u.email::text,
      coalesce(u.raw_user_meta_data->>'pseudo', u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name'),
      e.message, e.detail, e.page, e.agent
    from public.client_errors e
    left join auth.users u on u.id = e.user_id
    order by e.created_at desc
    limit 200;
end $$;

create or replace function public.admin_clear_errors() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  delete from public.client_errors where true;
end $$;

revoke execute on function public.admin_errors(), public.admin_clear_errors() from public, anon;
grant execute on function public.admin_errors(), public.admin_clear_errors() to authenticated;
