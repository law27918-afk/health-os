import { useState, useEffect, useCallback } from "react";
import {
  auth, db,
  registerUser, loginUser, logoutUser, resetPassword,
  changePassword, updateUserName,
  getUserData, saveUserData, subscribeUserData,
  onAuthStateChanged,
} from "./firebase.js";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
function fmtMins(m) {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), min = m % 60;
  if (h === 0) return `${min} min`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}min`;
}
function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

// ─── Score ────────────────────────────────────────────────────────────────────
function calcScore(metrics, dayLogs) {
  if (!metrics.length) return 0;
  let total = 0, possible = 0;
  metrics.filter(m => !m.archived).forEach(m => {
    const w = m.weight || 10;
    possible += w;
    const log = dayLogs?.[m.id];
    if (!log) return;
    let pct = 0;
    if (m.type === "check") pct = log.done ? 1 : 0;
    else if (m.type === "counter") pct = Math.min((log.count || 0) / (m.goal || 1), 1);
    else if (m.type === "quantity") pct = Math.min((log.amount || 0) / (m.goal || 1), 1);
    else if (m.type === "time") pct = Math.min((log.minutes || 0) / (m.goal || 1), 1);
    else if (m.type === "number") pct = log.value !== undefined ? 1 : 0;
    else if (m.type === "scale") pct = log.value !== undefined ? 1 : 0;
    total += w * pct;
  });
  return possible ? Math.round((total / possible) * 100) : 0;
}

function scoreLabel(s) {
  if (s >= 90) return { label: "Excelente", color: "#10b981" };
  if (s >= 75) return { label: "Bueno", color: "#3b82f6" };
  if (s >= 55) return { label: "Regular", color: "#f59e0b" };
  return { label: "Deficiente", color: "#ef4444" };
}

function isMetricDone(m, log) {
  if (!log) return false;
  if (m.type === "check") return !!log.done;
  if (m.type === "counter") return (log.count || 0) >= (m.goal || 1);
  if (m.type === "quantity") return (log.amount || 0) >= (m.goal || 1);
  if (m.type === "time") return (log.minutes || 0) >= (m.goal || 1);
  if (m.type === "number") return log.value !== undefined;
  if (m.type === "scale") return log.value !== undefined;
  return false;
}

function metricStatus(m, log) {
  if (!log) {
    if (m.type === "counter") return `0 / ${m.goal}`;
    if (m.type === "quantity") return `0 / ${m.goal} ${m.unit || ""}`;
    if (m.type === "time") return `0 / ${fmtMins(m.goal)}`;
    return "Pendiente";
  }
  if (m.type === "check") return log.done ? "Completado ✓" : "Pendiente";
  if (m.type === "counter") return `${log.count || 0} / ${m.goal}`;
  if (m.type === "quantity") return `${log.amount || 0} / ${m.goal} ${m.unit || ""}`;
  if (m.type === "time") return `${fmtMins(log.minutes || 0)} / ${fmtMins(m.goal)}`;
  if (m.type === "number") return log.value !== undefined ? `${log.value} ${m.unit || ""}` : "Sin registrar";
  if (m.type === "scale") return log.value !== undefined ? `${log.value} / ${m.max || 10}` : "Sin registrar";
  return "Pendiente";
}

function pendingDetail(m, log) {
  if (!log) {
    if (m.type === "quantity") return `Te faltan ${m.goal} ${m.unit || ""}`;
    if (m.type === "counter") return `${m.goal} por completar`;
    if (m.type === "time") return `Meta: ${fmtMins(m.goal)}`;
    return "No registrado aún";
  }
  if (m.type === "quantity") {
    const left = (m.goal || 0) - (log.amount || 0);
    return left > 0 ? `Te faltan ${left} ${m.unit || ""}` : "Completado";
  }
  if (m.type === "counter") {
    const left = (m.goal || 0) - (log.count || 0);
    return left > 0 ? `${left} más por completar` : "Completado";
  }
  if (m.type === "time") {
    const left = (m.goal || 0) - (log.minutes || 0);
    return left > 0 ? `Te faltan ${fmtMins(left)}` : "Completado";
  }
  return "No registrado";
}

function typeLabel(t) {
  const map = { check: "Check", counter: "Contador", quantity: "Cantidad", time: "Tiempo", number: "Número", scale: "Escala" };
  return map[t] || t;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  blue:   { bg: "#eff6ff", text: "#1d4ed8", accent: "#3b82f6" },
  teal:   { bg: "#f0fdfa", text: "#0f766e", accent: "#14b8a6" },
  coral:  { bg: "#fff7ed", text: "#c2410c", accent: "#f97316" },
  purple: { bg: "#f5f3ff", text: "#6d28d9", accent: "#8b5cf6" },
  green:  { bg: "#f0fdf4", text: "#15803d", accent: "#22c55e" },
  amber:  { bg: "#fffbeb", text: "#b45309", accent: "#f59e0b" },
  pink:   { bg: "#fdf2f8", text: "#9d174d", accent: "#ec4899" },
  red:    { bg: "#fef2f2", text: "#b91c1c", accent: "#ef4444" },
  gray:   { bg: "#f9fafb", text: "#374151", accent: "#9ca3af" },
};

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
  fontSize: 14, color: "#0f172a", background: "#fff", outline: "none",
};
const btnPrimary = {
  padding: "9px 18px", borderRadius: 9, border: "none", background: "#6366f1",
  color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
  display: "inline-flex", alignItems: "center",
};
const btnSecondary = {
  padding: "9px 18px", borderRadius: 9, border: "1px solid #e2e8f0",
  background: "#fff", color: "#374151", fontWeight: 500, fontSize: 14,
  cursor: "pointer", display: "inline-flex", alignItems: "center",
};
const labelStyle = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 };
const pageTitle = { fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "0 0 8px", letterSpacing: "-0.4px" };

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [userData, setUserData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [authMode, setAuthMode] = useState("login");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const data = await getUserData(firebaseUser.uid);
        setUserData(data);
        // Subscribe to real-time updates
        const unsubData = subscribeUserData(firebaseUser.uid, setUserData);
        return () => unsubData();
      } else {
        setUser(null);
        setUserData(null);
      }
    });
    return unsub;
  }, []);

  const updateData = useCallback(async (newData) => {
    setUserData(newData);
    if (user) await saveUserData(user.uid, newData);
  }, [user]);

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
    setUserData(null);
    setView("dashboard");
  };

  // Loading
  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#667eea,#764ba2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <i className="ti ti-heartbeat" style={{ color: "#fff", fontSize: 24 }} />
          </div>
          <p style={{ color: "#94a3b8", fontSize: 14 }}>Cargando Health OS…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={setUser} />;
  }

  return (
    <Shell
      view={view} setView={setView}
      userData={userData || { metrics: [], logs: {} }}
      updateData={updateData}
      user={user}
      onLogout={handleLogout}
    />
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthScreen({ mode, setMode, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const friendlyError = (code) => {
    const map = {
      "auth/user-not-found": "No existe una cuenta con ese correo.",
      "auth/wrong-password": "Contraseña incorrecta.",
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
      "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
      "auth/invalid-email": "Correo electrónico inválido.",
      "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
    };
    return map[code] || "Ocurrió un error. Intenta de nuevo.";
  };

  const handleSubmit = async () => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (resetMode) {
        await resetPassword(email);
        setSuccess("Correo de recuperación enviado. Revisa tu bandeja de entrada.");
        setLoading(false); return;
      }
      if (mode === "login") {
        const u = await loginUser(email, password);
        onLogin(u);
      } else {
        if (!name.trim()) { setError("Ingresa tu nombre."); setLoading(false); return; }
        const u = await registerUser(email, password, name);
        onLogin(u);
      }
    } catch (e) {
      setError(friendlyError(e.code));
    }
    setLoading(false);
  };

  const handleKey = (e) => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#667eea,#764ba2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <i className="ti ti-heartbeat" style={{ color: "#fff", fontSize: 26 }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 4px", letterSpacing: "-0.5px" }}>Health OS</h1>
          <p style={{ color: "#64748b", fontSize: 15, margin: 0 }}>Tu centro de control de salud</p>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: "32px 28px", boxShadow: "0 4px 24px rgba(0,0,0,0.04)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 24px", textAlign: "center" }}>
            {resetMode ? "Recuperar contraseña" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </h2>

          {mode === "register" && !resetMode && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Nombre</label>
              <input value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey} placeholder="Tu nombre" style={inputStyle} />
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Correo electrónico</label>
            <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey} placeholder="tu@correo.com" type="email" style={inputStyle} />
          </div>
          {!resetMode && (
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Contraseña</label>
              <input value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} placeholder="••••••••" type="password" style={inputStyle} />
            </div>
          )}

          {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}
          {success && <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#16a34a", marginBottom: 16 }}>{success}</div>}

          <button onClick={handleSubmit} disabled={loading} style={{ ...btnPrimary, width: "100%", padding: "12px", fontSize: 15, justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Cargando…" : resetMode ? "Enviar correo" : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>

          {!resetMode && mode === "login" && (
            <button onClick={() => setResetMode(true)} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 13, display: "block", margin: "12px auto 0", textDecoration: "underline" }}>
              Olvidé mi contraseña
            </button>
          )}

          {resetMode ? (
            <button onClick={() => { setResetMode(false); setSuccess(""); }} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 13, display: "block", margin: "12px auto 0" }}>
              ← Volver
            </button>
          ) : (
            <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#64748b" }}>
              {mode === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
              <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontWeight: 600, fontSize: 14, textDecoration: "underline" }}>
                {mode === "login" ? "Regístrate" : "Inicia sesión"}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SHELL ────────────────────────────────────────────────────────────────────
function Shell({ view, setView, userData, updateData, user, onLogout }) {
  const navItems = [
    { id: "dashboard", icon: "ti-layout-dashboard", label: "Hoy" },
    { id: "pending",   icon: "ti-circle-check",     label: "Pendientes" },
    { id: "log",       icon: "ti-plus",              label: "Registrar" },
    { id: "trends",    icon: "ti-chart-line",        label: "Tendencias" },
    { id: "metrics",   icon: "ti-adjustments",       label: "Métricas" },
    { id: "profile",   icon: "ti-user-circle",       label: "Perfil" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Sidebar desktop */}
      <aside className="sidebar-desktop" style={{ width: 220, background: "#fff", borderRight: "1px solid #f1f5f9", display: "flex", flexDirection: "column", padding: "24px 0", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 10 }}>
        <div style={{ padding: "0 20px 24px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#667eea,#764ba2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-heartbeat" style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 16, color: "#0f172a", letterSpacing: "-0.3px" }}>Health OS</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.displayName || user.email}
          </div>
        </div>
        <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", width: "100%", background: view === n.id ? "#f1f5f9" : "transparent", color: view === n.id ? "#0f172a" : "#64748b", fontWeight: view === n.id ? 600 : 400, fontSize: 14 }}>
              <i className={`ti ${n.icon}`} style={{ fontSize: 18 }} />
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "16px 12px", borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", width: "100%", background: "transparent", color: "#94a3b8", fontSize: 14 }}>
            <i className="ti ti-logout" style={{ fontSize: 18 }} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content" style={{ marginLeft: 220, flex: 1, minHeight: "100vh" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 100px" }}>
          {view === "dashboard" && <Dashboard userData={userData} updateData={updateData} setView={setView} />}
          {view === "pending"   && <PendingView userData={userData} updateData={updateData} />}
          {view === "log"       && <LogView userData={userData} updateData={updateData} />}
          {view === "trends"    && <TrendsView userData={userData} />}
          {view === "metrics"   && <MetricsManager userData={userData} updateData={updateData} />}
          {view === "profile"   && <ProfileView user={user} userData={userData} updateData={updateData} onLogout={onLogout} />}
        </div>
      </main>

      {/* Bottom nav mobile */}
      <nav className="bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #f1f5f9", display: "flex", padding: "8px 0 12px", zIndex: 20 }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setView(n.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", background: "transparent", cursor: "pointer", padding: "6px 0", color: view === n.id ? "#6366f1" : "#94a3b8", fontSize: 10, fontWeight: view === n.id ? 600 : 400 }}>
            <i className={`ti ${n.icon}`} style={{ fontSize: 20 }} />
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ userData, updateData, setView }) {
  const todayKey = today();
  const logs = userData.logs?.[todayKey] || {};
  const metrics = (userData.metrics || []).filter(m => !m.archived);
  const score = calcScore(metrics, logs);
  const { label: scoreLabel_, color: scoreColor } = scoreLabel(score);
  const completed = metrics.filter(m => isMetricDone(m, logs[m.id]));
  const pending = metrics.filter(m => !isMetricDone(m, logs[m.id]));

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "0 0 4px", letterSpacing: "-0.5px" }}>{greet()} 👋</h1>
        <p style={{ color: "#64748b", fontSize: 15, margin: 0 }}>{fmtDate(todayKey)}</p>
      </div>

      {/* Score */}
      <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #f1f5f9", padding: 28, marginBottom: 20, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ width: 100, height: 100, flexShrink: 0 }}>
          <ScoreRing score={score} color={scoreColor} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Health Score</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: scoreColor, letterSpacing: "-1px", marginBottom: 4 }}>{score}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: scoreColor }}>{scoreLabel_}</div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#64748b" }}>
            <span style={{ color: "#10b981", fontWeight: 600 }}>{completed.length} completadas</span>
            {" · "}
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>{pending.length} pendientes</span>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
        <QuickActionBtn icon="ti-plus"         label="Registrar"  color="#6366f1" onClick={() => setView("log")} />
        <QuickActionBtn icon="ti-circle-check" label="Pendientes" color="#f59e0b" onClick={() => setView("pending")} />
        <QuickActionBtn icon="ti-chart-line"   label="Tendencias" color="#10b981" onClick={() => setView("trends")} />
      </div>

      {pending.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ti ti-alert-circle" style={{ color: "#f59e0b", fontSize: 16 }} /> Por hacer
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map(m => <MetricCard key={m.id} metric={m} log={logs[m.id]} updateData={updateData} userData={userData} todayKey={todayKey} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ti ti-circle-check" style={{ color: "#10b981", fontSize: 16 }} /> Completado
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {completed.map(m => <MetricCard key={m.id} metric={m} log={logs[m.id]} updateData={updateData} userData={userData} todayKey={todayKey} />)}
          </div>
        </section>
      )}

      {metrics.length === 0 && <EmptyState icon="ti-adjustments" title="Sin métricas aún" body="Configura tus métricas de salud para empezar." />}
    </div>
  );
}

function ScoreRing({ score, color }) {
  const r = 42, circ = 2 * Math.PI * r, fill = (score / 100) * circ;
  return (
    <svg viewBox="0 0 100 100" width="100" height="100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="46" textAnchor="middle" fill={color} fontSize="20" fontWeight="800">{score}</text>
      <text x="50" y="60" textAnchor="middle" fill="#94a3b8" fontSize="9">/ 100</text>
    </svg>
  );
}

function QuickActionBtn({ icon, label, color, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "#fff", border: "1px solid #f1f5f9", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
      <i className={`ti ${icon}`} style={{ color, fontSize: 18 }} />{label}
    </button>
  );
}

// ─── METRIC CARD ──────────────────────────────────────────────────────────────
function MetricCard({ metric, log, updateData, userData, todayKey }) {
  const [expanded, setExpanded] = useState(false);
  const done = isMetricDone(metric, log);
  const col = COLOR_MAP[metric.color] || COLOR_MAP.gray;

  function patchLog(newLog) {
    const data = { ...userData, logs: { ...userData.logs } };
    data.logs[todayKey] = { ...data.logs[todayKey], [metric.id]: { ...data.logs[todayKey]?.[metric.id], ...newLog } };
    updateData(data);
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${done ? "#d1fae5" : "#f1f5f9"}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: done ? "#d1fae5" : col.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ${metric.icon || "ti-circle"}`} style={{ fontSize: 20, color: done ? "#059669" : col.accent }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{metric.name}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{metricStatus(metric, log)}</div>
        </div>
        {done
          ? <i className="ti ti-circle-check-filled" style={{ color: "#10b981", fontSize: 22 }} />
          : <i className={`ti ti-chevron-${expanded ? "up" : "down"}`} style={{ color: "#94a3b8", fontSize: 16 }} />}
      </div>

      {(metric.type === "quantity" || metric.type === "counter" || metric.type === "time") && metric.goal && (
        <div style={{ height: 3, background: "#f1f5f9", margin: "0 16px" }}>
          <div style={{ height: "100%", borderRadius: 2, background: col.accent, width: `${Math.min(100, ((log?.amount || log?.count || log?.minutes || 0) / metric.goal) * 100)}%`, transition: "width 0.4s" }} />
        </div>
      )}

      {expanded && !done && (
        <div style={{ padding: "14px 16px 16px", borderTop: "1px solid #f8fafc" }}>
          <MetricInput metric={metric} log={log} patchLog={patchLog} />
        </div>
      )}
    </div>
  );
}

