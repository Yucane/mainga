import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Droplet, MapPin, Phone, MessageCircle, Search, UserPlus,
  Siren, Activity, Check, X, ChevronRight, Users, Radio, Send,
  Flag, Lock, ShieldAlert, Heart, Bell
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---------- design tokens ---------- */
const C = {
  bg: "#14100D",
  surface: "#1D1613",
  surfaceRaised: "#271D19",
  line: "#3A2C26",
  garnet: "#C6293D",
  garnetDeep: "#8F1F2C",
  garnetSoft: "rgba(198,41,61,0.14)",
  gold: "#E8A33D",
  goldSoft: "rgba(232,163,61,0.14)",
  green: "#4E9A6E",
  greenSoft: "rgba(78,154,110,0.14)",
  paper: "#F5EDE4",
  muted: "#A6968D",
  faint: "#6E5F58",
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');`;

const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

const PROVINCES = [
  "Bengo", "Benguela", "Bié", "Cabinda", "Cuando", "Cuando Cubango",
  "Cuanza Norte", "Cuanza Sul", "Cunene", "Huambo", "Huíla",
  "Icolo e Bengo", "Luanda", "Lunda Norte", "Lunda Sul", "Malanje",
  "Moxico", "Moxico Leste", "Namibe", "Uíge", "Zaire",
];

/* compatibility: who can donate to a given recipient type */
const CAN_DONATE_TO = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"],
};
function compatibleDonorTypes(recipientType) {
  return BLOOD_TYPES.filter((t) => CAN_DONATE_TO[t]?.includes(recipientType));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const normalizePhone = (p) => (p || "").replace(/\D/g, "");
function maskPhone(phone) {
  const raw = (phone || "").trim();
  const digits = normalizePhone(raw);
  if (digits.length <= 4) return "••••";
  const visible = digits.slice(-2);
  const plus = raw.startsWith("+") ? "+" : "";
  const headLen = digits.length > 8 ? 3 : 1;
  return `${plus}${digits.slice(0, headLen)} ••• •• ${visible}`;
}
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

/* ---------- Supabase ---------- */
// Cole aqui os dois valores de Project Settings > API no painel do Supabase.
const SUPABASE_URL = "https://izdbplvpjktsswxuwsgx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Qz9-hQVQ54Z0KRHgWvKISA_TZbEgLJR";

async function sbFetch(path, { method = "GET", body, token, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || res.statusText;
    throw new Error(msg);
  }
  return data;
}

// chave pública VAPID: identifica o nosso servidor aos serviços de notificação (Google/Apple/etc.)
const VAPID_PUBLIC_KEY = "BILoGMAk83entCqgCtfkOEh4yr8vV3iAX5OkdgnBgUfUUA49B4R_-w95JHGlkrzCKuyCjmXNGze3V4CfFkUIaOI";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

const authApi = {
  sendCode: (email, createUser) => sbFetch("/auth/v1/otp", { method: "POST", body: { email, create_user: createUser } }),
  verifyCode: (email, token, type) => sbFetch("/auth/v1/verify", { method: "POST", body: { type, email, token } }),
  getUser: (token) => sbFetch("/auth/v1/user", { token }),
  refreshToken: (refreshToken) =>
    sbFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } }),
};

/* manter a sessão guardada no telemóvel, para não pedir login sempre que reabre a app */
const SESSION_KEY = "mainga_session";
function persistSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* localStorage indisponível (ex: modo privado). Sessão só dura enquanto a aba estiver aberta */
  }
}
function loadPersistedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearPersistedSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nada a fazer */
  }
}

/* mapear entre snake_case (base de dados) e camelCase (usado na app) */
const DONATION_INTERVAL_DAYS = { masculino: 90, feminino: 120, default: 90 };

function donorEligibleDate(lastDonationDate, sex) {
  if (!lastDonationDate) return null;
  const d = new Date(lastDonationDate);
  const days = DONATION_INTERVAL_DAYS[sex] || DONATION_INTERVAL_DAYS.default;
  d.setDate(d.getDate() + days);
  return d;
}
function donorIsEligible(donor) {
  const elig = donorEligibleDate(donor.lastDonationDate, donor.sex);
  return !elig || elig.getTime() <= Date.now();
}

function donorFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    bloodType: row.blood_type,
    age: row.age,
    sex: row.sex,
    whatsapp: row.whatsapp,
    diaspora: row.diaspora,
    province: row.province,
    city: row.city,
    available: row.available,
    lastDonationDate: row.last_donation_date,
    partnerInstitution: row.partner_institution,
    createdAt: new Date(row.created_at).getTime(),
  };
}
function donorToRow(donor, userId) {
  return {
    user_id: userId,
    name: donor.name,
    blood_type: donor.bloodType,
    age: donor.age,
    sex: donor.sex,
    whatsapp: donor.whatsapp,
    diaspora: donor.diaspora,
    province: donor.province,
    city: donor.city,
    available: donor.available,
    phone: donor.phone,
    last_donation_date: donor.lastDonationDate || null,
    partner_institution: donor.partnerInstitution || null,
  };
}
function requestFromRow(row) {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    place: row.place,
    bloodType: row.blood_type,
    province: row.province,
    city: row.city,
    units: row.units,
    urgency: row.urgency,
    notes: row.notes,
    status: row.status,
    approved: row.approved,
    reportCount: row.report_count,
    contactPhone: row.contact_phone,
    createdAt: new Date(row.created_at).getTime(),
  };
}
function requestToRow(req, userId) {
  return {
    requester_user_id: userId,
    place: req.place,
    blood_type: req.bloodType,
    province: req.province,
    city: req.city,
    units: req.units,
    urgency: req.urgency,
    notes: req.notes,
    contact_phone: req.contactPhone,
  };
}

const DONOR_COLUMNS = "id,user_id,name,blood_type,age,sex,whatsapp,diaspora,province,city,available,last_donation_date,partner_institution,created_at";

const api = {
  donors: {
    list: (token) => sbFetch(`/rest/v1/donors?select=${DONOR_COLUMNS}&order=created_at.desc`, { token }),
    insert: (token, row) =>
      sbFetch("/rest/v1/donors", { method: "POST", token, body: row, headers: { Prefer: "return=representation" } }),
    remove: (token, id) => sbFetch(`/rest/v1/donors?id=eq.${id}`, { method: "DELETE", token }),
  },
  requests: {
    list: (token) => sbFetch("/rest/v1/requests?select=*&order=created_at.desc", { token }),
    insert: (token, row) =>
      sbFetch("/rest/v1/requests", { method: "POST", token, body: row, headers: { Prefer: "return=representation" } }),
    close: (token, id) => sbFetch(`/rest/v1/requests?id=eq.${id}`, { method: "PATCH", token, body: { status: "resolvido" } }),
    approve: (token, id) => sbFetch(`/rest/v1/requests?id=eq.${id}`, { method: "PATCH", token, body: { approved: true } }),
    remove: (token, id) => sbFetch(`/rest/v1/requests?id=eq.${id}`, { method: "DELETE", token }),
  },
  reports: {
    insert: (token, requestId, userId) =>
      sbFetch("/rest/v1/reports", { method: "POST", token, body: { request_id: requestId, reporter_user_id: userId } }),
  },
  admins: {
    check: async (token, userId) => {
      const rows = await sbFetch(`/rest/v1/admins?user_id=eq.${userId}&select=user_id`, { token });
      return Array.isArray(rows) && rows.length > 0;
    },
  },
  verifiedRequesters: {
    list: (token) => sbFetch("/rest/v1/verified_requesters?select=*", { token }),
    add: (token, userId, institutionName) =>
      sbFetch("/rest/v1/verified_requesters", { method: "POST", token, body: { user_id: userId, institution_name: institutionName } }),
  },
  revealContact: (token, donorId) =>
    sbFetch("/rest/v1/rpc/reveal_donor_contact", { method: "POST", token, body: { target_donor_id: donorId } }),
  pushSubscriptions: {
    upsert: (token, row) =>
      sbFetch("/rest/v1/push_subscriptions?on_conflict=endpoint", {
        method: "POST",
        token,
        body: row,
        headers: { Prefer: "resolution=merge-duplicates" },
      }),
    remove: (token, endpoint) =>
      sbFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE", token }),
  },
};

/* ---------- tiny UI atoms ---------- */
function PulseLine({ w = 100, color = C.garnet, animate = true }) {
  return (
    <svg width={w} height="18" viewBox="0 0 100 18" fill="none" style={{ display: "block" }}>
      <path
        d="M0 9 H30 L36 2 L42 16 L48 4 L53 9 H100"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        style={
          animate
            ? {
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation: "pulseDraw 2.4s ease-in-out infinite",
              }
            : {}
        }
      />
    </svg>
  );
}

function Badge({ children, tone = "garnet" }) {
  const map = {
    garnet: { bg: C.garnetSoft, fg: C.garnet },
    gold: { bg: C.goldSoft, fg: C.gold },
    green: { bg: C.greenSoft, fg: C.green },
    muted: { bg: "rgba(166,150,141,0.12)", fg: C.muted },
  };
  const s = map[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.fg, fontFamily: "'JetBrains Mono', monospace" }}
    >
      {children}
    </span>
  );
}

function BloodBadge({ type, selected, onClick, size = "md" }) {
  const dims = size === "lg" ? "w-16 h-16 text-lg" : "w-12 h-12 text-sm";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${dims} rounded-full flex items-center justify-center font-bold transition-all`}
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        background: selected ? C.garnet : C.surfaceRaised,
        color: selected ? C.paper : C.muted,
        border: `1.5px solid ${selected ? C.garnet : C.line}`,
        boxShadow: selected ? `0 0 0 4px ${C.garnetSoft}` : "none",
      }}
    >
      {type}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span
        className="block text-xs font-semibold mb-1.5 uppercase tracking-wide"
        style={{ color: C.faint, fontFamily: "'JetBrains Mono', monospace" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: C.surfaceRaised,
  color: C.paper,
  border: `1px solid ${C.line}`,
};
const inputClass =
  "w-full px-3.5 py-2.5 rounded-lg outline-none text-sm focus:ring-2 transition-shadow";

function Btn({ children, onClick, variant = "primary", type = "button", full, disabled, icon: Icon }) {
  const styles = {
    primary: { background: C.garnet, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: C.paper, border: `1px solid ${C.line}` },
    gold: { background: C.gold, color: "#231506", border: "none" },
    subtle: { background: C.surfaceRaised, color: C.paper, border: `1px solid ${C.line}` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-transform active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${full ? "w-full" : ""}`}
      style={styles[variant]}
    >
      {Icon && <Icon size={16} strokeWidth={2.4} />}
      {children}
    </button>
  );
}

