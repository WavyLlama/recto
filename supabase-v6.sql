-- Recto v15: admins can clean up another account's images; error journal capped per account.
-- Run after supabase-v5.sql (safe to re-run).

drop policy if exists "recto images read own" on storage.objects;
create policy "recto images read own" on storage.objects for select to authenticated
  using (bucket_id = 'images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "recto images delete" on storage.objects;
create policy "recto images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- At most 50 errors per account and per day reach the journal; the rest are dropped quietly.
create or replace function public.cap_client_errors() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.client_errors where user_id = new.user_id and created_at > now() - interval '1 day') >= 50 then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists cap_client_errors on public.client_errors;
create trigger cap_client_errors before insert on public.client_errors
  for each row execute function public.cap_client_errors();
revoke execute on function public.cap_client_errors() from public, anon, authenticated;
