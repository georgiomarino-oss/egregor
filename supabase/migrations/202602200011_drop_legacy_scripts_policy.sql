-- Cleanup: remove legacy scripts policy with unknown role reference.
drop policy if exists "scripts_select_own_or_attached" on public.scripts;