function whatsappLink(phone, text) {
  const clean = (phone || "").replace(/[^\d+]/g, "");
  return `https://wa.me/${clean.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}

/* ---------- traduções (PT / EN) ---------- */
const TR = {
  pt: {
    nav_feed: "Pedidos",
    nav_search: "Procurar",
    nav_donor: "Ser doador",
    nav_publish: "Publicar pedido",
    nav_login: "Entrar",
    nav_logout: "Sair",
    hero_eyebrow_default: "Cada pedido aqui é uma vida real à espera de ajuda. Trate este espaço com amor, empatia e verdade",
    hero_title_1: "Cada doação de sangue é uma oportunidade de salvar uma vida.",
    hero_title_2: "A próxima pode depender de você.",
    hero_stat_note: "Angola precisa de mais de",
    hero_stat_note_end: "doadores voluntários de sangue, mas atualmente conta com menos de metade desse número. A sua próxima doação pode salvar a vida de alguém que você ama.",
    stat_open: "Pedidos abertos",
    stat_critical: "Críticos agora",
    stat_donors: "Doadores em Angola",
    stat_provinces: "Províncias",
    footer_text: "Mainga 2026 é um projeto comunitário, desenvolvido para conectar pessoas que necessitam de sangue a doadores voluntários.",
    footer_about: "sobre",
    footer_privacy: "privacidade",
    footer_terms: "termos",
    footer_admin: "painel administrador",
    auth_login_title: "Entre com o seu email para continuar.",
    auth_email_label: "Email",
    auth_send_code: "Enviar código",
    auth_sending: "A enviar…",
    auth_signin: "Entrar",
    auth_signup: "Criar conta",
    auth_google: "Continuar com Google",
    auth_or: "ou",
    auth_code_label: "Código de 6 dígitos",
    auth_verifying: "A verificar…",
    auth_other_email: "Usar outro email",
    procurar_title: "Procurar doadores",
    procurar_subtitle: "Filtra por grupo sanguíneo e localização para encontrar quem está disponível e já pode doar.",
    loading: "A carregar…",
    howit_title: "Como funciona, em 3 passos",
    howit_1_t: "Regista-te",
    howit_1_d: "Grupo sanguíneo, contacto e província, em menos de 2 minutos.",
    howit_2_t: "Encontra ou publica",
    howit_2_d: "Procura um doador compatível, ou publica um pedido urgente.",
    howit_3_t: "Contacto directo",
    howit_3_d: "Fala directamente com quem precisa ou pode ajudar, sem intermediários.",
  },
  en: {
    nav_feed: "Requests",
    nav_search: "Search",
    nav_donor: "Become a donor",
    nav_publish: "Post a request",
    nav_login: "Log in",
    nav_logout: "Log out",
    hero_eyebrow_default: "Every request here is a real life waiting for help. Treat this space with love, empathy and honesty",
    hero_title_1: "Every blood donation is a chance to save a life.",
    hero_title_2: "The next one could depend on you.",
    hero_stat_note: "Angola needs more than",
    hero_stat_note_end: "voluntary blood donors, but currently has less than half that number. Your next donation could save the life of someone you love.",
    stat_open: "Open requests",
    stat_critical: "Critical now",
    stat_donors: "Donors in Angola",
    stat_provinces: "Provinces",
    footer_text: "Mainga 2026 is a community project, built to connect people who need blood with voluntary donors.",
    footer_about: "about",
    footer_privacy: "privacy",
    footer_terms: "terms",
    footer_admin: "admin panel",
    auth_login_title: "Sign in with your email to continue.",
    auth_email_label: "Email",
    auth_send_code: "Send code",
    auth_sending: "Sending…",
    auth_signin: "Sign in",
    auth_signup: "Create account",
    auth_google: "Continue with Google",
    auth_or: "or",
    auth_code_label: "6-digit code",
    auth_verifying: "Verifying…",
    auth_other_email: "Use another email",
    procurar_title: "Find donors",
    procurar_subtitle: "Filter by blood type and location to find who is available and eligible to donate.",
    loading: "Loading…",
    howit_title: "How it works, in 3 steps",
    howit_1_t: "Register",
    howit_1_d: "Blood type, contact and province, in under 2 minutes.",
    howit_2_t: "Find or post",
    howit_2_d: "Search for a compatible donor, or post an urgent request.",
    howit_3_t: "Direct contact",
    howit_3_d: "Speak directly with whoever needs or can help, no middlemen.",
  },
};
function t(lang, key) {
  return TR[lang]?.[key] ?? TR.pt[key] ?? key;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "agora mesmo";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

/* pequeno "apito" de dois tons, sem precisar de nenhum ficheiro de áudio */
function playCompatibleBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.15);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    /* Web Audio indisponível. Sem problema, o aviso visual continua a aparecer */
  }
}

/* ---------- main app ---------- */
function MaingaApp() {
  const [session, setSession] = useState(null); // { token, user }
  const [authStep, setAuthStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [view, setView] = useState(() => {
    // permite abrir directamente em /privacidade, /termos ou /sobre (ex: a partir de um link partilhado,
    // ou exigido pelo ecrã de consentimento do Google OAuth)
    try {
      const path = window.location.pathname.replace(/\/$/, "");
      if (["/privacidade", "/termos", "/sobre"].includes(path)) return path.slice(1);
    } catch { /* sem problema, usa o valor por defeito */ }
    return "feed";
  });
  const [donors, setDonors] = useState([]);
  const [requests, setRequests] = useState([]);
  const [verifiedRequesters, setVerifiedRequesters] = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [checkingSession, setCheckingSession] = useState(true);
  const knownRequestIds = useRef(null);
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("mainga_lang") || "pt"; } catch { return "pt"; }
  });
  useEffect(() => {
    try { localStorage.setItem("mainga_lang", lang); } catch { /* indisponível, sem problema */ }
  }, [lang]);
  const [userRole, setUserRole] = useState(() => {
    try { return localStorage.getItem("mainga_role") || null; } catch { return null; }
  });
  const chooseRole = (role) => {
    setUserRole(role);
    try { localStorage.setItem("mainga_role", role); } catch { /* indisponível, sem problema */ }
    setView(role === "doador" ? "registar" : "publicar");
  };
  const myBloodTypeRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 3500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    window.scrollTo?.({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    if (!window.location.hash || !window.location.hash.includes("access_token")) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken) return;
    (async () => {
      try {
        const user = await authApi.getUser(accessToken);
        const newSession = { token: accessToken, refreshToken, user };
        setSession(newSession);
        persistSession(newSession);
        showToast("Sessão iniciada a partir do link do email.");
      } catch (err) {
        showToast(`Erro ao confirmar login: ${err.message}`, "garnet");
      } finally {
        window.history.replaceState(null, "", window.location.pathname);
      }
    })();
  }, []);

  // ao abrir a app, tenta restaurar uma sessão guardada no telemóvel
  useEffect(() => {
    const saved = loadPersistedSession();
    if (!saved?.token) { setCheckingSession(false); return; }
    (async () => {
      try {
        const user = await authApi.getUser(saved.token);
        setSession({ ...saved, user });
      } catch {
        // token expirado, tenta renovar com o refresh token, se houver
        if (!saved.refreshToken) { clearPersistedSession(); return; }
        try {
          const data = await authApi.refreshToken(saved.refreshToken);
          const newSession = { token: data.access_token, refreshToken: data.refresh_token, user: data.user };
          setSession(newSession);
          persistSession(newSession);
        } catch {
          clearPersistedSession();
        }
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  const showToast = useCallback((msg, tone = "green") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    const handleError = (e) => {
      const msg = e?.reason?.message || e?.error?.message || e?.message || "erro desconhecido";
      showToast(`Erro técnico: ${msg}`, "garnet");
      console.error("Mainga error:", e);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleError);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleError);
    };
  }, [showToast]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [donorRows, requestRows, verifiedRows] = await Promise.all([
        api.donors.list(session?.token),
        api.requests.list(session?.token),
        api.verifiedRequesters.list(session?.token).catch(() => []),
      ]);
      const mappedRequests = (requestRows || []).map(requestFromRow);

      if (silent && knownRequestIds.current && myBloodTypeRef.current) {
        const compatibleTypesForMe = BLOOD_TYPES.filter((t) => compatibleDonorTypes(t).includes(myBloodTypeRef.current));
        const newCompatible = mappedRequests.find(
          (r) =>
            !knownRequestIds.current.has(r.id) &&
            r.status === "aberto" &&
            r.approved &&
            compatibleTypesForMe.includes(r.bloodType)
        );
        if (newCompatible) {
          playCompatibleBeep();
          showToast(`🩸 Novo pedido de ${newCompatible.bloodType} compatível consigo, em ${newCompatible.city}!`, "gold");
        }
      }
      knownRequestIds.current = new Set(mappedRequests.map((r) => r.id));

      setDonors((donorRows || []).map(donorFromRow));
      setRequests(mappedRequests);
      const vMap = {};
      (verifiedRows || []).forEach((v) => { vMap[v.user_id] = v.institution_name; });
      setVerifiedRequesters(vMap);
    } catch (err) {
      if (!silent) showToast(`Erro ao carregar dados: ${err.message}`, "garnet");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [session, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // mantém o endereço do browser a par das páginas legais, para poderem ser partilhadas/abertas directamente
  useEffect(() => {
    try {
      const legalPaths = { privacidade: "/privacidade", termos: "/termos", sobre: "/sobre" };
      const desired = legalPaths[view] || "/";
      if (window.location.pathname !== desired) {
        window.history.replaceState(null, "", desired);
      }
    } catch { /* sem problema */ }
  }, [view]);

  // actualiza sozinho a cada 25s, sem mostrar o ecrã "A carregar..." outra vez
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadData(true);
    }, 25000);
    return () => clearInterval(t);
  }, [loadData]);

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    api.admins.check(session.token, session.user.id).then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [session]);

  const [authMode, setAuthMode] = useState("entrar"); // "entrar" | "registar"
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  const signInWithGoogle = () => {
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
  };

  const signInWithFacebook = () => {
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=facebook&redirect_to=${redirectTo}`;
  };

  const sendCode = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      await authApi.sendCode(email, authMode === "registar");
      setAuthStep("code");
    } catch (err) {
      const msg = /not found|does not exist|invalid/i.test(err.message)
        ? "Não encontrámos nenhuma conta com este email. Experimente \"Criar conta\" em vez de \"Entrar\"."
        : err.message;
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const verifyCode = async () => {
    setAuthLoading(true);
    setAuthError("");
    const primaryType = authMode === "registar" ? "signup" : "magiclink";
    try {
      let data;
      try {
        data = await authApi.verifyCode(email, code, primaryType);
      } catch (firstErr) {
        // versões diferentes do Supabase esperam tipos diferentes, tenta o tipo unificado como recurso
        data = await authApi.verifyCode(email, code, "email");
      }
      const newSession = { token: data.access_token, refreshToken: data.refresh_token, user: data.user };
      setSession(newSession);
      persistSession(newSession);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setSession(null);
    clearPersistedSession();
    setDonors([]);
    setRequests([]);
    setView("feed");
    setEmail("");
    setCode("");
    setAuthStep("email");
  };

  const myDonor = useMemo(
    () => donors.find((d) => d.userId === session?.user?.id) || null,
    [donors, session]
  );

  useEffect(() => {
    myBloodTypeRef.current = myDonor?.bloodType || null;
  }, [myDonor]);

  const addDonor = async (donor) => {
    try {
      const [row] = await api.donors.insert(session.token, donorToRow(donor, session.user.id));
      setDonors((prev) => [donorFromRow(row), ...prev]);
      showToast("Registo guardado. Obrigado por estar pronto a doar.");
    } catch (err) {
      showToast(`Erro ao registar: ${err.message}`, "garnet");
    }
  };

  const deleteDonor = async (id) => {
    try {
      await api.donors.remove(session.token, id);
      setDonors((prev) => prev.filter((d) => d.id !== id));
      showToast("Registo apagado.");
    } catch (err) {
      showToast(`Erro ao apagar: ${err.message}`, "garnet");
    }
  };

  const addRequest = async (req) => {
    const phone = normalizePhone(req.contactPhone);
    const recentCount = requests.filter(
      (r) => normalizePhone(r.contactPhone) === phone && Date.now() - r.createdAt < RATE_LIMIT_WINDOW_MS
    ).length;
    if (phone && recentCount >= RATE_LIMIT_MAX) {
      showToast(
        `Este número já publicou ${recentCount} pedidos nas últimas 24h. Espera um pouco ou contacta-nos se for um caso real e urgente.`,
        "garnet"
      );
      return null;
    }
    try {
      const [row] = await api.requests.insert(session.token, requestToRow(req, session.user.id));
      const record = requestFromRow(row);
      setRequests((prev) => [record, ...prev]);
      return record;
    } catch (err) {
      const msg = err.message?.includes("Limite") ? err.message : `Erro ao publicar: ${err.message}`;
      showToast(msg, "garnet");
      return null;
    }
  };

  const closeRequest = async (id) => {
    try {
      await api.requests.close(session.token, id);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "resolvido" } : r)));
      showToast("Pedido marcado como resolvido. Obrigado.");
    } catch (err) {
      showToast(`Erro: ${err.message}`, "garnet");
    }
  };

  const reportRequest = async (id) => {
    if (!session) { showToast("Entre com o seu email para sinalizar um pedido.", "gold"); return; }
    try {
      await api.reports.insert(session.token, id, session.user.id);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, reportCount: (r.reportCount || 0) + 1 } : r)));
      showToast("Obrigado. Vamos rever este pedido.", "gold");
    } catch (err) {
      showToast(`Erro: ${err.message}`, "garnet");
    }
  };

  const deleteRequestAdmin = async (id) => {
    try {
      await api.requests.remove(session.token, id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      showToast("Pedido apagado.");
    } catch (err) {
      showToast(`Erro: ${err.message}`, "garnet");
    }
  };

  const approveRequest = async (id) => {
    try {
      await api.requests.approve(session.token, id);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, approved: true } : r)));
      showToast("Pedido aprovado. Já está visível no feed.");
    } catch (err) {
      showToast(`Erro: ${err.message}`, "garnet");
    }
  };

  const addVerifiedRequester = async (userId, institutionName) => {
    try {
      await api.verifiedRequesters.add(session.token, userId, institutionName);
      setVerifiedRequesters((prev) => ({ ...prev, [userId]: institutionName }));
      showToast("Instituição marcada como verificada.");
    } catch (err) {
      showToast(`Erro: ${err.message}`, "garnet");
    }
  };

  const revealContact = async (donorId) => {
    if (!session) {
      showToast("Entre com o seu email para revelar o contacto.", "gold");
      return null;
    }
    try {
      const rows = await api.revealContact(session.token, donorId);
      return rows && rows[0];
    } catch (err) {
      showToast(err.message, "garnet");
      return null;
    }
  };

  const enablePushNotifications = async () => {
    if (!session || !myDonor) {
      showToast("Registe-se primeiro como doador para activar avisos.", "gold");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      showToast("O seu navegador não suporta notificações push.", "garnet");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        showToast("Precisa de aceitar a permissão de notificações para activar os avisos.", "gold");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const json = subscription.toJSON();
      await api.pushSubscriptions.upsert(session.token, {
        user_id: session.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth_key: json.keys.auth,
        blood_type: myDonor.bloodType,
        province: myDonor.province,
      });
      showToast("Notificações activadas. Vai receber um aviso mesmo com a app fechada.");
    } catch (err) {
      showToast(`Não foi possível activar: ${err.message}`, "garnet");
    }
  };

  const stats = useMemo(() => {
    const openApproved = requests.filter((r) => r.status === "aberto" && r.approved);
    const localDonors = donors.filter((d) => !d.diaspora);
    const diasporaCount = donors.length - localDonors.length;
    const byProvince = {};
    localDonors.forEach((d) => {
      if (d.province) byProvince[d.province] = (byProvince[d.province] || 0) + 1;
    });
    return {
      totalDonors: localDonors.length,
      diasporaCount,
      openRequests: openApproved.length,
      criticalOpen: openApproved.filter((r) => r.urgency === "critica").length,
      byProvince,
    };
  }, [donors, requests]);

  const sharedStyle = (
    <style>{`
      ${FONT_IMPORT}
      @keyframes pulseDraw {
        0% { stroke-dashoffset: 1; opacity: .3; }
        45% { stroke-dashoffset: 0; opacity: 1; }
        55% { stroke-dashoffset: 0; opacity: 1; }
        100% { stroke-dashoffset: -1; opacity: .3; }
      }
      @keyframes pulseDot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.6); opacity: 0.4; }
      }
      @keyframes fadeUp { from { opacity:0; transform:translateY(6px);} to {opacity:1; transform:translateY(0);} }
      .fadeUp { animation: fadeUp .35s ease both; }
      ::selection { background: ${C.garnet}; color: #fff; }
      input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 3px ${C.garnetSoft}; border-color: ${C.garnet}; }
    `}</style>
  );

  const renderAuthForm = (message) => (
    <div className="fadeUp max-w-sm mx-auto px-2 py-10">
      <div className="rounded-2xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.line}`, boxShadow: "0 8px 30px rgba(0,0,0,0.45)" }}>
        <div className="relative" style={{ height: 100 }}>
          <img
            src={HERO_PHOTOS[0].url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "blur(3px) brightness(0.55)" }}
          />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(20,16,13,0.25), rgba(20,16,13,0.96))" }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.paper }}>
              Mainga <span style={{ fontSize: "0.7em" }} aria-hidden="true">🇦🇴</span>
            </span>
            <div className="mt-1.5"><PulseLine w={100} /></div>
          </div>
        </div>

        <div className="px-6 py-7 text-center">
          <p className="text-sm mb-7" style={{ color: C.muted }}>
            {message || t(lang, "auth_login_title")}
          </p>

          {authStep === "email" ? (
            <>
              <button
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg font-semibold text-sm mb-5 transition-transform active:scale-[0.98]"
                style={{ background: "#fff", color: "#1F1F1F" }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"/>
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"/>
                </svg>
                {t(lang, "auth_google")}
              </button>

              <button
                onClick={signInWithFacebook}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg font-semibold text-sm mb-5 transition-transform active:scale-[0.98]"
                style={{ background: "#1877F2", color: "#fff" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                  <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.23 10.44 22v-7.03H7.9v-2.91h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22C18.34 21.23 22 17.08 22 12.06Z"/>
                </svg>
                Continuar com Facebook
              </button>

              {!showEmailFallback ? (
                <button
                  onClick={() => setShowEmailFallback(true)}
                  className="w-full text-center text-sm font-semibold py-2"
                  style={{ color: C.muted }}
                >
                  Não tem Google? <span style={{ color: C.gold }}>Entrar com email</span>
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-5 mt-2">
                    <div style={{ flex: 1, height: 1, background: C.line }} />
                    <span className="text-xs" style={{ color: C.faint }}>{t(lang, "auth_or")}</span>
                    <div style={{ flex: 1, height: 1, background: C.line }} />
                  </div>

                  <div className="flex gap-2 mb-5 justify-center">
                    <button
                      onClick={() => setAuthMode("entrar")}
                      className="px-4 py-1.5 rounded-full text-sm font-semibold"
                      style={{ background: authMode === "entrar" ? C.garnetSoft : "transparent", color: authMode === "entrar" ? C.garnet : C.muted, border: `1px solid ${authMode === "entrar" ? C.garnet : C.line}` }}
                    >
                      {t(lang, "auth_signin")}
                    </button>
                    <button
                      onClick={() => setAuthMode("registar")}
                      className="px-4 py-1.5 rounded-full text-sm font-semibold"
                      style={{ background: authMode === "registar" ? C.garnetSoft : "transparent", color: authMode === "registar" ? C.garnet : C.muted, border: `1px solid ${authMode === "registar" ? C.garnet : C.line}` }}
                    >
                      {t(lang, "auth_signup")}
                    </button>
                  </div>
                  <Field label={t(lang, "auth_email_label")}>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} style={inputStyle} placeholder="oseu@email.com" />
                  </Field>
                  {authError && <p className="text-xs mb-3" style={{ color: C.garnet }}>{authError}</p>}
                  <Btn full onClick={sendCode} disabled={authLoading || !email}>
                    {authLoading ? t(lang, "auth_sending") : t(lang, "auth_send_code")}
                  </Btn>
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-xs mb-4" style={{ color: C.muted }}>
                Mandámos um código de 6 dígitos para <strong style={{ color: C.paper }}>{email}</strong>.
              </p>
              <Field label={t(lang, "auth_code_label")}>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} style={{ ...inputStyle, textAlign: "center", letterSpacing: "0.3em", fontFamily: "'JetBrains Mono', monospace" }} placeholder="000000" />
              </Field>
              {authError && <p className="text-xs mb-3" style={{ color: C.garnet }}>{authError}</p>}
              <Btn full onClick={verifyCode} disabled={authLoading || code.length !== 6}>
                {authLoading ? t(lang, "auth_verifying") : t(lang, "auth_signin")}
              </Btn>
              <button onClick={() => { setAuthStep("email"); setCode(""); setAuthError(""); }} className="text-xs mt-3" style={{ color: C.faint }}>
                {t(lang, "auth_other_email")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-full" style={{ background: C.bg, fontFamily: "'Inter', sans-serif", color: C.paper }}>
      {sharedStyle}

      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
        style={{
          background: C.bg,
          opacity: (showSplash || checkingSession) ? 1 : 0,
          pointerEvents: (showSplash || checkingSession) ? "auto" : "none",
          transition: "opacity 0.6s ease",
        }}
      >
        <span
          className="text-3xl font-extrabold tracking-tight mb-3"
          style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}
        >
          Mainga <span style={{ fontSize: "0.7em" }} aria-hidden="true">🇦🇴</span>
        </span>
        <p className="text-base max-w-xs" style={{ color: C.paper }}>
          Uma única doação de sangue pode ser a diferença entre a vida e a morte de alguém. Doe. Salve vidas.
        </p>
        <div className="mt-6"><PulseLine w={140} /></div>
      </div>

      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: "rgba(20,16,13,0.92)", borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button onClick={() => setView("feed")} className="flex items-center gap-2 text-xl font-extrabold tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}>
              Mainga <span style={{ fontSize: "0.85rem" }} aria-hidden="true">🇦🇴</span>
            </button>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {[
              ["feed", t(lang, "nav_feed"), Siren],
              ["procurar", t(lang, "nav_search"), Search],
              ["registar", t(lang, "nav_donor"), UserPlus],
              ["publicar", t(lang, "nav_publish"), Radio],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
                style={{ background: view === id ? C.garnetSoft : "transparent", color: view === id ? C.garnet : C.muted }}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <button
              onClick={() => (session ? logout() : setView("entrar"))}
              className="text-xs px-2 font-semibold"
              style={{ color: session ? C.faint : C.garnet }}
            >
              {session ? t(lang, "nav_logout") : t(lang, "nav_login")}
            </button>
            <div className="flex items-center gap-0.5 ml-1 pl-2" style={{ borderLeft: `1px solid ${C.line}` }}>
              <button
                onClick={() => setLang("pt")}
                className="text-xs px-1.5 py-1 rounded font-bold"
                style={{ color: lang === "pt" ? C.paper : C.faint }}
              >
                PT
              </button>
              <button
                onClick={() => setLang("en")}
                className="text-xs px-1.5 py-1 rounded font-bold"
                style={{ color: lang === "en" ? C.paper : C.faint }}
              >
                EN
              </button>
            </div>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        {loading ? (
          <div className="py-24 flex flex-col items-center gap-3" style={{ color: C.muted }}>
            <div style={{ animation: "pulseDot 1.2s ease-in-out infinite" }}>
              <PulseLine w={80} />
            </div>
            <span className="text-sm">{t(lang, "loading")}</span>
          </div>
        ) : !userRole && view === "feed" ? (
          <div className="fadeUp max-w-md mx-auto text-center py-16">
            <span className="text-2xl font-extrabold tracking-tight block mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}>
              Bem-vindo à Mainga
            </span>
            <p className="text-sm mb-8" style={{ color: C.muted }}>
              Para lhe mostrar o caminho certo logo de início, diga-nos porque está aqui.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => chooseRole("doador")}
                className="rounded-xl p-5 text-left transition-transform active:scale-[0.98]"
                style={{ background: C.surface, border: `1px solid ${C.line}` }}
              >
                <div className="flex items-center gap-3">
                  <Droplet size={22} color={C.garnet} />
                  <div>
                    <div className="font-bold text-sm" style={{ color: C.paper }}>Sou doador / quero doar</div>
                    <div className="text-xs mt-0.5" style={{ color: C.faint }}>Regista-te e aparece para quem precisar do teu grupo sanguíneo</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => chooseRole("pesquisador")}
                className="rounded-xl p-5 text-left transition-transform active:scale-[0.98]"
                style={{ background: C.surface, border: `1px solid ${C.line}` }}
              >
                <div className="flex items-center gap-3">
                  <Search size={22} color={C.gold} />
                  <div>
                    <div className="font-bold text-sm" style={{ color: C.paper }}>Preciso de sangue / procuro um doador</div>
                    <div className="text-xs mt-0.5" style={{ color: C.faint }}>Procura doadores compatíveis ou publica um pedido urgente</div>
                  </div>
                </div>
              </button>
            </div>
            <button
              onClick={() => {
                setUserRole("pesquisador");
                try { localStorage.setItem("mainga_role", "pesquisador"); } catch {}
                setView("feed");
              }}
              className="text-xs mt-6"
              style={{ color: C.faint }}
            >
              Só quero ver os pedidos, sem escolher agora →
            </button>
          </div>
        ) : (
          <>
            {view === "feed" && (
              <Feed
                requests={requests}
                donors={donors}
                stats={stats}
                currentUserId={session?.user?.id}
                myBloodType={myDonor?.bloodType}
                verifiedRequesters={verifiedRequesters}
                onCloseRequest={closeRequest}
                onReportRequest={reportRequest}
                goPublicar={() => setView("publicar")}
                lang={lang}
              />
            )}
            {view === "procurar" && <Procurar donors={donors} onReveal={revealContact} lang={lang} />}
            {view === "entrar" && renderAuthForm("Entre com o seu email para continuar.")}
            {view === "registar" && (
              session
                ? <Registar onSubmit={addDonor} existing={myDonor} onDelete={deleteDonor} onEnablePush={enablePushNotifications} showToast={showToast} />
                : renderAuthForm("Entre com o seu email para se registar como doador.")
            )}
            {view === "publicar" && (
              session
                ? <Publicar donors={donors} onSubmit={addRequest} onDone={() => setView("feed")} showToast={showToast} />
                : renderAuthForm("Entre com o seu email para publicar um pedido.")
            )}
            {view === "admin" && (
              session
                ? (
                  <Admin
                    isAdmin={isAdmin}
                    donors={donors}
                    requests={requests}
                    verifiedRequesters={verifiedRequesters}
                    onDeleteDonor={deleteDonor}
                    onDeleteRequest={deleteRequestAdmin}
                    onApproveRequest={approveRequest}
                    onAddVerifiedRequester={addVerifiedRequester}
                  />
                )
                : renderAuthForm("Entre com o seu email para aceder ao painel administrador.")
            )}
            {(view === "sobre" || view === "privacidade" || view === "termos") && (
              <Legal page={view} onNavigate={setView} />
            )}
          </>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-xs" style={{ color: C.faint }}>
        {t(lang, "footer_text")}
        <div className="mt-3 flex items-center gap-3 flex-wrap font-mono" style={{ color: C.line }}>
          <button onClick={() => setView("sobre")} style={{ color: C.line }} className="underline">
            {t(lang, "footer_about")}
          </button>
          <button onClick={() => setView("privacidade")} style={{ color: C.line }} className="underline">
            {t(lang, "footer_privacy")}
          </button>
          <button onClick={() => setView("termos")} style={{ color: C.line }} className="underline">
            {t(lang, "footer_terms")}
          </button>
          <button onClick={() => setView("admin")} style={{ color: C.line }} className="underline">
            {t(lang, "footer_admin")}
          </button>
          <button onClick={() => { setUserRole(null); try { localStorage.removeItem("mainga_role"); } catch {} setView("feed"); }} style={{ color: C.line }} className="underline">
            mudar o que procuro
          </button>
        </div>
      </footer>

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg fadeUp flex items-center gap-2 max-w-[90vw]"
          style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, color: C.paper }}
        >
          {toast.tone === "garnet" ? (
            <ShieldAlert size={15} color={C.garnet} />
          ) : (
            <Check size={15} color={toast.tone === "gold" ? C.gold : C.green} />
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ---------- FEED ---------- */
const HERO_PHOTOS = [
  { url: "https://images.unsplash.com/photo-1514416205405-075ab2f15964?w=1200&q=80&auto=format&fit=crop", caption: "Cuidado médico, todos os dias" },
  { url: "https://images.unsplash.com/photo-1536064479547-7ee40b74b807?w=1200&q=80&auto=format&fit=crop", caption: "Cada doação começa com uma decisão simples" },
  { url: "https://images.unsplash.com/photo-1678695972687-033fa0bdbac9?w=1200&q=80&auto=format&fit=crop", caption: "Profissionais de saúde ao seu lado" },
  { url: "https://images.unsplash.com/photo-1605602517387-ec78b947335e?w=1200&q=80&auto=format&fit=crop", caption: "Um gesto que liga pessoas" },
  { url: "https://images.unsplash.com/photo-1590611936760-eeb9bc598548?w=1200&q=80&auto=format&fit=crop", caption: "O momento da doação" },
  { url: "https://images.unsplash.com/photo-1691139601099-932c01ec198b?w=1200&q=80&auto=format&fit=crop", caption: "Uma equipa pronta para ajudar" },
  { url: "https://images.unsplash.com/photo-1676286051346-ce6773753c72?w=1200&q=80&auto=format&fit=crop", caption: "Cuidado que começa desde cedo" },
  { url: "https://images.unsplash.com/photo-1643297654416-05795d62e39c?w=1200&q=80&auto=format&fit=crop", caption: "Dedicados à sua saúde" },
  { url: "https://images.unsplash.com/photo-1666887360921-85952a86894f?w=1200&q=80&auto=format&fit=crop", caption: "Ao seu lado, sempre" },
  { url: "https://images.unsplash.com/photo-1672655412906-8e10ba6ee373?w=1200&q=80&auto=format&fit=crop", caption: "Compromisso com quem cuida" },
  { url: "https://images.unsplash.com/photo-1576669801945-7a346954da5a?w=1200&q=80&auto=format&fit=crop", caption: "Uma conversa, uma vida ajudada" },
];

function HeroPhotoBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % HERO_PHOTOS.length), 4500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden mb-6" style={{ height: 180, background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
      {HERO_PHOTOS.map((photo, i) => (
        <img
          key={photo.url}
          src={photo.url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: i === index ? 1 : 0, transition: "opacity 1s ease" }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, rgba(20,16,13,0.92), rgba(20,16,13,0.15) 60%)" }}
      />
      <div className="absolute bottom-0 left-0 right-0 p-4 flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: C.paper }}>{HERO_PHOTOS[index].caption}</p>
        <div className="flex gap-1.5">
          {HERO_PHOTOS.map((_, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: i === index ? C.gold : "rgba(255,255,255,0.3)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Feed({ requests, donors, stats, currentUserId, myBloodType, verifiedRequesters, onCloseRequest, onReportRequest, goPublicar, lang }) {
  const [filterProvince, setFilterProvince] = useState("Todas");
  const open = requests.filter((r) => r.status === "aberto" && r.approved);
  const URGENCY_ORDER = { critica: 0, alta: 1, moderada: 2 };
  const shown = open
    .filter((r) => filterProvince === "Todas" || r.province === filterProvince)
    .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || b.createdAt - a.createdAt);
  const pendingMine = requests.filter((r) => r.status === "aberto" && !r.approved && r.requesterUserId === currentUserId);

  return (
    <div className="fadeUp">
      {/* hero */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3" style={{ color: C.gold }}>
          <Activity size={16} />
          {stats.openRequests > 0 ? (
            <span className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {stats.openRequests} pedido{stats.openRequests > 1 ? "s" : ""} de sangue em aberto agora
            </span>
          ) : (
            <span className="text-xs italic" style={{ fontFamily: "'Inter', sans-serif" }}>
              {t(lang, "hero_eyebrow_default")}
            </span>
          )}
        </div>
        <h1
          className="text-3xl sm:text-4xl font-extrabold leading-tight mb-2"
          style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
        >
          {t(lang, "hero_title_1")}{" "}
          <span style={{ color: C.garnet }}>{t(lang, "hero_title_2")}</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: C.muted }}>
          {t(lang, "hero_stat_note")} <strong style={{ color: C.paper }}>360 {lang === "en" ? "thousand voluntary blood donors" : "mil doadores voluntários de sangue"}</strong>,
          {" "}{t(lang, "hero_stat_note_end")}
        </p>
        <div className="mt-4"><PulseLine w={160} /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: C.garnetSoft, color: C.garnet }}>1</span>
            <span className="text-sm font-bold" style={{ color: C.paper }}>{t(lang, "howit_1_t")}</span>
          </div>
          <p className="text-xs" style={{ color: C.muted }}>{t(lang, "howit_1_d")}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: C.garnetSoft, color: C.garnet }}>2</span>
            <span className="text-sm font-bold" style={{ color: C.paper }}>{t(lang, "howit_2_t")}</span>
          </div>
          <p className="text-xs" style={{ color: C.muted }}>{t(lang, "howit_2_d")}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: C.garnetSoft, color: C.garnet }}>3</span>
            <span className="text-sm font-bold" style={{ color: C.paper }}>{t(lang, "howit_3_t")}</span>
          </div>
          <p className="text-xs" style={{ color: C.muted }}>{t(lang, "howit_3_d")}</p>
        </div>
      </div>

      <HeroPhotoBanner />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        <StatCard label={t(lang, "stat_open")} value={stats.openRequests} tone="garnet" />
        {stats.criticalOpen > 0 && <StatCard label={t(lang, "stat_critical")} value={stats.criticalOpen} tone="gold" pulse />}
        <StatCard label={t(lang, "stat_donors")} value={stats.totalDonors} tone="green" />
        <StatCard label={t(lang, "stat_provinces")} value={Object.keys(stats.byProvince).length} tone="gold" />
      </div>
      <p className="text-xs mb-6" style={{ color: C.faint, minHeight: "1em" }}>
        {stats.diasporaCount > 0
          ? `+ ${stats.diasporaCount} apoiante${stats.diasporaCount > 1 ? "s" : ""} na diáspora a ajudar a espalhar os pedidos`
          : ""}
      </p>

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <select
          value={filterProvince}
          onChange={(e) => setFilterProvince(e.target.value)}
          className={inputClass}
          style={{ ...inputStyle, width: "auto" }}
        >
          <option>Todas</option>
          {PROVINCES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <Btn variant="gold" icon={Radio} onClick={goPublicar}>
          Publicar pedido urgente
        </Btn>
      </div>

      {pendingMine.length > 0 && (
        <div className="mb-4 rounded-lg p-3 text-xs" style={{ background: C.goldSoft, color: C.gold }}>
          Tem {pendingMine.length} pedido{pendingMine.length > 1 ? "s" : ""} à espera de aprovação de um
          administrador antes de aparecer aqui para todos.
        </div>
      )}

      {shown.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl"
          style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px dashed ${C.line}`, color: C.muted }}
        >
          <p className="mb-1">Sem pedidos aqui neste momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              donors={donors}
              isOwner={r.requesterUserId === currentUserId}
              verifiedInstitution={verifiedRequesters?.[r.requesterUserId]}
              myBloodType={myBloodType}
              onClose={() => onCloseRequest(r.id)}
              onReport={() => onReportRequest(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone, pulse }) {
  const colors = { garnet: C.garnet, green: C.green, gold: C.gold };
  return (
    <div className="rounded-xl p-4 relative overflow-hidden" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${pulse ? C.gold : C.line}` }}>
      {pulse && (
        <span
          className="absolute top-3 right-3 w-2 h-2 rounded-full"
          style={{ background: C.gold, animation: "pulseDot 1.4s ease-in-out infinite" }}
        />
      )}
      <div
        className="text-2xl font-extrabold"
        style={{ color: colors[tone], fontFamily: "'JetBrains Mono', monospace" }}
      >
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: C.muted }}>{label}</div>
    </div>
  );
}

