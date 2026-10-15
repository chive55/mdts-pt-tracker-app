-- Only admins can set pt_logs.ptl_verified.
-- Apply AFTER the matching app change is live (members' saves no longer send ptl_verified).
create or replace function public.pt_logs_guard_ptl_verified()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;              -- admins may set/clear verification
  end if;
  if tg_op = 'INSERT' then
    new.ptl_verified := false;                 -- members can't self-verify new logs
  else
    new.ptl_verified := old.ptl_verified;      -- members can't change it on edit
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pt_logs_guard_ptl_verified on public.pt_logs;
create trigger trg_pt_logs_guard_ptl_verified
  before insert or update on public.pt_logs
  for each row execute function public.pt_logs_guard_ptl_verified();

-- ROLLBACK:
-- drop trigger if exists trg_pt_logs_guard_ptl_verified on public.pt_logs;
-- drop function if exists public.pt_logs_guard_ptl_verified();
