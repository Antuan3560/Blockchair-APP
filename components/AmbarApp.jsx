"use client";

import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";

/* ============================================================
   ÁMBAR — billetera y explorador de blockchain (demo interactiva)
   v0.7 · Dos accesos: app del cliente y panel del gestor.
   Autenticación separada (registro / inicio de sesión) lista
   para Supabase. Todas las solicitudes (retiros, depósitos fiat,
   direcciones, billetera) las aprueba o deniega el gestor desde
   su panel, con motivo obligatorio al denegar retiros.
   ============================================================ */

const BRAND = "Blockchair";                 // nombre visible de la app
const BRAND_LEGAL = "Blockchair Custodia SL"; // titular de la cuenta de depósitos
const BRAND_CODE = "AMB";                // prefijo de referencias y operaciones

// Cuenta con acceso al panel del gestor. En el proyecto real esto lo
// decide la columna role de la tabla profiles en Supabase; aquí basta
// con reconocer el correo del gestor al iniciar sesión.
// Accesos del panel del gestor. Añade hasta los que necesites (p. ej. 9),
// cada uno con su correo, contraseña y nombre visible. En producción con
// Supabase esto lo sustituye la columna role='gestor' en la tabla profiles.
const GESTORES = [
  { email: "gestor1@ambar.app", pass: "ambar-g1-2026", name: "Gestor 1" },
  { email: "gestor2@ambar.app", pass: "ambar-g2-2026", name: "Gestor 2" },
  { email: "gestor3@ambar.app", pass: "ambar-g3-2026", name: "Gestor 3" },
  { email: "gestor4@ambar.app", pass: "ambar-g4-2026", name: "Gestor 4" },
  { email: "gestor5@ambar.app", pass: "ambar-g5-2026", name: "Gestor 5" },
  { email: "gestor6@ambar.app", pass: "ambar-g6-2026", name: "Gestor 6" },
  { email: "gestor7@ambar.app", pass: "ambar-g7-2026", name: "Gestor 7" },
  { email: "gestor8@ambar.app", pass: "ambar-g8-2026", name: "Gestor 8" },
  { email: "gestor9@ambar.app", pass: "ambar-g9-2026", name: "Gestor 9" },
];
const findGestor = (email) => GESTORES.find((g) => g.email === String(email).toLowerCase());
const FONT_URL = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap";
const EUR_USD = 1.08;

/* ---------------- Supabase (autenticación real) ----------------
   1) Crea un proyecto en https://supabase.com
   2) Copia aquí la URL y la anon key (Settings → API)
   3) Con eso, "Registrarse" hace signUp y "Iniciar sesión" hace
      signInWithPassword contra tu proyecto; los usuarios quedan
      registrados en la tabla auth.users de Supabase.
   Si se deja vacío o la red lo bloquea, la app usa un registro
   local de demostración para no romper la presentación.        */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""; // p. ej. "https://abcd1234.supabase.co"
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function supabaseAuth(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.msg || data.error_description || data.message || "Error de autenticación");
  return data;
}
const supabaseReady = () => SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.length > 20;

// Lee el perfil propio (rol, nombre, gestor asignado) desde Supabase.
async function fetchProfile(token, id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=role,display_name,assigned_gestor,pin_salt,pin_hash`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { return null; }
}

/* ---- Capa de datos: tabla transactions en Supabase (REST) ----
   Convierte entre el formato de la BD (snake_case) y el de la app. */
const sbHeaders = (token) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});
const rowToTx = (r) => ({
  id: r.id, _uid: r.user_id, kind: r.kind, type: r.type, coin: r.coin, sym: r.sym,
  amount: Number(r.amount), valueUsd: r.value_usd != null ? Number(r.value_usd) : undefined,
  valueEur: r.kind === "fiat" ? Number(r.amount) : undefined,
  feeUsd: r.fee_usd != null ? Number(r.fee_usd) : undefined,
  status: r.status, reason: r.reason || undefined, op: r.op_number || undefined,
  hash: r.tx_hash || undefined, from: r.addr_from || undefined, to: r.addr_to || undefined,
  toLabel: r.to_label || undefined, iban: r.iban || undefined, conf: r.conf || undefined,
  date: r.created_at ? new Date(r.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : fecha(),
});
const txToRow = (uid, tx) => ({
  user_id: uid, kind: tx.kind, type: tx.type, coin: tx.coin, sym: tx.sym,
  amount: tx.amount, value_usd: tx.valueUsd ?? null, fee_usd: tx.feeUsd ?? null,
  status: tx.status || "pendiente", reason: tx.reason ?? null, op_number: tx.op ?? null,
  tx_hash: tx.hash ?? null, addr_from: tx.from ?? null, addr_to: tx.to ?? null,
  to_label: tx.toLabel ?? null, iban: tx.iban ?? null, conf: tx.conf ?? null,
});

async function dbLoadTxs(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${uid}&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map(rowToTx) : [];
}
async function dbInsertTx(token, uid, tx) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
    method: "POST", headers: { ...sbHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify([txToRow(uid, tx)]),
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rowToTx(rows[0]) : null;
}
async function dbUpdateTx(token, id, patch) {
  const row = {};
  if (patch.status) row.status = patch.status;
  if ("reason" in patch) row.reason = patch.reason;
  if (patch.hash) row.tx_hash = patch.hash;
  if (patch.conf) row.conf = patch.conf;
  if (patch.status === "confirmada" || patch.status === "denegada") row.resolved_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify(row),
  });
}

/* ---- addresses (direcciones de depósito y de retiro) ---- */
async function dbLoadAddrs(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/addresses?user_id=eq.${uid}&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbInsertAddr(token, uid, a) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/addresses`, {
    method: "POST", headers: { ...sbHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify([{ user_id: uid, purpose: a.purpose, coin: a.coin, chain: a.chain || null, label: a.label || null, address: a.address || null, status: a.status || "pendiente" }]),
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function dbUpdateAddr(token, id, patch) {
  const row = { ...patch };
  if (patch.status === "verificada" || patch.status === "rechazada" || patch.status === "lista") row.resolved_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/addresses?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify(row),
  });
}

/* ---- requests (datos fiat, billetera, kyc, informe) ---- */
async function dbLoadReqs(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/requests?user_id=eq.${uid}&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbInsertReq(token, uid, q) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/requests`, {
    method: "POST", headers: { ...sbHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify([{ user_id: uid, kind: q.kind, payload: q.payload || {}, status: q.status || "pendiente" }]),
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
// Cierra solicitudes de datos fiat anteriores (pendiente/emitida) del cliente,
// para que no se acumulen intentos abandonados. No toca depósitos (transactions).
async function dbCloseOpenFiatReqs(token, uid) {
  await fetch(`${SUPABASE_URL}/rest/v1/requests?user_id=eq.${uid}&kind=eq.datos_fiat&status=in.(pendiente,emitida)`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify({ status: "resuelta" }),
  });
}
async function dbUpdateReq(token, id, patch) {
  const row = { ...patch };
  if (patch.status && patch.status !== "pendiente") row.resolved_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/requests?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify(row),
  });
}

/* ---- lista de clientes para el panel del gestor ---- */
async function dbLoadClients(token, role, myId) {
  // matriz ve todos; gestor ve los asignados a él (RLS lo refuerza)
  const filter = role === "matriz" ? "role=eq.cliente" : `role=eq.cliente&assigned_gestor=eq.${myId}`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${filter}&select=id,email,display_name,assigned_gestor&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbLoadUnassigned(token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.cliente&assigned_gestor=is.null&select=id,email,display_name`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbLoadGestores(token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.gestor&select=id,email,display_name`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbAssignClient(token, clientId, gestorId) {
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${clientId}`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify({ assigned_gestor: gestorId }),
  });
}
// Movimientos de un cliente concreto (para el perfil en el panel)
async function dbLoadTxsOf(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${uid}&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map(rowToTx) : [];
}

/* ---- chat de soporte ---- */
async function dbLoadMsgs(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/messages?user_id=eq.${uid}&order=created_at.asc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbInsertMsg(token, uid, sender, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST", headers: sbHeaders(token),
    body: JSON.stringify([{ user_id: uid, sender, body }]),
  });
}
/* ---- notificaciones ---- */
async function dbLoadNotis(token, uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${uid}&order=created_at.desc`, { headers: sbHeaders(token) });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbInsertNoti(token, uid, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST", headers: sbHeaders(token),
    body: JSON.stringify([{ user_id: uid, body }]),
  });
}
async function dbMarkNotisRead(token, uid) {
  await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${uid}&read=eq.false`, {
    method: "PATCH", headers: sbHeaders(token), body: JSON.stringify({ read: true }),
  });
}

/* ------------------------- Tokens (tema único claro) ------------------------- */

const T0 = {
  bg: "#FFFFFF", cardSurface: "#F6F7F9", bgFormInput: "#F1F2F5", line: "#E8EAEE",
  textPrimary: "#101112", textSecondary: "#8C93A3",
  textOnAccent: "#FFFFFF",
  accent: "#1E7DF7", accentPressed: "#186AD4", accentAlt: "#18B2A5",
  success: "#0F9D58", successBg: "rgba(15,157,88,0.12)",
  error: "#E5484D", errorBg: "rgba(229,72,77,0.12)",
  warning: "#C77700", warningBg: "rgba(199,119,0,0.14)",
  prism: ["#E5289E", "#FF63B6", "#FF7A3D", "#FFC53D", "#38C6D9"],
  heroChair: {
    magenta: "#F715B2", crimson: "#E8135F", deep: "#D6006E", pinkEdge: "#FF9BD8", pinkSoft: "#FF7FC9",
    orange: "#FF8A3D", peach: "#FF9A4A", yellow: "#F7E13B",
    blue: "#3D46E8", violet: "#9A3DF0", sky: "#5AB2FF", lav: "#C77CFF",
  },
};
const RADIUS = { full: 999, card: 18, input: 12 };
const FONT = { display: "'Plus Jakarta Sans', system-ui, sans-serif", mono: "'Roboto Mono', monospace" };

const ThemeCtx = createContext(T0);
const useT = () => useContext(ThemeCtx);
const CurCtx = createContext({ cur: "usd", fMon: (n) => fUsd(n) });
const useMon = () => useContext(CurCtx);

/* ------------------------------ Datos base ------------------------------ */

const ASSETS0 = [
  { id: "btc", name: "Bitcoin", sym: "BTC", price: 76882, amount: 0, vol: 0.012, eco: "bitcoin", block: 967099, min: 2, fee: 0.26 },
  { id: "eth", name: "Ethereum", sym: "ETH", price: 3473, amount: 0, vol: 0.016, eco: "ethereum", block: 21894412, min: 1, fee: 0.41 },
  { id: "sol", name: "Solana", sym: "SOL", price: 142.6, amount: 0, vol: 0.024, eco: "otro", block: 316420877, min: 1, fee: 0.002 },
  { id: "ltc", name: "Litecoin", sym: "LTC", price: 91.4, amount: 0, vol: 0.02, eco: "bitcoin", block: 2870341, min: 4, fee: 0.01 },
  { id: "xmr", name: "Monero", sym: "XMR", price: 168.2, amount: 0, vol: 0.02, eco: "privacidad", block: 3327904, min: 3, fee: 0.03 },
  { id: "usdt", name: "Tether", sym: "USDT", network: "trx", price: 1, amount: 0, vol: 0.0006, eco: "tron", block: 68240100, min: 1, fee: 1.0 },
  { id: "usdc", name: "USD Coin", sym: "USDC", network: "eth", price: 1, amount: 0, vol: 0.0006, eco: "ethereum", block: 21894412, min: 1, fee: 0.41 },
];

const MOVERS0 = [
  { id: "doge", name: "Dogecoin", sym: "DOGE", price: 0.11, vol: 0.028 },
  { id: "dot", name: "Polkadot", sym: "DOT", price: 4.8, vol: 0.022 },
  { id: "trx", name: "Tron", sym: "TRX", price: 0.16, vol: 0.02 },
  { id: "bch", name: "Bitcoin Cash", sym: "BCH", price: 412, vol: 0.024 },
];

const DEPOSIT_COINS = ["btc", "eth", "usdt", "usdc", "sol"];
const chainOf = (c) => (c === "btc" ? "btc" : c === "sol" ? "sol" : c === "usdt" || c === "trx" ? "trx" : "eth");
const CHAIN_LABEL = { btc: "Bitcoin", eth: "Ethereum (ERC-20)", trx: "Tron (TRC-20)", sol: "Solana" };

const fNum2 = (n, min, max) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: min, maximumFractionDigits: max }).format(n);
const fUsd = (n) => {
  const a = Math.abs(n);
  return "$" + (a < 1 ? fNum2(n, 0, 4) : a < 1000 ? fNum2(n, 2, 2) : fNum2(n, 0, 0));
};
const fEur = (n) => "€" + fNum2(n, 2, 2);
const fNum = (n, d = 6) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(n);
const fInt = (n) => new Intl.NumberFormat("es-ES").format(n);

async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let x = 5381;
    for (const ch of text) x = ((x * 33) ^ ch.charCodeAt(0)) >>> 0;
    return x.toString(16).padStart(8, "0");
  }
}