function RequestCard({ r, donors, isOwner, verifiedInstitution, myBloodType, onClose, onReport }) {
  const [reported, setReported] = useState(false);

  const compatibleTypes = compatibleDonorTypes(r.bloodType);
  const matches = donors.filter(
    (d) => compatibleTypes.includes(d.bloodType) && d.province === r.province && d.available && donorIsEligible(d)
  );
  const urgencyTone = r.urgency === "critica" ? "garnet" : r.urgency === "alta" ? "gold" : "muted";
  const shareText = `🩸 Pedido urgente de sangue (${r.bloodType}) em ${r.city}, ${r.province}. ${r.units} unidade(s) necessária(s) em ${r.place}. Contacto: ${r.contactPhone}. Partilha se puderes ajudar. Mainga`;
  const flagged = (r.reportCount || 0) >= 3;
  const isCompatibleForMe = myBloodType && compatibleTypes.includes(myBloodType);

  const flag = () => {
    if (reported) return;
    onReport();
    setReported(true);
  };

  return (
    <div
      className="rounded-xl p-4 sm:p-5 fadeUp"
      style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${flagged ? C.gold : isCompatibleForMe ? C.garnet : C.line}` }}
    >
      {flagged && (
        <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold" style={{ color: C.gold }}>
          <ShieldAlert size={13} /> Sinalizado pela comunidade. Em verificação
        </div>
      )}
      {isCompatibleForMe && !flagged && (
        <div className="flex items-center gap-1.5 mb-3 text-xs font-bold" style={{ color: C.garnet }}>
          <Droplet size={13} fill={C.garnet} /> O seu tipo sanguíneo é compatível com este pedido
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center font-bold shrink-0"
            style={{
              background: C.garnetSoft,
              color: C.garnet,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "1.05rem",
            }}
          >
            {r.bloodType}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                {r.place}
              </span>
              {verifiedInstitution && (
                <span title={`Instituição verificada: ${verifiedInstitution}`}>
                  <Badge tone="green">
                    <Check size={10} /> Verificado
                  </Badge>
                </span>
              )}
              <Badge tone={urgencyTone}>
                {r.urgency === "critica" ? "Crítica" : r.urgency === "alta" ? "Alta" : "Moderada"}
              </Badge>
              <span className="scale-90 origin-left"><PulseLine w={40} /></span>
            </div>
            <div className="text-xs flex items-center gap-1 mb-1" style={{ color: C.muted }}>
              <MapPin size={12} /> {r.city}, {r.province} · {timeAgo(r.createdAt)}
            </div>
            <div className="text-sm" style={{ color: C.paper }}>
              {r.units} unidade{r.units > 1 ? "s" : ""} necessária{r.units > 1 ? "s" : ""}
              {r.notes ? `. ${r.notes}` : ""}
            </div>
            <div className="text-xs mt-1.5" style={{ color: C.green }}>
              {matches.length} doador{matches.length !== 1 ? "es" : ""} compatíve{matches.length !== 1 ? "is" : ""} na província
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap justify-end">
            <a href={`tel:${r.contactPhone}`} title="Ligar directamente">
              <Btn variant="subtle" icon={Phone}>Ligar</Btn>
            </a>
            <a href={whatsappLink(r.contactPhone, `Olá! Vi o pedido de ${r.bloodType} para ${r.place} na Mainga. Sou compatível e quero ajudar.`)} target="_blank" rel="noopener noreferrer">
              <Btn variant="gold" icon={MessageCircle}>Contactar</Btn>
            </a>
            <button
              type="button"
              onClick={flag}
              title="Sinalizar como suspeito"
              aria-label="Sinalizar este pedido como suspeito"
              className="p-2.5 rounded-lg transition-colors"
              style={{
                border: `1px solid ${C.line}`,
                color: reported ? C.gold : C.muted,
                background: "transparent",
              }}
            >
              <Flag size={15} strokeWidth={2.4} fill={reported ? C.gold : "none"} />
            </button>
            {isOwner && (
              <Btn variant="ghost" icon={Check} onClick={onClose}>Resolvido</Btn>
            )}
          </div>
          <a href={whatsappLink("", shareText)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold" style={{ color: C.faint }}>
            ou partilhar com mais alguém →
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------- PROCURAR ---------- */
/* coordenadas aproximadas (capital de cada província) */
const PROVINCE_COORDS = {
  "Luanda": [-8.8368, 13.2343],
  "Bengo": [-8.6015, 13.6763],
  "Icolo e Bengo": [-9.2739, 13.6811],
  "Cuanza Norte": [-9.2975, 14.9144],
  "Cuanza Sul": [-11.2061, 13.8437],
  "Malanje": [-9.5402, 16.3410],
  "Lunda Norte": [-7.3961, 20.8322],
  "Lunda Sul": [-9.6647, 20.3911],
  "Benguela": [-12.5763, 13.4055],
  "Huambo": [-12.7761, 15.7392],
  "Bié": [-12.3833, 16.9333],
  "Moxico": [-11.7833, 19.9167],
  "Moxico Leste": [-11.5000, 22.5000],
  "Cuando": [-15.5000, 20.0000],
  "Cuando Cubango": [-14.6585, 17.6910],
  "Namibe": [-15.1961, 12.1522],
  "Huíla": [-14.9177, 13.4925],
  "Cunene": [-17.0672, 15.7278],
  "Cabinda": [-5.5500, 12.2000],
  "Zaire": [-6.2686, 14.2494],
  "Uíge": [-7.6087, 15.0611],
};

/* encontra a província mais próxima de uma coordenada (distância em linha recta) */
function findNearestProvince(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const [prov, [plat, plng]] of Object.entries(PROVINCE_COORDS)) {
    const d = Math.hypot(lat - plat, lng - plng);
    if (d < bestDist) {
      bestDist = d;
      best = prov;
    }
  }
  return best;
}

/* botão "usar a minha localização actual", tal como nas apps de táxi */
function UseMyLocationButton({ onFound, showToast }) {
  const [loading, setLoading] = useState(false);
  const handleClick = () => {
    if (!navigator.geolocation) {
      showToast?.("O seu navegador não suporta localização.", "garnet");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const prov = findNearestProvince(pos.coords.latitude, pos.coords.longitude);
        setLoading(false);
        if (prov) {
          onFound(prov);
          showToast?.(`Localização detectada: ${prov}`);
        } else {
          showToast?.("Não foi possível determinar a província.", "garnet");
        }
      },
      () => {
        setLoading(false);
        showToast?.("Não foi possível aceder à localização. Verifique as permissões.", "garnet");
      }
    );
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="text-xs font-semibold flex items-center gap-1.5 mb-3"
      style={{ color: C.gold }}
    >
      <MapPin size={13} />
      {loading ? "A localizar…" : "Usar a minha localização actual?"}
    </button>
  );
}

/* um hospital de referência por província. Nomes confirmados onde encontrados
   (Wikipedia: "List of hospitals in Angola"); o resto usa um nome genérico
   provincial até termos confirmação oficial do Ministério da Saúde */
/* lista de hospitais: vários por província onde há confirmação real (Wikipedia:
   "List of hospitals in Angola" / "Healthcare in Angola"); pequeno desvio de
   coordenadas para não sobrepor marcadores na mesma cidade */
const HOSPITALS = [
  { name: "Hospital Municipal Do Ambriz", province: "Bengo", municipio: "Administração Municipal Do Ambriz" },
  { name: "Hospital Municipal Do Bula Atumba", province: "Bengo", municipio: "Administração Municipal Do Bula Atumba" },
  { name: "Hospital Municipal Do Caxito", province: "Bengo", municipio: "Administração Municipal Do Dande" },
  { name: "Hospital Municipal Do Dande", province: "Bengo", municipio: "Administração Municipal Do Dande" },
  { name: "Hospital Municipal Do Muxaluando", province: "Bengo", municipio: "Administração Municipal Do Muxaluando" },
  { name: "Hospital Municipal Do Pango Aluquém", province: "Bengo", municipio: "Administração Municipal Do Pango Aluquém" },
  { name: "Hospital Regional Do Quibaxe", province: "Bengo", municipio: "Administração Municipal Do Quibaxe" },
  { name: "Hospital Geral Da Barra Do Dande", province: "Bengo", municipio: "Hospital Geral Da Barra Do Dande" },
  { name: "Hospital Geral Do Bengo Reverendo Guilherme Pereira Inglês", province: "Bengo", municipio: "Hospital Geral Do Bengo «Reverendo Guilherme Pereira Inglês»" },
  { name: "Hospital Geral Do Bula Atumba", province: "Bengo", municipio: "Hospital Geral Do Bula Atumba" },
  { name: "Hospital Provincial Do Bengo", province: "Bengo", municipio: "Hospital Provincial Do Bengo" },
  { name: "Hospital Municipal Da Baía Farta", province: "Benguela", municipio: "Administração Municipal Da Baía Farta" },
  { name: "Hospital Da Catumbela", province: "Benguela", municipio: "Administração Municipal Da Catumbela" },
  { name: "Hospital Municipal Da Catumbela", province: "Benguela", municipio: "Administração Municipal Da Catumbela" },
  { name: "Hospital Municipal Da Ganda", province: "Benguela", municipio: "Administração Municipal Da Ganda" },
  { name: "Hospital Municipal Cdte Jika Cme", province: "Benguela", municipio: "Administração Municipal De Benguela" },
  { name: "Hospital Municipal De Benguela", province: "Benguela", municipio: "Administração Municipal De Benguela" },
  { name: "Hospital Municipal Do Balombo", province: "Benguela", municipio: "Administração Municipal Do Balombo" },
  { name: "Hospital Municipal Do Bocoio", province: "Benguela", municipio: "Administração Municipal Do Bocoio" },
  { name: "Hospital Municipal Do Caimbambo", province: "Benguela", municipio: "Administração Municipal Do Caimbambo" },
  { name: "Hospital Municipal Do Chongorói", province: "Benguela", municipio: "Administração Municipal Do Chongorói" },
  { name: "Hospital Municipal Do Cubal", province: "Benguela", municipio: "Administração Municipal Do Cubal" },
  { name: "Hospital Municipal Missionario Do Cubal", province: "Benguela", municipio: "Administração Municipal Do Cubal" },
  { name: "Hospital Central Do Dombe Grande", province: "Benguela", municipio: "Administração Municipal Do Dombe Grande" },
  { name: "Hospital Municipal Do Lobito Cme", province: "Benguela", municipio: "Administração Municipal Do Lobito" },
  { name: "Hospital Pediátrico De Benguela", province: "Benguela", municipio: "Hospital Provincial De Benguela" },
  { name: "Hospital Provincial De Benguela", province: "Benguela", municipio: "Hospital Provincial De Benguela" },
  { name: "Hospital Municipal Do Lobito-Maternidade", province: "Benguela", municipio: "Hospital Regional Do Lobito" },
  { name: "Hospital Pediátrico Do Lobito", province: "Benguela", municipio: "Hospital Regional Do Lobito" },
  { name: "Hospital Regional Do Lobito", province: "Benguela", municipio: "Hospital Regional Do Lobito" },
  { name: "Hospital Do Andulo", province: "Bié", municipio: "Administração Municipal Do Andulo" },
  { name: "Hospital Do Chicumbi", province: "Bié", municipio: "Administração Municipal Do Andulo" },
  { name: "Hospital Do Chilesso", province: "Bié", municipio: "Administração Municipal Do Andulo" },
  { name: "Hospital Municipal De Camacupa", province: "Bié", municipio: "Administração Municipal Do Camacupa" },
  { name: "Hospital De Chissamba", province: "Bié", municipio: "Administração Municipal Do Catabola" },
  { name: "Hospital Municipal Do Catabola", province: "Bié", municipio: "Administração Municipal Do Catabola" },
  { name: "Hospital Municipal Do Chinguar", province: "Bié", municipio: "Administração Municipal Do Chinguar" },
  { name: "Hospital Municipal De Chitembo", province: "Bié", municipio: "Administração Municipal Do Chitembo" },
  { name: "Hospital Regional Do Cuemba", province: "Bié", municipio: "Administração Municipal Do Cuemba" },
  { name: "Hospital De Camundongo", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Hospital Municipal Do Cuito", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Hospital Sanatório Do Cuito", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Hospital Municipal Do Cunhinga", province: "Bié", municipio: "Administração Municipal Do Cunhinga" },
  { name: "Hospital Sanatório Do Cunhinga", province: "Bié", municipio: "Administração Municipal Do Cunhinga" },
  { name: "Hospital De Catota", province: "Bié", municipio: "Administração Municipal Do Mumbué" },
  { name: "Hospital Municipal De Nharêa", province: "Bié", municipio: "Administração Municipal Do Nharêa" },
  { name: "Hospital Regional Mártires Do Cuito", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Hospital Provincial Do Bié", province: "Bié", municipio: "Hospital Provincial Do Bié" },
  { name: "Hospital Regional Do Belize", province: "Cabinda", municipio: "Administração Municipal De Belize" },
  { name: "Hospital Municipal De Buco Zau", province: "Cabinda", municipio: "Administração Municipal De Buco Zau" },
  { name: "Hospital Regional Norte De Buco Zau", province: "Cabinda", municipio: "Administração Municipal De Buco Zau" },
  { name: "Hospital Municipal De Cacongo", province: "Cabinda", municipio: "Administração Municipal Do Cacongo" },
  { name: "Hospital Municipal Do Chinga Cabinda", province: "Cabinda", municipio: "Administração Municipal Do Liambo" },
  { name: "Hospital Central De Cabinda", province: "Cabinda", municipio: "Hospital Central De Cabinda (H.C.C)" },
  { name: "Hospital Provincial De Cabinda", province: "Cabinda", municipio: "Hospital Provincial De Cabinda" },
  { name: "Hospital De Santa Catarina Cabinda", province: "Cabinda", municipio: "Hospital Santa Catarina" },
  { name: "Hospital Primeiro De Maio/Cabinda", province: "Cabinda", municipio: "Maternidade Provincial De Cabinda" },
  { name: "Hospital Municipal De Dirico", province: "Cuando", municipio: "Administração Municipal De Dirico" },
  { name: "Hospital Municipal De Mavinga", province: "Cuando", municipio: "Administração Municipal De Mavinga" },
  { name: "Hospital Do Cuito-Cuanaval/C.Cubango", province: "Cuando Cubango", municipio: "Cuito Cuanavale" },
  { name: "Hospital Municipal Do Rivungo", province: "Cuando", municipio: "Administração Municipal Do Rivungo" },
  { name: "Hospital Materno-Infantil Do Samba Cajú", province: "Cuanza Norte", municipio: "Administração Municipal De Samba Cajú" },
  { name: "Hospital Municipal De Samba Cajú", province: "Cuanza Norte", municipio: "Administração Municipal De Samba Cajú" },
  { name: "Hospital Municipal Do Ambaca", province: "Cuanza Norte", municipio: "Administração Municipal Do Ambaca" },
  { name: "Hospital Provincial De Camabatela", province: "Cuanza Norte", municipio: "Administração Municipal Do Ambaca" },
  { name: "Hospital Municipal Do Dondo", province: "Cuanza Norte", municipio: "Administração Municipal Do Cambambe" },
  { name: "Hospital Municipal Do Cazengo", province: "Cuanza Norte", municipio: "Administração Municipal Do Cazengo" },
  { name: "Hospital Municipal De Golungo Alto", province: "Cuanza Norte", municipio: "Administração Municipal Do Golungo Alto" },
  { name: "Hospital Municipal Materno-Infantil Do Golungo Alto", province: "Cuanza Norte", municipio: "Administração Municipal Do Golungo Alto" },
  { name: "Hospital Municipal Do Lucala", province: "Cuanza Norte", municipio: "Administração Municipal Do Lucala" },
  { name: "Hospital Municipal Materno-Infantil Do Lucala", province: "Cuanza Norte", municipio: "Administração Municipal Do Lucala" },
  { name: "Hospital Municipal Do Ngonguembo", province: "Cuanza Norte", municipio: "Administração Municipal Do Ngonguembo" },
  { name: "Hospital Regional Do Quiculungo", province: "Cuanza Norte", municipio: "Administração Municipal Do Quiculungo" },
  { name: "Hospital Materno Infantil Do Cuanza Norte", province: "Cuanza Norte", municipio: "Governo Provincial Do Cuanza-Norte" },
  { name: "Hospital Geral Do Cuanza-Norte «Mário Coelho Pinto De Andrade»", province: "Cuanza Norte", municipio: "Hospital Geral Do Cuanza-Norte «Mário Coelho Pinto De Andrade»" },
  { name: "Hospital Provincial Dr.A.Agostinho Neto/Cuanza - Norte", province: "Cuanza Norte", municipio: "Hospital Provincial Do Cuanza-Norte" },
  { name: "Hospital Provincial Sanatório Do Cuanza Norte", province: "Cuanza Norte", municipio: "Hospital Provincial Sanatório Do Cuanza Norte" },
  { name: "Hospital Da Boa Entrada", province: "Cuanza Sul", municipio: "Administração Municipal Da Boa Entrada" },
  { name: "Hospital Da Gabela", province: "Cuanza Sul", municipio: "Administração Municipal Da Gabela" },
  { name: "Hospital De Calulo/C.Sul", province: "Cuanza Sul", municipio: "Administração Municipal De Calulo" },
  { name: "Hospital Municipal Do Cassongue", province: "Cuanza Sul", municipio: "Administração Municipal Do Cassongue" },
  { name: "Hospital Do Conda", province: "Cuanza Sul", municipio: "Administração Municipal Do Conda" },
  { name: "Hospital Municipal Do Ebo", province: "Cuanza Sul", municipio: "Administração Municipal Do Ebo" },
  { name: "Hospital Municipal Do Mussende", province: "Cuanza Sul", municipio: "Administração Municipal Do Mussende" },
  { name: "Hospital Do Porto Amboim", province: "Cuanza Sul", municipio: "Administração Municipal Do Porto Amboim" },
  { name: "Hospital Do Quibala", province: "Cuanza Sul", municipio: "Administração Municipal Do Quibala" },
  { name: "Hospital Municipal Do Quilenda", province: "Cuanza Sul", municipio: "Administração Municipal Do Quilenda" },
  { name: "Hospital Do Seles", province: "Cuanza Sul", municipio: "Administração Municipal Do Seles" },
  { name: "Hospital Municipal Do Sumbe", province: "Cuanza Sul", municipio: "Administração Municipal Do Sumbe" },
  { name: "Hospital Da Cela", province: "Cuanza Sul", municipio: "Administração Municipal Do Waku Kungo" },
  { name: "Hospital Pediátrico Do Cuanza-Sul", province: "Cuanza Sul", municipio: "Governo Provincial Do Cuanza-Sul" },
  { name: "Hospital Geral Do Cuanza-Sul «Comandante Raul Diaz Arguelles»", province: "Cuanza Sul", municipio: "Hospital Geral Do Cuanza-Sul «Comandante Raul Diaz Arguelles»" },
  { name: "Hospital Provincial Do Sumbe/Cuanza - Sul", province: "Cuanza Sul", municipio: "Hospital Provincial Do Cuanza-Sul" },
  { name: "Hospital Municipal De Menongue/Cuando-Cubango", province: "Cuando Cubango", municipio: "Administração Municipal De Menongue" },
  { name: "Hospital Municipal De Nancova/Cubango", province: "Cuando Cubango", municipio: "Administração Municipal De Nancova" },
  { name: "Hospital Municipal Do Calai/C. Cubango", province: "Cuando Cubango", municipio: "Administração Municipal Do Calai" },
  { name: "Hospital Municipal Do Cuangar/C. Cubango", province: "Cuando Cubango", municipio: "Administração Municipal Do Cuangar" },
  { name: "Hospital Municipal Do Cuchi/C.Cubango", province: "Cuando Cubango", municipio: "Administração Municipal Do Cuchi" },
  { name: "Hospital Pediátrico De Menongue", province: "Cuando Cubango", municipio: "Governo Provincial Do Cubango" },
  { name: "Hospital Sanatório De Menongue", province: "Cuando Cubango", municipio: "Governo Provincial Do Cubango" },
  { name: "Hospital Provincial De Menongue/K.Kubango", province: "Cuando Cubango", municipio: "Hospital Provincial Do Cubango" },
  { name: "Hospital Do Cahama", province: "Cunene", municipio: "Administração Municipal Do Cahama" },
  { name: "Hospital Municipal De Cuanhama", province: "Cunene", municipio: "Administração Municipal Do Cuanhama" },
  { name: "Hospital Municipal Do Curoca", province: "Cunene", municipio: "Administração Municipal Do Curoca" },
  { name: "Hospital Municipal Do Cuvelai", province: "Cunene", municipio: "Administração Municipal Do Cuvelai" },
  { name: "Hospital Da Missão Catolica Do Chiulo", province: "Cunene", municipio: "Administração Municipal Do Humbe" },
  { name: "Hospital Municipal Do Namacunde", province: "Cunene", municipio: "Administração Municipal Do Namacunde" },
  { name: "Hospital De Xangongo", province: "Cunene", municipio: "Administração Municipal Do Ombadja" },
  { name: "Hospital Geral Do Cunene «General Simione Mucune»", province: "Cunene", municipio: "Hospital Geral Do Cunene «General Simione Mucune»" },
  { name: "Hospital Provincial De Onjiva/Kunene", province: "Cunene", municipio: "Hospital Provincial Do Cunene" },
  { name: "Complexo Hospitalar De Doenças Cardiopulmonares Cardeal Dom Alexandre Do Nascimento", province: "Luanda", municipio: "Complexo Hospitalar De Doenças Cardiopulmonares Cardeal Dom Alexandre Do Nascimento" },
  { name: "Hospital Militar De Cabinda", province: "Cabinda", municipio: "Cabinda" },
  { name: "Hospital Militar Regional Do Huambo", province: "Huambo", municipio: "Huambo" },
  { name: "Hospital Militar Regional Do Lubango", province: "Huíla", municipio: "Lubango" },
  { name: "Hospital Américo Boavida", province: "Luanda", municipio: "Hospital Americo Boavida" },
  { name: "Hospital De Medicina E Reabilitação Física", province: "Luanda", municipio: "Hospital De Medicina E Reabilitação Física" },
  { name: "Hospital Do Prenda", province: "Luanda", municipio: "Hospital Do Prenda" },
  { name: "Hospital Dr. Walter Strangway", province: "Luanda", municipio: "Hospital Dr. Walter Strangway" },
  { name: "Hospital Geral Especializado Augusto N'Gangula", province: "Luanda", municipio: "Hospital Geral Especializado Augusto Ngangula" },
  { name: "Hospital Josina Machel", province: "Luanda", municipio: "Hospital Josina Machel" },
  { name: "Hospital Materno-Infantil Do Camama «Manuel Pedro Azancot De Menezes».", province: "Luanda", municipio: "Hospital Materno-Infantil Do Camama Manuel Pedro Azancot De Menezes (Hmic)" },
  { name: "Hospital Militar Principal", province: "Luanda", municipio: "Hospital Militar Principal" },
  { name: "Hospital Neves Bendinha", province: "Luanda", municipio: "Hospital Neves Bendinha" },
  { name: "Hospital Pediátrico De Luanda-David Bernardino", province: "Luanda", municipio: "Hospital Pediátrico De Luanda - David Bernardino" },
  { name: "Hospital Psiquiatrico De Luanda", province: "Luanda", municipio: "Hospital Psiquiátrico" },
  { name: "Hospital Municipal De Chicala Choloanga", province: "Huambo", municipio: "Administração Municipal De Chicala Choloanga" },
  { name: "Hospital Municipal Do Alto Hama", province: "Huambo", municipio: "Administração Municipal Do Alto Hama" },
  { name: "Hospital Municipal Do Bailundo", province: "Huambo", municipio: "Administração Municipal Do Bailundo" },
  { name: "Hospital Municipal Da Caála", province: "Huambo", municipio: "Administração Municipal Do Caála" },
  { name: "Hospital Municipal Do Catchiungo", province: "Huambo", municipio: "Administração Municipal Do Cachiungo" },
  { name: "Hospital Municipal Do Chinjenje", province: "Huambo", municipio: "Administração Municipal Do Chinjenje" },
  { name: "Hospital Municipal Do Ecunha", province: "Huambo", municipio: "Administração Municipal Do Ecunha" },
  { name: "Hospital Materno Infantil Da Mineira", province: "Huambo", municipio: "Administração Municipal Do Huambo" },
  { name: "Hospital Municipal Casseque", province: "Huambo", municipio: "Administração Municipal Do Huambo" },
  { name: "Hospital Municipal Do Huambo", province: "Huambo", municipio: "Administração Municipal Do Huambo" },
  { name: "Hospital Municipal De Londuimbali", province: "Huambo", municipio: "Administração Municipal Do Londuimbali" },
  { name: "Hospital Municipal Do Longonjo", province: "Huambo", municipio: "Administração Municipal Do Longonjo" },
  { name: "Hospital Municipal Do Mungo", province: "Huambo", municipio: "Administração Municipal Do Mungo" },
  { name: "Hospital Municipal Do Ucuma", province: "Huambo", municipio: "Administração Municipal Do Ucuma" },
  { name: "Hospital Provincial Do Huambo", province: "Huambo", municipio: "Hospital Provincial Do Huambo" },
  { name: "Hospital Sanatório Do Huambo", province: "Huambo", municipio: "Hospital Sanatório Do Huambo" },
  { name: "Hospital Municipal Da Chibia", province: "Huíla", municipio: "Administração Municipal Da Chibia" },
  { name: "Hospital Municipal Da Humpata", province: "Huíla", municipio: "Administração Municipal Da Humpata" },
  { name: "Hospital Municipal Da Jamba Mineira", province: "Huíla", municipio: "Administração Municipal Da Jamba Mineira" },
  { name: "Hospital Municipal Da Matala", province: "Huíla", municipio: "Administração Municipal Da Matala" },
  { name: "Hospital Municipal Da Palanca", province: "Huíla", municipio: "Administração Municipal Da Palanca" },
  { name: "Hospital Municipal Da Caconda", province: "Huíla", municipio: "Administração Municipal De Caconda" },
  { name: "Hospital Municipal Da Cacula", province: "Huíla", municipio: "Administração Municipal De Cacula" },
  { name: "Hospital Municipal Da Chicomba", province: "Huíla", municipio: "Administração Municipal De Chicomba" },
  { name: "Hospital Municipal Do Chipindo", province: "Huíla", municipio: "Administração Municipal De Chipindo" },
  { name: "Hospital Municipal Do Cuvango", province: "Huíla", municipio: "Administração Municipal De Cuvango" },
  { name: "Hospital Municipal Do Quilengues", province: "Huíla", municipio: "Administração Municipal De Quilengues" },
  { name: "Hospital Municipal De Quipungo", province: "Huíla", municipio: "Administração Municipal De Quipungo" },
  { name: "Hospital De Capelongo", province: "Huíla", municipio: "Administração Municipal Do Capelongo" },
  { name: "Hospital Municipal Dos Gambos", province: "Huíla", municipio: "Administração Municipal Do Gambos" },
  { name: "Hospital Municipal Do Toco", province: "Huíla", municipio: "Administração Municipal Do Hoque" },
  { name: "Hospital Municipal Da Centralidade Da Quilemba", province: "Huíla", municipio: "Administração Municipal Do Lubango" },
  { name: "Hospital Municipal Da Eyva Do Lubango", province: "Huíla", municipio: "Administração Municipal Do Lubango" },
  { name: "Hospital Municipal Da Machiqueira", province: "Huíla", municipio: "Administração Municipal Do Lubango" },
  { name: "Hospital Municipal Do Lubango Maria Olga Chaves", province: "Huíla", municipio: "Administração Municipal Do Lubango" },
  { name: "Hospital Pediátrico Pioneiro Zeca/Huíla", province: "Huíla", municipio: "Governo Provincial Da Huíla" },
  { name: "Hospital Psiquiatrico Da Huíla", province: "Huíla", municipio: "Governo Provincial Da Huíla" },
  { name: "Hospital Sanatório Do Lubango", province: "Huíla", municipio: "Governo Provincial Da Huíla" },
  { name: "Hospital De Kaluquembe/Huíla", province: "Huíla", municipio: "Hospital De Caluquembe" },
  { name: "Hospital Provincial Dr.António A.Neto/Huíla", province: "Huíla", municipio: "Hospital Provincial Da Huíla" },
  { name: "Hospital Municipal De Quiçama", province: "Icolo e Bengo", municipio: "Administração Municipal Da Quiçama" },
  { name: "Hospital Municipal De Catete", province: "Icolo e Bengo", municipio: "Administração Municipal De Catete" },
  { name: "Hospital Municipal De Cacuaco", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Hospital Municipal De Viana", province: "Luanda", municipio: "Administração Municipal De Viana" },
  { name: "Hospital Municipal De Cazenga", province: "Luanda", municipio: "Administração Municipal Do Cazenga" },
  { name: "Hospital Municipal De Sambizanga", province: "Luanda", municipio: "Administração Municipal Do Hoji Ya Henda" },
  { name: "Hospital Municipal De Capalanga-Viana", province: "Luanda", municipio: "Administração Municipal Do Mulenvos" },
  { name: "Hospital Materno Infantil Do Ximbicato", province: "Luanda", municipio: "Administração Municipal Do Talatona" },
  { name: "Hospital Municipal De Talatona", province: "Luanda", municipio: "Administração Municipal Do Talatona" },
  { name: "Hospital Municipal Do Talatona", province: "Luanda", municipio: "Administração Municipal Do Talatona" },
  { name: "Hospital Divina Providência", province: "Luanda", municipio: "Gabinete Provincial De Saúde De Luanda" },
  { name: "Hospital Kilamba Kiaxi", province: "Luanda", municipio: "Hospital Do Kilamba Kiaxi" },
  { name: "Hospital Dos Cajueiros Do Cazenga\Luanda", province: "Luanda", municipio: "Hospital Dos Cajueiros Do Cazenga" },
  { name: "Hospital Dos Queimados «Presidente Julius Nyerere»", province: "Luanda", municipio: "Hospital Dos Queimados «Presidente Julius Nyerere»" },
  { name: "Hospital Geral De Cacuaco Heróis Do Kifangondo", province: "Luanda", municipio: "Hospital Geral De Cacuaco «Heróis Do Kifangondo»" },
  { name: "Hospital Geral De Luanda-Camama", province: "Luanda", municipio: "Hospital Geral De Luanda-Camama" },
  { name: "Hospital Geral De Viana «Bispo Emílio Júlio Miguel De Carvalho»", province: "Luanda", municipio: "Hospital Geral De Viana «Bispo Emílio Júlio Miguel De Carvalho»" },
  { name: "Hospital Pedro Maria Tonha «Pedalé»", province: "Luanda", municipio: "Hospital Pedro Maria Tonha «Pedalé»" },
  { name: "Hospital Municipal Do Cambulo", province: "Lunda Norte", municipio: "Administração Municipal Do Cambulo" },
  { name: "Hospital Sanatório Do Nzage", province: "Lunda Norte", municipio: "Administração Municipal Do Cambulo" },
  { name: "Hospital Municipal Do Caungula", province: "Lunda Norte", municipio: "Administração Municipal Do Caungula" },
  { name: "Hospital Municipal Do Chitato", province: "Lunda Norte", municipio: "Administração Municipal Do Chitato" },
  { name: "Hospital Municipal Do Cuango", province: "Lunda Norte", municipio: "Administração Municipal Do Cuango" },
  { name: "Hospital Municipal Do Cambimbi", province: "Lunda Norte", municipio: "Administração Municipal Do Lucapa" },
  { name: "Hospital Municipal Do Lucapa", province: "Lunda Norte", municipio: "Administração Municipal Do Lucapa" },
  { name: "Hospital Municipal Do Xá Muteba", province: "Lunda Norte", municipio: "Administração Municipal Do Xá Muteba" },
  { name: "Hospital De Calonda/L.Norte", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital De Cassaguidi/L.Norte", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Geral Do Dundo Nova Centralidade", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Municipal De Cafunfo/L.Norte", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Municipal Do Nzagi/L.Norte", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Provincial Materno Infantil Ln", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Sanatório Provincial Da Lunda Norte", province: "Lunda Norte", municipio: "Governo Provincial Da Lunda-Norte" },
  { name: "Hospital Provincial Da Lunda-Norte", province: "Lunda Norte", municipio: "Hospital Provincial Da Lunda-Norte" },
  { name: "Hospital Municipal Do Cacolo", province: "Lunda Sul", municipio: "Administração Municipal Do Cacolo" },
  { name: "Hospital Psiquiátrico Do Saurimo", province: "Lunda Sul", municipio: "Administração Municipal Do Cassengo" },
  { name: "Hospital Municipal Do Dala", province: "Lunda Sul", municipio: "Administração Municipal Do Dala" },
  { name: "Hospital Municipal Do Muconda", province: "Lunda Sul", municipio: "Administração Municipal Do Muconda" },
  { name: "Hospital Municipal Do Saurimo", province: "Lunda Sul", municipio: "Administração Municipal Do Saurimo" },
  { name: "Hospital Pediátrico Da Lunda Sul", province: "Lunda Sul", municipio: "Gabinete Provincial De Saúde Da Lunda Sul" },
  { name: "Hospital Maternidade Provincial Da Lunda Sul", province: "Lunda Sul", municipio: "Hospital Maternidade Provincial Da Lunda Sul" },
  { name: "Hospital Provincial Da Lunda-Sul", province: "Lunda Sul", municipio: "Hospital Provincial Da Lunda-Sul" },
  { name: "Hospital Sanatório Do Saurimo", province: "Lunda Sul", municipio: "Hospital Sanatório Da Lunda-Sul" },
  { name: "Hospital Municipal De Caculama", province: "Malanje", municipio: "Administração Municipal De Caculama" },
  { name: "Hospital Municipal Do Cacuso", province: "Malanje", municipio: "Administração Municipal Do Cacuso" },
  { name: "Hospital Municipal Do Cahombo", province: "Malanje", municipio: "Administração Municipal Do Cahombo" },
  { name: "Hospital Municipal Do Calandula", province: "Malanje", municipio: "Administração Municipal Do Calandula" },
  { name: "Hospital Municipal Do Cambundi Catembo", province: "Malanje", municipio: "Administração Municipal Do Cambundi Catembo" },
  { name: "Hospital Municipal De Cangandala/Malanje", province: "Malanje", municipio: "Administração Municipal Do Cangandala" },
  { name: "Hospital Municipal Do Cangandala", province: "Malanje", municipio: "Administração Municipal Do Cangandala" },
  { name: "Hospital Municipal Do Kiwaba Nzoji", province: "Malanje", municipio: "Administração Municipal Do Kiwaba Nzoji" },
  { name: "Hospital Municipal Do Kunda Dya Baze", province: "Malanje", municipio: "Administração Municipal Do Kunda Dya Baze" },
  { name: "Hospital Municipal Do Luquembo", province: "Malanje", municipio: "Administração Municipal Do Luquembo" },
  { name: "Hospital Municipal Do Marimba", province: "Malanje", municipio: "Administração Municipal Do Marimba" },
  { name: "Hospital Municipal Do Massango", province: "Malanje", municipio: "Administração Municipal Do Massango" },
  { name: "Hospital Municipal Do Quela", province: "Malanje", municipio: "Administração Municipal Do Quela" },
  { name: "Hospital Municipal De Malanje", province: "Malanje", municipio: "Administração Municipal Do Quêssua" },
  { name: "Hospital Municipal Do Quirima", province: "Malanje", municipio: "Administração Municipal Do Quirima" },
  { name: "Hospital Materno Infantil De Malanje", province: "Malanje", municipio: "Governo Provincial De Malanje" },
  { name: "Hospital Provincial De Malanje", province: "Malanje", municipio: "Hospital Provincial De Malanje" },
  { name: "Hospital Provincial Materno Infantil/Malanje", province: "Malanje", municipio: "Hospital Provincial Materno Infantil/Malanje" },
  { name: "Hospital Sanatório De Malanje", province: "Malanje", municipio: "Hospital Sanatório De Malanje" },
  { name: "Hospital Municipal De Camanongue/Moxico", province: "Moxico", municipio: "Administração Municipal De Camanongue" },
  { name: "Hospital Municipal Dos Luchazes Moxico", province: "Moxico", municipio: "Administração Municipal De Cangamba" },
  { name: "Hospital Municipal De Bundas", province: "Moxico", municipio: "Administração Municipal De Lumbala Nguimbo" },
  { name: "Hospital Municipal Do Leua/Moxico", province: "Moxico", municipio: "Administração Municipal Do Léua" },
  { name: "Hospital Municipal Do Moxico", province: "Moxico", municipio: "Administração Municipal Do Luena" },
  { name: "Hospital Geral Do Moxico", province: "Moxico", municipio: "Hospital Geral Do Moxico" },
  { name: "Hospital Municipal De Cameia", province: "Moxico Leste", municipio: "Administração Municipal Da Cameia" },
  { name: "Hospital Municipal Do Cazombo/Moxico Leste", province: "Moxico Leste", municipio: "Administração Municipal Do Cazombo" },
  { name: "Hospital Municipal Do Luacano", province: "Moxico Leste", municipio: "Administração Municipal Do Luacano" },
  { name: "Hospital Municipal Do Luacano/Moxico - Leste", province: "Moxico Leste", municipio: "Administração Municipal Do Luacano" },
  { name: "Hospital Municipal Do Luau/Moxico", province: "Moxico Leste", municipio: "Administração Municipal Do Luau" },
  { name: "Hospital Municipal Da Bibala", province: "Namibe", municipio: "Administração Municipal Da Bibala" },
  { name: "Hospital Municipal Do Camucuio", province: "Namibe", municipio: "Administração Municipal Do Camucuio" },
  { name: "Hospital Municipal De Moçamedes", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Hospital De Sacumar/Namibe", province: "Namibe", municipio: "Administração Municipal Do Sacomar" },
  { name: "Hospital Municipal Do Tômbwa", province: "Namibe", municipio: "Administração Municipal Do Tômbwa" },
  { name: "Hospital Municipal Do Virei", province: "Namibe", municipio: "Administração Municipal Do Virei" },
  { name: "Hospital Provincial Do Namibe", province: "Namibe", municipio: "Hospital Provincial Do Namibe" },
  { name: "Hospital Provincial Materno-Infantil «Liepey»", province: "Namibe", municipio: "Hospital Provincial Materno-Infantil «Liepey»" },
  { name: "Hospital Sanatório Do Namibe", province: "Namibe", municipio: "Hospital Sanatório Do Namibe" },
  { name: "Hospital Materno Infantil Rainha Santa Da Damba", province: "Uíge", municipio: "Administração Municipal Da Damba" },
  { name: "Hospital Municipal Da Damba", province: "Uíge", municipio: "Administração Municipal Da Damba" },
  { name: "Hospital Municipal Dos Buengas", province: "Uíge", municipio: "Administração Municipal Da Nova Esperança" },
  { name: "Hospital Municipal Maquela Do Zombo/Uíge", province: "Uíge", municipio: "Administração Municipal De Maquela Do Zombo" },
  { name: "Hospital Municipal Do Mucaba", province: "Uíge", municipio: "Administração Municipal De Mucaba" },
  { name: "Hospital Municipal Do Quimbele", province: "Uíge", municipio: "Administração Municipal De Quimbele" },
  { name: "Hospital Municipal De Sanza Pombo/Uíge", province: "Uíge", municipio: "Administração Municipal De Sanza Pombo" },
  { name: "Hospital Municipal Do Bembe", province: "Uíge", municipio: "Administração Municipal Do Bembe" },
  { name: "Hospital Municipal Do Bungo", province: "Uíge", municipio: "Administração Municipal Do Bungo" },
  { name: "Hospital Do Negage/Uíge", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Hospital Municipal Do Puri", province: "Uíge", municipio: "Administração Municipal Do Puri" },
  { name: "Hospital Municipal Do Songo", province: "Uíge", municipio: "Administração Municipal Do Songo" },
  { name: "Hospital Do Catapa", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Hospital Municipal Do Uíge", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Hospital Sanatório Do Uíge", province: "Uíge", municipio: "Gabinete Provincial De Saúde Do Uíge" },
  { name: "Hospital Provincial Do Uíge", province: "Uíge", municipio: "Hospital Provincial Do Uíge" },
  { name: "Hospital Municipal De Mbanza Congo", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Hospital Municipal Materno-Infantil De Mbanza Kongo", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Hospital Municipal Do Cuimba", province: "Zaire", municipio: "Administração Municipal Do Cuimba" },
  { name: "Hospital Municipal Do Noqui", province: "Zaire", municipio: "Administração Municipal Do Nóqui" },
  { name: "Hospital Do Nzeto/Zaire", province: "Zaire", municipio: "Administração Municipal Do Nzeto" },
  { name: "Hospital Do Soyo", province: "Zaire", municipio: "Administração Municipal Do Soyo" },
  { name: "Hospital Municipal Do Tomboco", province: "Zaire", municipio: "Administração Municipal Do Tomboco" },
  { name: "Hospital Provincial Do Zaire", province: "Zaire", municipio: "Hospital Provincial Do Zaire" },
  { name: "Centro De Saúde Materno-Infantil Do Chongorói", province: "Benguela", municipio: "Administração Municipal Do Chongorói" },
  { name: "Centro De Saúde Da Chicala", province: "Bié", municipio: "Administração Municipal Do Chicala" },
  { name: "Centro De Saúde Da Centralidade Do Cuíto", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Centro De Saúde Do Catemo", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Centro De Saúde Do Trumba Município Do Cuíto", province: "Bié", municipio: "Administração Municipal Do Cuito" },
  { name: "Centro Materno Infantil De Camacupa/Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro Materno Infantil Do Andulo/Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro Materno Infantil Do Chinguar/Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro Materno Infantil Do Cuito/Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro Materno Infantil Do Cunje/Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro Ortopédico E De Reabilitação Física Do Bié", province: "Bié", municipio: "Governo Provincial Do Bié" },
  { name: "Centro De Saúde De Referência Do Macoco 4 De Fevereiro", province: "Cabinda", municipio: "Administração Municipal De Cabinda" },
  { name: "Centro De Saúde De Massabi", province: "Cabinda", municipio: "Administração Municipal Do Massabi" },
  { name: "Centro Ortopédico De Menongue/C.Cubango", province: "Cuando Cubango", municipio: "Governo Provincial Do Cubango" },
  { name: "Centro De Saúde De Okalwa", province: "Cunene", municipio: "Administração Municipal Do Cafima" },
  { name: "Centro De Saúde De Oshimolo", province: "Cunene", municipio: "Administração Municipal Do Cafima" },
  { name: "Centro De Saúde Do Cavalawa", province: "Cunene", municipio: "Administração Municipal Do Cahama" },
  { name: "Centro De Saúde Do Otchinjau", province: "Cunene", municipio: "Administração Municipal Do Cahama" },
  { name: "Centro De Saúde De Cassueca", province: "Cunene", municipio: "Administração Municipal Do Chissuata" },
  { name: "Centro De Saúde Da Tapela", province: "Cunene", municipio: "Administração Municipal Do Chitado" },
  { name: "Centro De Saúde De Onahumba", province: "Cunene", municipio: "Administração Municipal Do Cuanhama" },
  { name: "Centro De Saúde Da Missão Católica Da Mupa", province: "Cunene", municipio: "Administração Municipal Do Mupa" },
  { name: "Centro De Saúde De Omunda", province: "Cunene", municipio: "Administração Municipal Do Mupa" },
  { name: "Centro De Saúde De Ondobodola", province: "Cunene", municipio: "Administração Municipal Do Naulila" },
  { name: "Centro De Saúde Do Caluheque", province: "Cunene", municipio: "Administração Municipal Do Naulila" },
  { name: "Centro De Saúde De Ohenda", province: "Cunene", municipio: "Administração Municipal Do Nehone" },
  { name: "Centro De Saúde De Omuvandje", province: "Cunene", municipio: "Administração Municipal Do Nehone" },
  { name: "Centro De Saúde Do Evale", province: "Cunene", municipio: "Administração Municipal Do Nehone" },
  { name: "Centro Especializado De Tratamento De Endemias E Pandemias", province: "Luanda", municipio: "Centro Especializado De Tratamento De Endemias E Pandemias (Cetep)" },
  { name: "Centro De Saúde De Referencia Da Matala", province: "Huíla", municipio: "Administração Municipal Da Matala" },
  { name: "Centro De Saúde Da Hupa", province: "Huíla", municipio: "Administração Municipal De Cacula" },
  { name: "Centro De Saúde Do Tchicuaqueia", province: "Huíla", municipio: "Administração Municipal De Cacula" },
  { name: "Centro De Saúde Do Impulo", province: "Huíla", municipio: "Administração Municipal De Quilengues" },
  { name: "Centro De Saúde Do Mulondo", province: "Huíla", municipio: "Administração Municipal Do Capelongo" },
  { name: "Centro De Saúde Da Quihita", province: "Huíla", municipio: "Administração Municipal Do Capunda Cavilongo" },
  { name: "Centro De Saúde Do Tchituto", province: "Huíla", municipio: "Administração Municipal Do Chituto" },
  { name: "Centro De Saúde Do Viti Vivali", province: "Huíla", municipio: "Administração Municipal Do Viti Vivali" },
  { name: "Centro Ortopédico Do Lubango", province: "Huíla", municipio: "Governo Provincial Da Huíla" },
  { name: "Centro De Diagnóstico 4 De Fevereiro", province: "Luanda", municipio: "Administração Municipal Da Ingombota" },
  { name: "Centro De Saúde Do Cassequel", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde Do Catambor", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde Do Nível I Alegria", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde Do Prenda", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde Do Rocha Pinto", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde Preventório Infantil", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro Materno Infantil Catinton", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro Ortopédico Neves Bendinha", province: "Luanda", municipio: "Administração Municipal Da Maianga" },
  { name: "Centro De Saúde De Referência Do Ramiro", province: "Luanda", municipio: "Administração Municipal De Belas" },
  { name: "Centro De Saúde Da Cerâmica", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Centro De Saúde De Barra Do Bengo", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Centro De Saúde De Mulenvos De Baixo", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Centro De Saúde De Referencia De Cacuaco", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Centro De Saúde De Referencia Do Kicolo", province: "Luanda", municipio: "Administração Municipal De Cacuaco" },
  { name: "Centro De Saúde De Referencia Do Chimbicado", province: "Luanda", municipio: "Administração Municipal Do Camama" },
  { name: "Centro Materno Infantil Do Caxinde", province: "Lunda Norte", municipio: "Administração Municipal Do Dundo" },
  { name: "Centro De Saúde De Tratamento De Tuberculose E Lepra", province: "Moxico", municipio: "Administração Municipal De Lumbala Nguimbo" },
  { name: "Centro De Saúde De Referência De Lutembo", province: "Moxico", municipio: "Administração Municipal De Lutembo" },
  { name: "Centro De Saúde De Referência Do Luvei", province: "Moxico", municipio: "Administração Municipal De Lutembo" },
  { name: "Centro De Saude Do Tempué", province: "Moxico", municipio: "Administração Municipal Do Alto Cuito" },
  { name: "Centro De Saúde Da Nhacalunda", province: "Moxico Leste", municipio: "Administração Municipal Da Cameia" },
  { name: "Centro De Saúde De Chiesso", province: "Moxico Leste", municipio: "Administração Municipal Da Cameia" },
  { name: "Centro De Saúde De Chivinda", province: "Moxico Leste", municipio: "Administração Municipal Da Cameia" },
  { name: "Centro De Saúde De Sacuaha", province: "Moxico Leste", municipio: "Administração Municipal Da Cameia" },
  { name: "Centro De Saúde Eduardo Gomes", province: "Namibe", municipio: "Administração Municipal Da Bibala" },
  { name: "Centro De Saúde Gabriel Tchipanguela Kapangombe", province: "Namibe", municipio: "Administração Municipal Da Bibala" },
  { name: "Centro De Saúde José Tchombe", province: "Namibe", municipio: "Administração Municipal Da Bibala" },
  { name: "Centro De Saúde 5 De Abril I", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde 5 De Abril Ii", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Aristides Sombreiro", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Do Forte Santa Rita", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Do Valódia I", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Do Valódia Ii", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Eucaliptos", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Praia Amélia", province: "Namibe", municipio: "Administração Municipal Do Moçâmedes" },
  { name: "Centro De Saúde Da Zona Sul", province: "Namibe", municipio: "Administração Municipal Do Tômbwa" },
  { name: "Centro De Saúde De Referência Felisberto João Agostinho", province: "Namibe", municipio: "Administração Municipal Do Tômbwa" },
  { name: "Centro De Saúde Do Coroca", province: "Namibe", municipio: "Administração Municipal Do Tômbwa" },
  { name: "Centro De Saúde De Referência Inácio Paquete - Cainde", province: "Namibe", municipio: "Administração Municipal Do Virei" },
  { name: "Centro De Saúde De Referência De Lucunga", province: "Uíge", municipio: "Administração Municipal Do Lucunga" },
  { name: "Centro De Saúde Do Bamba Matamba", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Cabala", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Cangundo", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Cawa-Feira", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Dimuca", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Longe Zeca", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Mbanza Negage", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Pumba", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Quindinga", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Quisseque", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde Do Quituia", province: "Uíge", municipio: "Administração Municipal Do Negage" },
  { name: "Centro De Saúde De Referência Da Centralidade Do Quilumosso", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Calumbo", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Candombe Novo", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Casseche", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Catula", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Culo", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Kamacoco", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Kilala", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Paco Benz", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Quiongua", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Tange", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde Do Bairro Pedreira", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde Do Quica", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde Madalena José Mário Cano", province: "Uíge", municipio: "Administração Municipal Do Uíge" },
  { name: "Centro De Saúde De Referência Do Kaluka", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde De Referência Do Madimba", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde De Referência Do Nkalambata", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde De Referência Do Nkiende", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde Integrado", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde Kianganga", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde Mbanza Mbamba", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
  { name: "Centro De Saúde Mbumbuzi", province: "Zaire", municipio: "Administração Municipal De Mbanza Kongo" },
];

const MUNICIPIOS_BY_PROVINCE = {
  "Bengo": ["Ambriz", "Bula Atumba", "Dande", "Dembos", "Muxaluando", "Nambuangongo", "Pango Aluquém", "Quibaxe"],
  "Benguela": ["Balombo", "Baía Farta", "Benguela", "Bocoio", "Caimbambo", "Catumbela", "Chongorói", "Cubal", "Dombe Grande", "Ganda", "Lobito"],
  "Bié": ["Andulo", "Camacupa", "Catabola", "Chicala", "Chinguar", "Chitembo", "Cuemba", "Cuito", "Cunhinga", "Cuíto", "Mumbué", "Nharea", "Nharêa"],
  "Cabinda": ["Belize", "Buco Zau", "Buco-Zau", "Cabinda", "Cacongo", "Liambo", "Massabi"],
  "Cuando": ["Cuito Cuanavale", "Dirico", "Mavinga", "Rivungo"],
  "Cuando Cubango": ["Calai", "Cuangar", "Cuchi", "Cuito Cuanavale", "Menongue", "Nancova"],
  "Cuanza Norte": ["Ambaca", "Banga", "Bolongongo", "Cambambe", "Cazengo", "Golungo Alto", "Gonguembo", "Lucala", "Ngonguembo", "Quiculungo", "Samba Caju", "Samba Cajú"],
  "Cuanza Sul": ["Amboim", "Boa Entrada", "Calulo", "Cassongue", "Cela", "Conda", "Ebo", "Gabela", "Libolo", "Mussende", "Porto Amboim", "Quibala", "Quilenda", "Seles", "Sumbe", "Waku Kungo"],
  "Cunene": ["Cafima", "Cahama", "Chissuata", "Chitado", "Cuanhama", "Curoca", "Cuvelai", "Humbe", "Mupa", "Namacunde", "Naulila", "Nehone", "Ombadja"],
  "Huambo": ["Alto Hama", "Bailundo", "Cachiungo", "Caála", "Chicala Choloanga", "Chicala-Choloanga", "Chinjenje", "Ecunha", "Huambo", "Londuimbali", "Longonjo", "Mungo", "Ucuma"],
  "Huíla": ["Caconda", "Cacula", "Caluquembe", "Capelongo", "Capunda Cavilongo", "Chiange", "Chibia", "Chicomba", "Chipindo", "Chituto", "Cuvango", "Gambos", "Hoque", "Humpata", "Jamba", "Jamba Mineira", "Lubango", "Matala", "Palanca", "Quilengues", "Quipungo", "Viti Vivali"],
  "Icolo e Bengo": ["Bom Jesus", "Cabiri", "Cabo Ledo", "Calumbo", "Catete", "Quiçama", "Sequele"],
  "Luanda": ["Belas", "Cacuaco", "Camama", "Cazenga", "Hoji-ya-Henda", "Ingombota", "Kilamba", "Kilamba Kiaxi", "Maianga", "Mulenvos", "Mussulo", "Rangel", "Samba", "Sambizanga", "Talatona", "Viana"],
  "Lunda Norte": ["Cambulo", "Capenda-Camulemba", "Caungula", "Chitato", "Cuango", "Cuílo", "Dundo", "Lubalo", "Lucapa", "Lóvua", "Xá Muteba", "Xá-Muteba"],
  "Lunda Sul": ["Cacolo", "Cassengo", "Dala", "Muconda", "Saurimo"],
  "Malanje": ["Caculama", "Cacuso", "Cahombo", "Calandula", "Cambundi Catembo", "Cambundi-Catembo", "Cangandala", "Caombo", "Cuaba Nzoji", "Cunda-Dia-Baze", "Kiwaba Nzoji", "Kunda Dya Baze", "Luquembo", "Malanje", "Marimba", "Massango", "Mucari", "Quela", "Quirima", "Quêssua"],
  "Moxico": ["Alto Cuito", "Camanongue", "Cangamba", "Luena", "Lumbala Nguimbo", "Lutembo", "Léua"],
  "Moxico Leste": ["Cameia", "Cazombo", "Luacano", "Luau"],
  "Namibe": ["Bibala", "Camucuio", "Moçâmedes", "Sacomar", "Tômbua", "Tômbwa", "Virei"],
  "Uíge": ["Alto Cauale", "Ambuíla", "Bembe", "Buengas", "Bungo", "Damba", "Lucunga", "Maquela Do Zombo", "Milunga", "Mucaba", "Negage", "Nova Esperança", "Puri", "Quimbele", "Quitexe", "Sanza Pombo", "Songo", "Uíge", "Zombo"],
  "Zaire": ["Cuimba", "Mabanza Congo", "Mbanza Kongo", "Nezeto", "Nzeto", "Nóqui", "Soio", "Soyo", "Tomboco"],
};

function AngolaMap({ selected, onSelect, donors }) {
  const mapEl = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const hospitalMarkers = useRef([]);

  useEffect(() => {
    if (mapObj.current || !mapEl.current) return;
    mapObj.current = L.map(mapEl.current, { center: [-12.3, 17.5], zoom: 5, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 18,
    }).addTo(mapObj.current);
    setTimeout(() => mapObj.current?.invalidateSize(), 200);
    return () => { mapObj.current?.remove(); mapObj.current = null; };
  }, []);

  useEffect(() => {
    if (!mapObj.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    Object.entries(PROVINCE_COORDS).forEach(([prov, coords]) => {
      const count = donors.filter((d) => d.province === prov && d.available).length;
      const isSelected = selected === prov;
      const marker = L.circleMarker(coords, {
        radius: isSelected ? 11 : count > 0 ? 8 : 6,
        color: isSelected ? "#fff" : "rgba(255,255,255,0.55)",
        weight: isSelected ? 2 : 1,
        fillColor: isSelected ? C.garnet : count > 0 ? C.gold : "#6b6b6b",
        fillOpacity: 0.9,
      }).addTo(mapObj.current);
      marker.bindTooltip(`${prov}${count > 0 ? ` · ${count} doador${count > 1 ? "es" : ""}` : ""}`, { direction: "top", opacity: 0.95 });
      marker.on("click", () => onSelect(isSelected ? "Todas" : prov));
      markers.current.push(marker);
    });
  }, [selected, donors]);

  // hospitais de referência: um marcador por hospital, distribuído em espiral
  // à volta do centro da província (padrão "girassol", mais compacto e uniforme
  // que um desvio aleatório, mesmo com dezenas de hospitais na mesma província)
  useEffect(() => {
    if (!mapObj.current) return;
    hospitalMarkers.current.forEach((m) => m.remove());
    hospitalMarkers.current = [];
    const hospitalIcon = L.divIcon({
      className: "",
      html: `<div style="width:11px;height:11px;border-radius:3px;background:#3B82C4;border:1.5px solid #fff;"></div>`,
      iconSize: [11, 11],
      iconAnchor: [5, 5],
    });
    const GOLDEN_ANGLE = 2.399963229728653;
    const seenPerProvince = {};
    HOSPITALS.forEach((h) => {
      const base = PROVINCE_COORDS[h.province];
      if (!base) return;
      const n = seenPerProvince[h.province] || 0;
      seenPerProvince[h.province] = n + 1;
      const angle = n * GOLDEN_ANGLE;
      const radius = 0.02 * Math.sqrt(n);
      const offset = [base[0] + Math.cos(angle) * radius, base[1] + Math.sin(angle) * radius];
      const marker = L.marker(offset, { icon: hospitalIcon }).addTo(mapObj.current);
      marker.bindTooltip(`🏥 ${h.name}`, { direction: "top", opacity: 0.95 });
      hospitalMarkers.current.push(marker);
    });
  }, []);


  const locateMe = () => {
    if (!navigator.geolocation || !mapObj.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => mapObj.current.setView([pos.coords.latitude, pos.coords.longitude], 8),
      () => {}
    );
  };

  return (
    <div className="rounded-xl overflow-hidden mb-4 relative" style={{ border: `1px solid ${C.line}` }}>
      <div ref={mapEl} style={{ height: 320, width: "100%", background: "#1a1a1a" }} />
      <button
        onClick={locateMe}
        className="absolute top-3 right-3 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1"
        style={{ background: C.surface, color: C.paper, border: `1px solid ${C.line}`, zIndex: 1000 }}
      >
        <MapPin size={12} /> Perto de mim
      </button>
      <div className="px-3 py-2 flex items-center gap-4 text-xs" style={{ background: C.surface, color: C.muted, borderTop: `1px solid ${C.line}` }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: C.gold }} /> Doadores disponíveis
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block" style={{ width: 9, height: 9, background: "#3B82C4", borderRadius: 2 }} /> Hospital de referência
        </span>
      </div>
      <div className="px-3 py-2.5 text-xs flex items-center justify-between" style={{ background: C.surface, color: C.muted }}>
        <span>
          {selected === "Todas" ? "Toque num ponto do mapa para filtrar" : <>Província seleccionada: <strong style={{ color: C.paper }}>{selected}</strong></>}
        </span>
        {selected !== "Todas" && (
          <button onClick={() => onSelect("Todas")} className="font-semibold" style={{ color: C.garnet }}>Limpar</button>
        )}
      </div>
    </div>
  );
}

function Procurar({ donors, onReveal, lang }) {
  const [type, setType] = useState("Todos");
  const [province, setProvince] = useState("Todas");
  const [revealed, setRevealed] = useState({});
  const [revealing, setRevealing] = useState(null);
  const [copied, setCopied] = useState(null);

  const results = donors.filter(
    (d) =>
      (type === "Todos" || d.bloodType === type) &&
      (province === "Todas" || d.province === province) &&
      d.available &&
      donorIsEligible(d)
  );

  const reveal = async (donorId) => {
    setRevealing(donorId);
    try {
      const contact = await onReveal(donorId);
      if (contact) setRevealed((r) => ({ ...r, [donorId]: contact }));
    } catch (err) {
      console.error("reveal error:", err);
    } finally {
      setRevealing(null);
    }
  };

  const copyPhone = async (donorId, phone) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(donorId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard indisponível, sem problema, o número já está visível */
    }
  };

  return (
    <div className="fadeUp">
      <div className="relative rounded-xl overflow-hidden mb-6" style={{ height: 110 }}>
        <img
          src="https://images.unsplash.com/photo-1643297654416-05795d62e39c?w=1200&q=80&auto=format&fit=crop"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "blur(3px) brightness(0.5)" }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(20,16,13,0.95), rgba(20,16,13,0.25))" }} />
        <div className="absolute inset-0 flex flex-col justify-end p-4">
          <h2 className="text-2xl font-extrabold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.paper }}>
            {t(lang, "procurar_title")}
          </h2>
        </div>
      </div>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        {t(lang, "procurar_subtitle")}
      </p>

      <AngolaMap selected={province} onSelect={setProvince} donors={donors} />

      <div className="flex gap-3 mb-6 flex-wrap">
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass} style={{ ...inputStyle, width: "auto" }}>
          <option>Todos</option>
          {BLOOD_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={province} onChange={(e) => setProvince(e.target.value)} className={inputClass} style={{ ...inputStyle, width: "auto" }}>
          <option>Todas</option>
          {PROVINCES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-16 rounded-xl" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px dashed ${C.line}`, color: C.muted }}>
          Ninguém encontrado com estes filtros ainda.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {results.map((d) => {
            const contact = revealed[d.id];
            return (
              <div key={d.id} className="rounded-xl p-4 flex items-center gap-3" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center font-bold shrink-0 text-sm"
                  style={{ background: C.garnetSoft, color: C.garnet, fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {d.bloodType}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{d.name}</div>
                  <div className="text-xs flex items-center gap-1 mb-1" style={{ color: C.muted }}>
                    <MapPin size={11} /> {d.city}, {d.province}
                  </div>
                  {contact ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color: C.paper, fontFamily: "'JetBrains Mono', monospace" }}>
                        {contact.phone}
                      </span>
                      <button
                        onClick={() => copyPhone(d.id, contact.phone)}
                        className="text-xs font-semibold"
                        style={{ color: copied === d.id ? C.green : C.faint }}
                      >
                        {copied === d.id ? "Copiado ✓" : "Copiar"}
                      </button>
                      <a href={`tel:${contact.phone}`} className="text-xs flex items-center gap-1 font-semibold" style={{ color: C.green }}>
                        <Phone size={11} /> Ligar
                      </a>
                      {contact.whatsapp && (
                        <a href={whatsappLink(contact.phone, "Olá! Encontrei o seu contacto no Mainga. Precisamos de um doador de sangue.")} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 font-semibold" style={{ color: C.gold }}>
                          <MessageCircle size={11} /> WhatsApp
                        </a>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => reveal(d.id)}
                      disabled={revealing === d.id}
                      className="text-xs mt-1 font-semibold"
                      style={{ color: C.garnet }}
                    >
                      {revealing === d.id ? "A revelar…" : "Revelar contacto"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- REGISTAR ---------- */
function Registar({ onSubmit, existing, onDelete, onEnablePush, showToast }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState(null);
  const [partnerInstitution, setPartnerInstitution] = useState("");
  const [bloodType, setBloodType] = useState(null);
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState(true);
  const [inAngola, setInAngola] = useState(true);
  const [province, setProvince] = useState("Luanda");
  const [city, setCity] = useState("");
  const [cityMode, setCityMode] = useState("lista"); // "lista" | "outro"
  const [available, setAvailable] = useState(true);
  const [lastDonationDate, setLastDonationDate] = useState("");

  const ageNum = Number(age);
  const ageValid = age !== "" && ageNum >= 18 && ageNum <= 69;
  const canSubmit = name && bloodType && phone && ageValid && (!inAngola || city);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [eligibilityModal, setEligibilityModal] = useState(null); // { eligibleDate, months } | null

  const submit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit) {
      const missing = [];
      if (!name) missing.push("nome");
      if (!ageValid) missing.push(age === "" ? "idade" : "idade entre 18 e 69 anos (exigência legal para doar sangue em Angola)");
      if (!bloodType) missing.push("grupo sanguíneo");
      if (!phone) missing.push("telefone");
      if (inAngola && !city) missing.push("cidade");
      setError(`Falta preencher: ${missing.join(", ")}.`);
      return;
    }
    setError("");
    onSubmit({
      name,
      age: ageNum,
      sex,
      bloodType,
      phone,
      whatsapp,
      diaspora: !inAngola,
      province: inAngola ? province : null,
      city: inAngola ? city : null,
      available: inAngola ? available : false,
      lastDonationDate: lastDonationDate || null,
      partnerInstitution: partnerInstitution || null,
    });

    // avisa já, na hora, se a pessoa ainda não pode doar (com base no sexo e na última doação)
    if (lastDonationDate) {
      const elig = donorEligibleDate(lastDonationDate, sex);
      if (elig && elig.getTime() > Date.now()) {
        const months = sex === "feminino" ? "4 meses" : "3 meses";
        setEligibilityModal({ eligibleDate: elig, months });
      } else {
        showToast?.("Registo feito! Já está elegível para doar e pode ser contactado.");
      }
    } else {
      showToast?.("Registo feito! Obrigado por se juntar à Mainga.");
    }

    setName(""); setAge(""); setSex(null); setBloodType(null); setPhone(""); setCity(""); setLastDonationDate(""); setPartnerInstitution("");
  };

  if (existing) {
    const eligibleDate = donorEligibleDate(existing.lastDonationDate, existing.sex);
    const eligible = donorIsEligible(existing);
    return (
      <>
        {eligibilityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
            <div className="max-w-sm w-full rounded-2xl p-6 text-center" style={{ background: C.surface, border: `2px solid ${C.gold}` }}>
              <ShieldAlert size={36} color={C.gold} className="mx-auto mb-4" />
              <h2 className="text-lg font-extrabold mb-3 uppercase tracking-wide" style={{ color: C.gold }}>
                Ainda não pode doar
              </h2>
              <p className="text-sm mb-2" style={{ color: C.paper }}>
                Por regra obrigatória de segurança, é preciso esperar:
              </p>
              <p className="text-3xl font-extrabold mb-3" style={{ color: C.paper, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                {eligibilityModal.months}
              </p>
              <p className="text-sm mb-1" style={{ color: C.muted }}>entre doações. Só volta a ficar disponível a partir de:</p>
              <p className="text-lg font-extrabold mb-6" style={{ color: C.paper }}>
                {eligibilityModal.eligibleDate.toLocaleDateString("pt-PT")}
              </p>
              <Btn full onClick={() => setEligibilityModal(null)}>Entendi</Btn>
            </div>
          </div>
        )}
      <div className="fadeUp max-w-md mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: C.greenSoft }}>
          <Check size={26} color={C.green} />
        </div>
        <h2 className="text-xl font-extrabold mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Já estás registado, {existing.name.split(" ")[0]}
        </h2>
        {existing.diaspora ? (
          <p className="text-sm" style={{ color: C.muted }}>
            Grupo {existing.bloodType} · registado como apoiante na diáspora. Não apareces nas
            correspondências automáticas. Mas podes continuar a partilhar pedidos e a espalhar a Mainga.
          </p>
        ) : (
          <p className="text-sm" style={{ color: C.muted }}>
            Grupo {existing.bloodType} · {existing.city}, {existing.province}. Quando alguém publicar um
            pedido compatível na tua zona, vai aparecer no feed.
          </p>
        )}

        {!existing.diaspora && (
          <div
            className="mt-4 rounded-lg p-3 text-sm"
            style={{ background: eligible ? C.greenSoft : C.goldSoft, color: eligible ? C.green : C.gold }}
          >
            {eligible
              ? "Já podes doar sangue neste momento."
              : `Podes doar de novo a partir de ${eligibleDate.toLocaleDateString("pt-PT")}.`}
          </div>
        )}

        {!existing.diaspora && (
          <div className="mt-4">
            <Btn full variant="gold" icon={Bell} onClick={onEnablePush}>
              Avisar-me quando houver um pedido compatível
            </Btn>
            <p className="text-xs mt-2" style={{ color: C.faint }}>
              Recebe um aviso no telemóvel mesmo com a app fechada, quando alguém precisar do seu tipo sanguíneo perto de si.
            </p>
          </div>
        )}

        <div className="mt-6">
          {confirmDelete ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs" style={{ color: C.muted }}>Apagar mesmo este registo?</span>
              <Btn variant="primary" onClick={() => onDelete(existing.id)}>Sim, apagar</Btn>
              <Btn variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Btn>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs font-semibold"
              style={{ color: C.faint }}
            >
              Apagar este registo
            </button>
          )}
        </div>
      </div>
      </>
    );
  }

  return (
    <>
      {eligibilityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="max-w-sm w-full rounded-2xl p-6 text-center" style={{ background: C.surface, border: `2px solid ${C.gold}` }}>
            <ShieldAlert size={36} color={C.gold} className="mx-auto mb-4" />
            <h2 className="text-lg font-extrabold mb-3 uppercase tracking-wide" style={{ color: C.gold }}>
              Ainda não pode doar
            </h2>
            <p className="text-sm mb-2" style={{ color: C.paper }}>
              Por regra obrigatória de segurança, é preciso esperar:
            </p>
            <p className="text-3xl font-extrabold mb-3" style={{ color: C.paper, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
              {eligibilityModal.months}
            </p>
            <p className="text-sm mb-1" style={{ color: C.muted }}>entre doações. Só volta a ficar disponível a partir de:</p>
            <p className="text-lg font-extrabold mb-6" style={{ color: C.paper }}>
              {eligibilityModal.eligibleDate.toLocaleDateString("pt-PT")}
            </p>
            <Btn full onClick={() => setEligibilityModal(null)}>Entendi</Btn>
          </div>
        </div>
      )}
    <div className="fadeUp max-w-lg mx-auto">
      <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
        Ser doador
      </h2>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        Dois minutos agora podem ser o tempo de vida de alguém depois.
      </p>

      <div>
        <Field label="Onde estás neste momento?">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setInAngola(true)}
              className="px-3 py-2.5 rounded-lg text-sm font-semibold text-left"
              style={{
                background: inAngola ? C.garnetSoft : C.surfaceRaised,
                color: inAngola ? C.garnet : C.muted,
                border: `1.5px solid ${inAngola ? C.garnet : C.line}`,
              }}
            >
              Em Angola
            </button>
            <button
              type="button"
              onClick={() => setInAngola(false)}
              className="px-3 py-2.5 rounded-lg text-sm font-semibold text-left"
              style={{
                background: !inAngola ? C.goldSoft : C.surfaceRaised,
                color: !inAngola ? C.gold : C.muted,
                border: `1.5px solid ${!inAngola ? C.gold : C.line}`,
              }}
            >
              Na diáspora
            </button>
          </div>
          {!inAngola && (
            <p className="text-xs mt-2" style={{ color: C.faint }}>
              A doação exige presença física, por isso não entras nas correspondências automáticas.
              Mesmo assim, o teu registo ajuda a mostrar o alcance da comunidade e podes partilhar pedidos.
            </p>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome completo">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} placeholder="O teu nome" />
          </Field>
          <Field label="Idade">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="Ex: 25"
            />
          </Field>
        </div>
        <p className="text-xs -mt-3 mb-4" style={{ color: C.faint }}>
          É preciso ter entre 18 e 69 anos para doar sangue em Angola.
        </p>

        <Field label="Sexo (opcional)">
          <div className="grid grid-cols-2 gap-2">
            {[["feminino", "Feminino"], ["masculino", "Masculino"]].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setSex(sex === val ? null : val)}
                className="py-2.5 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  border: `1px solid ${sex === val ? C.garnet : C.line}`,
                  background: sex === val ? C.garnetSoft : "transparent",
                  color: sex === val ? C.garnet : C.muted,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Grupo sanguíneo">
          <div className="grid grid-cols-4 gap-2">
            {BLOOD_TYPES.map((t) => (
              <BloodBadge key={t} type={t} selected={bloodType === t} onClick={() => setBloodType(t)} />
            ))}
          </div>
        </Field>

        <Field label="Telefone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} style={inputStyle} placeholder={inAngola ? "+244 9XX XXX XXX" : "com indicativo do país"} />
        </Field>
        <p className="text-xs -mt-3 mb-2" style={{ color: C.gold }}>
          Coloque sempre o indicativo do país antes do número (ex: <strong>+244</strong> Angola, <strong>+351</strong> Portugal, <strong>+49</strong> Alemanha, <strong>+31</strong> Países Baixos). Sem isso, o WhatsApp não abre a conversa correctamente. Útil também para angolanos na diáspora que conheçam alguém à procura de sangue.
        </p>
        <p className="text-xs -mt-3 mb-4 flex items-start gap-1.5" style={{ color: C.faint }}>
          <Lock size={13} className="shrink-0 mt-0.5" /> Protegido. Só é mostrado a quem estiver
          autenticado e clicar em "revelar contacto", com limite diário de segurança.
        </p>

        <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer" style={{ color: C.paper }}>
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} style={{ accentColor: C.garnet }} />
          Este número tem WhatsApp
        </label>

        {inAngola && (
          <>
            <UseMyLocationButton showToast={showToast} onFound={(prov) => setProvince(prov)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Província">
                <select
                  value={province}
                  onChange={(e) => { setProvince(e.target.value); setCity(""); setCityMode("lista"); }}
                  className={inputClass}
                  style={inputStyle}
                >
                  {PROVINCES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Município / cidade">
                {cityMode === "lista" ? (
                  <select
                    value={city}
                    onChange={(e) => {
                      if (e.target.value === "__outro__") { setCityMode("outro"); setCity(""); }
                      else setCity(e.target.value);
                    }}
                    className={inputClass}
                    style={inputStyle}
                  >
                    <option value="">Escolha…</option>
                    {(MUNICIPIOS_BY_PROVINCE[province] || []).map((m) => <option key={m}>{m}</option>)}
                    <option value="__outro__">Outro</option>
                  </select>
                ) : (
                  <div>
                    <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ex: Talatona" />
                    <button type="button" onClick={() => { setCityMode("lista"); setCity(""); }} className="text-xs font-semibold mt-1.5" style={{ color: C.gold }}>
                      ← Escolher da lista
                    </button>
                  </div>
                )}
              </Field>
            </div>

            <Field label="Data da última doação (opcional)">
              <input type="date" value={lastDonationDate} onChange={(e) => setLastDonationDate(e.target.value)} className={inputClass} style={inputStyle} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <p className="text-xs -mt-3 mb-4" style={{ color: C.faint }}>
              Ajuda a calcular quando podes doar de novo (mínimo de 3 meses para homens, 4 para mulheres). Deixa em branco se nunca doaste ou não te lembras.
            </p>

            <Field label="És doador fiel de alguma instituição ou banco de sangue? (opcional)">
              <input
                value={partnerInstitution}
                onChange={(e) => setPartnerInstitution(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="Ex: Hospital Josina Machel, Instituto Nacional de Sangue…"
              />
            </Field>
            <p className="text-xs -mt-3 mb-4" style={{ color: C.faint }}>
              Ajuda-nos a perceber quantos doadores já têm ligação a instituições — não afecta o teu registo na Mainga.
            </p>

            <label className="flex items-center gap-2 mb-6 text-sm cursor-pointer" style={{ color: C.paper }}>
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} style={{ accentColor: C.garnet }} />
              Estou disponível para doar neste momento
            </label>
          </>
        )}

        {error && (
          <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: C.garnet }}>
            <ShieldAlert size={13} /> {error}
          </p>
        )}
        <Btn type="button" full icon={UserPlus} onClick={submit}>
          {inAngola ? "Registar como doador" : "Registar como apoiante"}
        </Btn>
      </div>
    </div>
    </>
  );
}

/* ---------- PUBLICAR ---------- */
function Publicar({ donors, onSubmit, onDone, showToast }) {
  const [place, setPlace] = useState("");
  const [placeMode, setPlaceMode] = useState("lista"); // "lista" | "outro"
  const [bloodType, setBloodType] = useState(null);
  const [province, setProvince] = useState("Luanda");
  const [city, setCity] = useState("");
  const [cityMode, setCityMode] = useState("lista"); // "lista" | "outro"
  const [units, setUnits] = useState(1);
  const [urgency, setUrgency] = useState("alta");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [posted, setPosted] = useState(null);

  const canSubmit = place && bloodType && city && contactPhone;
  const [error, setError] = useState("");

  const matches = useMemo(() => {
    if (!bloodType) return [];
    const compatible = compatibleDonorTypes(bloodType);
    return donors.filter((d) => compatible.includes(d.bloodType) && d.province === province && d.available && donorIsEligible(d));
  }, [donors, bloodType, province]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) {
      const missing = [];
      if (!place) missing.push("hospital/local");
      if (!bloodType) missing.push("grupo sanguíneo");
      if (!city) missing.push("cidade");
      if (!contactPhone) missing.push("telefone de contacto");
      setError(`Falta preencher: ${missing.join(", ")}.`);
      return;
    }
    setError("");
    const record = await onSubmit({ place, bloodType, province, city, units: Number(units), urgency, contactPhone, notes });
    if (!record) return;
    setPosted(record);
  };

  if (posted) {
    const shareText = `🩸 Pedido urgente de sangue (${posted.bloodType}) em ${posted.city}, ${posted.province}. ${posted.units} unidade(s) necessária(s) em ${posted.place}. Contacto: ${posted.contactPhone}. Partilha se puderes ajudar. Mainga`;
    return (
      <div className="fadeUp max-w-lg mx-auto text-center py-10">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: C.garnetSoft }}>
          <Siren size={26} color={C.garnet} />
        </div>
        <h2 className="text-xl font-extrabold mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Pedido publicado
        </h2>
        <p className="text-sm mb-1" style={{ color: C.muted }}>
          Enviado. Fica visível a todos assim que um administrador o rever e aprovar (costuma ser
          rápido). Já pode partilhar o link no WhatsApp entretanto.
        </p>
        <p className="text-sm mb-6" style={{ color: C.green }}>
          {matches.length} doador{matches.length !== 1 ? "es" : ""} compatíve{matches.length !== 1 ? "is" : ""} identificado{matches.length !== 1 ? "s" : ""} em {posted.province}.
        </p>

        <div className="text-left rounded-xl p-4 mb-4 flex items-center gap-3" style={{ background: C.garnetSoft, border: `1px solid ${C.garnet}` }}>
          <Check size={20} color={C.garnet} className="shrink-0" />
          <div className="text-xs" style={{ color: C.paper }}>
            Como está ligado à sua conta, só o senhor consegue marcar este pedido como resolvido mais
            tarde. Vai aparecer o botão "Resolvido" neste cartão quando o vir no feed.
          </div>
        </div>

        <div className="text-left rounded-xl p-4 mb-6" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: C.gold }}>
            <Send size={14} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Notificações simuladas
            </span>
          </div>
          {matches.length === 0 ? (
            <p className="text-xs" style={{ color: C.muted }}>
              Ainda não há doadores registados com este perfil nesta província. Partilha o pedido para alcançar mais gente.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {matches.slice(0, 5).map((d) => (
                <li key={d.id} className="text-xs flex items-center gap-1.5" style={{ color: C.muted }}>
                  <Radio size={11} color={C.gold} /> SMS + WhatsApp para {d.name} ({d.bloodType}, {d.city})
                </li>
              ))}
              {matches.length > 5 && (
                <li className="text-xs" style={{ color: C.faint }}>+ {matches.length - 5} outros doadores</li>
              )}
            </ul>
          )}
          <p className="text-[11px] mt-3" style={{ color: C.faint }}>
            Envio real por SMS/WhatsApp requer ligação a um serviço externo (ex: Africa's Talking, WhatsApp Business API), ainda não activado neste protótipo.
          </p>
        </div>

        <div className="flex gap-2">
          <a href={whatsappLink("", shareText)} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Btn variant="gold" icon={MessageCircle} full>Partilhar no WhatsApp</Btn>
          </a>
          <Btn variant="ghost" onClick={onDone} icon={ChevronRight}>Ver feed</Btn>
        </div>
      </div>
    );
  }

  // hospitais desta província; se o município escolhido tiver hospitais próprios, mostra só esses
  const hospitalsInMunicipio = city ? HOSPITALS.filter((h) => h.province === province && h.municipio === city) : [];
  const hospitalOptions = hospitalsInMunicipio.length > 0
    ? hospitalsInMunicipio
    : HOSPITALS.filter((h) => h.province === province);

  return (
    <div className="fadeUp max-w-lg mx-auto">
      <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
        Publicar pedido urgente
      </h2>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        Hospital, clínica ou família: qualquer pessoa pode publicar uma necessidade.
      </p>

      <div>
        <UseMyLocationButton showToast={showToast} onFound={(prov) => setProvince(prov)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Província">
            <select
              value={province}
              onChange={(e) => {
                setProvince(e.target.value);
                // limpa a escolha de hospital se já não pertencer à nova província
                const stillValid = HOSPITALS.some((h) => h.name === place && h.province === e.target.value);
                if (!stillValid) { setPlace(""); setPlaceMode("lista"); }
                setCity("");
                setCityMode("lista");
              }}
              className={inputClass}
              style={inputStyle}
            >
              {PROVINCES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Município / cidade">
            {cityMode === "lista" ? (
              <select
                value={city}
                onChange={(e) => {
                  if (e.target.value === "__outro__") { setCityMode("outro"); setCity(""); }
                  else setCity(e.target.value);
                }}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">Escolha…</option>
                {(MUNICIPIOS_BY_PROVINCE[province] || []).map((m) => <option key={m}>{m}</option>)}
                <option value="__outro__">Outro</option>
              </select>
            ) : (
              <div>
                <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ex: Talatona" />
                <button type="button" onClick={() => { setCityMode("lista"); setCity(""); }} className="text-xs font-semibold mt-1.5" style={{ color: C.gold }}>
                  ← Escolher da lista
                </button>
              </div>
            )}
          </Field>
        </div>

        <Field label="Hospital / local">
          {placeMode === "lista" ? (
            <select
              value={place}
              onChange={(e) => {
                if (e.target.value === "__outro__") {
                  setPlaceMode("outro");
                  setPlace("");
                } else {
                  setPlace(e.target.value);
                }
              }}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">
                {hospitalOptions.length === 0
                  ? "Nenhum hospital listado nesta província ainda"
                  : hospitalsInMunicipio.length > 0
                    ? `Escolha um hospital em ${city}…`
                    : `Escolha um hospital em ${province}…`}
              </option>
              {hospitalOptions
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((h) => (
                  <option key={h.name} value={h.name}>{h.name}</option>
                ))}
              <option value="__outro__">Outro (não está na lista)</option>
            </select>
          ) : (
            <div>
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="Escreva o nome do hospital ou local"
              />
              <button
                type="button"
                onClick={() => { setPlaceMode("lista"); setPlace(""); }}
                className="text-xs font-semibold mt-1.5"
                style={{ color: C.gold }}
              >
                ← Escolher da lista
              </button>
            </div>
          )}
        </Field>
        <p className="text-xs -mt-3 mb-4" style={{ color: C.faint }}>
          {hospitalsInMunicipio.length > 0
            ? <>A lista mostra só hospitais de <strong style={{ color: C.muted }}>{city}</strong>. Mude o município ou a província acima para ver outros.</>
            : <>A lista mostra hospitais de <strong style={{ color: C.muted }}>{province}</strong>. Mude a província acima para ver outra região.</>}
        </p>

        <Field label="Grupo sanguíneo necessário">
          <div className="grid grid-cols-4 gap-2">
            {BLOOD_TYPES.map((t) => (
              <BloodBadge key={t} type={t} selected={bloodType === t} onClick={() => setBloodType(t)} />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidades necessárias">
            <input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Urgência">
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="critica">Crítica: agora</option>
              <option value="alta">Alta: hoje</option>
              <option value="moderada">Moderada: esta semana</option>
            </select>
          </Field>
        </div>

        <Field label="Telefone de contacto">
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClass} style={inputStyle} placeholder="+244 9XX XXX XXX" />
        </Field>
        <p className="text-xs -mt-3 mb-2" style={{ color: C.gold }}>
          Coloque sempre o indicativo do país antes do número (ex: <strong>+244</strong> Angola, <strong>+351</strong> Portugal, <strong>+49</strong> Alemanha, <strong>+31</strong> Países Baixos). Sem isso, quem quiser ajudar pelo WhatsApp não consegue abrir a conversa.
        </p>
        <p className="text-[11px] -mt-3 mb-4" style={{ color: C.faint }}>
          Máximo de {RATE_LIMIT_MAX} pedidos por número em 24 horas, para travar spam.
        </p>

        <Field label="Notas (opcional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} style={inputStyle} placeholder="Ex: cirurgia agendada para amanhã de manhã" />
        </Field>

        {bloodType && province && (
          <div className="mb-5 text-xs flex items-center gap-1.5" style={{ color: C.green }}>
            <Users size={13} /> {matches.length} doador{matches.length !== 1 ? "es" : ""} compatíve{matches.length !== 1 ? "is" : ""} já em {province}
          </div>
        )}

        {error && (
          <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: C.garnet }}>
            <ShieldAlert size={13} /> {error}
          </p>
        )}
        <Btn type="button" full variant="gold" icon={Siren} onClick={submit}>
          Publicar pedido
        </Btn>
      </div>
    </div>
  );
}

/* ---------- ADMIN ---------- */
function Admin({ isAdmin, donors, requests, verifiedRequesters, onDeleteDonor, onDeleteRequest, onApproveRequest, onAddVerifiedRequester }) {
  const [tab, setTab] = useState("doadores");
  const [confirmId, setConfirmId] = useState(null);
  const [institutionInput, setInstitutionInput] = useState({});

  if (!isAdmin) {
    return (
      <div className="fadeUp max-w-sm mx-auto text-center py-16">
        <Lock size={24} color={C.muted} className="mx-auto mb-4" />
        <h2 className="text-xl font-extrabold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Sem permissão
        </h2>
      </div>
    );
  }

  const list = tab === "doadores" ? donors : tab === "pedidos" ? requests : [];
  const pendingCount = requests.filter((r) => !r.approved && r.status === "aberto").length;

  const bloodTypeData = BLOOD_TYPES.map((t) => ({
    tipo: t,
    doadores: donors.filter((d) => d.bloodType === t).length,
  }));
  const provinceData = Object.entries(
    donors.filter((d) => !d.diaspora).reduce((acc, d) => {
      acc[d.province] = (acc[d.province] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([provincia, doadores]) => ({ provincia, doadores }))
    .sort((a, b) => b.doadores - a.doadores)
    .slice(0, 8);
  const requestsResolved = requests.filter((r) => r.status === "resolvido").length;
  const requestsOpen = requests.filter((r) => r.status === "aberto" && r.approved).length;

  return (
    <div className="fadeUp">
      <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
        Painel administrador
      </h2>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        Gestão directa de registos. Usar com cuidado: esta acção não tem "desfazer". Para apagar tudo
        de uma vez, use o Table Editor no painel do Supabase.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setTab("doadores")}
          className="px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: tab === "doadores" ? C.garnetSoft : "transparent", color: tab === "doadores" ? C.garnet : C.muted }}
        >
          Doadores ({donors.length})
        </button>
        <button
          onClick={() => setTab("pedidos")}
          className="px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5"
          style={{ background: tab === "pedidos" ? C.garnetSoft : "transparent", color: tab === "pedidos" ? C.garnet : C.muted }}
        >
          Pedidos ({requests.length})
          {pendingCount > 0 && <Badge tone="gold">{pendingCount} por aprovar</Badge>}
        </button>
        <button
          onClick={() => setTab("estatisticas")}
          className="px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: tab === "estatisticas" ? C.garnetSoft : "transparent", color: tab === "estatisticas" ? C.garnet : C.muted }}
        >
          Estatísticas
        </button>
      </div>

      {tab === "estatisticas" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Doadores" value={donors.length} tone="green" />
            <StatCard label="Pedidos abertos" value={requestsOpen} tone="garnet" />
            <StatCard label="Pedidos resolvidos" value={requestsResolved} tone="gold" />
          </div>

          <div className="rounded-xl p-4" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: C.paper }}>Doadores por grupo sanguíneo</h3>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={bloodTypeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="tipo" tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.line }} />
                  <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.line }} />
                  <Tooltip contentStyle={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, borderRadius: 8, color: C.paper }} />
                  <Bar dataKey="doadores" fill={C.garnet} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: C.paper }}>Doadores por província</h3>
            {provinceData.length === 0 ? (
              <p className="text-xs" style={{ color: C.muted }}>Ainda sem dados suficientes.</p>
            ) : (
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={provinceData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.line }} />
                    <YAxis dataKey="provincia" type="category" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.line }} width={90} />
                    <Tooltip contentStyle={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, borderRadius: 8, color: C.paper }} />
                    <Bar dataKey="doadores" fill={C.gold} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm py-10 text-center" style={{ color: C.muted }}>Nada para mostrar aqui.</p>
      ) : (
        <div className="space-y-2">
          {list.map((item) => (
            <div key={item.id} className="rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: C.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.35)", border: `1px solid ${C.line}` }}>
              <div className="min-w-0">
                {tab === "doadores" ? (
                  <>
                    <div className="text-sm font-semibold truncate">
                      {item.name} <span style={{ color: C.faint, fontFamily: "'JetBrains Mono', monospace" }}>· {item.bloodType}</span>
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      {item.diaspora ? "Diáspora" : `${item.city}, ${item.province}`}
                      {" · "}telefone protegido (use "Procurar" para revelar)
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5 flex-wrap">
                      {item.place} <span style={{ color: C.faint, fontFamily: "'JetBrains Mono', monospace" }}>· {item.bloodType}</span>
                      {!item.approved && <Badge tone="gold">Por aprovar</Badge>}
                      {verifiedRequesters?.[item.requesterUserId] && <Badge tone="green">Verificado</Badge>}
                    </div>
                    <div className="text-xs mb-1.5" style={{ color: C.muted }}>
                      {item.city}, {item.province} · {item.status} · {item.contactPhone}
                      {item.reportCount > 0 ? ` · ${item.reportCount} sinalizações` : ""}
                    </div>
                    {!verifiedRequesters?.[item.requesterUserId] && (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={institutionInput[item.id] || ""}
                          onChange={(e) => setInstitutionInput((s) => ({ ...s, [item.id]: e.target.value }))}
                          placeholder="Nome da instituição"
                          className="px-2 py-1 rounded text-xs"
                          style={{ ...inputStyle, width: 160 }}
                        />
                        <button
                          onClick={() => onAddVerifiedRequester(item.requesterUserId, institutionInput[item.id] || item.place)}
                          className="text-xs font-semibold"
                          style={{ color: C.green }}
                        >
                          Marcar verificado
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {tab === "pedidos" && !item.approved && (
                  <Btn variant="gold" onClick={() => onApproveRequest(item.id)}>Aprovar</Btn>
                )}
                {confirmId === item.id ? (
                  <>
                    <Btn variant="primary" onClick={() => { (tab === "doadores" ? onDeleteDonor : onDeleteRequest)(item.id); setConfirmId(null); }}>
                      Confirmar
                    </Btn>
                    <button onClick={() => setConfirmId(null)} aria-label="Cancelar" style={{ color: C.faint }}><X size={16} /></button>
                  </>
                ) : (
                  <button onClick={() => setConfirmId(item.id)} className="p-2 px-3 rounded-lg text-xs font-semibold" style={{ color: C.garnet, border: `1px solid ${C.line}` }}>
                    Apagar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- LEGAL ---------- */
function Legal({ page, onNavigate }) {
  const Section = ({ title, children }) => (
    <div className="mb-6">
      <h3 className="text-base font-bold mb-2" style={{ color: C.paper, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{title}</h3>
      <div className="text-sm leading-relaxed" style={{ color: C.muted }}>{children}</div>
    </div>
  );

  return (
    <div className="fadeUp max-w-2xl mx-auto">
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => onNavigate("sobre")}
          className="px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: page === "sobre" ? C.garnetSoft : "transparent", color: page === "sobre" ? C.garnet : C.muted }}
        >
          Sobre
        </button>
        <button
          onClick={() => onNavigate("privacidade")}
          className="px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: page === "privacidade" ? C.garnetSoft : "transparent", color: page === "privacidade" ? C.garnet : C.muted }}
        >
          Privacidade
        </button>
        <button
          onClick={() => onNavigate("termos")}
          className="px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: page === "termos" ? C.garnetSoft : "transparent", color: page === "termos" ? C.garnet : C.muted }}
        >
          Termos de Utilização
        </button>
      </div>

      {page === "sobre" && (
        <>
          <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>Sobre a Mainga</h2>
          <p className="text-xs mb-6" style={{ color: C.faint }}>A história por trás do projecto</p>

          <Section title="Porque existe a Mainga">
            <p className="mb-2">
              A Mainga nasceu de uma perda que não devia ter acontecido. Um mês, a filha de uma amiga
              da família perdeu a vida. Não por falta de tratamento, nem de esperança. Por falta de um
              doador de sangue a tempo. Quando a família precisou, a única forma de procurar ajuda foi
              publicar no estado do WhatsApp e esperar que alguém visse, partilhasse, e chegasse a tempo.
            </p>
            <p>
              Isso não devia depender de sorte, nem de quantos seguidores alguém tem. Devia ser tão simples
              como abrir uma aplicação e encontrar quem pode ajudar. A Mainga existe para ser essa ponte.
            </p>
          </Section>

          <Section title="Missão">
            <p>
              Ligar, de forma rápida e directa, quem precisa urgentemente de sangue a doadores voluntários
              em Angola. Sem depender de correntes de WhatsApp, sem precisar de conhecer alguém famoso, e
              sem custos para ninguém.
            </p>
          </Section>

          <Section title="Visão">
            <p className="mb-2">
              Uma Angola onde nenhuma família perde alguém que ama só porque não conseguiu encontrar um
              doador compatível a tempo. Onde a distância entre "preciso de ajuda" e "encontrei quem me
              ajude" se mede em minutos, não em dias.
            </p>
            <p>
              A Mainga é um projecto comunitário, feito por alguém que decidiu que esta
              dor não devia repetir-se para mais ninguém.
            </p>
          </Section>
        </>
      )}

      {page === "privacidade" ? (
        <>
          <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>Política de Privacidade</h2>
          <p className="text-xs mb-6" style={{ color: C.faint }}>Última actualização: Julho de 2026</p>

          <Section title="O que recolhemos">
            <p className="mb-2">Ao registar-se como doador: nome, telefone, grupo sanguíneo, WhatsApp (sim/não), província e cidade, e opcionalmente a data da última doação.</p>
            <p className="mb-2">Ao publicar um pedido: nome do local, grupo sanguíneo necessário, província, cidade, número de unidades, urgência, telefone de contacto e notas opcionais.</p>
            <p>Para entrar na plataforma: o seu endereço de email.</p>
          </Section>

          <Section title="Como usamos os seus dados">
            <p className="mb-2">Os dados servem exclusivamente para ligar quem precisa de sangue a quem pode doar: mostrar pedidos urgentes a doadores compatíveis, e permitir contacto directo entre as partes.</p>
            <p>Não vendemos nem partilhamos os seus dados com terceiros para fins publicitários. Não existe qualquer modelo de negócio por trás da Mainga. É um projecto comunitário.</p>
          </Section>

          <Section title="Quem vê o quê">
            <p className="mb-2">O grupo sanguíneo, disponibilidade, província e cidade de um doador são visíveis a qualquer pessoa autenticada na plataforma, para permitir a correspondência com pedidos.</p>
            <p>O seu telefone só é revelado a outra pessoa quando ela clica explicitamente em "Revelar contacto". Essa acção fica registada (data e quem revelou) para prevenir abuso, com um limite diário de revelações por conta.</p>
          </Section>

          <Section title="Onde ficam guardados os dados">
            <p>Os dados são guardados numa base de dados gerida pela Supabase (infra-estrutura na União Europeia). Não guardamos os dados em servidores próprios.</p>
          </Section>

          <Section title="Os seus direitos">
            <p className="mb-2">Pode apagar o seu registo de doador a qualquer momento, directamente na página "Ser doador".</p>
            <p>Para apagar a sua conta por completo, ou pedir uma cópia dos seus dados, contacte-nos através do email indicado no rodapé.</p>
          </Section>

          <Section title="Menores de idade">
            <p>A doação de sangue em Angola exige idade mínima legal. A Mainga não se destina a ser usada por menores para se registarem como doadores.</p>
          </Section>

          <Section title="Contacto">
            <p>Dúvidas sobre esta política podem ser enviadas para o email de contacto indicado no rodapé da plataforma.</p>
          </Section>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>Termos de Utilização</h2>
          <p className="text-xs mb-6" style={{ color: C.faint }}>Última actualização: Julho de 2026</p>

          <Section title="O que é a Mainga">
            <p>A Mainga é uma plataforma comunitária que liga pessoas que precisam de sangue a doadores voluntários em Angola. Não somos um hospital, banco de sangue, nem prestador de cuidados de saúde.</p>
          </Section>

          <Section title="O que a Mainga não faz">
            <p className="mb-2">Não realizamos colheitas de sangue, não verificamos a compatibilidade médica entre doador e receptor, e não garantimos a veracidade de cada pedido publicado. Existem, no entanto, mecanismos de aprovação por administradores e sinalização pela comunidade para reduzir abusos.</p>
            <p>Toda a doação efectiva de sangue deve ocorrer num hospital ou banco de sangue autorizado, seguindo os protocolos médicos apropriados.</p>
          </Section>

          <Section title="Responsabilidades do utilizador">
            <p className="mb-2">Ao usar a Mainga, compromete-se a fornecer informação verdadeira, não publicar pedidos falsos ou enganosos, e não usar os contactos obtidos na plataforma para fins diferentes de coordenar uma doação de sangue.</p>
            <p>Contas usadas para publicar pedidos falsos, assediar outros utilizadores, ou tentar contornar os limites de segurança da plataforma podem ser suspensas sem aviso prévio.</p>
          </Section>

          <Section title="Limitação de responsabilidade">
            <p>A Mainga é fornecida "tal como está", sem garantias de disponibilidade contínua. Não nos responsabilizamos por danos resultantes do uso da plataforma, incluindo (mas não limitado a) informação incorrecta fornecida por utilizadores, ou falhas de comunicação entre doador e receptor.</p>
          </Section>

          <Section title="Alterações a estes termos">
            <p>Podemos actualizar estes termos à medida que a plataforma evolui. Alterações significativas serão reflectidas na data no topo desta página.</p>
          </Section>

          <Section title="Contacto">
            <p>Para questões sobre estes termos, use o email de contacto indicado no rodapé.</p>
          </Section>
        </>
      )}
    </div>
  );
}

/* ---------- REDE DE SEGURANÇA CONTRA FALHAS ---------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Muxima/Mainga crash:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          className="w-full min-h-screen flex flex-col items-center justify-center px-6 text-center"
          style={{ background: C.bg, color: C.paper, fontFamily: "'Inter', sans-serif" }}
        >
          <span className="text-xl font-extrabold mb-3" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}>
            Mainga
          </span>
          <ShieldAlert size={32} color={C.gold} className="mb-4" />
          <h1 className="text-lg font-bold mb-2">Algo correu mal.</h1>
          <p className="text-sm max-w-sm mb-6" style={{ color: C.muted }}>
            Não é o fim do mundo. Só um problema técnico inesperado. Recarregue a página; se um pedido
            era mesmo urgente, ligue directamente ao contacto partilhado, sem esperar pela app.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-lg font-semibold text-sm"
            style={{ background: C.garnet, color: "#fff" }}
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Mainga() {
  return (
    <ErrorBoundary>
      <MaingaApp />
    </ErrorBoundary>
  );
}



