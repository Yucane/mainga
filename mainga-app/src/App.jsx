import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Droplet, MapPin, Phone, MessageCircle, Search, UserPlus,
  Siren, Activity, Check, X, ChevronRight, Users, Radio, Send,
  Flag, Lock, ShieldAlert, Heart
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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

const authApi = {
  sendCode: (email) => sbFetch("/auth/v1/otp", { method: "POST", body: { email, create_user: true } }),
  verifyCode: (email, token) => sbFetch("/auth/v1/verify", { method: "POST", body: { type: "email", email, token } }),
};

/* mapear entre snake_case (base de dados) e camelCase (usado na app) */
const DONATION_INTERVAL_DAYS = 90;

function donorEligibleDate(lastDonationDate) {
  if (!lastDonationDate) return null;
  const d = new Date(lastDonationDate);
  d.setDate(d.getDate() + DONATION_INTERVAL_DAYS);
  return d;
}
function donorIsEligible(donor) {
  const elig = donorEligibleDate(donor.lastDonationDate);
  return !elig || elig.getTime() <= Date.now();
}

function donorFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    bloodType: row.blood_type,
    whatsapp: row.whatsapp,
    diaspora: row.diaspora,
    province: row.province,
    city: row.city,
    available: row.available,
    lastDonationDate: row.last_donation_date,
    createdAt: new Date(row.created_at).getTime(),
  };
}
function donorToRow(donor, userId) {
  return {
    user_id: userId,
    name: donor.name,
    blood_type: donor.bloodType,
    whatsapp: donor.whatsapp,
    diaspora: donor.diaspora,
    province: donor.province,
    city: donor.city,
    available: donor.available,
    phone: donor.phone,
    last_donation_date: donor.lastDonationDate || null,
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

const DONOR_COLUMNS = "id,user_id,name,blood_type,whatsapp,diaspora,province,city,available,last_donation_date,created_at";

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

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "agora mesmo";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

/* ---------- main app ---------- */
export default function Mainga() {
  const [session, setSession] = useState(null); // { token, user }
  const [authStep, setAuthStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [view, setView] = useState("feed");
  const [donors, setDonors] = useState([]);
  const [requests, setRequests] = useState([]);
  const [verifiedRequesters, setVerifiedRequesters] = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    window.scrollTo?.({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [view]);

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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [donorRows, requestRows, verifiedRows] = await Promise.all([
        api.donors.list(session?.token),
        api.requests.list(session?.token),
        api.verifiedRequesters.list(session?.token).catch(() => []),
      ]);
      setDonors((donorRows || []).map(donorFromRow));
      setRequests((requestRows || []).map(requestFromRow));
      const vMap = {};
      (verifiedRows || []).forEach((v) => { vMap[v.user_id] = v.institution_name; });
      setVerifiedRequesters(vMap);
    } catch (err) {
      showToast(`Erro ao carregar dados: ${err.message}`, "garnet");
    } finally {
      setLoading(false);
    }
  }, [session, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    api.admins.check(session.token, session.user.id).then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [session]);

  const sendCode = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      await authApi.sendCode(email);
      setAuthStep("code");
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const verifyCode = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const data = await authApi.verifyCode(email, code);
      setSession({ token: data.access_token, user: data.user });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setSession(null);
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
      showToast("Obrigado — vamos rever este pedido.", "gold");
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
      showToast("Pedido aprovado — já está visível no feed.");
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
    <div className="fadeUp max-w-sm mx-auto px-2 text-center py-10">
      <span className="text-lg font-extrabold tracking-tight block mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}>
        Mainga
      </span>
      <p className="text-sm mt-1 mb-8" style={{ color: C.muted }}>
        {message || "Entre com o seu email para continuar."}
      </p>

      {authStep === "email" ? (
        <>
          <Field label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} style={inputStyle} placeholder="oseu@email.com" />
          </Field>
          {authError && <p className="text-xs mb-3" style={{ color: C.garnet }}>{authError}</p>}
          <Btn full onClick={sendCode} disabled={authLoading || !email}>
            {authLoading ? "A enviar…" : "Enviar código"}
          </Btn>
        </>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: C.muted }}>
            Mandámos um código para <strong style={{ color: C.paper }}>{email}</strong>. Se o email mostrar
            um link em vez de um código, procure o texto "Token" ou os 6 dígitos dentro da mensagem.
          </p>
          <Field label="Código de 6 dígitos">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} style={{ ...inputStyle, textAlign: "center", letterSpacing: "0.3em", fontFamily: "'JetBrains Mono', monospace" }} placeholder="000000" />
          </Field>
          {authError && <p className="text-xs mb-3" style={{ color: C.garnet }}>{authError}</p>}
          <Btn full onClick={verifyCode} disabled={authLoading || code.length !== 6}>
            {authLoading ? "A verificar…" : "Entrar"}
          </Btn>
          <button onClick={() => { setAuthStep("email"); setCode(""); setAuthError(""); }} className="text-xs mt-3" style={{ color: C.faint }}>
            Usar outro email
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="w-full min-h-full" style={{ background: C.bg, fontFamily: "'Inter', sans-serif", color: C.paper }}>
      {sharedStyle}

      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: "rgba(20,16,13,0.92)", borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl font-extrabold tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: C.garnet }}>
              Mainga
            </span>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {[
              ["feed", "Pedidos", Siren],
              ["procurar", "Procurar", Search],
              ["registar", "Ser doador", UserPlus],
              ["publicar", "Publicar pedido", Radio],
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
              {session ? "Sair" : "Entrar"}
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="py-24 text-center" style={{ color: C.muted }}>A carregar…</div>
        ) : (
          <>
            {view === "feed" && (
              <Feed
                requests={requests}
                donors={donors}
                stats={stats}
                currentUserId={session?.user?.id}
                verifiedRequesters={verifiedRequesters}
                onCloseRequest={closeRequest}
                onReportRequest={reportRequest}
                goPublicar={() => setView("publicar")}
              />
            )}
            {view === "procurar" && <Procurar donors={donors} onReveal={revealContact} />}
            {view === "entrar" && renderAuthForm("Entre com o seu email para continuar.")}
            {view === "registar" && (
              session
                ? <Registar onSubmit={addDonor} existing={myDonor} onDelete={deleteDonor} />
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
          </>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-xs" style={{ color: C.faint }}>
        Mainga 2026 é um projeto comunitário sem fins lucrativos, desenvolvido para conectar pessoas que necessitam de sangue a doadores voluntários.
        <div className="mt-3 flex items-center gap-3 font-mono" style={{ color: C.line }}>
          build-2026-07-17-mainga-v3
          <button onClick={() => setView("admin")} style={{ color: C.line }} className="underline">
            painel administrador
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
function Feed({ requests, donors, stats, currentUserId, verifiedRequesters, onCloseRequest, onReportRequest, goPublicar }) {
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
          <span className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Publica agora o teu pedido ou procura por um doador compatível
          </span>
        </div>
        {stats.openRequests > 0 && (
          <h1
            className="text-3xl sm:text-4xl font-extrabold leading-tight mb-2"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            {stats.openRequests} pedido{stats.openRequests > 1 ? "s" : ""} de sangue em aberto agora
          </h1>
        )}
        <p className="text-sm max-w-xl" style={{ color: C.muted }}>
          Angola precisa de mais de <strong style={{ color: C.paper }}>360 mil doadores voluntários de sangue</strong>,
          mas atualmente conta com menos de metade desse número. A sua próxima doação pode salvar a vida
          de alguém que você ama.
        </p>
        <div className="mt-4"><PulseLine w={160} /></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        <StatCard label="Pedidos abertos" value={stats.openRequests} tone="garnet" />
        {stats.criticalOpen > 0 && <StatCard label="Críticos agora" value={stats.criticalOpen} tone="gold" pulse />}
        <StatCard label="Doadores em Angola" value={stats.totalDonors} tone="green" />
        <StatCard label="Províncias" value={Object.keys(stats.byProvince).length} tone="gold" />
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
          style={{ background: C.surface, border: `1px dashed ${C.line}`, color: C.muted }}
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
    <div className="rounded-xl p-4 relative overflow-hidden" style={{ background: C.surface, border: `1px solid ${pulse ? C.gold : C.line}` }}>
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

function RequestCard({ r, donors, isOwner, verifiedInstitution, onClose, onReport }) {
  const [reported, setReported] = useState(false);

  const compatibleTypes = compatibleDonorTypes(r.bloodType);
  const matches = donors.filter(
    (d) => compatibleTypes.includes(d.bloodType) && d.province === r.province && d.available && donorIsEligible(d)
  );
  const urgencyTone = r.urgency === "critica" ? "garnet" : r.urgency === "alta" ? "gold" : "muted";
  const shareText = `🩸 Pedido urgente de sangue (${r.bloodType}) em ${r.city}, ${r.province}. ${r.units} unidade(s) necessária(s) em ${r.place}. Contacto: ${r.contactPhone}. Partilha se puderes ajudar — Mainga`;
  const flagged = (r.reportCount || 0) >= 3;

  const flag = () => {
    if (reported) return;
    onReport();
    setReported(true);
  };

  return (
    <div
      className="rounded-xl p-4 sm:p-5 fadeUp"
      style={{ background: C.surface, border: `1px solid ${flagged ? C.gold : C.line}` }}
    >
      {flagged && (
        <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold" style={{ color: C.gold }}>
          <ShieldAlert size={13} /> Sinalizado pela comunidade — em verificação
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
              {r.notes ? ` — ${r.notes}` : ""}
            </div>
            <div className="text-xs mt-1.5" style={{ color: C.green }}>
              {matches.length} doador{matches.length !== 1 ? "es" : ""} compatíve{matches.length !== 1 ? "is" : ""} na província
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={whatsappLink("", shareText)} target="_blank" rel="noopener noreferrer">
            <Btn variant="gold" icon={MessageCircle}>Partilhar</Btn>
          </a>
          <button
            type="button"
            onClick={flag}
            title="Sinalizar como suspeito"
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
      </div>
    </div>
  );
}

/* ---------- PROCURAR ---------- */
function Procurar({ donors, onReveal }) {
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
      /* clipboard indisponível — sem problema, o número já está visível */
    }
  };

  return (
    <div className="fadeUp">
      <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
        Procurar doadores
      </h2>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        Filtra por grupo sanguíneo e localização para encontrar quem está disponível e já pode doar.
      </p>

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
        <div className="text-center py-16 rounded-xl" style={{ background: C.surface, border: `1px dashed ${C.line}`, color: C.muted }}>
          Ninguém encontrado com estes filtros ainda.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {results.map((d) => {
            const contact = revealed[d.id];
            return (
              <div key={d.id} className="rounded-xl p-4 flex items-center gap-3" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
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
                        <a href={whatsappLink(contact.phone, "Olá! Encontrei o seu contacto no Mainga — precisamos de um doador de sangue.")} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 font-semibold" style={{ color: C.gold }}>
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
function Registar({ onSubmit, existing, onDelete }) {
  const [name, setName] = useState("");
  const [bloodType, setBloodType] = useState(null);
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState(true);
  const [inAngola, setInAngola] = useState(true);
  const [province, setProvince] = useState("Luanda");
  const [city, setCity] = useState("");
  const [available, setAvailable] = useState(true);
  const [lastDonationDate, setLastDonationDate] = useState("");

  const canSubmit = name && bloodType && phone && (!inAngola || city);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit) {
      const missing = [];
      if (!name) missing.push("nome");
      if (!bloodType) missing.push("grupo sanguíneo");
      if (!phone) missing.push("telefone");
      if (inAngola && !city) missing.push("cidade");
      setError(`Falta preencher: ${missing.join(", ")}.`);
      return;
    }
    setError("");
    onSubmit({
      name,
      bloodType,
      phone,
      whatsapp,
      diaspora: !inAngola,
      province: inAngola ? province : null,
      city: inAngola ? city : null,
      available: inAngola ? available : false,
      lastDonationDate: lastDonationDate || null,
    });
    setName(""); setBloodType(null); setPhone(""); setCity(""); setLastDonationDate("");
  };

  if (existing) {
    const eligibleDate = donorEligibleDate(existing.lastDonationDate);
    const eligible = donorIsEligible(existing);
    return (
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
            correspondências automáticas — mas podes continuar a partilhar pedidos e a espalhar a Mainga.
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
    );
  }

  return (
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
              A doação exige presença física, por isso não entras nas correspondências automáticas —
              mas o teu registo ajuda a mostrar o alcance da comunidade e podes partilhar pedidos.
            </p>
          )}
        </Field>

        <Field label="Nome completo">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} placeholder="O teu nome" />
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
        <p className="text-xs -mt-3 mb-4 flex items-start gap-1.5" style={{ color: C.faint }}>
          <Lock size={13} className="shrink-0 mt-0.5" /> Protegido — só é mostrado a quem estiver
          autenticado e clicar em "revelar contacto", com limite diário de segurança.
        </p>

        <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer" style={{ color: C.paper }}>
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} style={{ accentColor: C.garnet }} />
          Este número tem WhatsApp
        </label>

        {inAngola && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Província">
                <select value={province} onChange={(e) => setProvince(e.target.value)} className={inputClass} style={inputStyle}>
                  {PROVINCES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Município / cidade">
                <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ex: Talatona" />
              </Field>
            </div>

            <Field label="Data da última doação (opcional)">
              <input type="date" value={lastDonationDate} onChange={(e) => setLastDonationDate(e.target.value)} className={inputClass} style={inputStyle} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <p className="text-xs -mt-3 mb-4" style={{ color: C.faint }}>
              Ajuda a calcular quando podes doar de novo (mínimo de {DONATION_INTERVAL_DAYS} dias). Deixa em branco se nunca doaste ou não te lembras.
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
  );
}

/* ---------- PUBLICAR ---------- */
function Publicar({ donors, onSubmit, onDone, showToast }) {
  const [place, setPlace] = useState("");
  const [bloodType, setBloodType] = useState(null);
  const [province, setProvince] = useState("Luanda");
  const [city, setCity] = useState("");
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
    const shareText = `🩸 Pedido urgente de sangue (${posted.bloodType}) em ${posted.city}, ${posted.province}. ${posted.units} unidade(s) necessária(s) em ${posted.place}. Contacto: ${posted.contactPhone}. Partilha se puderes ajudar — Mainga`;
    return (
      <div className="fadeUp max-w-lg mx-auto text-center py-10">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: C.garnetSoft }}>
          <Siren size={26} color={C.garnet} />
        </div>
        <h2 className="text-xl font-extrabold mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Pedido publicado
        </h2>
        <p className="text-sm mb-1" style={{ color: C.muted }}>
          Enviado — fica visível a todos assim que um administrador o rever e aprovar (costuma ser
          rápido). Já pode partilhar o link no WhatsApp entretanto.
        </p>
        <p className="text-sm mb-6" style={{ color: C.green }}>
          {matches.length} doador{matches.length !== 1 ? "es" : ""} compatíve{matches.length !== 1 ? "is" : ""} identificado{matches.length !== 1 ? "s" : ""} em {posted.province}.
        </p>

        <div className="text-left rounded-xl p-4 mb-4 flex items-center gap-3" style={{ background: C.garnetSoft, border: `1px solid ${C.garnet}` }}>
          <Check size={20} color={C.garnet} className="shrink-0" />
          <div className="text-xs" style={{ color: C.paper }}>
            Como está ligado à sua conta, só o senhor consegue marcar este pedido como resolvido mais
            tarde — vai aparecer o botão "Resolvido" neste cartão quando o vir no feed.
          </div>
        </div>

        <div className="text-left rounded-xl p-4 mb-6" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: C.gold }}>
            <Send size={14} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Notificações simuladas
            </span>
          </div>
          {matches.length === 0 ? (
            <p className="text-xs" style={{ color: C.muted }}>
              Ainda não há doadores registados com este perfil nesta província — partilha o pedido para alcançar mais gente.
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
            Envio real por SMS/WhatsApp requer ligação a um serviço externo (ex: Africa's Talking, WhatsApp Business API) — ainda não activado neste protótipo.
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

  return (
    <div className="fadeUp max-w-lg mx-auto">
      <h2 className="text-2xl font-extrabold mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
        Publicar pedido urgente
      </h2>
      <p className="text-sm mb-6" style={{ color: C.muted }}>
        Hospital, clínica ou família — qualquer pessoa pode publicar uma necessidade.
      </p>

      <div>
        <Field label="Hospital / local">
          <input value={place} onChange={(e) => setPlace(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ex: Hospital Josina Machel" />
        </Field>

        <Field label="Grupo sanguíneo necessário">
          <div className="grid grid-cols-4 gap-2">
            {BLOOD_TYPES.map((t) => (
              <BloodBadge key={t} type={t} selected={bloodType === t} onClick={() => setBloodType(t)} />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Província">
            <select value={province} onChange={(e) => setProvince(e.target.value)} className={inputClass} style={inputStyle}>
              {PROVINCES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Município / cidade">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ex: Talatona" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidades necessárias">
            <input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Urgência">
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="critica">Crítica — agora</option>
              <option value="alta">Alta — hoje</option>
              <option value="moderada">Moderada — esta semana</option>
            </select>
          </Field>
        </div>

        <Field label="Telefone de contacto">
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClass} style={inputStyle} placeholder="+244 9XX XXX XXX" />
        </Field>
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
        <h2 className="text-xl font-extrabold mb-3" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Sem permissão
        </h2>
        <p className="text-sm" style={{ color: C.muted }}>
          A sua conta não está na lista de administradores. Para se tornar administrador, peça a quem
          gere o projecto Supabase para adicionar o seu <code style={{ color: C.paper }}>user_id</code> à
          tabela <code style={{ color: C.paper }}>admins</code> (Authentication → Users para copiar o ID,
          depois Table Editor → admins → Insert).
        </p>
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
        Gestão directa de registos — usar com cuidado, esta acção não tem "desfazer". Para apagar tudo
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

          <div className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
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

          <div className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
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
            <div key={item.id} className="rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
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
                    <button onClick={() => setConfirmId(null)} style={{ color: C.faint }}><X size={16} /></button>
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