const randHex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const randB58 = (n) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * B58.length)]).join("");
const randAddr = (chain) => (chain === "btc" ? "bc1q" + randHex(32) : chain === "sol" ? randB58(43) : chain === "trx" ? "T" + randB58(33) : "0x" + randHex(40));
const opNum = () => `${BRAND_CODE}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
const hhmm = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fecha = () => new Date().toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : fecha();
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : hhmm();

const SEED_WORDS = ["amber", "ocean", "forest", "quiet", "metal", "sunset", "river", "cargo", "violet", "humble", "spark", "granite", "meadow", "copper", "lunar", "harbor", "cedar", "prairie", "ember", "willow", "canyon", "fable", "saffron", "tide"];
const genSeed = () => {
  const pool = [...SEED_WORDS];
  const out = [];
  for (let i = 0; i < 12; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
};
const CHAT0 = () => [{ id: 1, from: "gestor", text: `Hola, soy el soporte de ${BRAND}. Escríbenos cualquier duda sobre depósitos, retiros o tu billetera.`, at: hhmm() }];

/* --------------------------- Trasfondo de facetas --------------------------- */

/* HeroBackground — patrón del proyecto:
   components/HeroBackground.jsx + HeroBackground.module.css
   Con HERO_IMAGE apuntando a /images/gradient-chair.webp se usa la
   imagen real con carga prioritaria; vacío, se renderiza la silla
   vectorial fiel a la referencia. */
const HERO_IMAGE = ""; // p. ej. "/images/gradient-chair.webp"

function HeroBackground({ h = 340 }) {
  const t = useT();
  const w = Math.round(h * 0.55);
  const wrapper = { position: "absolute", top: -4, right: -14, width: w, height: h, pointerEvents: "none", zIndex: 0, overflow: "visible" };
  if (HERO_IMAGE) {
    return (
      <div style={wrapper} aria-hidden="true">
        <img src={HERO_IMAGE} alt="" loading="eager" fetchPriority="high"
          style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "top right" }} />
      </div>
    );
  }
  const C = t.heroChair;
  /* Silla "S" proyectada isométricamente: respaldo (x=0, z:520→1050),
     asiento (z=520, x:0→460), panel (x=460, z:0→520), base (z=0, x:40→460),
     profundidad 340. Proyección: sx=(x−y)·0.866, sy=(x+y)·0.5−z.
     Las caras comparten aristas exactas: figura continua como la referencia. */
  return (
    <div style={wrapper} aria-hidden="true">
      <svg width={w} height={h} viewBox="0 0 800 1520" style={{ display: "block" }}>
        <defs>
          <linearGradient id="chBack" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.magenta} /><stop offset="1" stopColor={C.crimson} />
          </linearGradient>
          <linearGradient id="chBackTri" x1="0" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor={C.orange} /><stop offset="1" stopColor={C.yellow} />
          </linearGradient>
          <linearGradient id="chSeat" x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0" stopColor={C.pinkSoft} /><stop offset="0.45" stopColor={C.orange} /><stop offset="1" stopColor={C.yellow} />
          </linearGradient>
          <linearGradient id="chSide" x1="0.42" y1="0" x2="0.58" y2="1">
            <stop offset="0" stopColor={C.magenta} /><stop offset="0.45" stopColor={C.violet} /><stop offset="1" stopColor={C.blue} />
          </linearGradient>
          <linearGradient id="chSideTop" x1="1" y1="0" x2="0" y2="0.5">
            <stop offset="0" stopColor={C.yellow} /><stop offset="1" stopColor={C.magenta} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chSideTri" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={C.sky} /><stop offset="1" stopColor={C.lav} />
          </linearGradient>
          <linearGradient id="chBase" x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0" stopColor={C.pinkSoft} /><stop offset="1" stopColor={C.peach} />
          </linearGradient>
          <filter id="chGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="34" />
          </filter>
        </defs>

        {/* Halo luminoso */}
        <ellipse cx="380" cy="740" rx="330" ry="470" fill={C.magenta} opacity="0.14" filter="url(#chGlow)" />

        {/* Cantos (grosor) detrás de las caras */}
        <path d="M46 190 L46 720 L18 734 L18 204 Z" fill={C.pinkEdge} />
        <path d="M46 720 L444 950 L444 976 L46 746 Z" fill={C.pinkEdge} />
        <path d="M738 780 L738 1300 L762 1314 L762 794 Z" fill={C.deep} />
        <path d="M444 1470 L738 1300 L738 1324 L444 1494 Z" fill={C.deep} opacity="0.85" />
        <path d="M80 1260 L444 1470 L444 1494 L80 1284 Z" fill={C.pinkEdge} />

        {/* Caras principales (paralelogramos exactos, esquinas suavizadas con trazo) */}
        <g strokeLinejoin="round" strokeWidth="16">
          {/* Base */}
          <path d="M375 1090 L738 1300 L444 1470 L80 1260 Z" fill="url(#chBase)" stroke="url(#chBase)" />
          {/* Respaldo */}
          <path d="M340 20 L46 190 L46 720 L340 550 Z" fill="url(#chBack)" stroke="url(#chBack)" />
          {/* Asiento */}
          <path d="M340 550 L738 780 L444 950 L46 720 Z" fill="url(#chSeat)" stroke="url(#chSeat)" />
          {/* Panel lateral */}
          <path d="M738 780 L444 950 L444 1470 L738 1300 Z" fill="url(#chSide)" stroke="url(#chSide)" />
        </g>

        {/* Franja amarilla superior del panel */}
        <path d="M738 780 L444 950 L444 1002 L738 832 Z" fill="url(#chSideTop)" />

        {/* Triángulos incrustados */}
        <path d="M316 87 L70 229 L316 447 Z" fill="url(#chBackTri)" />
        <path d="M314 84 L72 224 L84 232 L314 100 Z" fill="#FFFFFF" opacity="0.8" />
        <path d="M473 995 L473 1375 L703 1112 Z" fill="url(#chSideTri)" />

        {/* Brillos de arista */}
        <path d="M340 550 L738 780 L732 792 L340 564 Z" fill="#FFFFFF" opacity="0.35" />
        <path d="M340 20 L46 190 L58 200 L340 36 Z" fill="#FFFFFF" opacity="0.25" />
        <path d="M46 720 L340 550 L344 562 L58 728 Z" fill={C.pinkEdge} opacity="0.9" />
      </svg>
    </div>
  );
}

/* Logo de la app. Con LOGO_IMAGE apuntando a tu archivo (p. ej.
   "/images/logo.svg" o .png en el proyecto real) se usa tu logo tal
   cual; vacío, se dibuja la marca vectorial de posición. */
const LOGO_IMAGE = "";

function Logo({ size = 30, withName = false }) {
  const t = useT();
  const [m, , o, y, c] = t.prism;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {LOGO_IMAGE ? (
        <img src={LOGO_IMAGE} alt={BRAND} width={size} height={size} style={{ display: "block", objectFit: "contain" }} />
      ) : (
        <svg width={size} height={size} viewBox="0 0 32 32">
          <polygon points="16,2 28,9 16,16 4,9" fill={m} />
          <polygon points="4,9 16,16 16,30 4,23" fill={c} />
          <polygon points="28,9 16,16 16,30 28,23" fill={y} />
          <circle cx="27" cy="5" r="3" fill={o} />
        </svg>
      )}
      {withName && <span style={{ fontWeight: 700, fontSize: size * 0.62, color: t.textPrimary, letterSpacing: "-0.02em" }}>{BRAND}</span>}
    </span>
  );
}

/* -------------------- Iconos de marca por moneda -------------------- */

const COIN_BRAND = {
  btc: "#F7931A", eth: "#627EEA", usdt: "#26A17B", usdc: "#2775CA", sol: "#9945FF", ltc: "#345D9D",
  xmr: "#FF6600", doge: "#C2A633", dot: "#E6007A", trx: "#EB0029", bch: "#0AC18E", eur: "#1E7DF7",
};

function CoinDot({ id, sym, size = 38 }) {
  const k = (id || "").toLowerCase();
  const bg = COIN_BRAND[k] || "#1E7DF7";
  const G = () => {
    switch (k) {
      case "eth":
        return (
          <g fill="#fff">
            <polygon points="16,5.5 23.5,16.2 16,20.6 8.5,16.2" opacity="0.95" />
            <polygon points="16,22.6 23,17.9 16,27.5 9,17.9" opacity="0.75" />
          </g>
        );
      case "sol":
        return (
          <g fill="#fff">
            <polygon points="11.5,8.5 24,8.5 20.5,11.5 8,11.5" />
            <polygon points="8,14.5 20.5,14.5 24,17.5 11.5,17.5" />
            <polygon points="11.5,20.5 24,20.5 20.5,23.5 8,23.5" />
          </g>
        );
      case "dot":
        return (
          <g fill="#fff">
            <circle cx="16" cy="9.5" r="3" /><circle cx="16" cy="22.5" r="3" />
            <circle cx="9.5" cy="16" r="2.1" /><circle cx="22.5" cy="16" r="2.1" />
          </g>
        );
      case "trx":
        return (
          <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round">
            <path d="M8 9 L24 12 L16 25 Z" /><path d="M24 12 L16 16.5" />
          </g>
        );
      default: {
        const glyphs = { btc: "₿", usdt: "₮", usdc: "$", ltc: "Ł", xmr: "M", doge: "Ð", bch: "₿", eur: "€" };
        return (
          <text x="16" y="22.2" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff"
            fontFamily={FONT.display} transform={k === "bch" ? "rotate(12 16 16)" : undefined}>
            {glyphs[k] || (sym || "?").slice(0, 1)}
          </text>
        );
      }
    }
  };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="16" cy="16" r="16" fill={bg} />
      <G />
    </svg>
  );
}

/* QR real — modo byte, ECC nivel L, versiones 1–5, máscara 0.
   Algoritmo estándar (Reed–Solomon sobre GF(256)); verificado con
   decodificador jsQR sobre direcciones ETH, BTC, SOL e IBAN. */
function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const CAP = [0, 19, 34, 55, 80, 108], ECN = [0, 7, 10, 15, 20, 26];
  let ver = 0;
  for (let v = 1; v <= 5; v++) if (bytes.length + 2 <= CAP[v]) { ver = v; break; }
  if (!ver) return null;
  const nData = CAP[ver], nEc = ECN[ver], size = 17 + 4 * ver;
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(4, 4); push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < nData * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let i = 0; data.length < nData; i++) data.push(i % 2 ? 0x11 : 0xEC);
  const EXP = new Array(510), LOG = new Array(256).fill(0);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  let gen = [1];
  for (let i = 0; i < nEc; i++) {
    const nx = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) { nx[j] ^= mul(gen[j], EXP[i]); nx[j + 1] ^= gen[j]; }
    gen = nx;
  }
  const div = [];
  for (let j = nEc - 1; j >= 0; j--) div.push(gen[j]);
  const ecc = new Array(nEc).fill(0);
  for (const d of data) {
    const f = d ^ ecc[0];
    ecc.shift(); ecc.push(0);
    if (f) for (let j = 0; j < nEc; j++) ecc[j] ^= mul(div[j], f);
  }
  const cw = data.concat(ecc);
  const M = Array.from({ length: size }, () => new Array(size).fill(false));
  const F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && x < size && y >= 0 && y < size) { M[y][x] = dark; F[y][x] = true; } };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const fmt = 0x77C4, bit = (i) => ((fmt >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!F[y][x] && i < cw.length * 8) {
          M[y][x] = ((cw[i >> 3] >> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    if (!F[y][x] && (x + y) % 2 === 0) M[y][x] = !M[y][x];
  return M;
}

function QRCode({ value, size = 132 }) {
  const m = useMemo(() => qrMatrix(value), [value]);
  if (!m) return null;
  const n = m.length, quiet = 3, total = n + quiet * 2, cs = size / total;
  const rects = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (m[y][x]) rects.push(<rect key={y * n + x} x={(x + quiet) * cs} y={(y + quiet) * cs} width={cs + 0.3} height={cs + 0.3} fill="#101112" />);
  return (
    <svg width={size} height={size} style={{ borderRadius: 10, background: "#fff", border: "1px solid #E8EAEE", display: "block" }}>
      {rects}
    </svg>
  );
}

/* ------------------------------ Piezas UI ------------------------------ */

function Btn({ label, onClick, variant = "primary", disabled, large, style }) {
  const t = useT();
  const bg = variant === "primary" ? t.accent : variant === "danger" ? t.errorBg : variant === "secondary" ? t.cardSurface : "transparent";
  const col = variant === "primary" ? (disabled ? "rgba(255,255,255,0.55)" : t.textOnAccent) : variant === "danger" ? t.error : variant === "secondary" ? t.textPrimary : t.textSecondary;
  return (
    <button onClick={onClick} disabled={disabled} className="press"
      style={{ height: large ? 56 : 48, background: bg, color: col, border: "none", borderRadius: RADIUS.full, padding: "0 20px", fontWeight: 600, fontSize: large ? 16 : 14.5, opacity: disabled && variant !== "primary" ? 0.5 : 1, ...style }}>
      {label}
    </button>
  );
}

function Badge({ tone = "success", children }) {
  const t = useT();
  const map = { success: [t.success, t.successBg], warning: [t.warning, t.warningBg], error: [t.error, t.errorBg], muted: [t.textSecondary, t.bgFormInput], accent: [t.accent, "rgba(30,125,247,0.12)"] };
  const [c, bg] = map[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: c, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: c, flexShrink: 0 }} />
      {children}
    </span>
  );
}

function Lupa({ color, size = 17, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={style}>
      <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="2" fill="none" />
      <line x1="13.5" y1="13.5" x2="18" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SearchPill({ value, onChange, placeholder, prominent, onSubmit, style }) {
  const t = useT();
  return (
    <div style={{ height: 48, background: t.bgFormInput, borderRadius: RADIUS.full, display: "flex", alignItems: "center", paddingLeft: 16, paddingRight: 6, ...style }}>
      {!prominent && <Lupa color={t.textSecondary} style={{ marginRight: 10, flexShrink: 0 }} />}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => e.key === "Enter" && onSubmit && onSubmit()}
        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 14.5, color: t.textPrimary, fontFamily: FONT.display }} />
      {value && <button onClick={() => onChange("")} aria-label="Limpiar" style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 15, padding: 8 }}>✕</button>}
      {prominent && (
        <button onClick={onSubmit} className="press" style={{ height: 38, borderRadius: RADIUS.full, background: t.accent, color: t.textOnAccent, border: "none", padding: "0 18px", fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          Buscar <Lupa color={t.textOnAccent} size={14} />
        </button>
      )}
    </div>
  );
}

function Chip({ label, selected, onClick }) {
  const t = useT();
  return (
    <button onClick={onClick} className="press"
      style={{ height: 28, borderRadius: RADIUS.full, border: "none", padding: "0 14px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: selected ? t.accent : "transparent", color: selected ? t.textOnAccent : t.textSecondary }}>
      {label}
    </button>
  );
}

function H3({ children }) { return <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 9px", letterSpacing: "-0.2px" }}>{children}</h3>; }
function Card({ children, style }) { const t = useT(); return <div style={{ background: t.cardSurface, borderRadius: RADIUS.card, ...style }}>{children}</div>; }
function Row({ k, children }) {
  const t = useT();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: t.textSecondary }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
}

function EmptyLine({ text }) { const t = useT(); return <div style={{ padding: "16px 14px", fontSize: 12.5, color: t.textSecondary }}>{text}</div>; }
function DemoNote() { const t = useT(); return <p style={{ fontSize: 11.5, color: t.textSecondary, textAlign: "center", margin: "18px 0 6px" }}>Precios simulados que se actualizan en vivo.</p>; }

const inputBase = (t) => ({ height: 48, width: "100%", background: t.bgFormInput, border: `1px solid ${t.line}`, borderRadius: RADIUS.input, color: t.textPrimary, padding: "0 12px", fontSize: 14, fontFamily: FONT.display });

const STATUS_BADGE = { pendiente: ["warning", "Pendiente"], confirmada: ["success", "Confirmada"], denegada: ["error", "Denegada"] };

/* ================================ RAÍZ ================================ */

export default function AmbarApp() {
  const t = T0;
  const [view, setView] = useState("cliente"); // cliente | gestor
  const [screen, setScreen] = useState("onboarding"); // onboarding | login | registro | pin | app
  const [user, setUser] = useState(null);

  // Restaurar sesión guardada al recargar (evita que F5 cierre la sesión).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ambar_session");
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.user && s.user.token) {
          setUser(s.user);
          setView(s.view || "cliente");
          setScreen("app");
        }
      }
    } catch (e) {}
  }, []);
  // Guardar / limpiar la sesión cuando cambia el usuario.
  useEffect(() => {
    try {
      if (user && user.token && screen === "app") {
        localStorage.setItem("ambar_session", JSON.stringify({ user, view }));
      }
    } catch (e) {}
  }, [user, view, screen]);
  const [tab, setTab] = useState("inicio");

  const [assets, setAssets] = useState(ASSETS0);
  const [movers, setMovers] = useState(MOVERS0);
  const [eur, setEur] = useState(0);
  const [txs, setTxs] = useState([]);
  const [txDetail, setTxDetail] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [chainSheet, setChainSheet] = useState(null);
  const [depositAddrs, setDepositAddrs] = useState({});
  const [fiatReq, setFiatReq] = useState(null); // datos fiat bajo solicitud: se piden en cada depósito
  const [book, setBook] = useState([]);
  const [walletState, setWalletState] = useState("none");
  const [kyc, setKyc] = useState({ level: 1, status: "ok" }); // status: ok | pendiente

  // ---- Estado del PANEL DEL GESTOR alimentado desde Supabase ----
  const [gClients, setGClients] = useState([]);      // clientes (según rol)
  const [gAddrs, setGAddrs] = useState([]);          // filas addresses de todos sus clientes
  const [gReqs, setGReqs] = useState([]);            // filas requests
  const [gTxs, setGTxs] = useState([]);              // movimientos de sus clientes
  const [gGestores, setGGestores] = useState([]);    // lista de gestores (para asignar)
  const [gEmitRow, setGEmitRow] = useState(null);    // fila addresses que el gestor va a emitir
  const [gChatClient, setGChatClient] = useState(null); // cliente cuyo chat abre el gestor
  const [gChatMsgs, setGChatMsgs] = useState([]);
  const [gMsgs, setGMsgs] = useState([]); // últimos mensajes de clientes (para el aviso)
  const [gMsgsSeen, setGMsgsSeen] = useState(0); // id máximo visto
  const [gReportRow, setGReportRow] = useState(null); // solicitud de informe a rellenar
  const [gFiatRow, setGFiatRow] = useState(null); // solicitud de datos fiat a emitir
  const [gSeedRow, setGSeedRow] = useState(null); // solicitud de billetera para emitir seed
  const gEmitSeedDb = async (reqRowId, words) => {
    if (!isSb()) return;
    const row = gReqs.find((r) => r.id === reqRowId);
    await dbUpdateReq(user.token, reqRowId, { status: "emitida", result: { seed: words } });
    if (row) await dbInsertNoti(user.token, row.user_id, "Tu frase de recuperación está lista en Billetera. Anótala y guárdala fuera de línea.").catch(() => {});
    await gestorReload();
    setToast("Frase de recuperación emitida");
  };
  const gOpenChat = async (client) => {
    setGChatClient(client);
    if (isSb()) { try { setGChatMsgs(await dbLoadMsgs(user.token, client.id)); } catch (e) { setGChatMsgs([]); } }
  };
  const gSendChat = async (body) => {
    if (!isSb() || !gChatClient) return;
    await dbInsertMsg(user.token, gChatClient.id, "gestor", body);
    setGChatMsgs(await dbLoadMsgs(user.token, gChatClient.id));
  };
  const [gLoading, setGLoading] = useState(false);
  const gestorReload = async () => {
    if (!isSb() || !(user?.role === "gestor" || user?.role === "matriz")) return;
    setGLoading(true);
    try {
      const clients = await dbLoadClients(user.token, user.role, user.id);
      setGClients(clients);
      if (user.role === "matriz") { try { setGGestores(await dbLoadGestores(user.token)); } catch (e) {} }
      const ids = clients.map((c) => c.id);
      if (ids.length) {
        const inList = `(${ids.join(",")})`;
        const [ax, rq, tx] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/addresses?user_id=in.${inList}&order=created_at.desc`, { headers: sbHeaders(user.token) }).then((r) => r.json()),
          fetch(`${SUPABASE_URL}/rest/v1/requests?user_id=in.${inList}&order=created_at.desc`, { headers: sbHeaders(user.token) }).then((r) => r.json()),
          fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=in.${inList}&order=created_at.desc`, { headers: sbHeaders(user.token) }).then((r) => r.json()),
        ]);
        setGAddrs(Array.isArray(ax) ? ax : []);
        setGReqs(Array.isArray(rq) ? rq : []);
        setGTxs(Array.isArray(tx) ? tx.map(rowToTx) : []);
        // Mensajes de clientes (para avisar de nuevos en Soporte)
        try {
          const mm = await fetch(`${SUPABASE_URL}/rest/v1/messages?user_id=in.${inList}&sender=eq.cliente&order=created_at.desc`, { headers: sbHeaders(user.token) }).then((r) => r.json());
          setGMsgs(Array.isArray(mm) ? mm : []);
        } catch (e) {}
      } else { setGAddrs([]); setGReqs([]); setGTxs([]); }
    } catch (e) { /* silencioso */ }
    setGLoading(false);
  };
  useEffect(() => {
    if (screen === "app" && (view === "gestor") && isSb()) gestorReload();
  }, [screen, view, user?.id]);
  // Refresco en vivo del panel del gestor
  useEffect(() => {
    if (screen !== "app" || view !== "gestor" || !isSb()) return;
    const iv = setInterval(() => { gestorReload(); }, 6000);
    return () => clearInterval(iv);
  }, [screen, view, user?.id]);

  // Acciones del gestor sobre datos reales (escriben en Supabase y recargan)
  const gEmitAddrDb = async (addrRowId, addr) => {
    if (!isSb()) return;
    const row = gAddrs.find((a) => a.id === addrRowId);
    await dbUpdateAddr(user.token, addrRowId, { address: addr, status: "lista" });
    if (row) await dbInsertNoti(user.token, row.user_id, `Tu dirección de depósito de ${row.coin.toUpperCase()} ya está disponible en Depositar → Cripto.`).catch(() => {});
    await gestorReload();
    setToast("Dirección emitida");
  };
  const gCreditClientDb = async (clientId, coin, amount) => {
    if (!isSb()) return;
    const a = assets.find((x) => x.id === coin);
    // Buscar la dirección de depósito emitida de ese cliente para esta moneda
    const depAddr = gAddrs.find((ad) => ad.user_id === clientId && ad.purpose === "deposito" && ad.coin === coin && ad.status === "lista");
    const tx = { kind: "cripto", type: "deposito", coin, sym: a.sym, amount,
      valueUsd: amount * a.price, status: "confirmada", op: opNum(),
      hash: randHex(64), to: depAddr ? depAddr.address : null, feeUsd: a.fee, conf: 40 + Math.floor(Math.random() * 500) };
    await dbInsertTx(user.token, clientId, tx);
    await dbInsertNoti(user.token, clientId, `Detectamos y acreditamos tu depósito entrante de ${fNum(amount)} ${a.sym}.`).catch(() => {});
    await gestorReload();
    setToast(`Acreditado ${fNum(amount)} ${a.sym}`);
  };
  const gApproveWithdrawDb = async (txRowId, kind) => {
    if (!isSb()) return;
    const row = gTxs.find((x) => x.id === txRowId);
    const extra = kind === "cripto" ? { hash: randHex(64), conf: 24 + Math.floor(Math.random() * 300) } : {};
    await dbUpdateTx(user.token, txRowId, { status: "confirmada", ...extra });
    if (row) await dbInsertNoti(user.token, row._uid || row.user_id, `Tu retiro ${row.op} fue aprobado.`).catch(() => {});
    await gestorReload();
    setToast("Retiro aprobado");
  };
  const gValidateFiatDb = async (txRowId) => {
    if (!isSb()) return;
    const row = gTxs.find((x) => x.id === txRowId);
    await dbUpdateTx(user.token, txRowId, { status: "confirmada" });
    if (row) await dbInsertNoti(user.token, row._uid || row.user_id, `Validamos tu transferencia de ${fEur(row.amount)}. El saldo ya está disponible.`).catch(() => {});
    await gestorReload();
    setToast("Depósito validado");
  };
  const gResolveDb = async (kindOrRow, rowId, patch) => {
    if (!isSb()) return;
    await dbUpdateReq(user.token, rowId, patch);
    await gestorReload();
  };
  const gEmitFiatDataDb = async (reqRowId, data) => {
    if (!isSb()) return;
    const row = gReqs.find((r) => r.id === reqRowId);
    await dbUpdateReq(user.token, reqRowId, { status: "emitida", result: data });
    if (row) await dbInsertNoti(user.token, row.user_id, "Los datos bancarios para tu depósito ya están disponibles en Depositar → Fiat.").catch(() => {});
    await gestorReload();
    setToast("Datos bancarios emitidos");
  };
  const gVerifyAddrDb = async (addrRowId) => {
    if (!isSb()) return;
    const vrow = gAddrs.find((a) => a.id === addrRowId);
    await dbUpdateAddr(user.token, addrRowId, { status: "verificada" });
    if (vrow) await dbInsertNoti(user.token, vrow.user_id, `Verificamos tu dirección "${vrow.label}". Ya puedes usarla para retirar.`).catch(() => {});
    await gestorReload();
    setToast("Dirección verificada");
  };
  const gFillReportDb = async (reqRowId, data) => {
    if (!isSb()) return;
    const rrow = gReqs.find((r) => r.id === reqRowId);
    await dbUpdateReq(user.token, reqRowId, { status: "resuelta", result: data });
    if (rrow) await dbInsertNoti(user.token, rrow.user_id, "El informe de la dirección que consultaste ya está disponible en Explorar.").catch(() => {});
    await gestorReload();
    setToast("Informe publicado");
  };
  const [addrReports, setAddrReports] = useState({}); // valor -> {status, at, balanceUsd, txCount, first}
  const [seed, setSeed] = useState(null);
  const [chat, setChat] = useState(CHAT0());
  const [chatOpen, setChatOpen] = useState(false);
  const [notis, setNotis] = useState([]);
  const [notisOpen, setNotisOpen] = useState(false);
  const [notisUnread, setNotisUnread] = useState(0);
  const noid = useRef(0);
  const notify = (text) => {
    setNotis((p) => [{ id: Date.now(), text, at: hhmm() }, ...p]);
    setNotisUnread((n) => n + 1);
    if (isSb() && view === "cliente" && user?.id) dbInsertNoti(user.token, user.id, text).catch(() => {});
  };

  const [sheet, setSheet] = useState(null);
  const [deny, setDeny] = useState(null); // {kind, id, title}
  const [emitFor, setEmitFor] = useState(null); // moneda cuya dirección va a emitir el gestor
  const [reportFor, setReportFor] = useState(null); // dirección cuyo informe rellena el gestor
  const [toast, setToast] = useState(null);
  const [dispCur, setDispCur] = useState("usd");
  const [notif, setNotif] = useState(true);
  const [audit, setAudit] = useState([]);
  const nid = useRef(50);
  const aid = useRef(0);
  const cid = useRef(10);
  const bid = useRef(0);
  const changingPin = useRef(false);
  const localUsers = useRef([]); // respaldo local si Supabase no está configurado

  const logEvent = (type, detail) =>
    setAudit((p) => [{ id: ++aid.current, type, detail, at: fecha() }, ...p]);
  const gestorSay = (text) =>
    setChat((p) => [...p, { id: ++cid.current, from: "gestor", text, at: hhmm() }]);
  const userSay = (text) => {
    setChat((p) => [...p, { id: ++cid.current, from: "yo", text, at: hhmm() }]);
    if (isSb() && user?.id) dbInsertMsg(user.token, user.id, "cliente", text).catch(() => {});
    logEvent("Soporte", "Mensaje del cliente en el chat");
  };

  /* Precios simulados en vivo (la fuente real se administra desde el panel) */
  useEffect(() => {
    const iv = setInterval(() => {
      const tick = (l) => l.map((a) => {
        const s = (Math.random() - 0.485) * a.vol;
        return { ...a, price: Math.max(a.price * (1 + s), 0.0001), last: s };
      });
      setAssets(tick); setMovers(tick);
    }, 2400);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const x = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(x);
  }, [toast]);

  // Cargar movimientos guardados en Supabase al iniciar sesión un cliente.
  // Reconstruye saldos desde el historial: así, entre desde donde entre, ve lo mismo.
  const isSb = () => supabaseReady() && user?.token && user?.id;
  useEffect(() => {
    if (screen !== "app" || view !== "cliente" || !isSb()) return;
    let cancel = false;
    (async () => {
      try {
        const loaded = await dbLoadTxs(user.token, user.id);
        if (cancel) return;
        setTxs(loaded);
        // Reconstruir saldos cripto y fiat desde el historial confirmado
        setAssets((prev) => prev.map((a) => {
          let amt = 0;
          for (const t of loaded) {
            if (t.coin !== a.id || t.kind !== "cripto") continue;
            if (t.status === "confirmada") amt += t.type === "deposito" ? t.amount : -t.amount;
            else if (t.status === "pendiente" && t.type === "retiro") amt -= t.amount; // retiro retenido
          }
          return { ...a, amount: Math.max(amt, 0) };
        }));
        let e = 0;
        for (const t of loaded) {
          if (t.kind !== "fiat") continue;
          if (t.status === "confirmada") e += t.type === "deposito" ? t.amount : -t.amount;
          else if (t.status === "pendiente" && t.type === "retiro") e -= t.amount;
        }
        setEur(Math.max(e, 0));

        // Direcciones (depósito emitidas + lista blanca de retiro)
        const addrs = await dbLoadAddrs(user.token, user.id);
        if (cancel) return;
        const dep = {};
        const wl = [];
        for (const a of addrs) {
          if (a.purpose === "deposito") {
            dep[a.coin] = { status: a.status === "lista" ? "lista" : "pendiente", addr: a.address || undefined, at: fmtDate(a.created_at), _id: a.id };
          } else {
            wl.push({ id: a.id, chain: a.coin, label: a.label, addr: a.address, status: a.status === "verificada" ? "verificada" : a.status === "rechazada" ? "rechazada" : "verificacion", reason: a.reason || undefined, at: fmtDate(a.created_at) });
          }
        }
        setDepositAddrs(dep);
        setBook(wl);

        // Solicitudes (datos fiat, billetera, kyc)
        const reqs = await dbLoadReqs(user.token, user.id);
        if (cancel) return;
        const fiatPend = reqs.find((q) => q.kind === "datos_fiat" && q.status !== "resuelta" && q.status !== "denegada");
        if (fiatPend) {
          const r = fiatPend.result || {};
          setFiatReq({ id: fiatPend.id, amount: (fiatPend.payload || {}).amount, status: fiatPend.status === "emitida" ? "emitida" : "pendiente", beneficiario: r.beneficiario, titular: r.titular, iban: r.iban, bic: r.bic, ref: r.ref, at: fmtDate(fiatPend.created_at) });
        }
        const wallet = reqs.find((q) => q.kind === "billetera");
        if (wallet) {
          setWalletState(wallet.status === "resuelta" ? "activa" : wallet.status === "emitida" ? "seed" : "solicitada");
          if (wallet.result && wallet.result.seed) setSeed(wallet.result.seed);
        }
        const kycReq = reqs.find((q) => q.kind === "kyc_n2");
        if (kycReq) setKyc({ level: kycReq.status === "resuelta" ? 2 : 1, status: kycReq.status === "pendiente" || kycReq.status === "emitida" ? "pendiente" : "ok" });
        // Informes de dirección (explorador)
        const reps = {};
        for (const q of reqs) {
          if (q.kind !== "informe_direccion") continue;
          const addr = (q.payload || {}).address;
          if (!addr) continue;
          if (q.status === "resuelta" && q.result) reps[addr] = { status: "lista", at: fmtDate(q.created_at), ...q.result };
          else reps[addr] = { status: "pendiente", at: fmtDate(q.created_at) };
        }
        setAddrReports(reps);

        // Chat de soporte y notificaciones
        const msgs = await dbLoadMsgs(user.token, user.id);
        if (cancel) return;
        if (msgs.length) setChat(msgs.map((m) => ({ id: m.id, from: m.sender === "gestor" ? "gestor" : "yo", text: m.body, at: fmtTime(m.created_at) })));
        const nt = await dbLoadNotis(user.token, user.id);
        if (cancel) return;
        setNotis(nt.map((n) => ({ id: n.id, text: n.body, at: fmtTime(n.created_at) })));
        setNotisUnread(nt.filter((n) => !n.read).length);
      } catch (err) { /* silencioso: la app sigue en modo local */ }
    })();
    return () => { cancel = true; };
  }, [screen, view, user?.id]);

  // Refresco periódico del cliente: trae del servidor lo que el gestor haya
  // cambiado (saldos, notificaciones, chat) sin que el cliente recargue.
  useEffect(() => {
    if (screen !== "app" || view !== "cliente" || !isSb()) return;
    const iv = setInterval(async () => {
      try {
        const [loaded, nt, msgs, addrs, reqs] = await Promise.all([
          dbLoadTxs(user.token, user.id),
          dbLoadNotis(user.token, user.id),
          dbLoadMsgs(user.token, user.id),
          dbLoadAddrs(user.token, user.id),
          dbLoadReqs(user.token, user.id),
        ]);
        setTxs(loaded);
        setAssets((prev) => prev.map((a) => {
          let amt = 0;
          for (const tx of loaded) {
            if (tx.coin !== a.id || tx.kind !== "cripto") continue;
            if (tx.status === "confirmada") amt += tx.type === "deposito" ? tx.amount : -tx.amount;
            else if (tx.status === "pendiente" && tx.type === "retiro") amt -= tx.amount;
          }
          return { ...a, amount: Math.max(amt, 0) };
        }));
        let e = 0;
        for (const tx of loaded) {
          if (tx.kind !== "fiat") continue;
          if (tx.status === "confirmada") e += tx.type === "deposito" ? tx.amount : -tx.amount;
          else if (tx.status === "pendiente" && tx.type === "retiro") e -= tx.amount;
        }
        setEur(Math.max(e, 0));
        setNotis(nt.map((n) => ({ id: n.id, text: n.body, at: fmtTime(n.created_at) })));
        setNotisUnread(nt.filter((n) => !n.read).length);
        if (msgs.length) setChat(msgs.map((m) => ({ id: m.id, from: m.sender === "gestor" ? "gestor" : "yo", text: m.body, at: fmtTime(m.created_at) })));
        // Direcciones: refleja en vivo cuando el gestor emite
        const dep = {};
        const wl = [];
        for (const a of addrs) {
          if (a.purpose === "deposito") dep[a.coin] = { status: a.status === "lista" ? "lista" : "pendiente", addr: a.address || undefined, at: fmtDate(a.created_at), _id: a.id };
          else wl.push({ id: a.id, chain: a.coin, label: a.label, addr: a.address, status: a.status === "verificada" ? "verificada" : a.status === "rechazada" ? "rechazada" : "verificacion", reason: a.reason || undefined, at: fmtDate(a.created_at) });
        }
        setDepositAddrs(dep);
        setBook(wl);
        const fiatPend = reqs.find((q) => q.kind === "datos_fiat" && q.status !== "resuelta" && q.status !== "denegada");
        if (fiatPend) { const rr = fiatPend.result || {}; setFiatReq({ id: fiatPend.id, amount: (fiatPend.payload || {}).amount, status: fiatPend.status === "emitida" ? "emitida" : "pendiente", beneficiario: rr.beneficiario, titular: rr.titular, iban: rr.iban, bic: rr.bic, ref: rr.ref, at: fmtDate(fiatPend.created_at) }); }
        const wallet = reqs.find((q) => q.kind === "billetera");
        if (wallet) {
          setWalletState(wallet.status === "resuelta" ? "activa" : wallet.status === "emitida" ? "seed" : "solicitada");
          if (wallet.result && wallet.result.seed) setSeed(wallet.result.seed);
        }
        const reps = {};
        for (const q of reqs) {
          if (q.kind !== "informe_direccion") continue;
          const addr = (q.payload || {}).address;
          if (!addr) continue;
          if (q.status === "resuelta" && q.result) reps[addr] = { status: "lista", at: fmtDate(q.created_at), ...q.result };
          else reps[addr] = { status: "pendiente", at: fmtDate(q.created_at) };
        }
        setAddrReports(reps);
      } catch (e) { /* silencioso */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [screen, view, user?.id]);

  const cryptoUsd = assets.reduce((s, a) => s + a.price * a.amount, 0);
  const total = cryptoUsd + eur * EUR_USD;

  /* ---------- Autenticación (Supabase con respaldo local) ---------- */

  const registerUser = async (email, pass) => {
    if (findGestor(email)) throw new Error("Este correo no está disponible");
    if (supabaseReady()) {
      const d = await supabaseAuth("signup", { email, password: pass });
      return { mode: "supabase", id: d.user?.id, token: d.access_token || d.session?.access_token };
    }
    if (localUsers.current.some((u) => u.email === email)) throw new Error("Este correo ya está registrado");
    localUsers.current.push({ email, pass, created: fecha() });
    return { mode: "local" };
  };

  const loginUser = async (email, pass) => {
    if (supabaseReady()) {
      const d = await supabaseAuth("token?grant_type=password", { email, password: pass });
      return { mode: "supabase", id: d.user?.id, token: d.access_token };
    }
    const g = findGestor(email);
    if (g) {
      if (pass !== g.pass) throw new Error("Correo o contraseña incorrectos");
      return { mode: "gestor", gestorName: g.name };
    }
    const u = localUsers.current.find((x) => x.email === email);
    if (!u || u.pass !== pass) throw new Error("Correo o contraseña incorrectos");
    return { mode: "local" };
  };

  const onAuthDone = async (email, kind, res) => {
    // Con Supabase, el rol lo decide la tabla profiles (matriz/gestor/cliente).
    if (res?.mode === "supabase" && res?.token && res?.id) {
      const prof = await fetchProfile(res.token, res.id);
      const role = prof?.role || "cliente";
      const name = prof?.display_name || email.split("@")[0];
      setUser({ name, email, id: res.id, token: res.token, role, assignedGestor: prof?.assigned_gestor || null });
      logEvent("Acceso", `Sesión: ${email} [${role}]`);
      if (role === "matriz" || role === "gestor") { setView("gestor"); setScreen("app"); return; }
      // cliente: PIN. Si ya tiene hash en el perfil, verificar; si no, crear.
      if (prof?.pin_hash && prof?.pin_salt) { setPinSec({ email, salt: prof.pin_salt, hash: prof.pin_hash }); setScreen("pinVerify"); }
      else setScreen(pinSec && pinSec.email === email ? "pinVerify" : "pin");
      setView("cliente");
      return;
    }
    // Sin Supabase: modo local con la lista de gestores de ejemplo.
    const g = findGestor(email);
    setUser({ name: g ? g.name : email.split("@")[0], email, id: res?.id, token: res?.token, role: g ? "gestor" : "cliente" });
    logEvent("Acceso", `${kind === "registro" ? "Cuenta creada" : "Sesión iniciada"}: ${email}${g ? ` [${g.name}]` : ""}`);
    if (g) { setView("gestor"); setScreen("app"); return; }
    setView("cliente");
    setScreen(pinSec && pinSec.email === email ? "pinVerify" : "pin");
  };

  /* PIN: nunca se guarda en claro. Hash SHA-256 con salt; si hay sesión de
     Supabase, el hash se sincroniza a la tabla profiles (RLS: solo el dueño). */
  const [pinSec, setPinSec] = useState(null);
  const savePin = async (pinValue) => {
    const salt = randHex(16);
    const hash = await sha256Hex(salt + ":" + pinValue);
    setPinSec({ email: user?.email, salt, hash });
    logEvent("Acceso", changingPin.current ? "PIN actualizado (hash renovado)" : "PIN configurado (SHA-256 + salt)");
    if (supabaseReady() && user?.token && user?.id) {
      fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${user.token}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{ id: user.id, email: user.email, pin_salt: salt, pin_hash: hash }]),
      }).catch(() => {});
    }
  };

  /* ---------- Solicitudes del cliente (quedan pendientes) ---------- */

  const requestDepositAddr = async (coin) => {
    setDepositAddrs((p) => ({ ...p, [coin]: { status: "pendiente", at: fecha() } }));
    if (isSb()) { try { await dbInsertAddr(user.token, user.id, { purpose: "deposito", coin, chain: chainOf(coin), status: "pendiente" }); } catch (e) {} }
    logEvent("Ingreso", `Solicitud de dirección de depósito: ${coin.toUpperCase()}`);
    setToast(`Solicitud enviada (${coin.toUpperCase()}). Pendiente de emisión.`);
  };

  const creditIncoming = async (coin, amount) => {
    const a = assets.find((x) => x.id === coin);
    const d = depositAddrs[coin];
    const base = { kind: "cripto", type: "deposito", coin, sym: a.sym, amount,
      valueUsd: amount * a.price, date: fecha(), status: "confirmada", op: opNum(),
      hash: randHex(64), from: randAddr(chainOf(coin)), to: d?.addr, feeUsd: a.fee, conf: 40 + Math.floor(Math.random() * 500) };
    setAssets((p) => p.map((x) => (x.id === coin ? { ...x, amount: x.amount + amount } : x)));
    let saved = null;
    if (isSb()) { try { saved = await dbInsertTx(user.token, user.id, base); } catch (e) {} }
    setTxs((p) => [saved || { ...base, id: ++nid.current }, ...p]);
    logEvent("Ingreso", `Depósito en cadena acreditado: ${fNum(amount)} ${a.sym}`);
    notify(`Detectamos y acreditamos tu depósito entrante de ${fNum(amount)} ${a.sym}.`);
    setToast(`Depósito acreditado: ${fNum(amount)} ${a.sym}`);
  }


  const requestFiatData = async (amountEur) => {
    setFiatReq({ id: Date.now(), amount: amountEur, status: "pendiente", at: fecha() });
    if (isSb()) {
      try {
        await dbCloseOpenFiatReqs(user.token, user.id); // cierra intentos anteriores abandonados
        const r = await dbInsertReq(user.token, user.id, { kind: "datos_fiat", payload: { amount: amountEur } });
        if (r) setFiatReq({ id: r.id, amount: amountEur, status: "pendiente", at: fecha() });
      } catch (e) {}
    }
    logEvent("Ingreso", `Solicitud de datos de depósito fiat: ${fEur(amountEur)}`);
    setToast("Solicitud enviada. El gestor emitirá los datos bancarios.");
  };

  const gEmitFiatData = () => {
    const ref = `${BRAND_CODE}-REF-` + Math.floor(100000 + Math.random() * 899999);
    setFiatReq((r) => (r ? { ...r, status: "emitida", titular: BRAND_LEGAL, iban: "ES91 2100 0418 4502 0005 1332", ref } : r));
    logEvent("Ingreso", `Gestor emitió datos bancarios (${ref})`);
    notify("Los datos bancarios para tu depósito ya están disponibles en Depositar → Fiat. Usa el concepto indicado.");
    setToast("Datos bancarios emitidos");
  };

  const confirmFiatTransfer = () => {
    if (!fiatReq || fiatReq.status !== "emitida") return;
    fiatDeposit(fiatReq.amount, fiatReq.ref);
    // Cerrar la solicitud en Supabase para que no reaparezca en el próximo refresco.
    if (isSb() && user?.id && typeof fiatReq.id === "number") dbUpdateReq(user.token, fiatReq.id, { status: "resuelta" }).catch(() => {});
    setFiatReq(null); // los datos fiat se solicitan de nuevo en cada depósito
  };

  const fiatDeposit = async (amountEur, ref) => {
    const tx = { kind: "fiat", type: "deposito", coin: "eur", sym: "EUR", amount: amountEur,
      valueEur: amountEur, date: fecha(), status: "pendiente", op: ref, iban: "Transferencia SEPA entrante" };
    let saved = null;
    if (isSb()) { try { saved = await dbInsertTx(user.token, user.id, tx); } catch (e) {} }
    setTxs((p) => [saved || { ...tx, id: ++nid.current }, ...p]);
    logEvent("Ingreso", `Depósito fiat notificado: ${fEur(amountEur)} · ${ref}`);
    setToast("Depósito notificado. Pendiente de validación.");
    setSheet(null);
  };

  const withdrawFiat = async (amountEur, iban) => {
    const base = { kind: "fiat", type: "retiro", coin: "eur", sym: "EUR", amount: amountEur,
      valueEur: amountEur, date: fecha(), status: "pendiente", op: opNum(), iban };
    setEur((v) => v - amountEur);
    let saved = null;
    if (isSb()) { try { saved = await dbInsertTx(user.token, user.id, base); } catch (e) {} }
    const tx = saved || { ...base, id: ++nid.current };
    setTxs((p) => [tx, ...p]);
    logEvent("Retiro", `Solicitud de retiro fiat: ${fEur(amountEur)} · ${tx.op}`);
    setSheet(null);
    setReceipt(tx);
  };

  const withdrawCrypto = async (coin, amount, entry) => {
    const a = assets.find((x) => x.id === coin);
    const base = { kind: "cripto", type: "retiro", coin, sym: a.sym, amount,
      valueUsd: amount * a.price, date: fecha(), status: "pendiente", op: opNum(),
      to: entry.addr, toLabel: entry.label, feeUsd: a.fee };
    setAssets((p) => p.map((x) => (x.id === coin ? { ...x, amount: x.amount - amount } : x)));
    let saved = null;
    if (isSb()) { try { saved = await dbInsertTx(user.token, user.id, base); } catch (e) {} }
    const tx = saved || { ...base, id: ++nid.current };
    setTxs((p) => [tx, ...p]);
    logEvent("Retiro", `Solicitud de retiro: ${fNum(amount)} ${a.sym} · ${tx.op}`);
    setSheet(null);
    setReceipt(tx);
  };

  const requestWallet = async () => {
    setWalletState("solicitada");
    if (isSb()) { try { await dbInsertReq(user.token, user.id, { kind: "billetera", payload: {} }); } catch (e) {} }
    logEvent("Billetera", "Solicitud de billetera de autocustodia");
    setToast("Solicitud enviada. Pendiente de emisión.");
  };
  const confirmSeed = async () => {
    setWalletState("activa");
    if (isSb() && user?.id) {
      try {
        const reqs = await dbLoadReqs(user.token, user.id);
        const w = reqs.find((q) => q.kind === "billetera" && q.status === "emitida");
        if (w) await dbUpdateReq(user.token, w.id, { status: "resuelta" });
      } catch (e) {}
    }
    logEvent("Billetera", "Billetera de autocustodia activada por el cliente");
    setToast("Billetera activa");
  };

  const addBookEntry = async (chain, label, addr) => {
    let saved = null;
    if (isSb()) { try { saved = await dbInsertAddr(user.token, user.id, { purpose: "retiro", coin: chain, chain: chainOf(chain), label, address: addr, status: "verificacion" }); } catch (e) {} }
    setBook((p) => [{ id: saved ? saved.id : ++bid.current, chain, label, addr, status: "verificacion", at: fecha() }, ...p]);
    logEvent("Direcciones", `Dirección registrada (${chain.toUpperCase()}): ${label}`);
    setToast("Dirección enviada a verificación");
  };

  /* ---------- Acciones del gestor (desde el panel) ---------- */

  const gEmitAddr = (coin, addr) => {
    setDepositAddrs((p) => ({ ...p, [coin]: { status: "lista", addr } }));
    logEvent("Ingreso", `Gestor emitió dirección de depósito de ${coin.toUpperCase()}`);
    notify(`Tu dirección de depósito de ${coin.toUpperCase()} ya está disponible en Depositar → Cripto.`);
    setToast(`Dirección de ${coin.toUpperCase()} emitida`);
  };

  const gValidateFiat = (id) => {
    const tx = txs.find((x) => x.id === id);
    setEur((v) => v + tx.amount);
    setTxs((p) => p.map((x) => (x.id === id ? { ...x, status: "confirmada" } : x)));
    if (isSb()) dbUpdateTx(user.token, id, { status: "confirmada" }).catch(() => {});
    logEvent("Ingreso", `Gestor validó depósito ${tx.op} (${fEur(tx.amount)})`);
    notify(`Validamos tu transferencia de ${fEur(tx.amount)}. El saldo ya está disponible.`);
    setToast("Depósito validado");
  };

  const gApproveWithdraw = (id) => {
    const tx = txs.find((x) => x.id === id);
    const extra = tx.kind === "cripto" ? { hash: randHex(64), conf: 24 + Math.floor(Math.random() * 300) } : {};
    setTxs((p) => p.map((x) => (x.id === id ? { ...x, status: "confirmada", ...extra } : x)));
    if (isSb()) dbUpdateTx(user.token, id, { status: "confirmada", ...extra }).catch(() => {});
    logEvent("Retiro", `Gestor aprobó el retiro ${tx.op}`);
    notify(tx.kind === "fiat"
      ? `Tu retiro ${tx.op} de ${fEur(tx.amount)} fue aprobado y enviado a tu banco.`
      : `Tu retiro ${tx.op} de ${fNum(tx.amount)} ${tx.sym} fue firmado y difundido a la red.`);
    setToast(`Retiro ${tx.op} aprobado`);
  };

  const gDenyWithdraw = (id, reason) => {
    const tx = txs.find((x) => x.id === id);
    if (tx.kind === "fiat") setEur((v) => v + tx.amount);
    else setAssets((p) => p.map((x) => (x.id === tx.coin ? { ...x, amount: x.amount + tx.amount } : x)));
    setTxs((p) => p.map((x) => (x.id === id ? { ...x, status: "denegada", reason } : x)));
    if (isSb()) dbUpdateTx(user.token, id, { status: "denegada", reason }).catch(() => {});
    logEvent("Retiro", `Gestor denegó el retiro ${tx.op}: ${reason}`);
    notify(`Tu retiro ${tx.op} fue denegado. Motivo: ${reason}. Los fondos fueron devueltos a tu saldo.`);
    setToast(`Retiro ${tx.op} denegado`);
  };

  const gDenyFiatDeposit = (id, reason) => {
    const tx = txs.find((x) => x.id === id);
    setTxs((p) => p.map((x) => (x.id === id ? { ...x, status: "denegada", reason } : x)));
    if (isSb()) dbUpdateTx(user.token, id, { status: "denegada", reason }).catch(() => {});
    logEvent("Ingreso", `Gestor rechazó el depósito ${tx.op}: ${reason}`);
    notify(`No pudimos validar tu depósito ${tx.op}. Motivo: ${reason}.`);
    setToast("Depósito rechazado");
  };

  const gVerifyAddr = (id) => {
    const b = book.find((x) => x.id === id);
    setBook((p) => p.map((x) => (x.id === id ? { ...x, status: "verificada" } : x)));
    logEvent("Direcciones", `Gestor verificó la dirección "${b.label}"`);
    notify(`Verificamos tu dirección "${b.label}". Ya puedes usarla para retirar.`);
    setToast(`Dirección "${b.label}" verificada`);
  };

  const gRejectAddr = (id, reason) => {
    const b = book.find((x) => x.id === id);
    setBook((p) => p.map((x) => (x.id === id ? { ...x, status: "rechazada", reason } : x)));
    logEvent("Direcciones", `Gestor rechazó la dirección "${b.label}": ${reason}`);
    notify(`Tu dirección "${b.label}" no pasó la verificación. Motivo: ${reason}.`);
    setToast("Dirección rechazada");
  };

  const gEmitSeed = () => {
    setSeed(genSeed());
    setWalletState("seed");
    logEvent("Billetera", "Gestor emitió la frase de recuperación");
    notify("Tu frase de recuperación está lista en Billetera. Anótala en papel y confírmalo en la app.");
    setToast("Frase de recuperación emitida");
  };

  const requestAddrReport = async (value) => {
    setAddrReports((p) => ({ ...p, [value]: { status: "pendiente", at: fecha() } }));
    if (isSb() && user?.id) { try { await dbInsertReq(user.token, user.id, { kind: "informe_direccion", payload: { address: value } }); } catch (e) {} }
    logEvent("Explorador", `Informe de dirección solicitado: ${value.slice(0, 18)}…`);
    setToast("Solicitud enviada al equipo de operaciones");
  };
  const gFillAddrReport = (value, rep) => {
    setAddrReports((p) => ({ ...p, [value]: { ...p[value], ...rep, status: "lista" } }));
    logEvent("Explorador", `Informe de dirección completado: ${value.slice(0, 18)}…`);
    notify("El informe de la dirección que consultaste ya está disponible en Explorar.");
    setToast("Informe publicado");
  };

  const requestKycUpgrade = async () => {
    setKyc((k) => ({ ...k, status: "pendiente" }));
    if (isSb()) { try { await dbInsertReq(user.token, user.id, { kind: "kyc_n2", payload: {} }); } catch (e) {} }
    logEvent("Acceso", "Solicitud de verificación Nivel 2 enviada");
    notify("Recibimos tu solicitud de Nivel 2. Te avisaremos cuando el gestor la revise.");
    setToast("Solicitud de Nivel 2 enviada");
  };
  const gApproveKyc = () => {
    setKyc({ level: 2, status: "ok" });
    logEvent("Acceso", "Gestor aprobó la verificación Nivel 2");
    notify("Tu verificación Nivel 2 fue aprobada. Nuevo límite de retiro: " + fEur(50000) + " / día.");
    setToast("Nivel 2 aprobado");
  };
  const gDenyKyc = (reason) => {
    setKyc({ level: 1, status: "ok" });
    logEvent("Acceso", `Gestor denegó la verificación Nivel 2: ${reason}`);
    notify(`Tu solicitud de Nivel 2 fue denegada. Motivo: ${reason}.`);
    setToast("Nivel 2 denegado");
  };
  const dailyLimit = kyc.level === 2 ? 50000 : 10000;

  const onDenySubmit = async (reason) => {
    if (!deny) return;
    if (isSb() && (user?.role === "gestor" || user?.role === "matriz")) {
      if (deny.kind === "retiro") { await dbUpdateTx(user.token, deny.id, { status: "denegada", reason }); await gestorReload(); }
      else if (deny.kind === "fiatdep") { await dbUpdateTx(user.token, deny.id, { status: "denegada", reason }); await gestorReload(); }
      else if (deny.kind === "addr") { await dbUpdateAddr(user.token, deny.id, { status: "rechazada", reason }); await gestorReload(); }
      else if (deny.kind === "kyc") { await dbUpdateReq(user.token, deny.id, { status: "denegada", reason }); await gestorReload(); }
      setDeny(null); setToast("Solicitud denegada");
      return;
    }
    if (deny.kind === "retiro") gDenyWithdraw(deny.id, reason);
    if (deny.kind === "depfiat") gDenyFiatDeposit(deny.id, reason);
    if (deny.kind === "addr") gRejectAddr(deny.id, reason);
    if (deny.kind === "kyc") gDenyKyc(reason);
    setDeny(null);
  };

  const logout = () => {
    logEvent("Acceso", "Sesión cerrada");
    try { localStorage.removeItem("ambar_session"); } catch (e) {}
    setUser(null); setView("cliente"); setScreen("onboarding"); setTab("inicio");
    setToast("Sesión cerrada");
  };
  const changePin = () => { changingPin.current = true; setScreen("pin"); };
  const verifyPin = async (p) => pinSec ? (await sha256Hex(pinSec.salt + ":" + p)) === pinSec.hash : false;
  const fMon = (nUsd) => (dispCur === "usd" ? fUsd(nUsd) : fEur(nUsd / EUR_USD));

  const reset = () => {
    setView("cliente"); setScreen("onboarding"); setUser(null); setTab("inicio");
    setAssets(ASSETS0); setMovers(MOVERS0); setEur(0); setTxs([]); setBook([]);
    setDepositAddrs({}); setFiatReq(null); setWalletState("none"); setSeed(null); setAudit([]); setPinSec(null); setNotis([]); setNotisUnread(0); setAddrReports({});
    setChat(CHAT0()); localUsers.current = [];
    setToast("Demo restablecida");
  };

  const pendingCount =
    txs.filter((x) => x.status === "pendiente").length +
    Object.values(depositAddrs).filter((d) => d.status === "pendiente").length +
    book.filter((b) => b.status === "verificacion").length +
    (walletState === "solicitada" ? 1 : 0) +
    (fiatReq?.status === "pendiente" ? 1 : 0) +
    (kyc.status === "pendiente" ? 1 : 0) +
    Object.values(addrReports).filter((r) => r.status === "pendiente").length;

  return (
    <ThemeCtx.Provider value={t}>
    <CurCtx.Provider value={{ cur: dispCur, fMon }}>
      <div className="ambar-outer" style={{ minHeight: "100vh", background: "#EDEFF3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "16px 0", fontFamily: FONT.display }}>
        <link rel="stylesheet" href={FONT_URL} />
        <style>{`
          * { box-sizing: border-box; }
          button { font-family: inherit; cursor: pointer; }
          input, select, textarea { font-family: inherit; }
          @keyframes rise { from { opacity:0; transform: translateY(10px);} to { opacity:1; transform:none; } }
          @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
          .rise { animation: rise .32s ease both; }
          .press:active:not(:disabled) { transform: scale(0.95); }
          .press { transition: transform .12s ease, background .15s ease; }
          .nosb::-webkit-scrollbar { display: none; } .nosb { scrollbar-width: none; }
          input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
          /* Móvil: la app ocupa toda la pantalla, sin marco de teléfono */
          @media (max-width: 500px) {
            .ambar-outer { padding: 0 !important; background: ${t.bg} !important; }
            .ambar-phone {
              max-width: 100% !important;
              height: 100vh !important;
              height: 100dvh !important;
              border-radius: 0 !important;
              border: none !important;
              box-shadow: none !important;
            }
          }
        `}</style>

        <div className="ambar-phone" style={{ width: "100%", maxWidth: 400, height: "min(88vh, 820px)", background: t.bg, color: t.textPrimary, borderRadius: 34, border: `1px solid ${t.line}`, boxShadow: "0 24px 70px rgba(16,17,18,.18)", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", fontVariantNumeric: "tabular-nums", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ height: 16, flexShrink: 0 }} />

          {view === "gestor" ? (
            isSb() ? (
              <GestorPanelDb user={user} clients={gClients} addrs={gAddrs} reqs={gReqs} txs={gTxs}
                gestores={gGestores} assets={assets} loading={gLoading} onReload={gestorReload}
                onEmitFiatData={(reqId) => { const r = gReqs.find((x) => x.id === reqId); setGFiatRow(r); }} onValidateFiat={gValidateFiatDb}
                onApproveWithdraw={gApproveWithdrawDb} onVerifyAddr={gVerifyAddrDb}
                onResolveReq={(id, patch) => gResolveDb(null, id, patch)}
                onDeny={setDeny} onLogout={logout}
                onAssign={async (cid, gid) => { await dbAssignClient(user.token, cid, gid); await gestorReload(); setToast("Cliente asignado"); }}
                onOpenEmit={(row) => setGEmitRow(row)}
                onCreditClient={gCreditClientDb}
                onOpenReport={(r) => setGReportRow(r)}
                chatClient={gChatClient} chatMsgs={gChatMsgs} onOpenChat={(c) => { gOpenChat(c); const mx = Math.max(0, ...gMsgs.map((m) => m.id)); setGMsgsSeen(mx); }} onSendChat={gSendChat} onCloseChat={() => setGChatClient(null)}
                newMsgs={gMsgs.filter((m) => m.id > gMsgsSeen).length}
                onOpenReport={(r) => setGReportRow(r)} onOpenSeed={(r) => setGSeedRow(r)} />
            ) : (
            <GestorPanel txs={txs} depositAddrs={depositAddrs} book={book} walletState={walletState}
              user={user} eur={eur} totalUsd={total} chat={chat} audit={audit}
              onEmitAddr={setEmitFor} onValidateFiat={gValidateFiat} onApprove={gApproveWithdraw}
              onDeny={setDeny} onVerifyAddr={gVerifyAddr} onEmitSeed={gEmitSeed} onReply={gestorSay} fiatReq={fiatReq} onEmitFiatData={gEmitFiatData} onCreditIncoming={creditIncoming} assets={assets} kyc={kyc} onApproveKyc={gApproveKyc} addrReports={addrReports} onOpenReport={setReportFor} onLogout={logout} />
            )
          ) : (
            <>
              {screen === "onboarding" && <Onboarding onRegister={() => setScreen("registro")} onLogin={() => setScreen("login")} />}
              {screen === "login" && <Auth mode="login" onSubmit={loginUser} onDone={(e, m) => onAuthDone(e, "login", m)} onSwitch={() => setScreen("registro")} onBack={() => setScreen("onboarding")} />}
              {screen === "registro" && <Auth mode="registro" onSubmit={registerUser} onDone={(e, m) => onAuthDone(e, "registro", m)} onSwitch={() => setScreen("login")} onBack={() => setScreen("onboarding")} />}
              {screen === "pin" && <Pin onDone={(pinValue) => { savePin(pinValue); setScreen("app"); if (changingPin.current) { changingPin.current = false; setToast("PIN actualizado"); } }} />}
              {screen === "pinVerify" && <Pin mode="verify" verify={verifyPin} onDone={() => setScreen("app")} onForgot={() => setScreen("pin")} />}

              {screen === "app" && (
                <>
                  <div className="nosb" style={{ flex: 1, overflowY: "auto", paddingBottom: 84 }}>
                    {tab === "inicio" && <Home assets={assets} movers={movers} total={total} eur={eur} user={user}
                      onDeposit={() => setSheet("depositar")} onWithdraw={() => setSheet("retirar")} txs={txs} onTx={setTxDetail} onOpenNotis={() => { setNotisOpen(true); setNotisUnread(0); if (isSb() && user?.id) dbMarkNotisRead(user.token, user.id).catch(() => {}); }} unread={notisUnread} />}
                    {tab === "billetera" && <WalletPage walletState={walletState} seed={seed} onRequestWallet={requestWallet} onConfirmSeed={confirmSeed}
                      book={book} onAddEntry={addBookEntry} setToast={setToast} />}
                    {tab === "explorar" && <Explore assets={assets} onOpenChain={setChainSheet} txs={txs} depositAddrs={depositAddrs} book={book} addrReports={addrReports} onRequestReport={requestAddrReport} />}
                    {tab === "ajustes" && <Settings user={user} onOpenChat={() => setChatOpen(true)} chat={chat}
                      dispCur={dispCur} setDispCur={setDispCur} notif={notif} setNotif={setNotif} onChangePin={changePin} onLogout={logout} kyc={kyc} dailyLimit={dailyLimit} onKycUpgrade={requestKycUpgrade} />}
                  </div>
                  <Nav tab={tab} setTab={setTab} />
                </>
              )}

              {sheet === "depositar" && <DepositSheet assets={assets} depositAddrs={depositAddrs} onRequestAddr={requestDepositAddr}
                fiatReq={fiatReq} onRequestFiatData={requestFiatData} onConfirmFiat={confirmFiatTransfer} onClose={() => setSheet(null)} />}
              {sheet === "retirar" && <WithdrawSheet assets={assets} eur={eur} book={book} onFiat={withdrawFiat} onCrypto={withdrawCrypto}
                onClose={() => setSheet(null)} goBook={() => { setSheet(null); setTab("billetera"); }} />}
              {receipt && <ReceiptSheet tx={txs.find((x) => x.id === receipt.id) || receipt} onClose={() => setReceipt(null)} />}
              {txDetail && <TxSheet tx={txs.find((x) => x.id === txDetail.id) || txDetail} onClose={() => setTxDetail(null)} onExplore={() => { setTxDetail(null); setTab("explorar"); }} />}
              {notisOpen && <NotisSheet notis={notis} onClose={() => setNotisOpen(false)} />}
          {chatOpen && <ChatSheet chat={chat} onSend={userSay} onClose={() => setChatOpen(false)} me="yo" title="Soporte en línea" />}
            </>
          )}

          {chainSheet && <ChainSheet chain={assets.find((a) => a.id === chainSheet) || chainSheet} onClose={() => setChainSheet(null)} />}
          {deny && <DenyModal title={deny.title} onCancel={() => setDeny(null)} onSubmit={onDenySubmit} />}
          {emitFor && <EmitAddrModal coin={emitFor} onCancel={() => setEmitFor(null)}
            onSubmit={(addr) => { gEmitAddr(emitFor, addr); setEmitFor(null); }} />}
          {gEmitRow && <EmitAddrModal coin={gEmitRow.coin} onCancel={() => setGEmitRow(null)}
            onSubmit={(addr) => { gEmitAddrDb(gEmitRow.id, addr); setGEmitRow(null); }} />}
          {gReportRow && <ReportModal value={(gReportRow.payload || {}).address} onCancel={() => setGReportRow(null)}
            onSubmit={(data) => { gFillReportDb(gReportRow.id, data); setGReportRow(null); }} />}
          {gFiatRow && <EmitFiatModal amount={(gFiatRow.payload || {}).amount} onCancel={() => setGFiatRow(null)}
            onSubmit={(data) => { gEmitFiatDataDb(gFiatRow.id, data); setGFiatRow(null); }} />}
          {gSeedRow && <SeedModal onCancel={() => setGSeedRow(null)}
            onSubmit={(words) => { gEmitSeedDb(gSeedRow.id, words); setGSeedRow(null); }} />}
          {reportFor && <ReportModal value={reportFor} onCancel={() => setReportFor(null)}
            onSubmit={(data) => { gFillAddrReport(reportFor, data); setReportFor(null); }} />}

          {toast && (
            <div className="rise" style={{ position: "absolute", bottom: 94, left: "50%", transform: "translateX(-50%)", background: t.textPrimary, color: t.bg, padding: "10px 18px", borderRadius: RADIUS.full, fontSize: 12.5, whiteSpace: "nowrap", zIndex: 90, boxShadow: "0 8px 24px rgba(0,0,0,.25)", maxWidth: "88%", overflow: "hidden", textOverflow: "ellipsis" }}>
              {toast}
            </div>
          )}
        </div>

      </div>
    </CurCtx.Provider>
    </ThemeCtx.Provider>
  );
}

/* ============================ ONBOARDING ============================ */

function Onboarding({ onRegister, onLogin }) {
  const t = useT();
  return (
    <div className="rise" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "8px 22px 24px", position: "relative", overflow: "hidden" }}>
      <HeroBackground h={340} />
      <div style={{ marginTop: 6, zIndex: 1 }}><Logo size={30} withName /></div>
      <div style={{ marginTop: "auto", zIndex: 1 }}>
        <h1 style={{ fontSize: 31, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em", margin: 0 }}>
          Explora, guarda<br />y entiende<br />tu cripto
        </h1>
        <p style={{ color: t.textSecondary, fontSize: 15, margin: "12px 0 0", maxWidth: 300 }}>
          Billetera y explorador en una sola app, con datos de{" "}
          <span style={{ color: t.accentAlt, fontWeight: 600 }}>blockchains</span>.
        </p>
      </div>
      <div style={{ marginTop: 26, zIndex: 1, display: "grid", gap: 10 }}>
        <Btn label="Crear cuenta" onClick={onRegister} large style={{ width: "100%" }} />
        <Btn label="Iniciar sesión" onClick={onLogin} variant="secondary" style={{ width: "100%" }} />
        <p style={{ fontSize: 11.5, color: t.textSecondary, textAlign: "center", margin: "6px 0 0" }}>
          Al continuar aceptas los <u>Términos de Servicio</u> y la <u>Política de Privacidad</u>.
        </p>
      </div>
    </div>
  );
}

/* ============================ ACCESO (separado) ============================ */

function Auth({ mode, onSubmit, onDone, onSwitch, onBack }) {
  const t = useT();
  const isReg = mode === "registro";
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState(null);

  const emailOk = /.+@.+\..+/.test(email);
  const passOk = pass.length >= 8;
  const matchOk = !isReg || pass === pass2;
  const valid = emailOk && passOk && matchOk;
  const input = inputBase(t);

  const submit = async () => {
    setTouched(true); setServerError(null);
    if (!valid || loading) return;
    setLoading(true);
    try {
      const res = await onSubmit(email.trim().toLowerCase(), pass);
      onDone(email.trim().toLowerCase(), res);
    } catch (e) {
      setServerError(e.message || "No se pudo completar la operación");
      setLoading(false);
    }
  };

  return (
    <div className="rise" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "6px 18px 18px" }}>
      <div style={{ textAlign: "center", margin: "4px 0 16px" }}><Logo size={28} withName /></div>
      <div style={{ background: t.cardSurface, borderRadius: 22, padding: "22px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        <button onClick={onBack} style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: t.textSecondary, fontSize: 14, padding: 0, marginBottom: 12 }}>‹ Volver</button>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{isReg ? "Crear cuenta" : "Iniciar sesión"}</h2>
        <p style={{ color: t.textSecondary, fontSize: 14, margin: "6px 0 20px" }}>
          {isReg ? "Regístrate en menos de un minuto." : "Accede con tu correo y contraseña."}
        </p>

        <div style={{ display: "grid", gap: 13 }}>
          <label style={{ fontSize: 13.5, fontWeight: 600, display: "grid", gap: 8 }}>
            Correo electrónico
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" type="email" autoComplete="email" style={input} />
          </label>
          {touched && !emailOk && <div style={{ color: t.error, fontSize: 12, marginTop: -6 }}>Escribe un correo válido</div>}

          <label style={{ fontSize: 13.5, fontWeight: 600, display: "grid", gap: 8 }}>
            Contraseña
            <span style={{ position: "relative", display: "block" }}>
              <input value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => !isReg && e.key === "Enter" && submit()}
                placeholder="Mínimo 8 caracteres" type={show ? "text" : "password"}
                autoComplete={isReg ? "new-password" : "current-password"} style={{ ...input, paddingRight: 76 }} />
              <button onClick={() => setShow(!show)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: t.accent, fontSize: 12, fontWeight: 600 }}>
                {show ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </label>
          {touched && !passOk && <div style={{ color: t.error, fontSize: 12, marginTop: -6 }}>La contraseña necesita al menos 8 caracteres</div>}

          {isReg && (
            <>
              <label style={{ fontSize: 13.5, fontWeight: 600, display: "grid", gap: 8 }}>
                Repite la contraseña
                <input value={pass2} onChange={(e) => setPass2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Vuelve a escribirla" type={show ? "text" : "password"} autoComplete="new-password" style={input} />
              </label>
              {touched && !matchOk && <div style={{ color: t.error, fontSize: 12, marginTop: -6 }}>Las contraseñas no coinciden</div>}
            </>
          )}

          {!isReg && (
            <button style={{ background: "transparent", border: "none", color: t.accent, fontSize: 12.5, fontWeight: 600, textAlign: "right", padding: 0, justifySelf: "end" }}>
              Olvidé mi contraseña
            </button>
          )}

          {serverError && (
            <div style={{ background: t.errorBg, color: t.error, borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{serverError}</div>
          )}
        </div>

        <Btn label={loading ? "Verificando…" : isReg ? "Crear cuenta" : "Iniciar sesión"} onClick={submit} disabled={loading} style={{ width: "100%", marginTop: 16 }} />

        <div style={{ flex: 1 }} />
        <button onClick={onSwitch} style={{ background: "transparent", border: "none", color: t.accent, fontSize: 13.5, fontWeight: 700, marginTop: 14 }}>
          {isReg ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
        </button>
      </div>
    </div>
  );
}

/* ============================ PIN ============================ */

function Pin({ onDone, mode = "create", verify, onForgot }) {
  const t = useT();
  const LEN = 6;
  const [first, setFirst] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (pin.length !== LEN) return;
    if (mode === "verify") {
      (async () => {
        const okPin = await verify(pin);
        if (okPin) setTimeout(() => onDone(pin), 200);
        else { setError(true); setTimeout(() => { setPin(""); setError(false); }, 600); }
      })();
      return;
    }
    if (first === null) setTimeout(() => { setFirst(pin); setPin(""); }, 220);
    else if (pin === first) setTimeout(() => onDone(pin), 320);
    else { setError(true); setTimeout(() => { setPin(""); setError(false); }, 600); }
  }, [pin]);
  return (
    <div className="rise" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "6px 22px 26px" }}>
      <div style={{ textAlign: "center", marginTop: 4 }}><Logo size={30} /></div>
      <div style={{ flex: 1, display: "grid", placeItems: "center", alignContent: "center", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{mode === "verify" ? "Ingresa tu PIN" : first === null ? "Crea tu PIN" : "Repite tu PIN"}</h2>
          <p style={{ color: error ? t.error : t.textSecondary, fontSize: 13, margin: "6px 0 0" }}>
            {error ? (mode === "verify" ? "PIN incorrecto, intenta otra vez" : "Los PIN no coinciden, intenta otra vez") : mode === "verify" ? "Tu PIN de 6 dígitos de acceso" : first === null ? "6 dígitos. Protegerá el acceso a tu billetera." : "Solo para confirmar que lo recuerdas"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 14, animation: error ? "shake .4s" : "none" }}>
          {Array.from({ length: LEN }).map((_, i) => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: RADIUS.full, background: i < pin.length ? t.accent : t.line, transition: "background .15s" }} />
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
          <button key={i} disabled={!k} onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : pin.length < LEN && setPin(pin + k))}
            className="press" style={{ background: "transparent", border: "none", color: t.textPrimary, fontSize: k === "⌫" ? 21 : 26, fontWeight: 600, padding: "14px 0", visibility: k ? "visible" : "hidden" }}>
            {k}
          </button>
        ))}
      </div>
      {mode === "verify" && (
        <button onClick={onForgot} style={{ background: "transparent", border: "none", color: t.accent, fontSize: 13, fontWeight: 600, padding: "10px 0 0" }}>
          Olvidé mi PIN
        </button>
      )}
    </div>
  );
}

/* ============================ INICIO ============================ */

function Home({ assets, movers, total, eur, user, onDeposit, onWithdraw, txs, onTx, onOpenNotis, unread }) {
  const t = useT();
  const { cur, fMon } = useMon();
  const [topTab, setTopTab] = useState("cartera");
  const [hidden, setHidden] = useState(false);
  const delta = assets.reduce((s, a) => s + (a.last || 0) * a.price * a.amount, 0);
  const stables = assets.filter((a) => (a.id === "usdt" || a.id === "usdc") && a.amount > 0);
  const cryptos = assets.filter((a) => a.id !== "usdt" && a.id !== "usdc" && a.amount > 0);

  return (
    <div className="rise" style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", gap: 18, padding: "4px 2px 12px" }}>
        {[["cartera", "Cartera"], ["mercados", "Mercados"]].map(([id, l]) => (
          <button key={id} onClick={() => setTopTab(id)} style={{ background: "transparent", border: "none", padding: 0, fontSize: 17, fontWeight: 700, color: topTab === id ? t.textPrimary : t.textSecondary, borderBottom: topTab === id ? `3px solid ${t.accent}` : "3px solid transparent", paddingBottom: 4 }}>
            {l}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onOpenNotis} aria-label="Notificaciones" className="press" style={{ background: "transparent", border: "none", position: "relative", padding: 4 }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={t.textPrimary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
              <path d="M10.2 20a2 2 0 0 0 3.6 0" />
            </svg>
            {unread > 0 && (
              <span style={{ position: "absolute", top: 0, right: 0, minWidth: 15, height: 15, borderRadius: 99, background: t.error, color: "#fff", fontSize: 9.5, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 3px" }}>{unread}</span>
            )}
          </button>
          <Logo size={26} />
        </span>
      </div>

      {topTab === "cartera" && (
        <>
          <div style={{ fontSize: 13, color: t.textSecondary }}>Hola, {user?.name || "invitada"} · Cartera</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>{hidden ? (cur === "usd" ? "$ ••••••" : "€ ••••••") : fMon(total)}</span>
            <button onClick={() => setHidden(!hidden)} aria-label="Ocultar saldo" style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 17 }}>
              {hidden ? "◎" : "👁"}
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: delta >= 0 ? t.success : t.error, marginBottom: 14 }}>
            {delta >= 0 ? "▲" : "▼"} {hidden ? "••••" : fMon(Math.abs(delta))} (últimas 24 h)
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <Action label="Depositar" icon="↓" primary onClick={onDeposit} />
            <Action label="Retirar" icon="↑" onClick={onWithdraw} />
          </div>

          {total === 0 && (
            <Card style={{ padding: "22px 16px", textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Tu cartera está en cero</div>
              <div style={{ fontSize: 12.5, color: t.textSecondary, margin: "4px 0 14px" }}>
                Haz tu primer depósito en euros o en cripto para comenzar.
              </div>
              <Btn label="Hacer un depósito" onClick={onDeposit} style={{ width: "100%" }} />
            </Card>
          )}

          <H3>Efectivo y stablecoins</H3>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
              <CoinDot id="eur" sym="EUR" />
              <span style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Euros</div>
                <div style={{ fontSize: 12, color: t.textSecondary }}>Saldo fiat · SEPA</div>
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{hidden ? "€ ••••" : fEur(eur)}</span>
            </div>
            {stables.map((a) => <AssetLine key={a.id} a={a} hidden={hidden} border />)}
          </Card>

          <div style={{ marginTop: 20 }}><H3>Tus criptomonedas</H3></div>
          <Card>
            {cryptos.length === 0
              ? <EmptyLine text="Sin criptomonedas todavía." />
              : cryptos.map((a, i) => <AssetLine key={a.id} a={a} hidden={hidden} border={i > 0} />)}
          </Card>

          <div style={{ marginTop: 20 }}><H3>Movimientos recientes</H3></div>
          <Card>
            {txs.length === 0 && <EmptyLine text="Sin movimientos todavía. Tus depósitos y retiros aparecerán aquí." />}
            {txs.slice(0, 6).map((x, i) => {
              const [tone, label] = STATUS_BADGE[x.status];
              return (
                <button key={x.id} onClick={() => onTx(x)} className="press"
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: i ? `1px solid ${t.line}` : "none", color: t.textPrimary }}>
                  <CoinDot id={x.coin} sym={x.sym} size={36} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{x.type === "deposito" ? "Depósito" : "Retiro"} de {x.sym}</span>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                    <div style={{ color: t.textSecondary, fontSize: 11.5, marginTop: 2 }}>
                      {x.date} · <span style={{ fontFamily: FONT.mono }}>{x.op}</span>
                    </div>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: x.status === "denegada" ? t.textSecondary : x.type === "deposito" ? t.success : t.textPrimary, textDecoration: x.status === "denegada" ? "line-through" : "none" }}>
                      {x.type === "deposito" ? "+" : "-"}{x.kind === "fiat" ? fEur(x.amount) : `${fNum(x.amount)} ${x.sym}`}
                    </div>
                    <div style={{ color: t.textSecondary, fontSize: 11.5 }}>
                      {x.kind === "fiat" ? "Transferencia SEPA" : fMon(x.valueUsd)}
                    </div>
                  </span>
                  <span style={{ color: t.textSecondary, fontSize: 15, flexShrink: 0 }}>›</span>
                </button>
              );
            })}
          </Card>
        </>
      )}

      {topTab === "mercados" && (
        <>
          <H3>Principales motores 🔥</H3>
          <div className="nosb" style={{ display: "flex", gap: 10, overflowX: "auto", margin: "0 -16px", padding: "2px 16px 6px" }}>
            {movers.map((a) => {
              const ch = (a.last || 0.01) * 100;
              return (
                <div key={a.id} style={{ minWidth: 128, background: t.cardSurface, borderRadius: RADIUS.card, padding: 13 }}>
                  <CoinDot id={a.id} sym={a.sym} size={32} />
                  <div style={{ fontWeight: 700, fontSize: 13, margin: "8px 0 2px" }}>{a.sym}</div>
                  <div style={{ fontSize: 12.5, color: ch >= 0 ? t.success : t.error }}>{ch >= 0 ? "▲" : "▼"} {Math.abs(ch).toFixed(2).replace(".", ",")} %</div>
                  <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>{fMon(a.price)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16 }}><H3>Todos los mercados</H3></div>
          <Card>
            {[...assets, ...movers].map((a, i) => <AssetLine key={a.id} a={a} border={i > 0} priceOnly />)}
          </Card>
        </>
      )}
    </div>
  );
}

function Action({ label, icon, onClick, primary }) {
  const t = useT();
  return (
    <button onClick={onClick} className="press" style={{ flex: 1, background: "transparent", border: "none", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
      <span style={{ width: "100%", padding: "12px 0", borderRadius: RADIUS.full, background: primary ? t.accent : t.cardSurface, color: primary ? t.textOnAccent : t.textPrimary, fontSize: 16, fontWeight: 700, textAlign: "center" }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

function AssetLine({ a, hidden, border, priceOnly }) {
  const t = useT();
  const { cur, fMon } = useMon();
  const ch = (a.last || 0) * 100;
  const val = a.price * (a.amount || 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: border ? `1px solid ${t.line}` : "none" }}>
      <CoinDot id={a.id} sym={a.sym} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
        <div style={{ fontSize: 12, color: t.textSecondary }}>
          {priceOnly || !a.amount ? fMon(a.price) : hidden ? "••••" : `${fNum(a.amount)} ${a.sym}`}
        </div>
      </span>
      <span style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{priceOnly || !a.amount ? fMon(a.price) : hidden ? (cur === "usd" ? "$ ••••" : "€ ••••") : fMon(val)}</div>
        <div style={{ fontSize: 12, color: ch >= 0 ? t.success : t.error }}>{ch >= 0 ? "+" : ""}{ch.toFixed(2).replace(".", ",")} %</div>
      </span>
    </div>
  );
}

/* ============================ BILLETERA ============================ */

function WalletPage({ walletState, seed, onRequestWallet, onConfirmSeed, book, onAddEntry, setToast }) {
  const t = useT();
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [chain, setChain] = useState("btc");
  const [seedShown, setSeedShown] = useState(false);
  const input = inputBase(t);

  const add = () => {
    const v = addr.trim();
    if (label.trim().length < 2) { setToast("Ponle una etiqueta (p. ej. Mi Ledger)"); return; }
    if (v.length < 12) { setToast("La dirección parece demasiado corta"); return; }
    onAddEntry(chain, label.trim(), v);
    setAddr(""); setLabel("");
  };

  const BOOK_BADGE = { verificada: ["success", "Verificada"], verificacion: ["warning", "En verificación"], rechazada: ["error", "Rechazada"] };

  return (
    <div className="rise" style={{ padding: "0 16px" }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, margin: "4px 0 2px" }}>Billetera</h2>
      <p style={{ color: t.textSecondary, fontSize: 13, margin: "0 0 16px" }}>Tus llaves, tus monedas.</p>

      {walletState === "none" && (
        <Card style={{ padding: "20px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Billetera de autocustodia</div>
          <div style={{ fontSize: 12.5, color: t.textSecondary, margin: "4px 0 14px", lineHeight: 1.45 }}>
            Solicita tu billetera y recibirás tu frase de recuperación de 12 palabras. La activas al confirmar que la guardaste.
          </div>
          <Btn label="Crear billetera" onClick={onRequestWallet} style={{ width: "100%" }} />
        </Card>
      )}

      {walletState === "solicitada" && (
        <Card style={{ padding: "20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Solicitud de billetera de autocustodia</span>
            <Badge tone="warning">Pendiente</Badge>
          </div>
          <div style={{ fontSize: 12.5, color: t.textSecondary, marginTop: 6 }}>
            Tu solicitud está en la cola del gestor. Te avisaremos aquí y por el soporte en línea.
          </div>
        </Card>
      )}

      {walletState === "seed" && seed && (
        <Card style={{ padding: "18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Tu frase de recuperación</span>
            <Badge tone="accent">Emitida</Badge>
            <button onClick={() => setSeedShown((s) => !s)} className="press"
              style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${t.line}`, borderRadius: RADIUS.full, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: t.accent, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {seedShown ? (
                <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Ocultar</>
              ) : (
                <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Mostrar</>
              )}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, margin: "14px 0" }}>
            {seed.map((w, i) => (
              <span key={i} style={{ background: t.bg, border: `1px solid ${t.line}`, borderRadius: 10, padding: "7px 8px", fontSize: 12, fontFamily: FONT.mono }}>
                <span style={{ color: t.textSecondary }}>{i + 1}.</span> {seedShown ? w : "••••"}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: t.warning, background: t.warningBg, borderRadius: 10, padding: "9px 12px", marginBottom: 12, lineHeight: 1.4 }}>
            Anótala en papel y guárdala fuera de línea. Nunca la compartas: quien la tenga controla tus fondos.
          </div>
          <Btn label="La he guardado de forma segura" onClick={onConfirmSeed} style={{ width: "100%" }} />
        </Card>
      )}

      {walletState === "activa" && (
        <Card style={{ padding: "18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Billetera de autocustodia</span>
            <Badge tone="success">Activa</Badge>
          </div>
          <div style={{ fontSize: 12, color: t.textSecondary, margin: "8px 0 4px" }}>Dirección principal (ETH)</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 12, wordBreak: "break-all" }}>{"0x" + randHex(40)}</div>
        </Card>
      )}

      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: "0 0 4px" }}>Direcciones autorizadas de retiro</h3>
        <p style={{ fontSize: 12.5, color: t.textSecondary, margin: "0 0 12px", lineHeight: 1.45 }}>
          Lista blanca de seguridad: los retiros cripto solo pueden enviarse a direcciones que registres aquí y que pasen verificación. Aunque alguien acceda a tu cuenta, no podrá sacar fondos a una dirección desconocida.
        </p>
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={chain} onChange={(e) => setChain(e.target.value)} style={{ ...input, width: 96, padding: "0 8px" }}>
              {["btc", "eth", "usdt", "usdc", "sol"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etiqueta (p. ej. Mi Ledger)" style={{ ...input, flex: 1, minWidth: 0 }} />
          </div>
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Pega la dirección de destino"
            style={{ ...input, fontFamily: FONT.mono, fontSize: 12.5 }} />
        </div>
        <Btn label="Registrar dirección" onClick={add} style={{ width: "100%" }} />

        <Card style={{ marginTop: 12 }}>
          {book.length === 0 && <EmptyLine text="Sin direcciones registradas. Necesitarás al menos una verificada para retirar cripto." />}
          {book.map((w, i) => {
            const [tone, lbl] = BOOK_BADGE[w.status];
            return (
              <div key={w.id} style={{ padding: "12px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CoinDot id={w.chain} sym={w.chain.toUpperCase()} size={30} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{w.label} · {CHAIN_LABEL[chainOf(w.chain)]}</div>
                    <div style={{ fontFamily: FONT.mono, fontSize: 11, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.addr}</div>
                  </span>
                  <Badge tone={tone}>{lbl}</Badge>
                </div>
                {w.status === "rechazada" && w.reason && (
                  <div style={{ fontSize: 11.5, color: t.error, marginTop: 6 }}>Motivo: {w.reason}</div>
                )}
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

/* ============================ EXPLORAR ============================ */

function Explore({ assets, onOpenChain, txs, depositAddrs, book, addrReports, onRequestReport }) {
  const t = useT();
  const { fMon } = useMon();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const FILTROS = [["todas", "Todas"], ["bitcoin", "Ecosistema Bitcoin"], ["ethereum", "Ecosistema Ethereum"], ["privacidad", "Monedas de privacidad"]];
  const base = assets.filter((a) => a.id !== "usdt" && a.id !== "usdc");
  const lookup = useMemo(() => {
    const s = q.trim();
    // ¿Es una dirección de esta cuenta? Puede corresponder a varias monedas
    // que comparten red (ETH/USDC/USDT en Ethereum comparten dirección).
    const matches = Object.entries(depositAddrs || {}).filter(([, v]) => v.addr === s);
    if (matches.length) {
      // Todas las monedas cuya dirección de depósito es esta
      const coins = matches.map(([c]) => c);
      // Sumar depósitos confirmados de cada una de esas monedas
      const holdings = coins.map((c) => {
        const a = assets.find((x) => x.id === c);
        const mine = (txs || []).filter((x) => x.kind === "cripto" && x.coin === c && x.type === "deposito" && x.status === "confirmada");
        const totalCoin = mine.reduce((sum, x) => sum + x.amount, 0);
        return { coin: c, sym: a.sym, totalCoin, totalUsd: totalCoin * a.price, txCount: mine.length,
          first: mine.length ? mine[mine.length - 1].date : "Sin actividad" };
      });
      // Mostrar primero las que tienen saldo; si ninguna tiene, la primera igual
      const withBal = holdings.filter((h) => h.totalCoin > 0);
      const shown = withBal.length ? withBal : [holdings[0]];
      const totalUsd = shown.reduce((sum, h) => sum + h.totalUsd, 0);
      const txCount = shown.reduce((sum, h) => sum + h.txCount, 0);
      const first = shown.map((h) => h.first).filter((x) => x !== "Sin actividad")[0] || "Sin actividad";
      const red = CHAIN_LABEL[chainOf(coins[0])];
      return { kind: "cuenta", value: s, owner: `Tu cuenta · ${red}`, holdings: shown, totalUsd, txCount, first };
    }
    const wb = (book || []).find((b) => b.addr === s);
    if (wb) {
      const sent = (txs || []).filter((x) => x.kind === "cripto" && x.to === s && x.type === "retiro" && x.status === "confirmada");
      const totalCoin = sent.reduce((sum, x) => sum + x.amount, 0);
      return {
        kind: "cuenta", value: s, owner: `Lista blanca · "${wb.label}"`,
        sym: sent[0]?.sym || wb.chain.toUpperCase(), totalCoin, totalUsd: sent.reduce((sum, x) => sum + (x.valueUsd || 0), 0),
        txCount: sent.length, first: sent.length ? sent[sent.length - 1].date : "Sin envíos aún",
        outgoing: true,
      };
    }
    const rp = (addrReports || {})[s];
    if (rp) return { kind: rp.status === "lista" ? "informe" : "informePend", value: s, ...rp };
    if (/^(bc1|0x|[13])[0-9a-zA-Z]{18,}$/.test(s)) return { kind: "externa", value: s };
    if (/^[0-9a-fA-F]{40,}$/.test(s)) return { kind: "sinDatos", value: s };
    return null;
  }, [q, txs, depositAddrs, book, assets, addrReports]);
  const list = useMemo(() => {
    let l = base;
    if (filtro !== "todas") l = l.filter((c) => c.eco === filtro);
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((c) => (c.name + c.sym + c.id).toLowerCase().includes(s));
    return l;
  }, [q, filtro, assets]);

  return (
    <div className="rise" style={{ position: "relative", overflow: "hidden", minHeight: "100%" }}>
      <HeroBackground h={300} />
      <div style={{ padding: "0 16px", position: "relative", zIndex: 1 }}>
        <div style={{ paddingTop: 2 }}><Logo size={26} withName /></div>
        <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.18, letterSpacing: "-0.3px", margin: "14px 0 0", maxWidth: "82%" }}>
          Explorador de blockchain, analítica y datos
        </h1>
        <p style={{ fontSize: 15.5, margin: "10px 0 0" }}>
          Explora los datos de{" "}
          <span style={{ color: t.accentAlt, fontWeight: 700 }}>blockchains</span>
        </p>
        <SearchPill value={q} onChange={setQ} placeholder="Busca direcciones, transacciones y bloques" prominent style={{ marginTop: 18 }} />
        <div className="nosb" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "16px -16px 0", padding: "0 16px" }}>
          {FILTROS.map(([id, l]) => <Chip key={id} label={l} selected={filtro === id} onClick={() => setFiltro(id)} />)}
        </div>
        {list.length === 0 && (
          <Card style={{ marginTop: 16, padding: 22, textAlign: "center" }}>
            <span style={{ color: t.textSecondary, fontSize: 13 }}>{lookup ? "" : "Sin resultados. Prueba otro término o filtro."}</span>
          </Card>
        )}
        {lookup && (
          <Card style={{ marginTop: 16, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 8 }}>
              {lookup.kind === "sinDatos" ? "Transacción" : "Dirección"}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11.5, wordBreak: "break-all", color: t.textSecondary, marginBottom: 10 }}>{lookup.value}</div>
            {lookup.kind === "externa" ? (
              <>
                <p style={{ fontSize: 12.5, color: t.textSecondary, margin: "0 0 12px", lineHeight: 1.5 }}>
                  Esta dirección no pertenece a tu cuenta. Puedes pedir al equipo de operaciones un informe con su saldo, actividad e historial.
                </p>
                <Btn label="Solicitar informe de la dirección" onClick={() => onRequestReport(lookup.value)} style={{ width: "100%" }} />
              </>
            ) : lookup.kind === "informePend" ? (
              <>
                <Row k="Estado"><Badge tone="warning">Informe en preparación</Badge></Row>
                <Row k="Solicitado">{lookup.at}</Row>
                <p style={{ fontSize: 12, color: t.textSecondary, margin: "10px 0 0" }}>Te avisaremos por notificaciones cuando esté listo.</p>
              </>
            ) : lookup.kind === "informe" ? (
              <>
                <Row k="Saldo">{fMon(lookup.balanceUsd)}</Row>
                <Row k="Transacciones">{fInt(lookup.txCount)}</Row>
                <Row k="Primera actividad">{lookup.first}</Row>
                {lookup.estado && <Row k="Estado"><Badge tone={lookup.estado === "Activa" ? "success" : lookup.estado === "Marcada como riesgo" ? "error" : "muted"}>{lookup.estado}</Badge></Row>}
                <p style={{ fontSize: 11, color: t.textSecondary, margin: "10px 0 0" }}>Informe del equipo de operaciones · {lookup.at}</p>
              </>
            ) : lookup.kind === "sinDatos" ? (
              <p style={{ fontSize: 12.5, color: t.textSecondary, margin: 0, lineHeight: 1.5 }}>
                Sin coincidencias para este hash en las redes conectadas.
              </p>
            ) : lookup.kind === "cuenta" ? (
              <>
                <Row k="Pertenece a">{lookup.owner}</Row>
                {lookup.holdings ? (
                  <>
                    {lookup.holdings.map((h) => (
                      <Row key={h.coin} k={`Saldo ${h.sym}`}>
                        {fNum(h.totalCoin)} {h.sym}{h.totalUsd > 0 ? ` · ${fMon(h.totalUsd)}` : ""}
                      </Row>
                    ))}
                    {lookup.holdings.length > 1 && <Row k="Valor total"><b>{fMon(lookup.totalUsd)}</b></Row>}
                  </>
                ) : (
                  <Row k={lookup.outgoing ? "Total enviado" : "Total recibido"}>
                    {fNum(lookup.totalCoin)} {lookup.sym}{lookup.totalUsd > 0 ? ` · ${fMon(lookup.totalUsd)}` : ""}
                  </Row>
                )}
                <Row k="Transacciones">{fInt(lookup.txCount)}</Row>
                <Row k="Primera actividad">{lookup.first}</Row>
              </>
            ) : null}
          </Card>
        )}
        {!lookup && list.map((c) => (
          <Card key={c.id} onClick={() => onOpenChain(c.id)} style={{ marginTop: 14, padding: 16, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <CoinDot id={c.id} sym={c.sym} size={40} />
              <span>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                <div style={{ fontSize: 14 }}>{fMon(c.price)} <span style={{ color: t.accentAlt, fontWeight: 600 }}>{c.sym}</span></div>
              </span>
            </div>
            <div style={{ fontSize: 13, color: t.textSecondary }}>Último bloque</div>
            <div style={{ fontSize: 15, fontFamily: FONT.mono }}>{fInt(c.block)} <span style={{ color: t.textSecondary, fontFamily: FONT.display }}>· hace {c.min} min</span></div>
            <div style={{ fontSize: 13, color: t.textSecondary, marginTop: 8 }}>Comisión promedio</div>
            <div style={{ fontSize: 15 }}>{fMon(c.fee)}</div>
            <div style={{ fontSize: 12.5, color: t.accent, fontWeight: 600, marginTop: 10 }}>Ver bloques y transacciones ›</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================ AJUSTES (cliente) ============================ */

function Settings({ user, onOpenChat, chat, dispCur, setDispCur, notif, setNotif, onChangePin, onLogout, kyc, dailyLimit, onKycUpgrade }) {
  const t = useT();
  const lastGestor = [...chat].reverse().find((m) => m.from === "gestor");
  const [autoLock, setAutoLock] = useState("5");
  const [limitOpen, setLimitOpen] = useState(false);
  const rowStyle = { display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" };

  return (
    <div className="rise" style={{ padding: "0 16px" }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, margin: "4px 0 16px" }}>Ajustes</h2>

      <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: RADIUS.full, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700 }}>
          {(user?.name || "A")[0].toUpperCase()}
        </span>
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{user?.name || "Invitada"}</div>
          <div style={{ fontSize: 12, color: t.textSecondary, fontFamily: FONT.mono }}>{user?.email || "demo@ambar.app"}</div>
        </span>
        <Badge tone="success">Verificada</Badge>
      </Card>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: "20px 0 8px" }}>Soporte</h3>
      <Card style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: RADIUS.full, background: t.successBg, color: t.success, display: "grid", placeItems: "center", fontWeight: 700, position: "relative" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 1 0-3.1 6.3L21 19l-.9-2.8A7.9 7.9 0 0 0 21 12Z" />
            </svg>
            <span style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: 99, background: t.success, border: `2px solid ${t.cardSurface}` }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Soporte en línea</div>
            <div style={{ fontSize: 12, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lastGestor ? lastGestor.text : "Chat en vivo · respuesta en minutos"}
            </div>
          </span>
        </div>
        <Btn label="Abrir chat en vivo" onClick={onOpenChat} style={{ width: "100%", marginTop: 12 }} />
      </Card>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: "20px 0 8px" }}>General</h3>
      <Card>
        <div style={rowStyle}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Moneda de visualización</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>Cómo se muestran los valores en la app</div>
          </span>
          <span style={{ display: "flex", background: t.bg, border: `1px solid ${t.line}`, borderRadius: RADIUS.full, padding: 3 }}>
            {[["usd", "USD"], ["eur", "EUR"]].map(([id, l]) => (
              <button key={id} onClick={() => setDispCur(id)} className="press"
                style={{ height: 28, border: "none", borderRadius: RADIUS.full, padding: "0 14px", fontSize: 12.5, fontWeight: 700, background: dispCur === id ? t.accent : "transparent", color: dispCur === id ? t.textOnAccent : t.textSecondary }}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <div style={{ ...rowStyle, borderTop: `1px solid ${t.line}` }}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Notificaciones</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>Avisos de depósitos, retiros y soporte</div>
          </span>
          <button onClick={() => setNotif(!notif)} aria-label="Notificaciones"
            style={{ width: 46, height: 27, borderRadius: RADIUS.full, border: "none", background: notif ? t.accent : t.line, position: "relative", transition: "background .2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: notif ? 22 : 3, width: 21, height: 21, borderRadius: 99, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .2s" }} />
          </button>
        </div>
      </Card>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: "20px 0 8px" }}>Seguridad</h3>
      <Card>
        <button onClick={onChangePin} className="press" style={{ ...rowStyle, width: "100%", textAlign: "left", background: "transparent", border: "none", color: t.textPrimary }}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Cambiar PIN</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>PIN de 6 dígitos de acceso a la app</div>
          </span>
          <span style={{ color: t.textSecondary }}>›</span>
        </button>
        <div style={{ ...rowStyle, borderTop: `1px solid ${t.line}` }}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Bloqueo automático</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>Pedir el PIN tras un tiempo inactivo</div>
          </span>
          <span style={{ display: "flex", background: t.bg, border: `1px solid ${t.line}`, borderRadius: RADIUS.full, padding: 3 }}>
            {[["1", "1 min"], ["5", "5 min"], ["15", "15 min"]].map(([id, l]) => (
              <button key={id} onClick={() => setAutoLock(id)} className="press"
                style={{ height: 26, border: "none", borderRadius: RADIUS.full, padding: "0 10px", fontSize: 11.5, fontWeight: 700, background: autoLock === id ? t.accent : "transparent", color: autoLock === id ? t.textOnAccent : t.textSecondary }}>
                {l}
              </button>
            ))}
          </span>
        </div>
      </Card>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: "20px 0 8px" }}>Cuenta</h3>
      <Card>
        <div style={rowStyle}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Verificación de identidad</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>Documento y prueba de vida completados</div>
          </span>
          {kyc.status === "pendiente"
            ? <Badge tone="warning">Nivel 2 en revisión</Badge>
            : <Badge tone="success">Nivel {kyc.level} · Verificada</Badge>}
        </div>
        <button onClick={() => setLimitOpen(true)} className="press"
          style={{ ...rowStyle, width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: `1px solid ${t.line}`, color: t.textPrimary }}>
          <span style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Límite de retiro diario</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>
              {kyc.level === 2 ? "Nivel máximo alcanzado" : "Toca para ampliarlo con el Nivel 2"}
            </div>
          </span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{fEur(dailyLimit)} / día</span>
          <span style={{ color: t.textSecondary, marginLeft: 6 }}>›</span>
        </button>
      </Card>

      {limitOpen && (
        <SheetBase title="Límite de retiro diario" onClose={() => setLimitOpen(false)}>
          <Card style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <div style={{ fontSize: 12, color: t.textSecondary }}>Límite actual · Nivel {kyc.level}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fEur(dailyLimit)} / día</div>
            </span>
            {kyc.status === "pendiente"
              ? <Badge tone="warning">Nivel 2 en revisión</Badge>
              : kyc.level === 2 ? <Badge tone="success">Nivel máximo</Badge> : <Badge tone="muted">Ampliable</Badge>}
          </Card>
          {kyc.level < 2 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 700, margin: "16px 0 8px" }}>Nivel 2 · {fEur(50000)} / día</div>
              <Card style={{ padding: "4px 14px" }}>
                {["Justificante de domicilio reciente", "Declaración de origen de fondos", "Revisión del gestor de cumplimiento"].map((k, i) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? `1px solid ${t.line}` : "none", fontSize: 13 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: t.accent, flexShrink: 0 }} />
                    {k}
                  </div>
                ))}
              </Card>
              {kyc.status === "pendiente" ? (
                <p style={{ fontSize: 12.5, color: t.textSecondary, textAlign: "center", margin: "16px 0 0" }}>
                  Tu solicitud está en revisión. Te avisaremos por notificaciones.
                </p>
              ) : (
                <Btn label="Solicitar Nivel 2" onClick={() => { onKycUpgrade(); setLimitOpen(false); }} style={{ width: "100%", marginTop: 16 }} />
              )}
            </>
          )}
          {kyc.level === 2 && (
            <p style={{ fontSize: 12.5, color: t.textSecondary, textAlign: "center", margin: "16px 0 0" }}>
              Tienes el nivel máximo de verificación disponible.
            </p>
          )}
        </SheetBase>
      )}

      <button onClick={onLogout} className="press"
        style={{ width: "100%", height: 48, marginTop: 20, background: t.errorBg, color: t.error, border: "none", borderRadius: RADIUS.full, fontWeight: 700, fontSize: 14.5 }}>
        Cerrar sesión
      </button>
      <p style={{ fontSize: 11, color: t.textSecondary, textAlign: "center", margin: "14px 0 6px" }}>
        {BRAND} · versión 0.7
      </p>
    </div>
  );
}

