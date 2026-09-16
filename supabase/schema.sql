-- ============================================================
-- ÁMBAR · Esquema Supabase — FASE 1 (activa hoy en la app)
-- Pega este archivo completo en Supabase → SQL Editor → Run.
--
-- Qué habilita:
--  · Tabla profiles enlazada a auth.users (rol cliente/gestor)
--  · Guardado del PIN como hash SHA-256 + salt (nunca en claro)
--  · Perfil creado automáticamente al registrarse
--  · RLS: cada cliente solo ve y edita su fila; el gestor lee todas
-- ============================================================

-- 1) Tabla de perfiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text unique,
  role       text not null default 'cliente' check (role in ('cliente', 'gestor')),
  pin_salt   text,
  pin_hash   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuario: rol y credencial de PIN (solo hash + salt).';

-- 2) updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 3) Crear el perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Función de rol (security definer: evita recursión de RLS)
create or replace function public.is_gestor()
returns boolean
language sql
security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'gestor'
  );
$$;

-- 5) Seguridad a nivel de fila
alter table public.profiles enable row level security;

drop policy if exists "leer perfil propio"      on public.profiles;
drop policy if exists "insertar perfil propio"  on public.profiles;
drop policy if exists "actualizar perfil propio" on public.profiles;
drop policy if exists "gestor lee todos"        on public.profiles;

create policy "leer perfil propio"
  on public.profiles for select
  using (auth.uid() = id);

create policy "insertar perfil propio"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "actualizar perfil propio"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));

create policy "gestor lee todos"
  on public.profiles for select
  using (public.is_gestor());

-- ============================================================
-- Promover un gestor (los gestores NO se crean por el registro
-- público): tras registrar su cuenta normal, ejecuta:
--
--   update public.profiles set role = 'gestor'
--   where email = 'gestor@tudominio.com';
-- ============================================================
