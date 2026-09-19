-- MDTS PT Tracker: migration 2 (2026-09-19)
-- Self-service profile edit (safe fields only), admin member update with
-- last-admin guard, and admin member delete (removes auth user too).

-- Members can update only their own name, rank, and flight.
create or replace function public.update_own_profile(p_name text, p_rank text, p_flight text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Enter your full name.';
  end if;
  update public.profiles
  set name = trim(p_name),
      rank = coalesce(p_rank, ''),
      flight = coalesce(nullif(trim(p_flight), ''), '')
  where id = auth.uid();
end;
$$;

-- Admins can edit any member (including role); cannot demote self or the last admin.
create or replace function public.admin_update_member(
  target_id uuid, p_name text, p_rank text, p_flight text, p_pfa_due_date date, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
  other_admins int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception 'Invalid role';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Enter the member''s full name.';
  end if;
  if target_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role.';
  end if;
  select role into target_role from public.profiles where id = target_id;
  if target_role = 'admin' and p_role = 'member' then
    select count(*) into other_admins
    from public.profiles where role = 'admin' and id <> target_id;
    if other_admins = 0 then
      raise exception 'You cannot demote the last admin.';
    end if;
  end if;
  update public.profiles
  set name = trim(p_name),
      rank = coalesce(p_rank, ''),
      flight = coalesce(nullif(trim(p_flight), ''), ''),
      pfa_due_date = p_pfa_due_date,
      role = p_role
  where id = target_id;
end;
$$;

-- Admins can delete a member entirely: notifications, PFA tests, PT logs,
-- profile row, and the Authentication user (fully blocks sign in).
create or replace function public.admin_delete_member(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
  other_admins int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  if target_id = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;
  select role into target_role from public.profiles where id = target_id;
  if target_role is null then
    raise exception 'Member not found.';
  end if;
  if target_role = 'admin' then
    select count(*) into other_admins
    from public.profiles where role = 'admin' and id <> target_id;
    if other_admins = 0 then
      raise exception 'You cannot delete the last admin.';
    end if;
  end if;
  delete from public.notifications where user_id = target_id;
  delete from public.pfa_tests where user_id = target_id;
  delete from public.pt_logs where user_id = target_id;
  delete from public.profiles where id = target_id;
  delete from auth.users where id = target_id;
end;
$$;

grant execute on function public.update_own_profile(text, text, text) to authenticated;
grant execute on function public.admin_update_member(uuid, text, text, text, date, text) to authenticated;
grant execute on function public.admin_delete_member(uuid) to authenticated;
