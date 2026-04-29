-- Allow authenticated clients to insert audit rows only for themselves.
-- Service role bypasses RLS; this protects direct anon/authenticated misuse.
-- SELECT remains "View own audit" from 001_initial_schema.sql.

drop policy if exists "Insert own audit" on public.audit_log;

create policy "Insert own audit" on public.audit_log
  for insert
  to authenticated
  with check (auth.uid() = user_id);