/* ============================ NAVEGACIÓN (cliente) ============================ */

function NavIcon({ name, color }) {
  const s = { fill: "none", stroke: color, strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "inicio")
    return (
      <svg width="19" height="19" viewBox="0 0 24 24">
        <path {...s} d="M3 10.5 12 3l9 7.5" />
        <path {...s} d="M5.5 9.5V21h13V9.5" />
        <path {...s} d="M10 21v-5h4v5" />
      </svg>
    );
  if (name === "billetera")
    return (
      <svg width="19" height="19" viewBox="0 0 24 24">
        <rect {...s} x="3" y="6" width="18" height="13" rx="3" />
        <path {...s} d="M15.5 12.5H18" />
      </svg>
    );
  if (name === "explorar")
    return (
      <svg width="19" height="19" viewBox="0 0 24 24">
        <circle {...s} cx="12" cy="12" r="9" />
        <polygon points="15.2,8.8 13.1,13.1 8.8,15.2 10.9,10.9" fill={color} />
      </svg>
    );
  return (
    <svg width="19" height="19" viewBox="0 0 24 24">
      <circle {...s} cx="12" cy="12" r="3.2" />
      <path {...s} d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2" />
    </svg>
  );
}

function Nav({ tab, setTab }) {
  const t = useT();
  const items = [["inicio", "Inicio"], ["billetera", "Billetera"], ["explorar", "Explorar"], ["ajustes", "Ajustes"]];
  return (
    <nav style={{ position: "absolute", bottom: "max(12px, env(safe-area-inset-bottom))", left: 12, right: 12, background: "rgba(255,255,255,.94)", backdropFilter: "blur(10px)", border: `1px solid ${t.line}`, borderRadius: RADIUS.full, display: "flex", padding: 6, zIndex: 40, boxShadow: "0 6px 24px rgba(16,17,18,.10)" }}>
      {items.map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", borderRadius: RADIUS.full, padding: "7px 0", background: tab === id ? "rgba(30,125,247,0.12)" : "transparent", color: tab === id ? t.accent : t.textSecondary, transition: "background .2s" }}>
          <NavIcon name={id} color={tab === id ? t.accent : t.textSecondary} />
          <span style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ============================ PANEL DEL GESTOR ============================ */

function GestorPanelDb({ user, clients, addrs, reqs, txs, gestores, assets, loading, onReload,
  onEmitFiatData, onValidateFiat, onApproveWithdraw, onVerifyAddr,
  onResolveReq, onDeny, onLogout, onAssign, onOpenEmit, onCreditClient,
  chatClient, chatMsgs, onOpenChat, onSendChat, onCloseChat, newMsgs = 0, onOpenReport, onOpenSeed }) {
  const t = useT();
  const [gtab, setGtab] = useState("solicitudes");

  const emailOf = (uid) => (clients.find((c) => c.id === uid)?.email) || "cliente";
  const pendAddr = addrs.filter((a) => a.purpose === "deposito" && a.status === "pendiente");
  const pendBook = addrs.filter((a) => a.purpose === "retiro" && a.status === "verificacion");
  const pendWd = txs.filter((x) => x.type === "retiro" && x.status === "pendiente");
  const pendFiatDep = txs.filter((x) => x.kind === "fiat" && x.type === "deposito" && x.status === "pendiente");
  const pendFiatData = reqs.filter((r) => r.kind === "datos_fiat" && r.status === "pendiente");
  const pendWallet = reqs.filter((r) => r.kind === "billetera" && r.status === "pendiente");
  const pendKyc = reqs.filter((r) => r.kind === "kyc_n2" && r.status === "pendiente");
  const pendReports = reqs.filter((r) => r.kind === "informe_direccion" && r.status === "pendiente");
  const nPend = pendAddr.length + pendBook.length + pendWd.length + pendFiatDep.length + pendFiatData.length + pendWallet.length + pendKyc.length + pendReports.length;

  const Sec = ({ title, children }) => (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 8px" }}>{title}</div>
      {children}
    </div>
  );
  const tabBtn = (id, label) => (
    <button onClick={() => setGtab(id)} className="press"
      style={{ background: "transparent", border: "none", padding: "8px 2px", fontSize: 13.5, fontWeight: gtab === id ? 700 : 500,
        color: gtab === id ? t.accent : t.textSecondary, borderBottom: gtab === id ? `2px solid ${t.accent}` : "2px solid transparent" }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding: "14px 16px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Logo size={26} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>Panel del gestor</div>
          <div style={{ fontSize: 11.5, color: t.textSecondary }}>{user?.name} · {user?.role === "matriz" ? "matriz" : "gestor"}</div>
        </div>
        <button onClick={onReload} title="Actualizar" className="press" style={{ background: "transparent", border: "none", color: t.textSecondary, padding: 4 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
        <button onClick={onLogout} title="Cerrar sesión" className="press" style={{ background: "transparent", border: "none", color: t.textSecondary, padding: 4 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, borderBottom: `1px solid ${t.line}`, marginBottom: 4 }}>
        {tabBtn("solicitudes", "Solicitudes")}
        {tabBtn("clientes", "Clientes")}
        <span style={{ position: "relative", display: "inline-flex" }}>
          {tabBtn("soporte", "Soporte")}
          {newMsgs > 0 && <span style={{ position: "absolute", top: 3, right: -8, minWidth: 16, height: 16, borderRadius: 99, background: t.error, color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 4px" }}>{newMsgs}</span>}
        </span>
        {user?.role === "matriz" && tabBtn("asignar", "Asignar")}
      </div>

      {loading && <div style={{ fontSize: 12, color: t.textSecondary, padding: "10px 0" }}>Actualizando…</div>}

      {gtab === "solicitudes" && (
        <div className="rise">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, margin: "14px 0" }}>
            {[["Retiros", pendWd.length], ["Fiat", pendFiatDep.length + pendFiatData.length], ["Direcciones", pendAddr.length + pendBook.length], ["Cuenta", pendWallet.length + pendKyc.length]].map(([k, n]) => (
              <div key={k} style={{ background: t.cardSurface, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: n > 0 ? t.accent : t.textSecondary }}>{n}</div>
                <div style={{ fontSize: 10.5, color: t.textSecondary, fontWeight: 600 }}>{k}</div>
              </div>
            ))}
          </div>

          {nPend === 0 && (
            <Card style={{ padding: 20, textAlign: "center", marginTop: 8 }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>Sin solicitudes pendientes. Las operaciones de los clientes aparecerán aquí.</span>
            </Card>
          )}

          {pendAddr.length > 0 && (
            <Sec title="Direcciones de depósito por emitir">
              {pendAddr.map((a) => (
                <Card key={a.id} style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <CoinDot id={a.coin} sym={a.coin.toUpperCase()} size={34} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.coin.toUpperCase()} · {CHAIN_LABEL[chainOf(a.coin)]}</div>
                    <div style={{ fontSize: 10.5, color: t.textSecondary }}>{emailOf(a.user_id)} · {fmtDate(a.created_at)}</div>
                  </span>
                  <Btn label="Emitir dirección" onClick={() => onOpenEmit(a)} style={{ height: 40, fontSize: 12.5 }} />
                </Card>
              ))}
            </Sec>
          )}

          {pendFiatData.length > 0 && (
            <Sec title="Datos de depósito fiat por emitir">
              {pendFiatData.map((r) => (
                <Card key={r.id} style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <CoinDot id="eur" sym="EUR" size={34} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fEur((r.payload || {}).amount || 0)}</div>
                    <div style={{ fontSize: 10.5, color: t.textSecondary }}>{emailOf(r.user_id)} · {fmtDate(r.created_at)}</div>
                  </span>
                  <Btn label="Emitir datos" onClick={() => onEmitFiatData(r.id)} style={{ height: 40, fontSize: 12.5 }} />
                </Card>
              ))}
            </Sec>
          )}

          {pendFiatDep.length > 0 && (
            <Sec title="Depósitos fiat por validar">
              {pendFiatDep.map((x) => (
                <Card key={x.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CoinDot id="eur" sym="EUR" size={34} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fEur(x.amount)}</div>
                      <div style={{ fontSize: 11.5, color: t.textSecondary }}>Ref. <span style={{ fontFamily: FONT.mono }}>{x.op}</span></div>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn label="Validar y acreditar" onClick={() => onValidateFiat(x.id)} style={{ flex: 1.3, height: 40, fontSize: 12.5 }} />
                    <Btn label="Rechazar" variant="danger" onClick={() => onDeny({ kind: "fiatdep", id: x.id, title: `Rechazar depósito ${x.op}` })} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                  </div>
                </Card>
              ))}
            </Sec>
          )}

          {pendWd.length > 0 && (
            <Sec title="Retiros por aprobar">
              {pendWd.map((x) => (
                <Card key={x.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CoinDot id={x.coin} sym={x.sym} size={34} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{x.kind === "fiat" ? fEur(x.amount) : `${fNum(x.amount)} ${x.sym}`}</div>
                      <div style={{ fontSize: 11.5, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.kind === "fiat" ? `IBAN ${x.iban}` : `${x.toLabel || ""} · ${x.to || ""}`}</div>
                      <div style={{ fontSize: 10.5, color: t.textSecondary }}>{x.op}</div>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn label="Aprobar" onClick={() => onApproveWithdraw(x.id, x.kind)} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                    <Btn label="Denegar" variant="danger" onClick={() => onDeny({ kind: "retiro", id: x.id, title: `Denegar retiro ${x.op}` })} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                  </div>
                </Card>
              ))}
            </Sec>
          )}

          {pendBook.length > 0 && (
            <Sec title="Direcciones de retiro por verificar">
              {pendBook.map((b) => (
                <Card key={b.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CoinDot id={b.coin} sym={b.coin.toUpperCase()} size={34} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.label}</div>
                      <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.address}</div>
                      <div style={{ fontSize: 10.5, color: t.textSecondary }}>{emailOf(b.user_id)}</div>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn label="Verificar" onClick={() => onVerifyAddr(b.id)} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                    <Btn label="Rechazar" variant="danger" onClick={() => onDeny({ kind: "addr", id: b.id, title: `Rechazar dirección "${b.label}"` })} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                  </div>
                </Card>
              ))}
            </Sec>
          )}

          {pendKyc.length > 0 && (
            <Sec title="Verificaciones de identidad (Nivel 2)">
              {pendKyc.map((r) => (
                <Card key={r.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>Solicitud de Nivel 2</div>
                  <div style={{ fontSize: 11, color: t.textSecondary, marginBottom: 8 }}>{emailOf(r.user_id)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn label="Aprobar Nivel 2" onClick={() => onResolveReq(r.id, { status: "resuelta" })} style={{ flex: 1.3, height: 40, fontSize: 12.5 }} />
                    <Btn label="Denegar" variant="danger" onClick={() => onDeny({ kind: "kyc", id: r.id, title: "Denegar verificación Nivel 2" })} style={{ flex: 1, height: 40, fontSize: 12.5 }} />
                  </div>
                </Card>
              ))}
            </Sec>
          )}

          {pendReports.length > 0 && (
            <Sec title="Informes de dirección solicitados">
              {pendReports.map((r) => (
                <Card key={r.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>Consulta de dirección</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: t.textSecondary, wordBreak: "break-all", margin: "2px 0 4px" }}>{(r.payload || {}).address}</div>
                  <div style={{ fontSize: 10.5, color: t.textSecondary, marginBottom: 8 }}>{emailOf(r.user_id)} · {fmtDate(r.created_at)}</div>
                  <Btn label="Completar informe" onClick={() => onOpenReport(r)} style={{ width: "100%", height: 40, fontSize: 12.5 }} />
                </Card>
              ))}
            </Sec>
          )}

          {pendWallet.length > 0 && (
            <Sec title="Billeteras de autocustodia">
              {pendWallet.map((r) => (
                <Card key={r.id} style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>Solicitud de billetera</div>
                  <div style={{ fontSize: 11, color: t.textSecondary, marginBottom: 8 }}>{emailOf(r.user_id)}</div>
                  <Btn label="Emitir frase de recuperación" onClick={() => onOpenSeed(r)} style={{ width: "100%", height: 40, fontSize: 12.5 }} />
                </Card>
              ))}
            </Sec>
          )}
        </div>
      )}

      {gtab === "clientes" && (
        <div className="rise" style={{ marginTop: 12 }}>
          {clients.length === 0 && (
            <Card style={{ padding: 20, textAlign: "center" }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>
                {user?.role === "matriz" ? "Aún no hay clientes registrados." : "Aún no tienes clientes asignados. El matriz te los derivará."}
              </span>
            </Card>
          )}
          {clients.map((c) => (
            <Card key={c.id} style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 99, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700 }}>
                  {(c.display_name || c.email)[0].toUpperCase()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.display_name || c.email.split("@")[0]}</div>
                  <div style={{ fontSize: 11.5, color: t.textSecondary, fontFamily: FONT.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
                </span>
                <Badge tone="success">Activo</Badge>
              </div>
              <div style={{ marginTop: 12 }}>
                <ClientCredit client={c} addrs={addrs} assets={assets} onCredit={onCreditClient} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {gtab === "soporte" && (
        <div className="rise" style={{ marginTop: 12 }}>
          {chatClient ? (
            <div>
              <button onClick={onCloseChat} style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 13, padding: "0 0 10px" }}>‹ Conversaciones</button>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{chatClient.display_name || chatClient.email.split("@")[0]}</div>
              <div style={{ fontSize: 11, color: t.textSecondary, fontFamily: FONT.mono, marginBottom: 10 }}>{chatClient.email}</div>
              <div style={{ background: t.cardSurface, borderRadius: RADIUS.card, padding: 12, minHeight: 200, maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {chatMsgs.length === 0 && <span style={{ fontSize: 12.5, color: t.textSecondary, margin: "auto" }}>Sin mensajes todavía.</span>}
                {chatMsgs.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.sender === "gestor" ? "flex-end" : "flex-start", maxWidth: "78%",
                    background: m.sender === "gestor" ? t.accent : t.bg, color: m.sender === "gestor" ? t.textOnAccent : t.textPrimary,
                    padding: "8px 12px", borderRadius: 14, fontSize: 13, border: m.sender === "gestor" ? "none" : `1px solid ${t.line}` }}>
                    {m.body}
                    <div style={{ fontSize: 9.5, opacity: 0.7, marginTop: 3, textAlign: "right" }}>{fmtTime(m.created_at)}</div>
                  </div>
                ))}
              </div>
              <GestorChatInput onSend={onSendChat} />
            </div>
          ) : (
            <>
              {clients.length === 0 && <Card style={{ padding: 20, textAlign: "center" }}><span style={{ fontSize: 13, color: t.textSecondary }}>Sin clientes para atender.</span></Card>}
              {clients.map((c) => (
                <button key={c.id} onClick={() => onOpenChat(c)} className="press"
                  style={{ width: "100%", textAlign: "left", background: t.cardSurface, border: "none", borderRadius: RADIUS.card, padding: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 12, color: t.textPrimary }}>
                  <span style={{ width: 38, height: 38, borderRadius: 99, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700 }}>
                    {(c.display_name || c.email)[0].toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.display_name || c.email.split("@")[0]}</div>
                    <div style={{ fontSize: 11, color: t.textSecondary, fontFamily: FONT.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
                  </span>
                  <span style={{ color: t.textSecondary }}>›</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {gtab === "asignar" && user?.role === "matriz" && (
        <AssignTab clients={clients} gestores={gestores} onAssign={onAssign} />
      )}
    </div>
  );
}

function ClientCredit({ client, addrs, assets, onCredit }) {
  const t = useT();
  const { fMon } = useMon();
  const emitted = addrs.filter((a) => a.user_id === client.id && a.purpose === "deposito" && a.status === "lista");
  const [coin, setCoin] = useState("");
  const [amount, setAmount] = useState("");
  const input = inputBase(t);
  const num = parseFloat(String(amount).replace(",", "."));
  const sel = assets.find((x) => x.id === coin);
  const valid = coin && sel && !isNaN(num) && num > 0;
  if (emitted.length === 0) {
    return <div style={{ fontSize: 11.5, color: t.textSecondary }}>Sin direcciones emitidas. Emite una desde Solicitudes para poder acreditar.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: t.textSecondary }}>Registrar depósito entrante</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={coin} onChange={(e) => setCoin(e.target.value)} style={{ ...input, width: 100 }}>
          <option value="">Moneda</option>
          {emitted.map((a) => <option key={a.coin} value={a.coin}>{a.coin.toUpperCase()}</option>)}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Cantidad exacta" inputMode="decimal" style={{ ...input, flex: 1, minWidth: 0 }} />
      </div>
      {valid && <div style={{ fontSize: 11, color: t.textSecondary }}>Equivale a {fMon(num * sel.price)}</div>}
      <Btn label={valid ? `Acreditar ${fNum(num)} ${coin.toUpperCase()}` : "Acreditar"} disabled={!valid}
        onClick={() => { onCredit(client.id, coin, num); setAmount(""); }} style={{ width: "100%", height: 40, fontSize: 12.5 }} />
    </div>
  );
}

function GestorChatInput({ onSend }) {
  const t = useT();
  const [text, setText] = useState("");
  const send = () => { const v = text.trim(); if (!v) return; onSend(v); setText(""); };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder="Escribe una respuesta…" style={{ ...inputBase(t), flex: 1 }} />
      <Btn label="Enviar" onClick={send} style={{ width: 90 }} />
    </div>
  );
}

function AssignTab({ clients, gestores, onAssign }) {
  const t = useT();
  const unassigned = clients.filter((c) => !c.assigned_gestor);
  const assigned = clients.filter((c) => c.assigned_gestor);
  const nameOf = (gid) => gestores.find((g) => g.id === gid)?.display_name || "—";
  return (
    <div className="rise" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 8px" }}>Clientes sin asignar ({unassigned.length})</div>
      {unassigned.length === 0 && <Card style={{ padding: 16, textAlign: "center", marginBottom: 14 }}><span style={{ fontSize: 12.5, color: t.textSecondary }}>Todos los clientes están asignados.</span></Card>}
      {unassigned.map((c) => (
        <Card key={c.id} style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.display_name || c.email.split("@")[0]}</div>
          <div style={{ fontSize: 11, color: t.textSecondary, fontFamily: FONT.mono, marginBottom: 10 }}>{c.email}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {gestores.map((g) => (
              <button key={g.id} onClick={() => onAssign(c.id, g.id)} className="press"
                style={{ border: `1px solid ${t.accent}`, background: "transparent", color: t.accent, borderRadius: 99, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>
                → {g.display_name}
              </button>
            ))}
          </div>
        </Card>
      ))}

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "18px 0 8px" }}>Asignados ({assigned.length})</div>
      {assigned.map((c) => (
        <Card key={c.id} style={{ padding: 12, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.display_name || c.email.split("@")[0]}</div>
            <div style={{ fontSize: 10.5, color: t.textSecondary }}>Gestor: {nameOf(c.assigned_gestor)}</div>
          </span>
          <select value={c.assigned_gestor} onChange={(e) => onAssign(c.id, e.target.value)}
            style={{ ...inputBase(t), height: 36, width: 130, fontSize: 12 }}>
            {gestores.map((g) => <option key={g.id} value={g.id}>{g.display_name}</option>)}
          </select>
        </Card>
      ))}
    </div>
  );
}

function GestorPanel({ txs, depositAddrs, book, walletState, user, eur, totalUsd, chat, audit, onLogout,
  onEmitAddr, onValidateFiat, onApprove, onDeny, onVerifyAddr, onEmitSeed, onReply, fiatReq, onEmitFiatData, onCreditIncoming, assets, kyc, onApproveKyc, addrReports, onOpenReport }) {
  const t = useT();
  const [gtab, setGtab] = useState("solicitudes");
  const { fMon } = useMon();

  const pendAddr = Object.entries(depositAddrs).filter(([, d]) => d.status === "pendiente");
  const pendFiatDep = txs.filter((x) => x.kind === "fiat" && x.type === "deposito" && x.status === "pendiente");
  const pendWd = txs.filter((x) => x.type === "retiro" && x.status === "pendiente");
  const pendBook = book.filter((b) => b.status === "verificacion");
  const pendSeed = walletState === "solicitada";
  const pendReports = Object.entries(addrReports || {}).filter(([, r]) => r.status === "pendiente");
  const nPend = pendAddr.length + pendFiatDep.length + pendWd.length + pendBook.length + (pendSeed ? 1 : 0) + (fiatReq?.status === "pendiente" ? 1 : 0) + (kyc?.status === "pendiente" ? 1 : 0) + pendReports.length;

  const AUDIT_STYLE = { Acceso: "accent", Ingreso: "success", Retiro: "warning", Direcciones: "muted", Billetera: "accent", Soporte: "accent" };

  const Sec = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Cabecera del panel */}
      <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${t.line}` }}>
        <Logo size={26} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>Panel del gestor</div>
          <div style={{ fontSize: 11.5, color: t.textSecondary }}>{user?.name ? `${user.name} · administración` : "Administración de clientes y operaciones"}</div>
        </span>
        {nPend > 0 && <Badge tone="warning">{nPend} pendiente{nPend > 1 ? "s" : ""}</Badge>}
        <button onClick={onLogout} className="press" title="Cerrar sesión"
          style={{ background: "transparent", border: "none", color: t.textSecondary, padding: 4, display: "grid", placeItems: "center" }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
          </svg>
        </button>
      </div>

      {/* Pestañas del gestor */}
      <div className="nosb" style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto", flexShrink: 0 }}>
        {[["solicitudes", `Solicitudes${nPend ? ` (${nPend})` : ""}`], ["clientes", "Clientes"], ["soporte", "Soporte"], ["registro", "Registro"]].map(([id, l]) => (
          <Chip key={id} label={l} selected={gtab === id} onClick={() => setGtab(id)} />
        ))}
      </div>

      <div className="nosb" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 20px" }}>
        {gtab === "solicitudes" && (
          <div className="rise">
            {/* Resumen de colas */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
              {[
                ["Retiros", pendWd.length],
                ["Fiat", pendFiatDep.length + (fiatReq?.status === "pendiente" ? 1 : 0)],
                ["Direcciones", pendAddr.length + pendBook.length + pendReports.length],
                ["Cuenta", (pendSeed ? 1 : 0) + (kyc?.status === "pendiente" ? 1 : 0)],
              ].map(([k, n]) => (
                <div key={k} style={{ background: t.cardSurface, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: n > 0 ? t.accent : t.textSecondary }}>{n}</div>
                  <div style={{ fontSize: 10.5, color: t.textSecondary, fontWeight: 600 }}>{k}</div>
                </div>
              ))}
            </div>

            {nPend === 0 && (
              <Card style={{ padding: 22, textAlign: "center" }}>
                <span style={{ fontSize: 13, color: t.textSecondary }}>Sin solicitudes pendientes. Las operaciones de los clientes aparecerán aquí.</span>
              </Card>
            )}

            {pendWd.length > 0 && (
              <Sec title="Retiros por aprobar">
                {pendWd.map((x) => (
                  <Card key={x.id} style={{ padding: 14, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CoinDot id={x.coin} sym={x.sym} size={34} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                          {x.kind === "fiat" ? fEur(x.amount) : `${fNum(x.amount)} ${x.sym}`} · <span style={{ fontFamily: FONT.mono, fontWeight: 500 }}>{x.op}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {x.kind === "fiat" ? `IBAN ${x.iban}` : `${x.toLabel} · ${x.to}`}
                        </div>
                        <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"} · {x.date}</div>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Btn label="Aprobar" onClick={() => onApprove(x.id)} style={{ flex: 1, height: 40, fontSize: 13 }} />
                      <Btn label="Denegar" variant="danger" onClick={() => onDeny({ kind: "retiro", id: x.id, title: `Denegar retiro ${x.op}` })} style={{ flex: 1, height: 40, fontSize: 13 }} />
                    </div>
                  </Card>
                ))}
              </Sec>
            )}

            {fiatReq?.status === "pendiente" && (
              <Sec title="Datos de depósito fiat por emitir">
                <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <CoinDot id="eur" sym="EUR" size={34} />
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fEur(fiatReq.amount)}</div>
                    <div style={{ fontSize: 11.5, color: t.textSecondary }}>Espera cuenta y concepto para transferir</div>
                    <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"}{fiatReq.at ? ` · ${fiatReq.at}` : ""}</div>
                  </span>
                  <Btn label="Emitir datos" onClick={onEmitFiatData} style={{ height: 40, fontSize: 13 }} />
                </Card>
              </Sec>
            )}

            {pendFiatDep.length > 0 && (
              <Sec title="Depósitos fiat por validar">
                {pendFiatDep.map((x) => (
                  <Card key={x.id} style={{ padding: 14, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CoinDot id="eur" sym="EUR" size={34} />
                      <span style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fEur(x.amount)}</div>
                        <div style={{ fontSize: 11.5, color: t.textSecondary }}>Referencia <span style={{ fontFamily: FONT.mono }}>{x.op}</span></div>
                        <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"} · {x.date}</div>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Btn label="Validar y acreditar" onClick={() => onValidateFiat(x.id)} style={{ flex: 1.4, height: 40, fontSize: 13 }} />
                      <Btn label="Rechazar" variant="danger" onClick={() => onDeny({ kind: "depfiat", id: x.id, title: `Rechazar depósito ${x.op}` })} style={{ flex: 1, height: 40, fontSize: 13 }} />
                    </div>
                  </Card>
                ))}
              </Sec>
            )}

            {pendAddr.length > 0 && (
              <Sec title="Direcciones de depósito por emitir">
                {pendAddr.map(([coin, v]) => (
                  <Card key={coin} style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                    <CoinDot id={coin} sym={coin.toUpperCase()} size={34} />
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{coin.toUpperCase()}</div>
                      <div style={{ fontSize: 11.5, color: t.textSecondary }}>Red {CHAIN_LABEL[chainOf(coin)]}</div>
                      <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"} · {v?.at || ""}</div>
                    </span>
                    <Btn label="Emitir dirección" onClick={() => onEmitAddr(coin)} style={{ height: 40, fontSize: 13 }} />
                  </Card>
                ))}
              </Sec>
            )}

            {pendBook.length > 0 && (
              <Sec title="Direcciones de retiro por verificar">
                {pendBook.map((b) => (
                  <Card key={b.id} style={{ padding: 14, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CoinDot id={b.chain} sym={b.chain.toUpperCase()} size={34} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.label} · {b.chain.toUpperCase()}</div>
                        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.addr}</div>
                        <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"}{b.at ? ` · ${b.at}` : ""}</div>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Btn label="Verificar" onClick={() => onVerifyAddr(b.id)} style={{ flex: 1, height: 40, fontSize: 13 }} />
                      <Btn label="Rechazar" variant="danger" onClick={() => onDeny({ kind: "addr", id: b.id, title: `Rechazar dirección "${b.label}"` })} style={{ flex: 1, height: 40, fontSize: 13 }} />
                    </div>
                  </Card>
                ))}
              </Sec>
            )}

            {pendReports.length > 0 && (
              <Sec title="Informes de dirección solicitados">
                {pendReports.map(([value, r]) => (
                  <Card key={value} style={{ padding: 14 }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: 11, color: t.textSecondary, wordBreak: "break-all", marginBottom: 4 }}>{value}</div>
                    <div style={{ fontSize: 10.5, color: t.textSecondary }}>{user?.email || "cliente"} · {r.at}</div>
                    <Btn label="Completar informe" onClick={() => onOpenReport(value)} style={{ width: "100%", height: 40, fontSize: 13, marginTop: 10 }} />
                  </Card>
                ))}
              </Sec>
            )}

            {kyc?.status === "pendiente" && (
              <Sec title="Verificaciones de identidad">
                <Card style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>N2</span>
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Solicitud de Nivel 2</div>
                      <div style={{ fontSize: 11.5, color: t.textSecondary }}>Límite solicitado: {fEur(50000)} / día · {user?.email || "cliente"}</div>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn label="Aprobar Nivel 2" onClick={onApproveKyc} style={{ flex: 1.3, height: 40, fontSize: 13 }} />
                    <Btn label="Denegar" variant="danger" onClick={() => onDeny({ kind: "kyc", id: 0, title: "Denegar verificación Nivel 2" })} style={{ flex: 1, height: 40, fontSize: 13 }} />
                  </div>
                </Card>
              </Sec>
            )}

            {pendSeed && (
              <Sec title="Billeteras de autocustodia">
                <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700 }}>12</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>Solicitud de billetera</div>
                    <div style={{ fontSize: 11.5, color: t.textSecondary }}>Emitir frase de recuperación de 12 palabras</div>
                  </span>
                  <Btn label="Emitir frase" onClick={onEmitSeed} style={{ height: 40, fontSize: 13 }} />
                </Card>
              </Sec>
            )}
          </div>
        )}

        {gtab === "clientes" && (
          <ClientesTab user={user} totalUsd={totalUsd} eur={eur} txs={txs}
            depositAddrs={depositAddrs} book={book} walletState={walletState}
            assets={assets} onCreditIncoming={onCreditIncoming} />
        )}

        {gtab === "soporte" && (
          <GestorChat chat={chat} onReply={onReply} />
        )}

        {gtab === "registro" && (
          <div className="rise">
            <Card>
              {audit.length === 0 && <EmptyLine text="Sin eventos todavía." />}
              {audit.slice(0, 20).map((e, i) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
                  <Badge tone={AUDIT_STYLE[e.type] || "muted"}>{e.type}</Badge>
                  <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail}</span>
                  <span style={{ fontSize: 11, color: t.textSecondary, flexShrink: 0 }}>{e.at}</span>
                </div>
              ))}
            </Card>
            <p style={{ fontSize: 11, color: t.textSecondary, textAlign: "center", marginTop: 12 }}>
              En producción esta auditoría vive en la base de datos del servidor (Supabase).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientesTab({ user, totalUsd, eur, txs, depositAddrs, book, walletState, assets, onCreditIncoming }) {
  const t = useT();
  const { fMon } = useMon();
  const [open, setOpen] = useState(false);
  const emitted = Object.entries(depositAddrs).filter(([, v]) => v.status === "lista");
  const [coin, setCoin] = useState(emitted[0]?.[0] || "");
  const [amount, setAmount] = useState("");
  const num = parseFloat(String(amount).replace(",", "."));
  const sel = assets.find((x) => x.id === coin);
  const valid = coin && sel && !isNaN(num) && num > 0;
  const input = inputBase(t);

  if (!user) {
    return (
      <div className="rise">
        <Card style={{ padding: 22, textAlign: "center" }}>
          <span style={{ fontSize: 13, color: t.textSecondary }}>Sin clientes con sesión activa. Cuando alguien se registre aparecerá aquí.</span>
        </Card>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="rise">
        <button onClick={() => { setOpen(true); if (!coin && emitted[0]) setCoin(emitted[0][0]); }} className="press"
          style={{ width: "100%", textAlign: "left", background: t.cardSurface, border: "none", borderRadius: RADIUS.card, padding: 14, color: t.textPrimary }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: RADIUS.full, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700 }}>
              {user.name[0].toUpperCase()}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: t.textSecondary, fontFamily: FONT.mono }}>{user.email}</div>
            </span>
            <Badge tone="success">Activo</Badge>
            <span style={{ color: t.textSecondary }}>›</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
            {[["Patrimonio", fMon(totalUsd)], ["Fiat", fEur(eur)], ["Movimientos", String(txs.length)]].map(([k, v]) => (
              <span key={k} style={{ background: t.bg, border: `1px solid ${t.line}`, borderRadius: 12, padding: "9px 10px", display: "block" }}>
                <span style={{ fontSize: 10.5, color: t.textSecondary, display: "block" }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, marginTop: 2, display: "block" }}>{v}</span>
              </span>
            ))}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="rise">
      <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 13, padding: "0 0 10px" }}>‹ Clientes</button>

      <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 44, height: 44, borderRadius: RADIUS.full, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16 }}>
          {user.name[0].toUpperCase()}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user.name}</div>
          <div style={{ fontSize: 11.5, color: t.textSecondary, fontFamily: FONT.mono }}>{user.email}</div>
        </span>
        <Badge tone="success">Activo</Badge>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
        {[["Patrimonio", fMon(totalUsd)], ["Fiat", fEur(eur)], ["Movimientos", String(txs.length)]].map(([k, v]) => (
          <div key={k} style={{ background: t.cardSurface, borderRadius: 12, padding: "10px" }}>
            <div style={{ fontSize: 10.5, color: t.textSecondary }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "18px 0 8px" }}>Wallet registrada del cliente</div>
      <Card>
        {emitted.length === 0 && <EmptyLine text="Sin direcciones de depósito emitidas todavía." />}
        {emitted.map(([c, v], i) => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
            <CoinDot id={c} sym={c.toUpperCase()} size={30} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.toUpperCase()} · {CHAIN_LABEL[chainOf(c)]}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.addr}</div>
            </span>
          </div>
        ))}
      </Card>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "18px 0 4px" }}>Registrar depósito entrante</div>
      <p style={{ fontSize: 11.5, color: t.textSecondary, margin: "0 0 8px", lineHeight: 1.45 }}>
        Acredita el monto exacto detectado en la red hacia la wallet del cliente.
      </p>
      {emitted.length === 0 ? (
        <Card style={{ padding: 14 }}>
          <span style={{ fontSize: 12.5, color: t.textSecondary }}>Emite primero una dirección de depósito desde Solicitudes.</span>
        </Card>
      ) : (
        <Card style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={coin} onChange={(e) => setCoin(e.target.value)} style={{ ...input, width: 110 }}>
              {emitted.map(([c]) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Cantidad exacta recibida" inputMode="decimal" style={{ ...input, flex: 1, minWidth: 0 }} />
          </div>
          {valid && <div style={{ fontSize: 11.5, color: t.textSecondary }}>Equivale a {fMon(num * sel.price)}</div>}
          <Btn label={valid ? `Acreditar ${fNum(num)} ${coin.toUpperCase()}` : "Acreditar depósito"} disabled={!valid}
            onClick={() => { onCreditIncoming(coin, num); setAmount(""); }} style={{ width: "100%" }} />
        </Card>
      )}

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "18px 0 8px" }}>Estado</div>
      <Card>
        {[
          ["Billetera de autocustodia", walletState === "activa" ? "Activa" : walletState === "none" ? "Sin solicitar" : "En proceso", walletState === "activa" ? "success" : "muted"],
          ["Direcciones de retiro verificadas", String(book.filter((b) => b.status === "verificada").length), "accent"],
        ].map(([k, v, tone], i) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
            <span style={{ fontSize: 13 }}>{k}</span>
            <Badge tone={tone}>{v}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}

function GestorChat({ chat, onReply }) {
  const t = useT();
  const [text, setText] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onReply(v);
    setText("");
  };
  return (
    <div className="rise" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 380 }}>
      <div className="nosb" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 10 }}>
        {chat.map((m) => (
          <div key={m.id} style={{ alignSelf: m.from === "gestor" ? "flex-end" : "flex-start", maxWidth: "82%" }}>
            <div style={{
              background: m.from === "gestor" ? t.accent : t.cardSurface,
              color: m.from === "gestor" ? t.textOnAccent : t.textPrimary,
              borderRadius: m.from === "gestor" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              padding: "9px 13px", fontSize: 13.5, lineHeight: 1.4,
            }}>
              {m.text}
            </div>
            <div style={{ fontSize: 10.5, color: t.textSecondary, margin: "3px 6px 0", textAlign: m.from === "gestor" ? "right" : "left" }}>
              {m.from === "gestor" ? "Gestor" : "Cliente"} · {m.at}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${t.line}` }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Responder al cliente…" style={{ ...inputBase(t), flex: 1, minWidth: 0 }} />
        <Btn label="Enviar" onClick={send} disabled={!text.trim()} />
      </div>
    </div>
  );
}

/* ------------------------- Modal de denegación ------------------------- */

const ADDR_RULES = {
  btc: { re: /^(bc1[0-9a-z]{24,60}|[13][a-km-zA-HJ-NP-Z1-9]{24,40})$/, hint: "bc1… o 1…/3… (Bitcoin)" },
  eth: { re: /^0x[0-9a-fA-F]{40}$/, hint: "0x seguido de 40 caracteres hexadecimales" },
  sol: { re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, hint: "32–44 caracteres base58 (Solana)" },
  trx: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hint: "empieza por T y 34 caracteres (Tron TRC-20)" },
};

function SeedModal({ onCancel, onSubmit }) {
  const t = useT();
  const [text, setText] = useState("");
  const [shown, setShown] = useState(true);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const valid = words.length === 12;
  const generate = () => setText(genSeed().join(" "));
  const input = inputBase(t);
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 75 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", background: t.bg, borderRadius: 20, padding: 18, maxHeight: "88%", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Emitir frase de recuperación</div>
        <div style={{ fontSize: 11.5, color: t.textSecondary, margin: "4px 0 12px", lineHeight: 1.45 }}>
          Introduce las 12 palabras separadas por espacio, o genera una frase de prueba. El cliente la verá para anotarla.
        </div>
        <div style={{ position: "relative" }}>
          <textarea value={shown ? text : text.replace(/\S/g, "•")} onChange={(e) => shown && setText(e.target.value)} rows={3}
            placeholder="palabra1 palabra2 palabra3 … (12 en total)"
            style={{ width: "100%", background: t.bgFormInput, border: `1px solid ${valid || !text ? t.line : t.warning}`, borderRadius: RADIUS.input, color: t.textPrimary, padding: 10, fontSize: 13, fontFamily: FONT.mono, resize: "none" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 11.5, color: valid ? t.success : t.textSecondary }}>{words.length} / 12 palabras</span>
          <span style={{ display: "flex", gap: 12 }}>
            <button onClick={() => setShown((s) => !s)} style={{ background: "transparent", border: "none", color: t.accent, fontSize: 11.5, fontWeight: 600 }}>{shown ? "Ocultar" : "Mostrar"}</button>
            <button onClick={generate} style={{ background: "transparent", border: "none", color: t.accent, fontSize: 11.5, fontWeight: 600 }}>Generar de prueba</button>
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Btn label="Cancelar" variant="secondary" onClick={onCancel} style={{ flex: 1 }} />
          <Btn label="Emitir frase" disabled={!valid} onClick={() => onSubmit(words)} style={{ flex: 1.4 }} />
        </div>
      </div>
    </div>
  );
}

function EmitFiatModal({ amount, onCancel, onSubmit }) {
  const t = useT();
  const [beneficiario, setBeneficiario] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [ref, setRef] = useState("");
  const input = inputBase(t);
  const valid = beneficiario.trim() && iban.trim().length >= 15 && bic.trim().length >= 8 && ref.trim();
  const field = (label, val, set, ph, mono) => (
    <label style={{ fontSize: 12.5, fontWeight: 600, display: "grid", gap: 6 }}>
      {label}
      <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
        style={{ ...input, fontFamily: mono ? FONT.mono : "inherit" }} />
    </label>
  );
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 75 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", background: t.bg, borderRadius: 20, padding: 18, maxHeight: "88%", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Emitir datos de depósito</div>
        <div style={{ fontSize: 11.5, color: t.textSecondary, margin: "4px 0 12px" }}>
          Depósito de {fEur(amount || 0)}. Introduce los datos bancarios para esta operación. Serán de un solo uso.
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {field("Beneficiario", beneficiario, setBeneficiario, "Titular de la cuenta")}
          {field("IBAN", iban, setIban, "ES00 0000 0000 0000 0000 0000", true)}
          {field("BIC / SWIFT", bic, setBic, "XXXXESMMXXX", true)}
          {field("Referencia / Concepto", ref, setRef, "Concepto obligatorio", true)}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Btn label="Cancelar" variant="secondary" onClick={onCancel} style={{ flex: 1 }} />
          <Btn label="Emitir datos" disabled={!valid}
            onClick={() => onSubmit({ beneficiario: beneficiario.trim(), iban: iban.trim(), bic: bic.trim(), ref: ref.trim() })}
            style={{ flex: 1.4 }} />
        </div>
      </div>
    </div>
  );
}

function EmitAddrModal({ coin, onCancel, onSubmit }) {
  const t = useT();
  const [addr, setAddr] = useState("");
  const chain = chainOf(coin);
  const rule = ADDR_RULES[chain];
  const v = addr.trim();
  const valid = rule.re.test(v);
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 75 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", background: t.bg, borderRadius: 20, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <CoinDot id={coin} sym={coin.toUpperCase()} size={32} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Emitir dirección de {coin.toUpperCase()}</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary }}>Red {CHAIN_LABEL[chain]}</div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: t.textSecondary, margin: "6px 0 10px", lineHeight: 1.45 }}>
          Pega la dirección asignada a este cliente desde el sistema de custodia. Quedará fija como su dirección de depósito.
        </p>
        <textarea value={addr} onChange={(e) => setAddr(e.target.value)} rows={2}
          placeholder={rule.hint}
          style={{ width: "100%", background: t.bgFormInput, border: `1px solid ${valid || !v ? t.line : t.error}`, borderRadius: RADIUS.input, color: t.textPrimary, padding: 10, fontSize: 12.5, fontFamily: FONT.mono, resize: "none" }} />
        {v && !valid && <div style={{ fontSize: 11.5, color: t.error, marginTop: 6 }}>Formato no válido para {CHAIN_LABEL[chain]}: {rule.hint}</div>}
        <button onClick={() => setAddr(randAddr(chain))}
          style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 11.5, fontWeight: 600, padding: "8px 0 0", textDecoration: "underline" }}>
          Usar una dirección de prueba (solo demo)
        </button>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Btn label="Cancelar" variant="secondary" onClick={onCancel} style={{ flex: 1 }} />
          <Btn label="Emitir dirección" disabled={!valid} onClick={() => onSubmit(v)} style={{ flex: 1.4 }} />
        </div>
      </div>
    </div>
  );
}

function ReportModal({ value, onCancel, onSubmit }) {
  const t = useT();
  const [bal, setBal] = useState("");
  const [n, setN] = useState("");
  const [first, setFirst] = useState("");
  const [estado, setEstado] = useState("Activa");
  const input = inputBase(t);
  const balN = parseFloat(String(bal).replace(",", "."));
  const nN = parseInt(n, 10);
  const valid = !isNaN(balN) && balN >= 0 && !isNaN(nN) && nN >= 0 && first.trim().length >= 4 && estado.trim().length > 0;
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 75 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", background: t.bg, borderRadius: 20, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Informe de dirección</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: t.textSecondary, wordBreak: "break-all", marginBottom: 10 }}>{value}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: "grid", gap: 6 }}>
            Saldo (USD)
            <input value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0,00" inputMode="decimal" style={input} />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: "grid", gap: 6 }}>
            Transacciones
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="0" inputMode="numeric" style={input} />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: "grid", gap: 6 }}>
            Primera actividad
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="p. ej. 14 mar 2021" style={input} />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: "grid", gap: 6 }}>
            Estado
            <select value={estado} onChange={(e) => setEstado(e.target.value)} style={input}>
              {["Activa", "Inactiva", "Marcada como riesgo", "En observación"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Btn label="Cancelar" variant="secondary" onClick={onCancel} style={{ flex: 1 }} />
          <Btn label="Publicar informe" disabled={!valid} onClick={() => onSubmit({ balanceUsd: balN, txCount: nN, first: first.trim(), estado })} style={{ flex: 1.3 }} />
        </div>
      </div>
    </div>
  );
}

function DenyModal({ title, onCancel, onSubmit }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 8;
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 85 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", background: t.bg, borderRadius: 20, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 4 }}>{title}</div>
        <p style={{ fontSize: 12.5, color: t.textSecondary, margin: "0 0 12px" }}>
          El motivo es obligatorio y se comunica al cliente junto con la devolución de fondos cuando aplique.
        </p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="Motivo de la denegación (mínimo 8 caracteres). P. ej.: la dirección de destino no supera la verificación de riesgo."
          style={{ width: "100%", background: t.bgFormInput, border: `1px solid ${t.line}`, borderRadius: RADIUS.input, color: t.textPrimary, padding: 12, fontSize: 13.5, resize: "none", lineHeight: 1.4 }} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <Btn label="Cancelar" variant="secondary" onClick={onCancel} style={{ flex: 1 }} />
          <Btn label="Confirmar denegación" variant="danger" disabled={!ok} onClick={() => ok && onSubmit(reason.trim())} style={{ flex: 1.4 }} />
        </div>
      </div>
    </div>
  );
}

/* ============================ HOJAS (cliente) ============================ */

function SheetBase({ title, onClose, children }) {
  const t = useT();
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise"
        style={{ width: "100%", maxHeight: "88%", overflowY: "auto", background: t.bg, borderRadius: "24px 24px 0 0", padding: "10px 18px 24px" }}>
        <div style={{ width: 40, height: 4, borderRadius: 99, background: t.line, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h3>
          {onClose && <button onClick={onClose} aria-label="Cerrar" style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 20, lineHeight: 1 }}>×</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function ModePicker({ onFiat, onCrypto }) {
  const t = useT();
  const Opt = ({ title, sub, onClick, icon }) => (
    <button onClick={onClick} className="press" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: t.cardSurface, border: "none", borderRadius: RADIUS.card, padding: 16, color: t.textPrimary }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(30,125,247,0.12)", color: t.accent, display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>{sub}</div>
      </span>
      <span style={{ color: t.textSecondary }}>›</span>
    </button>
  );
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Opt title="Fiat" sub="Euros (EUR) por transferencia SEPA" icon="€" onClick={onFiat} />
      <Opt title="Cripto" sub="BTC, ETH, USDT, USDC y SOL en cadena" icon="₿" onClick={onCrypto} />
    </div>
  );
}

function DepositSheet({ assets, depositAddrs, onRequestAddr, fiatReq, onRequestFiatData, onConfirmFiat, onClose }) {
  const t = useT();
  const [mode, setMode] = useState(null);
  const [coin, setCoin] = useState(null);
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const input = inputBase(t);
  const num = parseFloat(String(amount).replace(",", "."));
  const amountOk = !isNaN(num) && num > 0;
  const d = coin ? depositAddrs[coin] : null;

  const back = () => (coin ? setCoin(null) : setMode(null));
  const title = mode === null ? "Depositar" : mode === "fiat" ? "Depositar euros" : coin ? `Depositar ${coin.toUpperCase()}` : "Depositar cripto";

  return (
    <SheetBase title={title} onClose={onClose}>
      {mode !== null && (
        <button onClick={back} style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 13.5, padding: 0, marginBottom: 12 }}>‹ Volver</button>
      )}

      {mode === null && <ModePicker onFiat={() => setMode("fiat")} onCrypto={() => setMode("cripto")} />}

      {mode === "fiat" && !fiatReq && (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, display: "grid", gap: 8 }}>
            Importe a depositar (EUR)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" style={input} />
          </label>
          <Card style={{ padding: "14px" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Los datos bancarios se emiten por operación</div>
            <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 4, lineHeight: 1.45 }}>
              Solicita los datos y el equipo de operaciones te emitirá la cuenta y el concepto exclusivos para este depósito.
            </div>
          </Card>
          <Btn label="Solicitar datos de depósito" disabled={!amountOk} onClick={() => onRequestFiatData(num)} style={{ width: "100%" }} />
        </div>
      )}

      {mode === "fiat" && fiatReq?.status === "pendiente" && (
        <div style={{ display: "grid", gap: 12 }}>
          <Card style={{ padding: "16px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Solicitud de datos enviada</span>
              <Badge tone="warning">Pendiente</Badge>
            </div>
            <div style={{ fontSize: 12.5, color: t.textSecondary, marginTop: 4 }}>
              Depósito por {fEur(fiatReq.amount)}. El gestor emitirá los datos bancarios y te avisaremos aquí y por soporte.
            </div>
          </Card>
        </div>
      )}

      {mode === "fiat" && fiatReq?.status === "emitida" && (
        <div style={{ display: "grid", gap: 12 }}>
          <Card style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: t.textSecondary }}>Datos para tu depósito de {fEur(fiatReq.amount)}</span>
              <Badge tone="success">Datos listos</Badge>
            </div>
            {[["Beneficiario", fiatReq.beneficiario || fiatReq.titular], ["IBAN", fiatReq.iban], ["BIC / SWIFT", fiatReq.bic], ["Referencia (obligatoria)", fiatReq.ref]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0" }}>
                <span style={{ fontSize: 12, color: t.textSecondary, flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: 12, fontFamily: FONT.mono, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
              </div>
            ))}
          </Card>
          <p style={{ fontSize: 11.5, color: t.textSecondary, margin: 0 }}>
            Transfiere con el concepto exacto; el equipo de operaciones validará y acreditará tu saldo. Estos datos valen solo para esta operación.
          </p>
          <Btn label="Ya hice la transferencia" onClick={onConfirmFiat} style={{ width: "100%" }} />
        </div>
      )}

      {mode === "cripto" && !coin && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ fontSize: 12.5, color: t.textSecondary, margin: "0 0 4px" }}>Elige la moneda que vas a depositar</p>
          {DEPOSIT_COINS.map((c) => {
            const a = assets.find((x) => x.id === c);
            const st = depositAddrs[c]?.status;
            return (
              <button key={c} onClick={() => setCoin(c)} className="press"
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: t.cardSurface, border: "none", borderRadius: RADIUS.card, padding: "12px 14px", color: t.textPrimary }}>
                <CoinDot id={c} sym={a.sym} size={36} />
                <span style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: t.textSecondary }}>Red: {CHAIN_LABEL[chainOf(c)]}</div>
                </span>
                {st === "lista" && <Badge tone="success">Dirección lista</Badge>}
                {st === "pendiente" && <Badge tone="warning">Solicitada</Badge>}
                <span style={{ color: t.textSecondary }}>›</span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "cripto" && coin && (
        <div style={{ display: "grid", gap: 12 }}>
          {!d && (
            <>
              <Card style={{ padding: "16px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Necesitas una dirección de depósito</div>
                <div style={{ fontSize: 12.5, color: t.textSecondary, marginTop: 4, lineHeight: 1.45 }}>
                  Solicítala y se generará una dirección de {coin.toUpperCase()} exclusiva para tu cuenta en la red {CHAIN_LABEL[chainOf(coin)]}.
                </div>
              </Card>
              <Btn label="Solicitar dirección de depósito" onClick={() => onRequestAddr(coin)} style={{ width: "100%" }} />
            </>
          )}
          {d?.status === "pendiente" && (
            <Card style={{ padding: "16px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Solicitud en curso</span>
                <Badge tone="warning">Pendiente</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: t.textSecondary, marginTop: 4 }}>
                Tu dirección está en la cola de emisión. Te avisaremos en cuanto esté lista.
              </div>
            </Card>
          )}
          {d?.status === "lista" && (
            <>
              <Card style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: t.textSecondary }}>Tu dirección de depósito · {CHAIN_LABEL[chainOf(coin)]}</span>
                </div>
                <div style={{ display: "grid", placeItems: "center", padding: "6px 0 10px" }}>
                  <QRCode value={d.addr} size={132} />
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 12, wordBreak: "break-all", textAlign: "center" }}>{d.addr}</div>
              </Card>
              <Btn label={copied ? "Copiada" : "Copiar dirección"} variant="secondary" style={{ width: "100%" }}
                onClick={() => { try { navigator.clipboard?.writeText(d.addr); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1400); }} />
              <p style={{ fontSize: 11.5, color: t.textSecondary, margin: 0 }}>
                Envía solo {coin.toUpperCase()} por {CHAIN_LABEL[chainOf(coin)]}. Los fondos se acreditan al confirmarse en la red.
              </p>
              <Btn label="Volver al inicio" variant="secondary" onClick={onClose} style={{ width: "100%" }} />
            </>
          )}
        </div>
      )}
    </SheetBase>
  );
}