function MetricInput({ metric, log, patchLog }) {
  const [local, setLocal] = useState({});

  if (metric.type === "check") {
    return (
      <button onClick={() => patchLog({ done: true, time: new Date().toISOString() })} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>
        <i className="ti ti-check" style={{ marginRight: 6 }} /> Marcar como hecho
      </button>
    );
  }

  if (metric.type === "counter") {
    const cur = log?.count || 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => patchLog({ count: Math.max(0, cur - 1) })} style={{ ...btnSecondary, width: 40, height: 40, borderRadius: "50%", padding: 0, justifyContent: "center", fontSize: 20 }}>−</button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{cur}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>de {metric.goal} veces</div>
        </div>
        <button onClick={() => patchLog({ count: cur + 1 })} style={{ ...btnPrimary, width: 40, height: 40, borderRadius: "50%", padding: 0, justifyContent: "center", fontSize: 20 }}>+</button>
      </div>
    );
  }

  if (metric.type === "quantity") {
    const cur = log?.amount || 0;
    const quick = metric.id === "agua" ? [250, 500, 750, 1000] : [1, 2, 5, 10];
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
          {quick.map(q => (
            <button key={q} onClick={() => patchLog({ amount: cur + q })} style={{ ...btnSecondary, fontSize: 13, padding: "8px 4px", justifyContent: "center" }}>
              +{q >= 1000 ? (q/1000)+"L" : q+(metric.unit||"")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="number" placeholder={`Cantidad (${metric.unit || ""})`} value={local.amt || ""} onChange={e => setLocal({ amt: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => { patchLog({ amount: cur + Number(local.amt || 0) }); setLocal({}); }} style={btnPrimary}>Añadir</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Total: {cur} {metric.unit || ""} / {metric.goal} {metric.unit || ""}</div>
      </div>
    );
  }

  if (metric.type === "time") {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4 }}>Inicio</label>
            <input type="time" value={local.start || ""} onChange={e => setLocal(l => ({ ...l, start: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4 }}>Fin</label>
            <input type="time" value={local.end || ""} onChange={e => setLocal(l => ({ ...l, end: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <button onClick={() => {
          if (local.start && local.end) {
            const [sh, sm] = local.start.split(":").map(Number);
            const [eh, em] = local.end.split(":").map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins < 0) mins += 1440;
            patchLog({ minutes: mins, start: local.start, end: local.end });
          }
        }} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Guardar</button>
        {log?.minutes && <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Registrado: {fmtMins(log.minutes)}</div>}
      </div>
    );
  }

  if (metric.type === "number") {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" placeholder={`Valor (${metric.unit || ""})`} value={local.val || ""} onChange={e => setLocal({ val: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
        <button onClick={() => { patchLog({ value: Number(local.val), unit: metric.unit }); setLocal({}); }} style={btnPrimary}>Guardar</button>
      </div>
    );
  }

  if (metric.type === "scale") {
    const cur = log?.value || 0;
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{metric.min || 1}</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{cur || "—"}</span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{metric.max || 10}</span>
        </div>
        <input type="range" min={metric.min || 1} max={metric.max || 10} value={cur || metric.min || 1} onChange={e => patchLog({ value: Number(e.target.value) })} style={{ width: "100%" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {Array.from({ length: (metric.max || 10) - (metric.min || 1) + 1 }, (_, i) => i + (metric.min || 1)).map(v => (
            <button key={v} onClick={() => patchLog({ value: v })} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${cur === v ? "#6366f1" : "#e2e8f0"}`, background: cur === v ? "#6366f1" : "#fff", color: cur === v ? "#fff" : "#0f172a", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>{v}</button>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// ─── PENDING VIEW ─────────────────────────────────────────────────────────────
function PendingView({ userData }) {
  const todayKey = today();
  const logs = userData.logs?.[todayKey] || {};
  const metrics = (userData.metrics || []).filter(m => !m.archived);
  const pending = metrics.filter(m => !isMetricDone(m, logs[m.id]));
  const done = metrics.filter(m => isMetricDone(m, logs[m.id]));

  return (
    <div>
      <h1 style={pageTitle}>¿Qué me falta hoy?</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>{pending.length === 0 ? "¡Todo completado hoy! 🎉" : `${pending.length} pendiente${pending.length > 1 ? "s" : ""}`}</p>

      {pending.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 14, padding: 16, marginBottom: 20 }}>
          {pending.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid #fef3c7" }}>
              <i className="ti ti-alert-triangle" style={{ color: "#d97706", fontSize: 16, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#92400e" }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#b45309" }}>{pendingDetail(m, logs[m.id])}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: 16 }}>
          {done.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #dcfce7" }}>
              <i className="ti ti-circle-check" style={{ color: "#16a34a", fontSize: 16 }} />
              <div style={{ fontWeight: 600, fontSize: 14, color: "#166534" }}>{m.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LOG VIEW ─────────────────────────────────────────────────────────────────
function LogView({ userData, updateData }) {
  const [selectedMetric, setSelectedMetric] = useState(null);
  const todayKey = today();
  const metrics = (userData.metrics || []).filter(m => !m.archived);
  const logs = userData.logs?.[todayKey] || {};

  function patchLog(metricId, newLog) {
    const data = { ...userData, logs: { ...userData.logs } };
    data.logs[todayKey] = { ...data.logs[todayKey], [metricId]: { ...data.logs[todayKey]?.[metricId], ...newLog } };
    updateData(data);
  }

  const selectedM = selectedMetric ? metrics.find(x => x.id === selectedMetric) : null;

  if (selectedMetric && selectedM) {
    const m = selectedM;
    return (
      <div>
        <button onClick={() => setSelectedMetric(null)} style={{ ...btnSecondary, marginBottom: 20, gap: 6 }}>
          <i className="ti ti-arrow-left" style={{ fontSize: 16 }} /> Volver
        </button>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: (COLOR_MAP[m.color]||COLOR_MAP.gray).bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className={`ti ${m.icon||"ti-circle"}`} style={{ fontSize: 24, color: (COLOR_MAP[m.color]||COLOR_MAP.gray).accent }} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{m.name}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>{metricStatus(m, logs[m.id])}</p>
            </div>
          </div>
          <MetricInput metric={m} log={logs[m.id]} patchLog={p => patchLog(m.id, p)} />
        </div>
        {m.id === "ejercicio" && <ExerciseLogger log={logs[m.id]} patchLog={p => patchLog(m.id, p)} />}
      </div>
    );
  }

  return (
    <div>
      <h1 style={pageTitle}>Registrar</h1>
      <p style={{ color: "#64748b", marginBottom: 24, fontSize: 15 }}>Selecciona qué quieres registrar hoy.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12 }}>
        {metrics.map(m => {
          const done = isMetricDone(m, logs[m.id]);
          const col = COLOR_MAP[m.color] || COLOR_MAP.gray;
          return (
            <button key={m.id} onClick={() => setSelectedMetric(m.id)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, padding: 16, background: "#fff", border: `1px solid ${done ? "#d1fae5" : "#f1f5f9"}`, borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: done ? "#d1fae5" : col.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className={`ti ${m.icon||"ti-circle"}`} style={{ fontSize: 20, color: done ? "#059669" : col.accent }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{metricStatus(m, logs[m.id])}</div>
              </div>
              {done && <i className="ti ti-circle-check-filled" style={{ color: "#10b981", fontSize: 18 }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExerciseLogger({ log, patchLog }) {
  const types = ["Elíptica","Caminata","Pesas","Bicicleta","Natación","Yoga","Correr","Otro"];
  const [type, setType] = useState(log?.exerciseType || "");
  const [duration, setDuration] = useState(log?.duration || "");
  const [intensity, setIntensity] = useState(log?.intensity || "Media");
  const [notes, setNotes] = useState(log?.notes || "");

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 24, marginTop: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Detalles del ejercicio</h3>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Tipo</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {types.map(t => (
            <button key={t} onClick={() => setType(t)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${type===t?"#6366f1":"#e2e8f0"}`, background: type===t?"#6366f1":"#fff", color: type===t?"#fff":"#374151", cursor: "pointer", fontSize: 13, fontWeight: type===t?600:400 }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Duración (min)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="30" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Intensidad</label>
          <select value={intensity} onChange={e => setIntensity(e.target.value)} style={inputStyle}>
            <option>Baja</option><option>Media</option><option>Alta</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Notas (opcional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="¿Cómo te sentiste?" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
      <button onClick={() => patchLog({ exerciseType: type, duration: Number(duration), intensity, notes, done: true })} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>
        Guardar ejercicio
      </button>
    </div>
  );
}

// ─── TRENDS ───────────────────────────────────────────────────────────────────
function TrendsView({ userData }) {
  const [range, setRange] = useState(7);
  const metrics = (userData.metrics || []).filter(m => !m.archived);
  const days = lastNDays(range);
  const scores = days.map(d => ({ date: d, score: calcScore(metrics, userData.logs?.[d] || {}) }));
  const avgScore = scores.length ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : 0;
  const maxScore = scores.reduce((m, d) => Math.max(m, d.score), 0);

  return (
    <div>
      <h1 style={pageTitle}>Tendencias</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[7, 30, 90].map(n => (
          <button key={n} onClick={() => setRange(n)} style={{ padding: "6px 16px", borderRadius: 8, border: `1px solid ${range===n?"#6366f1":"#e2e8f0"}`, background: range===n?"#6366f1":"#fff", color: range===n?"#fff":"#374151", cursor: "pointer", fontSize: 14, fontWeight: range===n?600:400 }}>{n} días</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Score promedio" value={avgScore} suffix="/100" color="#6366f1" />
        <StatCard label="Mejor día" value={maxScore} suffix="/100" color="#10b981" />
        <StatCard label="Días registrados" value={scores.filter(d => d.score > 0).length} suffix={`/${range}`} color="#f59e0b" />
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Health Score</h3>
        <MiniBarChart data={scores} days={range} />
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Cumplimiento por métrica</h3>
        {metrics.map(m => {
          const completedDays = days.filter(d => isMetricDone(m, userData.logs?.[d]?.[m.id])).length;
          const pct = range > 0 ? Math.round((completedDays / range) * 100) : 0;
          const col = COLOR_MAP[m.color] || COLOR_MAP.gray;
          return (
            <div key={m.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <i className={`ti ${m.icon||"ti-circle"}`} style={{ color: col.accent, fontSize: 15 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{m.name}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: pct>=80?"#10b981":pct>=50?"#f59e0b":"#ef4444" }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ height: "100%", borderRadius: 3, background: col.accent, width: `${pct}%`, transition: "width 0.4s" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniBarChart({ data, days }) {
  const h = 120;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: h, paddingBottom: 24, position: "relative" }}>
      {[25,50,75,100].map(g => (
        <div key={g} style={{ position: "absolute", left: 0, right: 0, bottom: 24 + (g/100)*(h-24)-1, borderTop: "1px dashed #f1f5f9" }}>
          <span style={{ fontSize: 10, color: "#cbd5e1" }}>{g}</span>
        </div>
      ))}
      {data.map(d => {
        const barH = d.score ? Math.max(4, (d.score/100)*(h-24)) : 2;
        const { color } = scoreLabel(d.score);
        const isToday = d.date === today();
        return (
          <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div title={`${d.date}: ${d.score}`} style={{ width: "100%", height: barH, borderRadius: "3px 3px 0 0", background: isToday ? "#6366f1" : (d.score>0 ? color : "#f1f5f9"), transition: "height 0.4s" }} />
            {days <= 14 && <div style={{ fontSize: 9, color: isToday?"#6366f1":"#cbd5e1", fontWeight: isToday?700:400, whiteSpace: "nowrap" }}>{new Date(d.date+"T12:00").toLocaleDateString("es-ES",{weekday:"narrow"})}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, suffix, color }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>
        {value}<span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>{suffix}</span>
      </div>
    </div>
  );
}

// ─── METRICS MANAGER ─────────────────────────────────────────────────────────
function MetricsManager({ userData, updateData }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const blankMetric = () => ({ name: "", icon: "ti-circle", type: "check", goal: "", unit: "", weight: 10, color: "blue", min: 1, max: 10 });
  const [form, setForm] = useState(blankMetric());
  const metrics = userData.metrics || [];

  function saveMetric() {
    if (!form.name.trim()) return;
    const data = { ...userData, metrics: [...metrics] };
    if (editing) {
      data.metrics = data.metrics.map(m => m.id === editing ? { ...m, ...form } : m);
    } else {
      data.metrics.push({ ...form, id: `m_${Date.now()}`, archived: false });
    }
    updateData(data);
    setAdding(false); setEditing(null); setForm(blankMetric());
  }

  function startEdit(m) { setForm({ ...m }); setEditing(m.id); setAdding(true); }
  function deleteMetric(id) { if (!confirm("¿Eliminar esta métrica?")) return; updateData({ ...userData, metrics: metrics.filter(m => m.id !== id) }); }
  function toggleArchive(m) { updateData({ ...userData, metrics: metrics.map(x => x.id===m.id ? { ...x, archived: !x.archived } : x) }); }
  function duplicateMetric(m) { updateData({ ...userData, metrics: [...metrics, { ...m, id: `m_${Date.now()}`, name: m.name+" (copia)", archived: false }] }); }

  const active = metrics.filter(m => !m.archived);
  const archived = metrics.filter(m => m.archived);

  if (adding) {
    return (
      <div>
        <button onClick={() => { setAdding(false); setEditing(null); setForm(blankMetric()); }} style={{ ...btnSecondary, marginBottom: 20, gap: 6 }}>
          <i className="ti ti-arrow-left" style={{ fontSize: 16 }} /> Volver
        </button>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 20px" }}>{editing ? "Editar métrica" : "Nueva métrica"}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Nombre</label>
              <input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="ej. Agua, Vitaminas..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))} style={inputStyle}>
                <option value="check">Check (Sí/No)</option>
                <option value="counter">Contador</option>
                <option value="quantity">Cantidad</option>
                <option value="time">Tiempo</option>
                <option value="number">Número</option>
                <option value="scale">Escala</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Color</label>
              <select value={form.color} onChange={e => setForm(f=>({...f,color:e.target.value}))} style={inputStyle}>
                {Object.keys(COLOR_MAP).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {(form.type==="counter"||form.type==="quantity"||form.type==="time") && (
              <div>
                <label style={labelStyle}>Meta diaria</label>
                <input type="number" value={form.goal} onChange={e => setForm(f=>({...f,goal:Number(e.target.value)}))} style={inputStyle} />
              </div>
            )}
            {(form.type==="quantity"||form.type==="number") && (
              <div>
                <label style={labelStyle}>Unidad</label>
                <input value={form.unit} onChange={e => setForm(f=>({...f,unit:e.target.value}))} placeholder="ml, kg, pasos..." style={inputStyle} />
              </div>
            )}
            {form.type==="scale" && (
              <>
                <div><label style={labelStyle}>Mínimo</label><input type="number" value={form.min} onChange={e => setForm(f=>({...f,min:Number(e.target.value)}))} style={inputStyle} /></div>
                <div><label style={labelStyle}>Máximo</label><input type="number" value={form.max} onChange={e => setForm(f=>({...f,max:Number(e.target.value)}))} style={inputStyle} /></div>
              </>
            )}
            <div>
              <label style={labelStyle}>Peso en Health Score</label>
              <input type="number" min={0} max={100} value={form.weight} onChange={e => setForm(f=>({...f,weight:Number(e.target.value)}))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ícono (clase Tabler)</label>
              <input value={form.icon} onChange={e => setForm(f=>({...f,icon:e.target.value}))} placeholder="ti-droplet" style={inputStyle} />
              <div style={{ marginTop: 6 }}><i className={`ti ${form.icon}`} style={{ fontSize: 24, color: (COLOR_MAP[form.color]||COLOR_MAP.gray).accent }} /></div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button onClick={saveMetric} style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}>{editing ? "Guardar cambios" : "Crear métrica"}</button>
            <button onClick={() => { setAdding(false); setEditing(null); setForm(blankMetric()); }} style={btnSecondary}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ ...pageTitle, margin: 0 }}>Métricas</h1>
        <button onClick={() => setAdding(true)} style={btnPrimary}><i className="ti ti-plus" style={{ marginRight: 6 }} /> Nueva</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {active.map(m => <MetricRow key={m.id} metric={m} onEdit={startEdit} onDelete={deleteMetric} onArchive={toggleArchive} onDuplicate={duplicateMetric} />)}
        {active.length === 0 && <EmptyState icon="ti-adjustments" title="Sin métricas" body="Crea tu primera métrica de salud." />}
      </div>
      {archived.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", margin: "0 0 12px" }}>Archivadas</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {archived.map(m => <MetricRow key={m.id} metric={m} onEdit={startEdit} onDelete={deleteMetric} onArchive={toggleArchive} onDuplicate={duplicateMetric} isArchived />)}
          </div>
        </>
      )}
    </div>
  );
}

function MetricRow({ metric, onEdit, onDelete, onArchive, onDuplicate, isArchived }) {
  const col = COLOR_MAP[metric.color] || COLOR_MAP.gray;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#fff", borderRadius: 12, border: "1px solid #f1f5f9", opacity: isArchived ? 0.6 : 1 }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: col.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${metric.icon||"ti-circle"}`} style={{ fontSize: 18, color: col.accent }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{metric.name}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{typeLabel(metric.type)} · Peso: {metric.weight}pts{metric.goal ? ` · Meta: ${metric.goal}${metric.unit?" "+metric.unit:""}` : ""}</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <IconBtn icon="ti-copy"   title="Duplicar"                       onClick={() => onDuplicate(metric)} />
        <IconBtn icon="ti-edit"   title="Editar"                         onClick={() => onEdit(metric)} />
        <IconBtn icon={isArchived?"ti-archive-off":"ti-archive"} title={isArchived?"Restaurar":"Archivar"} onClick={() => onArchive(metric)} />
        <IconBtn icon="ti-trash"  title="Eliminar"                       onClick={() => onDelete(metric.id)} danger />
      </div>
    </div>
  );
}

function IconBtn({ icon, title, onClick, danger }) {
  return (
    <button onClick={onClick} title={title} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #f1f5f9", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: danger?"#ef4444":"#94a3b8" }}>
      <i className={`ti ${icon}`} style={{ fontSize: 16 }} />
    </button>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function ProfileView({ user, userData, updateData, onLogout }) {
  const [name, setName] = useState(user.displayName || "");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function saveName() {
    try { await updateUserName(name); setMsg("Nombre actualizado."); setTimeout(() => setMsg(""), 3000); }
    catch (e) { setErr("No se pudo actualizar."); }
  }

  async function handleChangePw() {
    setErr(""); setMsg("");
    if (newPw.length < 6) { setErr("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw(""); setNewPw("");
      setMsg("Contraseña actualizada correctamente.");
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setErr(e.code === "auth/wrong-password" ? "Contraseña actual incorrecta." : "No se pudo actualizar.");
    }
  }

  const allDays = Object.keys(userData.logs || {});
  const metrics = (userData.metrics || []).filter(m => !m.archived);
  const avgScore = allDays.length ? Math.round(allDays.reduce((s, d) => s + calcScore(metrics, userData.logs[d]), 0) / allDays.length) : 0;

  return (
    <div>
      <h1 style={pageTitle}>Mi perfil</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Días registrados" value={allDays.length} suffix="" color="#6366f1" />
        <StatCard label="Score promedio" value={avgScore} suffix="/100" color="#10b981" />
        <StatCard label="Métricas activas" value={metrics.length} suffix="" color="#f59e0b" />
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Información personal</h2>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Correo</label>
          <input value={user.email} disabled style={{ ...inputStyle, background: "#f8fafc", color: "#94a3b8" }} />
        </div>
        <button onClick={saveName} style={btnPrimary}>Guardar nombre</button>
        {msg && <div style={{ color: "#16a34a", fontSize: 13, marginTop: 10 }}>{msg}</div>}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9", padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Cambiar contraseña</h2>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Contraseña actual</label>
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Nueva contraseña</label>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} style={inputStyle} />
        </div>
        {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button onClick={handleChangePw} style={btnPrimary}>Actualizar contraseña</button>
      </div>

      <button onClick={onLogout} style={{ ...btnSecondary, color: "#ef4444", borderColor: "#fecaca", width: "100%", justifyContent: "center" }}>
        <i className="ti ti-logout" style={{ marginRight: 8 }} /> Cerrar sesión
      </button>
    </div>
  );
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────
function EmptyState({ icon, title, body }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px" }}>
      <i className={`ti ${icon}`} style={{ fontSize: 40, color: "#e2e8f0" }} />
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#94a3b8", margin: "12px 0 6px" }}>{title}</h3>
      <p style={{ color: "#cbd5e1", fontSize: 14, margin: 0 }}>{body}</p>
    </div>
  );
}
