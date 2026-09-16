# ámbar · billetera y explorador de blockchain

Demo interactiva (Next.js) con dos accesos: **app del cliente** y **panel del gestor**,
lista para desplegar en Vercel y conectada a Supabase para registro, inicio de sesión
y guardado del PIN (como hash SHA-256 + salt, nunca en claro).

---

## 1 · Supabase (5 minutos)

1. Entra en <https://supabase.com> → **New project** (elige región cercana y una
   contraseña de base de datos).
2. Cuando el proyecto esté listo, ve a **SQL Editor**, pega el contenido completo de
   [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Eso crea la tabla
   `profiles` (con roles cliente/gestor), el guardado del PIN y las políticas de
   seguridad (RLS).
3. Ve a **Project Settings → API** y copia dos valores:
   - **Project URL** → será `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → será `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. (Recomendado para la demo) En **Authentication → Providers → Email**, desactiva
   *Confirm email* para que el registro entre sin paso de correo.

## 2 · GitHub

```bash
cd ambar-web
git init
git add .
git commit -m "ámbar v0.7"
# crea un repositorio vacío en github.com y luego:
git remote add origin https://github.com/TU-USUARIO/ambar-app.git
git branch -M main
git push -u origin main
```

## 3 · Vercel

1. Entra en <https://vercel.com> → **Add New → Project** → importa el repositorio.
2. En **Environment Variables**, añade:

   | Nombre                          | Valor                          |
   |---------------------------------|--------------------------------|
   | `NEXT_PUBLIC_SUPABASE_URL`      | la Project URL de Supabase     |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la anon key de Supabase        |

3. **Deploy**. En un minuto tienes la URL pública (p. ej. `ambar-app.vercel.app`).

> Sin esas variables la app también funciona, pero en **modo local de demostración**
> (sin guardar cuentas). La propia pantalla de acceso indica el modo activo.

## 4 · Crear el gestor

Los gestores **no** se crean por el registro público. Registra su cuenta normal desde
la app y luego, en Supabase → SQL Editor:

```sql
update public.profiles set role = 'gestor' where email = 'gestor@tudominio.com';
```

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y rellena tus claves
npm run dev                  # http://localhost:3000
```

---

## Qué hay dentro

| Ruta                          | Qué es                                                        |
|-------------------------------|---------------------------------------------------------------|
| `components/AmbarApp.jsx`     | Toda la app (cliente + panel del gestor + controles de demo)  |
| `app/page.jsx` / `app/layout.jsx` | Envoltorio Next.js (App Router)                           |
| `supabase/schema.sql`         | **Fase 1 (activa):** perfiles, roles, PIN, RLS                |
| `supabase/fase2-esquema.sql`  | **Fase 2 (borrador):** tablas operativas con RLS              |

### Personalización rápida (arriba de `components/AmbarApp.jsx`)

- `BRAND`, `BRAND_LEGAL`, `BRAND_CODE` — nombre visible, titular legal y prefijo de operaciones.
- `LOGO_IMAGE` — ruta a tu logo (déjalo vacío para la marca de posición).
- `HERO_IMAGE` — ruta a la ilustración de fondo (vacío = silla vectorial).

### Estado actual y siguiente fase

**Conectado a Supabase hoy:** registro e inicio de sesión (`auth.users`), perfil con
rol, y sincronización del hash del PIN a `profiles`.

**Fase 2 (cuando se conecten las operaciones):** mover movimientos, direcciones,
solicitudes, chat y notificaciones a las tablas de `fase2-esquema.sql`. Con eso, el
panel del gestor puede vivir en su propia ruta `/gestor` con datos compartidos de
verdad (hoy cliente y panel comparten estado en memoria dentro de la misma pestaña,
con el conmutador del presentador). El esquema ya deja la separación de roles
resuelta a nivel de base de datos.
