-- Cornell Craves: templates are one-time manual or auto-recurring (build spec 5
-- #8). The table keeps its name, but a template now declares whether the club
-- relaunches it by hand (one_time) or it auto-recurs once the club turns that on
-- (auto + auto_active). Frequency only matters for auto templates.

alter table public.recurring_templates
  add column if not exists mode text not null default 'one_time'
  check (mode in ('one_time', 'auto'));

alter table public.recurring_templates
  add column if not exists auto_active boolean not null default false;
