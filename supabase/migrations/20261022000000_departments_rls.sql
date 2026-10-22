-- Company Manager — departamentos + RLS (Postgres/Supabase).
-- Para quando o backend migrar para Supabase. Espelha src/lib/departments/access.ts.
-- Pressupõe: companies(id uuid), memberships(company_id, user_id, role) com user_id = auth.uid().

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, slug)
);

create table if not exists public.department_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'membro' check (role in ('chefe','assistente','membro')),
  created_at timestamptz not null default now(),
  unique (department_id, user_id)
);

create table if not exists public.department_grants (
  grantee_slug text not null,
  owner_slug text not null,
  resource text not null,
  fields text[] not null default '{}',
  primary key (grantee_slug, owner_slug, resource)
);
insert into public.department_grants values
  ('marketing','rh','ferias_ausencias', array['colaborador_nome','tipo','data_inicio','data_fim'])
on conflict do nothing;

create table if not exists public.hr_absences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid references auth.users(id),
  colaborador_nome text not null,
  tipo text not null default 'ferias',
  data_inicio date not null,
  data_fim date not null,
  motivo text,
  status text not null default 'aprovado',
  created_at timestamptz not null default now()
);

-- Helpers (security definer para evitar recursão de RLS)
create or replace function public.is_company_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                  where m.company_id = p_company and m.user_id = auth.uid() and m.role = 'admin');
$$;

create or replace function public.dept_role(p_company uuid, p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select dm.role from department_members dm
    join departments d on d.id = dm.department_id
   where d.company_id = p_company and d.slug = p_slug and dm.user_id = auth.uid()
   limit 1;
$$;

create or replace function public.has_dept_grant(p_company uuid, p_owner text, p_resource text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from department_grants g
      join departments d on d.slug = g.grantee_slug and d.company_id = p_company
      join department_members dm on dm.department_id = d.id and dm.user_id = auth.uid()
     where g.owner_slug = p_owner and g.resource = p_resource);
$$;

alter table public.departments enable row level security;
alter table public.department_members enable row level security;
alter table public.department_grants enable row level security;
alter table public.hr_absences enable row level security;

create policy departments_select on public.departments for select using (
  public.is_company_admin(company_id) or public.dept_role(company_id, slug) is not null
  or exists (select 1 from department_grants g where g.owner_slug = slug
             and public.dept_role(company_id, g.grantee_slug) is not null));
create policy departments_admin_write on public.departments for all
  using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy dm_select on public.department_members for select using (
  user_id = auth.uid() or exists (select 1 from departments d where d.id = department_id
    and (public.is_company_admin(d.company_id) or public.dept_role(d.company_id, d.slug) is not null)));
create policy dm_write on public.department_members for all using (
  exists (select 1 from departments d where d.id = department_id
    and (public.is_company_admin(d.company_id) or public.dept_role(d.company_id, d.slug) = 'chefe')))
  with check (
  exists (select 1 from departments d where d.id = department_id
    and (public.is_company_admin(d.company_id) or public.dept_role(d.company_id, d.slug) = 'chefe')));

create policy grants_read on public.department_grants for select using (auth.uid() is not null);
-- grants: escrita só via service role (sem policy de escrita).

-- hr_absences: tabela completa só para RH e admin.
create policy absences_rh_read on public.hr_absences for select using (
  public.is_company_admin(company_id) or public.dept_role(company_id, 'rh') is not null);
create policy absences_rh_insert on public.hr_absences for insert with check (
  public.is_company_admin(company_id) or public.dept_role(company_id, 'rh') in ('chefe','assistente'));
create policy absences_rh_update on public.hr_absences for update using (
  public.is_company_admin(company_id) or public.dept_role(company_id, 'rh') in ('chefe','assistente'));
create policy absences_rh_delete on public.hr_absences for delete using (
  public.is_company_admin(company_id) or public.dept_role(company_id, 'rh') = 'chefe');

-- Outros departamentos (ex.: Marketing) leem apenas esta função, com colunas limitadas.
create or replace function public.rh_ferias_ausencias_compartilhado(p_company uuid)
returns table (colaborador_nome text, tipo text, data_inicio date, data_fim date)
language sql stable security definer set search_path = public as $$
  select a.colaborador_nome, a.tipo, a.data_inicio, a.data_fim
    from hr_absences a
   where a.company_id = p_company and a.status = 'aprovado'
     and (public.is_company_admin(p_company)
          or public.dept_role(p_company, 'rh') is not null
          or public.has_dept_grant(p_company, 'rh', 'ferias_ausencias'));
$$;
revoke all on function public.rh_ferias_ausencias_compartilhado(uuid) from public;
grant execute on function public.rh_ferias_ausencias_compartilhado(uuid) to authenticated;

-- Seed dos 20 departamentos por empresa
insert into public.departments (company_id, slug, name)
select c.id, v.slug, v.name from public.companies c cross join (values
  ('design', 'Design'),
  ('rh', 'RH'),
  ('financeiro', 'Financeiro'),
  ('projetos', 'Projetos'),
  ('ti', 'TI'),
  ('vendas', 'Vendas'),
  ('suporte', 'Suporte'),
  ('operacoes', 'Operações'),
  ('marketing', 'Marketing'),
  ('comercial', 'Comercial'),
  ('compras', 'Compras'),
  ('logistica', 'Logística'),
  ('qualidade', 'Qualidade'),
  ('pmo', 'PMO'),
  ('seguranca-informacao', 'Segurança da Informação'),
  ('contabilidade', 'Contabilidade'),
  ('administrativo', 'Administrativo'),
  ('atendimento-cliente', 'Atendimento ao Cliente'),
  ('dados-analytics', 'Dados e Analytics'),
  ('assistente-executivo', 'Assistente Executivo')
) as v(slug, name)
on conflict (company_id, slug) do nothing;