function WithdrawSheet({ assets, eur, book, onFiat, onCrypto, onClose, goBook }) {
  const t = useT();
  const { fMon } = useMon();
  const [mode, setMode] = useState(null);
  const [coin, setCoin] = useState(null);
  const [amount, setAmount] = useState("");
  const [iban, setIban] = useState("");
  const [dest, setDest] = useState(null);
  const input = inputBase(t);
  const num = parseFloat(String(amount).replace(",", "."));

  const owned = assets.filter((a) => a.amount > 0);
  const a = coin ? assets.find((x) => x.id === coin) : null;
  const verified = coin ? book.filter((b) => b.status === "verificada" && chainOf(b.chain) === chainOf(coin)) : [];

  const back = () => (coin ? (setCoin(null), setDest(null), setAmount("")) : setMode(null));
  const title = mode === null ? "Retirar" : mode === "fiat" ? "Retirar euros" : coin ? `Retirar ${a.sym}` : "Retirar cripto";

  const fiatOk = !isNaN(num) && num > 0 && num <= eur && iban.trim().replace(/\s/g, "").length >= 15;
  const cryptoOk = a && !isNaN(num) && num > 0 && num <= a.amount && dest;

  return (
    <SheetBase title={title} onClose={onClose}>
      {mode !== null && (
        <button onClick={back} style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 13.5, padding: 0, marginBottom: 12 }}>‹ Volver</button>
      )}

      {mode === null && <ModePicker onFiat={() => setMode("fiat")} onCrypto={() => setMode("cripto")} />}

      {mode === "fiat" && (
        eur <= 0 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ fontSize: 13.5, color: t.textSecondary, margin: 0 }}>No tienes saldo en euros. Haz primero un depósito fiat.</p>
            <Btn label="Entendido" variant="secondary" onClick={onClose} style={{ width: "100%" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <Card style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: t.textSecondary }}>Disponible</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fEur(eur)}</span>
            </Card>
            <label style={{ fontSize: 13, fontWeight: 600, display: "grid", gap: 8 }}>
              Importe (EUR)
              <div style={{ display: "flex", gap: 8 }}>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" style={{ ...input, flex: 1 }} />
                <Btn label="Todo" variant="secondary" onClick={() => setAmount(String(eur))} />
              </div>
            </label>
            <label style={{ fontSize: 13, fontWeight: 600, display: "grid", gap: 8 }}>
              IBAN de destino
              <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" style={{ ...input, fontFamily: FONT.mono, fontSize: 12.5 }} />
            </label>
            {amount && !isNaN(num) && num > eur && <div style={{ fontSize: 12, color: t.error }}>Saldo insuficiente</div>}
            <Btn label="Enviar solicitud de retiro" disabled={!fiatOk} onClick={() => onFiat(num, iban.trim())} style={{ width: "100%" }} />
            <p style={{ fontSize: 11.5, color: t.textSecondary, margin: 0, textAlign: "center" }}>
              La solicitud queda pendiente hasta su aprobación.
            </p>
          </div>
        )
      )}

      {mode === "cripto" && !coin && (
        owned.length === 0 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ fontSize: 13.5, color: t.textSecondary, margin: 0 }}>No tienes cripto con saldo para retirar. Haz primero un depósito.</p>
            <Btn label="Entendido" variant="secondary" onClick={onClose} style={{ width: "100%" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ fontSize: 12.5, color: t.textSecondary, margin: "0 0 4px" }}>Solo se muestran monedas con saldo a favor</p>
            {owned.map((x) => (
              <button key={x.id} onClick={() => setCoin(x.id)} className="press"
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: t.cardSurface, border: "none", borderRadius: RADIUS.card, padding: "12px 14px", color: t.textPrimary }}>
                <CoinDot id={x.id} sym={x.sym} size={36} />
                <span style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{x.name}</div>
                  <div style={{ fontSize: 11.5, color: t.textSecondary }}>Disponible: {fNum(x.amount)} {x.sym}</div>
                </span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{fMon(x.amount * x.price)}</span>
                <span style={{ color: t.textSecondary }}>›</span>
              </button>
            ))}
          </div>
        )
      )}

      {mode === "cripto" && coin && (
        <div style={{ display: "grid", gap: 12 }}>
          <Card style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: t.textSecondary }}>Disponible</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{fNum(a.amount)} {a.sym}</span>
          </Card>

          <div style={{ fontSize: 13, fontWeight: 600 }}>Destino (direcciones verificadas)</div>
          {verified.length === 0 ? (
            <Card style={{ padding: "14px" }}>
              <div style={{ fontSize: 12.5, color: t.textSecondary, lineHeight: 1.45 }}>
                No tienes direcciones verificadas para {CHAIN_LABEL[chainOf(coin)]}. Por seguridad, los retiros solo van a tu lista blanca.
              </div>
              <Btn label="Registrar una dirección" variant="secondary" onClick={goBook} style={{ width: "100%", marginTop: 10 }} />
            </Card>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {verified.map((b) => (
                <button key={b.id} onClick={() => setDest(b)} className="press"
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: dest?.id === b.id ? "rgba(30,125,247,0.10)" : t.cardSurface, border: `1.5px solid ${dest?.id === b.id ? t.accent : "transparent"}`, borderRadius: RADIUS.card, padding: "11px 13px", color: t.textPrimary }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{b.label}</div>
                    <div style={{ fontFamily: FONT.mono, fontSize: 11, color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.addr}</div>
                  </span>
                  <Badge tone="success">Verificada</Badge>
                </button>
              ))}
            </div>
          )}

          <label style={{ fontSize: 13, fontWeight: 600, display: "grid", gap: 8 }}>
            Cantidad ({a.sym})
            <div style={{ display: "flex", gap: 8 }}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" style={{ ...input, flex: 1 }} />
              <Btn label="Todo" variant="secondary" onClick={() => setAmount(String(a.amount))} />
            </div>
          </label>
          {amount && !isNaN(num) && (
            <div style={{ fontSize: 12, color: num > a.amount ? t.error : t.textSecondary }}>
              {num > a.amount ? "Saldo insuficiente" : `Equivale a ${fMon(num * a.price)} · comisión de red ${fMon(a.fee)}`}
            </div>
          )}
          <Btn label="Enviar solicitud de retiro" disabled={!cryptoOk} onClick={() => onCrypto(coin, num, dest)} style={{ width: "100%" }} />
          <p style={{ fontSize: 11.5, color: t.textSecondary, margin: 0, textAlign: "center" }}>
            La solicitud queda pendiente hasta su firma y difusión.
          </p>
        </div>
      )}
    </SheetBase>
  );
}

