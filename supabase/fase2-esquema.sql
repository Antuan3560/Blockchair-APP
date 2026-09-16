-- ============================================================
-- ÁMBAR · Esquema Supabase — FASE 2 (borrador preparado)
-- NO lo ejecutes todavía: la app aún gestiona estas operaciones
-- en memoria. Cuando conectemos las operaciones a Supabase, este
-- esquema separa de verdad al cliente del gestor a nivel de datos.
-- ============================================================

-- Movimientos (depósitos y retiros, fiat y cripto)
create table if not exists public.transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('fiat', 'cripto')),
  type        text not null check (type in ('deposito', 'retiro')),
  coin        text,
  amount      numeric not null check (amount > 0),
  value_usd   numeric,
  status      text not null default 'pendiente' check (status in ('pendiente', 'confirmada', 'denegada')),
  deny_reason text,
  op_number   text unique,
  tx_hash     text,
  addr_from   text,
  addr_to     text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Direcciones: de depósito (emitidas por el gestor) y lista blanca de retiro
create table if not exists public.addresses (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  purpose     text not null check (purpose in ('deposito', 'retiro')),
  coin        text not null,
  label       text,
  address     text not null,
  status      text not null default 'pendiente' check (status in ('pendiente', 'lista', 'verificada', 'rechazada')),
  deny_reason text,
  created_at  timestamptz not null default now()
);

-- Solicitudes que no son movimientos (datos fiat, billetera/seed, KYC N2, informes del explorador)
create table if not exists public.requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('datos_fiat', 'billetera', 'kyc_n2', 'informe_direccion')),
  payload     jsonb not null default '{}'::jsonb,   -- p. ej. {"amount": 1000} o {"address": "0x…"}
  result      jsonb,                                 -- p. ej. {"iban": "…", "ref": "…"} o el informe
  status      text not null default 'pendiente' check (status in ('pendiente', 'resuelta', 'denegada')),
  deny_reason text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Chat de soporte
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  sender     text not null check (sender in ('cliente', 'gestor')),
  body       text not null,
  created_at timestamptz not null default now()
);

-- Notificaciones del sistema
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auditoría (solo lectura del gestor)
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  actor      text not null check (actor in ('cliente', 'gestor', 'sistema')),
  category   text not null,
  detail     text not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS: el cliente solo lo suyo; el gestor, todo ----------
alter table public.transactions  enable row level security;
alter table public.addresses     enable row level security;
alter table public.requests      enable row level security;
alter table public.messages      enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log     enable row level security;

-- Cliente: ver e insertar sus filas (los cambios de estado los hace el gestor)
create policy "cliente ve sus movimientos"    on public.transactions  for select using (auth.uid() = user_id);
create policy "cliente crea sus movimientos"  on public.transactions  for insert with check (auth.uid() = user_id);
create policy "cliente ve sus direcciones"    on public.addresses     for select using (auth.uid() = user_id);
create policy "cliente crea sus direcciones"  on public.addresses     for insert with check (auth.uid() = user_id and status in ('pendiente'));
create policy "cliente ve sus solicitudes"    on public.requests      for select using (auth.uid() = user_id);
create policy "cliente crea sus solicitudes"  on public.requests      for insert with check (auth.uid() = user_id);
create policy "cliente ve su chat"            on public.messages      for select using (auth.uid() = user_id);
create policy "cliente escribe en su chat"    on public.messages      for insert with check (auth.uid() = user_id and sender = 'cliente');
create policy "cliente ve sus notificaciones" on public.notifications for select using (auth.uid() = user_id);
create policy "cliente marca leídas"          on public.notifications for update using (auth.uid() = user_id);

-- Gestor: lee todo y resuelve estados
create policy "gestor lee movimientos"     on public.transactions  for select using (public.is_gestor());
create policy "gestor resuelve movimientos" on public.transactions for update using (public.is_gestor());
create policy "gestor lee direcciones"     on public.addresses     for select using (public.is_gestor());
create policy "gestor resuelve direcciones" on public.addresses    for update using (public.is_gestor());
create policy "gestor emite direcciones"   on public.addresses     for insert with check (public.is_gestor());
create policy "gestor lee solicitudes"     on public.requests      for select using (public.is_gestor());
create policy "gestor resuelve solicitudes" on public.requests     for update using (public.is_gestor());
create policy "gestor lee chats"           on public.messages      for select using (public.is_gestor());
create policy "gestor escribe en chats"    on public.messages      for insert with check (public.is_gestor() and sender = 'gestor');
create policy "gestor crea notificaciones" on public.notifications for insert with check (public.is_gestor());
create policy "gestor lee auditoría"       on public.audit_log     for select using (public.is_gestor());
create policy "todos registran auditoría"  on public.audit_log     for insert with check (auth.uid() is not null);

-- Realtime: activa estas tablas en Database → Replication para que
-- las colas del panel y el chat se actualicen en vivo.