/* ------------------------- Justificante ------------------------- */

function ReceiptSheet({ tx, onClose }) {
  const t = useT();
  const { fMon } = useMon();
  const [tone, label] = STATUS_BADGE[tx.status];
  const row = { display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: `1px solid ${t.line}`, fontSize: 13 };
  return (
    <SheetBase title="Justificante de la operación" onClose={onClose}>
      <div style={{ textAlign: "center", padding: "6px 0 14px" }}>
        <CoinDot id={tx.coin} sym={tx.sym} size={46} />
        <div style={{ fontWeight: 700, fontSize: 20, marginTop: 10 }}>
          -{tx.kind === "fiat" ? fEur(tx.amount) : `${fNum(tx.amount)} ${tx.sym}`}
        </div>
        <div style={{ marginTop: 8 }}>
          <Badge tone={tone}>{tx.status === "pendiente" ? "Solicitud de retiro · Pendiente" : label}</Badge>
        </div>
      </div>
      <Card style={{ padding: "4px 14px" }}>
        <div style={{ ...row, borderTop: "none" }}>
          <span style={{ color: t.textSecondary }}>Nº de operación</span>
          <span style={{ fontFamily: FONT.mono, fontWeight: 600 }}>{tx.op}</span>
        </div>
        <div style={row}>
          <span style={{ color: t.textSecondary }}>Tipo</span>
          <span style={{ fontWeight: 600 }}>Retiro {tx.kind === "fiat" ? "fiat (SEPA)" : "cripto"}</span>
        </div>
        <div style={row}>
          <span style={{ color: t.textSecondary }}>Fecha de solicitud</span>
          <span style={{ fontWeight: 600 }}>{tx.date}</span>
        </div>
        {tx.kind === "fiat" ? (
          <div style={row}>
            <span style={{ color: t.textSecondary, flexShrink: 0 }}>IBAN destino</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 12, textAlign: "right", wordBreak: "break-all" }}>{tx.iban}</span>
          </div>
        ) : (
          <>
            <div style={row}>
              <span style={{ color: t.textSecondary }}>Destino</span>
              <span style={{ fontWeight: 600 }}>{tx.toLabel}</span>
            </div>
            <div style={row}>
              <span style={{ color: t.textSecondary, flexShrink: 0 }}>Dirección</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 11.5, textAlign: "right", wordBreak: "break-all" }}>{tx.to}</span>
            </div>
            <div style={row}>
              <span style={{ color: t.textSecondary }}>Comisión de red (est.)</span>
              <span style={{ fontWeight: 600 }}>{fMon(tx.feeUsd)}</span>
            </div>
          </>
        )}
        <div style={row}>
          <span style={{ color: t.textSecondary }}>Estado</span>
          <span style={{ fontWeight: 600, color: tx.status === "pendiente" ? t.warning : tx.status === "denegada" ? t.error : t.success }}>
            {tx.status === "pendiente" ? "Pendiente" : tx.status === "denegada" ? "Denegada" : "Aprobada"}
          </span>
        </div>
        {tx.status === "denegada" && tx.reason && (
          <div style={{ ...row, display: "block" }}>
            <div style={{ color: t.textSecondary, marginBottom: 3 }}>Motivo</div>
            <div style={{ fontWeight: 600, color: t.error }}>{tx.reason}</div>
          </div>
        )}
      </Card>
      <p style={{ fontSize: 11.5, color: t.textSecondary, textAlign: "center", margin: "12px 0" }}>
        Recibirás la resolución en la app y en el soporte en línea.
      </p>
      <Btn label="Entendido" onClick={onClose} style={{ width: "100%" }} />
    </SheetBase>
  );
}

/* ------------------------- Detalle de movimiento ------------------------- */

function TxSheet({ tx, onClose, onExplore }) {
  const t = useT();
  const { fMon } = useMon();
  const [copied, setCopied] = useState(false);
  const mono = { fontFamily: FONT.mono, fontSize: 11.5, wordBreak: "break-all", color: t.textPrimary, lineHeight: 1.5 };
  const label = { fontSize: 12, color: t.textSecondary, marginBottom: 2 };
  const row = { padding: "10px 14px", borderTop: `1px solid ${t.line}` };
  const [tone, lbl] = STATUS_BADGE[tx.status];

  return (
    <SheetBase title="Detalle del movimiento" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <CoinDot id={tx.coin} sym={tx.sym} size={44} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{tx.type === "deposito" ? "Depósito" : "Retiro"} de {tx.sym}</div>
          <div style={{ fontSize: 12.5, color: t.textSecondary }}>{tx.date} · <span style={{ fontFamily: FONT.mono }}>{tx.op}</span></div>
        </span>
        <span style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: tx.type === "deposito" ? t.success : t.textPrimary, textDecoration: tx.status === "denegada" ? "line-through" : "none" }}>
            {tx.type === "deposito" ? "+" : "-"}{tx.kind === "fiat" ? fEur(tx.amount) : `${fNum(tx.amount)} ${tx.sym}`}
          </div>
          {tx.kind === "cripto" && <div style={{ fontSize: 12.5, color: t.textSecondary }}>{fMon(tx.valueUsd)}</div>}
        </span>
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div style={{ ...row, borderTop: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>Estado</span>
          <Badge tone={tone}>
            {tx.status === "confirmada" && tx.kind === "cripto" && tx.conf ? `Confirmada · ${fInt(tx.conf)} conf.` : lbl}
          </Badge>
        </div>
        {tx.status === "denegada" && tx.reason && (
          <div style={row}>
            <div style={label}>Motivo de la denegación</div>
            <div style={{ fontSize: 12.5, color: t.error, fontWeight: 600, lineHeight: 1.4 }}>{tx.reason}</div>
            <div style={{ fontSize: 11.5, color: t.textSecondary, marginTop: 4 }}>Los fondos fueron devueltos a tu saldo.</div>
          </div>
        )}
        {tx.kind === "fiat" ? (
          <div style={row}>
            <div style={label}>{tx.type === "deposito" ? "Origen" : "IBAN de destino"}</div>
            <div style={mono}>{tx.iban}</div>
          </div>
        ) : (
          <>
            {tx.feeUsd != null && (
              <div style={{ ...row, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>Comisión de red</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{fMon(tx.feeUsd)}</span>
              </div>
            )}
            {tx.from && (
              <div style={row}>
                <div style={label}>Desde</div>
                <div style={mono}>{tx.from}</div>
              </div>
            )}
            {tx.to && (
              <div style={row}>
                <div style={label}>Hacia{tx.toLabel ? ` · ${tx.toLabel}` : ""}</div>
                <div style={mono}>{tx.to}</div>
              </div>
            )}
            <div style={row}>
              <div style={label}>Hash de la transacción</div>
              <div style={mono}>{tx.hash || (tx.status === "denegada" ? "No aplica: la operación fue denegada." : "Se asignará cuando la operación se firme y difunda.")}</div>
            </div>
          </>
        )}
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {tx.kind === "cripto" && tx.hash && (
          <Btn label={copied ? "Hash copiado" : "Copiar hash"} variant="secondary" style={{ flex: 1 }}
            onClick={() => { try { navigator.clipboard?.writeText(tx.hash); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1400); }} />
        )}
        <Btn label="Ver en el explorador" onClick={onExplore} style={{ flex: 1 }} />
      </div>
    </SheetBase>
  );
}

/* ------------------------- Chat (cliente) ------------------------- */

/* ------------------- Detalle de cadena (explorador) ------------------- */

function NotisSheet({ notis, onClose }) {
  const t = useT();
  return (
    <SheetBase title="Notificaciones" onClose={onClose}>
      <Card>
        {notis.length === 0 && <EmptyLine text="Sin notificaciones todavía. Aquí verás depósitos, retiros, direcciones y avisos de tu cuenta." />}
        {notis.map((n, i) => (
          <div key={n.id} style={{ display: "flex", gap: 10, padding: "12px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: t.accent, marginTop: 6, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>{n.text}</span>
            <span style={{ fontSize: 10.5, color: t.textSecondary, flexShrink: 0 }}>{n.at}</span>
          </div>
        ))}
      </Card>
    </SheetBase>
  );
}

function ChainSheet({ chain: c, onClose }) {
  const t = useT();
  const { fMon } = useMon();
  const blocks = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    n: c.block - i,
    min: c.min + i * (c.id === "btc" ? 9 : c.id === "ltc" ? 2 : 1),
    txs: 400 + ((c.block - i) * 37) % 2600,
  })), [c.id]);
  const rtxs = useMemo(() => Array.from({ length: 3 }, (_, i) => {
    let x = c.sym.charCodeAt(0) * (i + 3) * 97;
    const hash = Array.from({ length: 20 }, () => { x = (x * 31 + 17) % 997; return "0123456789abcdef"[x % 16]; }).join("");
    return { hash: hash + "…", amount: (x % 900) / (c.price > 1000 ? 900 : c.price > 50 ? 30 : 0.5) };
  }), [c.id]);
  return (
    <SheetBase title={`${c.name} · Explorador`} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <CoinDot id={c.id} sym={c.sym} size={42} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{fMon(c.price)} <span style={{ color: t.accentAlt, fontWeight: 600, fontSize: 13 }}>{c.sym}</span></div>
          <div style={{ fontSize: 12, color: t.textSecondary }}>Comisión promedio {fMon(c.fee)}</div>
        </span>
        <Badge tone="success">Red activa</Badge>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "4px 0 8px" }}>Últimos bloques</div>
      <Card>
        {blocks.map((b, i) => (
          <div key={b.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 12.5, fontWeight: 600, flex: 1 }}>{fInt(b.n)}</span>
            <span style={{ fontSize: 11.5, color: t.textSecondary }}>{fInt(b.txs)} transacciones</span>
            <span style={{ fontSize: 11.5, color: t.textSecondary, width: 74, textAlign: "right" }}>hace {b.min} min</span>
          </div>
        ))}
      </Card>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "16px 0 8px" }}>Transacciones recientes</div>
      <Card>
        {rtxs.map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: t.textSecondary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.hash}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{fNum(x.amount, 4)} {c.sym}</span>
          </div>
        ))}
      </Card>
      <p style={{ fontSize: 11, color: t.textSecondary, textAlign: "center", margin: "12px 0 0" }}>
        Datos de red simulados. En producción provienen del adaptador de cada cadena.
      </p>
    </SheetBase>
  );
}

function ChatSheet({ chat, onSend, onClose, me = "yo", title = "Soporte en línea" }) {
  const t = useT();
  const [text, setText] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
  };
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(16,17,18,.45)", display: "flex", alignItems: "flex-end", zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise"
        style={{ width: "100%", height: "88%", background: t.bg, borderRadius: "24px 24px 0 0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 18px 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: t.line, margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: `1px solid ${t.line}` }}>
            <span style={{ width: 36, height: 36, borderRadius: RADIUS.full, background: t.successBg, color: t.success, display: "grid", placeItems: "center", fontWeight: 700, position: "relative" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 1 0-3.1 6.3L21 19l-.9-2.8A7.9 7.9 0 0 0 21 12Z" />
              </svg>
              <span style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 99, background: t.success, border: `2px solid ${t.bg}` }} />
            </span>
            <span style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: t.success }}>En línea</div>
            </span>
            <button onClick={onClose} aria-label="Cerrar" style={{ background: "transparent", border: "none", color: t.textSecondary, fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div className="nosb" style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {chat.map((m) => (
            <div key={m.id} style={{ alignSelf: m.from === me ? "flex-end" : "flex-start", maxWidth: "82%" }}>
              <div style={{
                background: m.from === me ? t.accent : t.cardSurface,
                color: m.from === me ? t.textOnAccent : t.textPrimary,
                borderRadius: m.from === me ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                padding: "9px 13px", fontSize: 13.5, lineHeight: 1.4,
              }}>
                {m.text}
              </div>
              <div style={{ fontSize: 10.5, color: t.textSecondary, margin: "3px 6px 0", textAlign: m.from === me ? "right" : "left" }}>{m.at}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div style={{ display: "flex", gap: 8, padding: "10px 14px 16px", borderTop: `1px solid ${t.line}` }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Escribe un mensaje…" style={{ ...inputBase(t), flex: 1, minWidth: 0 }} />
          <Btn label="Enviar" onClick={send} disabled={!text.trim()} />
        </div>
      </div>
    </div>
  );
}
