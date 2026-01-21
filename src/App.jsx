import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { ensureProfile } from "./services/profiles";
import { getMyProfile, updateMyProfile } from "./services/profiles";
import confetti from "canvas-confetti";

import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import UserProfile from "./UserProfile";
import StravaCallback from "./StravaCallback";



export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) ensureProfile(data.session.user);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) ensureProfile(session.user);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <div
              style={{
                maxWidth: 600,
                margin: "40px auto",
                fontFamily: "system-ui",
              }}
            >
              <h1>Rollea Comunidad</h1>
              {!session ? <Auth /> : <Dashboard session={session} />}
            </div>
          }
        />
        <Route path="/u/:id" element={<UserProfile />} />
        <Route path="/strava-callback" element={<StravaCallback />} />

      </Routes>
    </BrowserRouter>
  );
}


function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const signUp = async () => {
    setMsg("");
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "Cuenta creada. Ahora inicia sesión.");
  };

  const signIn = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "Sesión iniciada.");
  };

  return (
    <div>
      <h2>Ingresar</h2>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10, boxSizing: "border-box" }}
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10, boxSizing: "border-box" }}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={signIn}>Iniciar sesión</button>
        <button onClick={signUp}>Crear cuenta</button>
      </div>

      {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}

function Dashboard({ session }) {
  const userId = session.user.id;
  const [activities, setActivities] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [birthdate, setBirthdate] = useState("");
  const [savingBirthdate, setSavingBirthdate] = useState(false);
  const [birthdayToday, setBirthdayToday] = useState(false);
  const [shouldShowBirthdayMessage, setShouldShowBirthdayMessage] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [communities, setCommunities] = useState([]);
  const [memberships, setMemberships] = useState({}); // { community_id: role }
  const [joinRequests, setJoinRequests] = useState({}); // { community_id: status }
  const [selectedCommunityId, setSelectedCommunityId] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [goingInfo, setGoingInfo] = useState({});
  // { [activityId]: { count: number, users: {id,name}[] } }
  const [displayName, setDisplayName] = useState("");
  const [visibility, setVisibility] = useState("public"); // public | private
  const [savingProfile, setSavingProfile] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaLinking, setStravaLinking] = useState(false);
  const [stravaError, setStravaError] = useState("");
  const [stravaStatusLoading, setStravaStatusLoading] = useState(false);
  const [stravaIsConnected, setStravaIsConnected] = useState(false);
  const [kmYear, setKmYear] = useState(new Date().getFullYear());
  const [kmLoading, setKmLoading] = useState(false);
  const [kmData, setKmData] = useState({ km: 0, activities_count: 0 });
  const [kmAutoSynced, setKmAutoSynced] = useState(false);


useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("strava");

  if (connected === "connected") {
    setStravaConnected(true);

    // Limpiar la URL sin recargar la página
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}, []);
  
const loadStravaStatus = async () => {
  setStravaStatusLoading(true);
  setError("");

  const { data, error } = await supabase
    .from("strava_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    setError(error.message);
    setStravaStatusLoading(false);
    return;
  }

  setStravaIsConnected(!!data);
  setStravaStatusLoading(false);
};



const loadGoingInfo = async (activityIds) => {
  if (!activityIds?.length) {
    setGoingInfo({});
    return;
  }

  setError("");

  const { data, error } = await supabase
    .from("attendance")
    .select(`
      activity_id,
      profiles:profiles (
        id,
        display_name,
        attendance_visibility
      )
    `)
    .in("activity_id", activityIds)
    .eq("status", "going");

  if (error) {
    setError(error.message);
    return;
  }

  const map = {};

  for (const row of data || []) {
    const actId = row.activity_id;
    if (!map[actId]) map[actId] = { count: 0, users: [] };

    map[actId].count += 1;

    const p = row.profiles;
    if (p && p.attendance_visibility === "public") {
      const name = (p.display_name || "").trim() || "Usuario";
      if (map[actId].users.length < 5) {
  map[actId].users.push({ id: p.id, name });
}

    }
  }

  setGoingInfo(map);
};


  const isAdminOfSelected =
  selectedCommunityId && memberships[selectedCommunityId] === "admin";

  const loadPendingRequests = async () => {
  if (!selectedCommunityId) return;

  setError("");

  const { data, error } = await supabase
    .from("community_join_requests")
    .select(`
  id,
  user_id,
  status,
  created_at,
  message,
  profiles:profiles (
    id,
    display_name
  )
`)

    .eq("community_id", selectedCommunityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    setError(error.message);
    return;
  }

  setPendingRequests(data || []);
};

  const requestToJoin = async (communityId) => {
  setError("");

  const { error } = await supabase
    .from("community_join_requests")
    .insert({
      community_id: communityId,
      user_id: userId,
      status: "pending",
    });

  if (error) {
    setError(error.message);
    return;
  }

  await loadCommunities();
};
 
  
  const loadCommunities = async () => {
  setError("");

  // 1) comunidades
  const { data: comms, error: commsError } = await supabase
    .from("communities")
    .select("id, name")
    .order("created_at", { ascending: true });

  if (commsError) {
    setError(commsError.message);
    return;
  }

  // 2) mis membresías
  const { data: mems, error: memsError } = await supabase
    .from("community_members")
    .select("community_id, role")
    .eq("user_id", userId);

  if (memsError) {
    setError(memsError.message);
    return;
  }

  // 3) mis solicitudes
  const { data: reqs, error: reqsError } = await supabase
    .from("community_join_requests")
    .select("community_id, status")
    .eq("user_id", userId);

  if (reqsError) {
    setError(reqsError.message);
    return;
  }

  const memMap = {};
  mems?.forEach((m) => (memMap[m.community_id] = m.role));

  const reqMap = {};
  reqs?.forEach((r) => (reqMap[r.community_id] = r.status));

  setCommunities(comms || []);
  setMemberships(memMap);
  setJoinRequests(reqMap);

  // Default: primera comunidad donde soy miembro, o primera disponible
  if (!selectedCommunityId) {
    const firstMember = (comms || []).find((c) => memMap[c.id]);
    setSelectedCommunityId(firstMember?.id || comms?.[0]?.id || "");
  }
};

  function fireBirthdayConfetti() {
  confetti({
    particleCount: 80,
    spread: 70,
    startVelocity: 25,
    gravity: 0.9,
    ticks: 180,
    origin: { y: 0.6 },
  });
}

  function isBirthdayToday(birthdate) {
  if (!birthdate) return false;

  // birthdate viene como "YYYY-MM-DD"
  const [y, m, d] = birthdate.split("-").map(Number);

  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth() + 1; // 1-12

  return d === todayDay && m === todayMonth;
}

const approveRequest = async (req) => {
  setError("");

  // 1) marcar request como approved
  const { error: updError } = await supabase
    .from("community_join_requests")
    .update({
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", req.id);

  if (updError) {
    setError(updError.message);
    return;
  }

  // 2) crear membresía
  const { error: insError } = await supabase
    .from("community_members")
    .insert({
      community_id: selectedCommunityId,
      user_id: req.user_id,
      role: "member",
    });

  if (insError) {
    setError(insError.message);
    return;
  }

  await loadPendingRequests();
};

const rejectRequest = async (req) => {
  setError("");

  const { error } = await supabase
    .from("community_join_requests")
    .update({
      status: "rejected",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", req.id);

  if (error) {
    setError(error.message);
    return;
  }

  await loadPendingRequests();
};


  useEffect(() => {
  loadCommunities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useEffect(() => {
  if (isAdminOfSelected) {
    loadPendingRequests();
  } else {
    setPendingRequests([]);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedCommunityId, memberships]);


  useEffect(() => {
  async function loadProfile() {
    const { data, error } = await getMyProfile(userId);
    if (error || !data) return;

    // 🎂 Cumpleaños (si existe)
    if (data.birthdate) setBirthdate(data.birthdate);

    const isToday = isBirthdayToday(data.birthdate);
    setBirthdayToday(isToday);

    const dismissedToday =
      data.birthday_dismissed_on === new Date().toISOString().slice(0, 10);

    setShouldShowBirthdayMessage(isToday && !dismissedToday);

    // 👤 Perfil (siempre)
    setDisplayName(data.display_name || "");
    setVisibility(data.attendance_visibility || "public");
    await loadStravaStatus();
  }

  loadProfile();
}, [userId]);

  function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1) - day; // lunes como inicio
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date = new Date()) {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}

  const loadData = async () => {
    setError("");

let query = supabase
  .from("activities")
  .select("id, title, starts_at, location, description, community_id")
  .order("starts_at", { ascending: true });

if (selectedCommunityId) {
  query = query.eq("community_id", selectedCommunityId);
}

if (!showAll) {
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek();
  query = query
    .gte("starts_at", weekStart.toISOString())
    .lte("starts_at", weekEnd.toISOString());
}

const { data: acts, error: actsError } = await query;

if (actsError) {
  setError(actsError.message);
  return;
}

    const { data: att, error: attError } = await supabase
      .from("attendance")
      .select("activity_id, status")
      .eq("user_id", userId);

    if (attError) {
      setError(attError.message);
      return;
    }

    const map = {};
    att?.forEach((a) => (map[a.activity_id] = a.status));

    setActivities(acts || []);
    setAttendance(map);

await loadGoingInfo((acts || []).map((a) => a.id));


  };

  useEffect(() => {
  if (shouldShowBirthdayMessage && !confettiFired) {
    fireBirthdayConfetti();
    setConfettiFired(true);
  }
}, [shouldShowBirthdayMessage, confettiFired]);


  useEffect(() => {
  if (selectedCommunityId) {
    loadData();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showAll, selectedCommunityId]);

const syncYearKm = async (year) => {
  setError("");
  setKmLoading(true);

  try {
    const raw = JSON.parse(localStorage.getItem("sb-crehuacuhxpgdcohumlf-auth-token"));
    const jwt = raw?.access_token;

    if (!jwt) {
      setError("No hay sesión activa.");
      setKmLoading(false);
      return;
    }

    const res = await fetch(
      `https://crehuacuhxpgdcohumlf.functions.supabase.co/strava-sync-year?year=${year}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    const json = await res.json();

    if (!res.ok) {
      setError(json?.error || "Error al sincronizar km.");
      setKmLoading(false);
      return;
    }

    setKmData({
      km: json.km || 0,
      activities_count: json.activities_count || 0,
    });
  } catch (e) {
    setError(String(e));
  } finally {
    setKmLoading(false);
  }
};


const connectStrava = async () => {
  setStravaError("");
  setStravaLinking(true);

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) {
      setStravaError("No hay sesión activa. Vuelve a iniciar sesión.");
      setStravaLinking(false);
      return;
    }

    const res = await fetch(
      "https://crehuacuhxpgdcohumlf.functions.supabase.co/strava-auth",
      {
        headers: { Authorization: "Bearer " + token },
      }
    );

    const json = await res.json();

    if (!res.ok) {
      setStravaError(json?.error || json?.message || "Error conectando con Strava");
      setStravaLinking(false);
      return;
    }

    if (!json?.authorize_url) {
      setStravaError("No se recibió authorize_url");
      setStravaLinking(false);
      return;
    }

    window.location.href = json.authorize_url;
  } catch (e) {
    setStravaError(String(e));
    setStravaLinking(false);
  }
};

const disconnectStrava = async () => {
  setError("");

  const { error } = await supabase
    .from("strava_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) {
    setError(error.message);
    return;
  }

  // Actualizar estado en UI
  setStravaIsConnected(false);

  // 🔹 LIMPIEZA DE KILÓMETROS (ESTO ES LO NUEVO)
  setKmData({ km: 0, activities_count: 0 });
  setKmAutoSynced(false);
  setKmYear(new Date().getFullYear());
};

useEffect(() => {
  // Auto-sync solo si:
  // - Strava está conectado
  // - no está cargando el estado
  // - aún no hicimos auto sync
  if (!stravaStatusLoading && stravaIsConnected && !kmAutoSynced) {
    syncYearKm(new Date().getFullYear());
    setKmAutoSynced(true);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [stravaStatusLoading, stravaIsConnected, kmAutoSynced]);


  const markAttendance = async (activityId, status) => {
  setError("");

  const { error } = await supabase
    .from("attendance")
    .upsert(
      {
        user_id: userId,
        activity_id: activityId,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,activity_id" }
    );

  if (error) {
    setError(error.message);
    return;
  }

  // Actualización inmediata en pantalla
  setAttendance((prev) => ({ ...prev, [activityId]: status }));

  // Recarga desde DB para que quede 100% consistente
  await loadData();
};

const dismissBirthdayToday = async () => {
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Guardar en DB
  const { error } = await updateMyProfile(userId, {
    birthday_dismissed_on: todayStr,
  });

  if (error) {
    setError(error.message);
    return;
  }

  // Ocultar en UI inmediatamente
  setShouldShowBirthdayMessage(false);
  setConfettiFired(false);

};


  const signOut = async () => {
    await supabase.auth.signOut();
  };

  function dayLabel(startsAt) {
  const d = new Date(startsAt);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const d0 = new Date(d);
  d0.setHours(0, 0, 0, 0);

  if (d0.getTime() === today.getTime()) return "Hoy";
  if (d0.getTime() === tomorrow.getTime()) return "Mañana";

  // Ej: "Lun 18"
  return d.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit" });
}

function formatTime(startsAt) {
  return new Date(startsAt).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isPast(startsAt) {
  return new Date(startsAt).getTime() < Date.now();
}


  return (


    
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Actividades</h2>
          <button onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Ver solo esta semana" : "Ver todas"}
          </button>
      </div>

      <button onClick={signOut}>Salir</button>
    </div>

    {stravaConnected && (
  <div
    style={{
      border: "1px solid #d1fae5",
      background: "#ecfdf5",
      color: "#065f46",
      padding: 12,
      borderRadius: 10,
      marginBottom: 12,
      fontSize: 14,
    }}
  >
    ✅ <strong>Strava conectado correctamente.</strong>  
    <div style={{ opacity: 0.8 }}>
      Ya puedes comenzar a sincronizar tus kilómetros.
    </div>
  </div>
)}


    <div style={{ marginTop: 12, marginBottom: 12 }}>
  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 6 }}>
    Comunidad
  </div>

  

  <select
    value={selectedCommunityId}
    onChange={(e) => setSelectedCommunityId(e.target.value)}
    style={{ width: "100%", padding: 10 }}
  >
    {communities.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
        {memberships[c.id] ? " (miembro)" : joinRequests[c.id] ? ` (${joinRequests[c.id]})` : ""}
      </option>
    ))}
  </select>

    {!memberships[selectedCommunityId] && (
    <div style={{ marginTop: 10 }}>
      {joinRequests[selectedCommunityId] === "pending" && (
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Solicitud enviada ⏳ (pendiente)
        </div>
      )}

      {joinRequests[selectedCommunityId] === "rejected" && (
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Solicitud rechazada ❌
        </div>
      )}

      {!joinRequests[selectedCommunityId] && (
        <button onClick={() => requestToJoin(selectedCommunityId)}>
          Solicitar unirse
        </button>
      )}
    </div>
  )}
</div>

{isAdminOfSelected && (
  <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 12 }}>
    <div style={{ fontWeight: 600, marginBottom: 8 }}>Solicitudes pendientes</div>

    {pendingRequests.length === 0 ? (
      <div style={{ fontSize: 13, opacity: 0.7 }}>No hay solicitudes pendientes.</div>
    ) : (
      pendingRequests.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid #f2f2f2" }}>
          <div style={{ fontSize: 13 }}>
            <div>
  <strong>User:</strong>{" "}
  <Link to={`/u/${r.user_id}`} style={{ textDecoration: "underline" }}>
    {(r.profiles?.display_name || "").trim() || "Usuario"}
  </Link>
</div>

            {r.message && <div style={{ opacity: 0.8 }}>{r.message}</div>}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => approveRequest(r)}>Aprobar</button>
            <button onClick={() => rejectRequest(r)}>Rechazar</button>
          </div>
        </div>
      ))
    )}
  </div>
)}


    {shouldShowBirthdayMessage && (
  <div
    style={{
      border: "1px solid #e6e6e6",
      borderRadius: 10,
      padding: 12,
      marginTop: 12,
      marginBottom: 12,
      background: "var(--birthday-bg, #fafafa)",
      color: "#111",
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "center",
    }}
  >
    <div style={{ fontSize: 14 }}>
      🎉 <strong>¡Feliz cumpleaños!</strong>{" "}
      <span style={{ opacity: 0.8 }}>Que tengas un gran día.</span>
    </div>

    <div style={{ display: "flex", gap: 10 }}>
      <button onClick={dismissBirthdayToday}>
        No ver hoy
      </button>
    </div>
  </div>
)}


    <div style={{ marginBottom: 20 }}>
  <label style={{ fontSize: 14, opacity: 0.8 }}>
    🎂 Tu cumpleaños
  </label>

  <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
    <input
      type="date"
      value={birthdate || ""}
      onChange={(e) => setBirthdate(e.target.value)}
    />

    <button
  disabled={savingBirthdate}
  onClick={async () => {
    setSavingBirthdate(true);

    const { error } = await updateMyProfile(userId, { birthdate });

    if (error) {
      setError(error.message);
      setSavingBirthdate(false);
      return;
    }

    // 🔹 Recalcular cumpleaños inmediatamente
    const isToday = isBirthdayToday(birthdate);
    setBirthdayToday(isToday);

    // 🔹 Como recién se guarda, asumimos que NO lo ha ocultado hoy
    setShouldShowBirthdayMessage(isToday);

    setSavingBirthdate(false);
  }}
>
  Guardar
</button>

  </div>
</div>

<div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 12 }}>
  <div style={{ fontWeight: 600, marginBottom: 8 }}>Tu perfil</div>

  <div style={{ marginBottom: 10 }}>
    <label style={{ fontSize: 13, opacity: 0.8 }}>Nombre público</label>
    <input
      value={displayName}
      onChange={(e) => setDisplayName(e.target.value)}
      placeholder="Ej: Alberto"
      style={{ width: "100%", padding: 10, marginTop: 6, boxSizing: "border-box" }}
    />
  </div>

  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
    <label style={{ fontSize: 13, opacity: 0.8 }}>Asistencia</label>

    <select
      value={visibility}
      onChange={(e) => setVisibility(e.target.value)}
      style={{ padding: 10, boxSizing: "border-box" }}
    >
      <option value="public">Pública (aparece tu nombre)</option>
      <option value="private">Privada (solo suma al contador)</option>
    </select>
  </div>

  <button
    disabled={savingProfile}
    onClick={async () => {
      setSavingProfile(true);

      const cleanName = displayName.trim();

      const { error } = await updateMyProfile(userId, {
        display_name: cleanName,
        attendance_visibility: visibility,
      });

      if (error) {
        setError(error.message);
        setSavingProfile(false);
        return;
      }

      setSavingProfile(false);

      // ✅ refrescar "Quién va" para que se vea al tiro
      await loadGoingInfo(activities.map((a) => a.id));
    }}
  >
    Guardar perfil
  </button>

  <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "14px 0" }} />

<div>
  <div style={{ fontWeight: 600, marginBottom: 8 }}>
    Kilómetros (InlineSkate)
  </div>

  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
    <select
      value={kmYear}
      onChange={(e) => setKmYear(Number(e.target.value))}
      style={{ padding: 10, boxSizing: "border-box" }}
    >
      {Array.from({ length: 6 }).map((_, i) => {
        const y = new Date().getFullYear() - i;
        return (
          <option key={y} value={y}>
            {y}
          </option>
        );
      })}
    </select>

    <button
      disabled={kmLoading}
      onClick={() => syncYearKm(kmYear)}
      style={{ padding: "10px 12px" }}
    >
      {kmLoading ? "Sincronizando..." : "Sincronizar"}
    </button>
  </div>

  <div style={{ fontSize: 14, opacity: 0.9 }}>
    <div>
      <strong>{kmData.km}</strong> km • {kmData.activities_count} actividades
    </div>
    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
      *Se calcula desde Strava filtrando sport_type = InlineSkate
    </div>
  </div>
</div>


  <div style={{ marginTop: 10 }}>
  {!stravaIsConnected ? (
  <button disabled={stravaLinking} onClick={connectStrava}>
    {stravaLinking ? "Conectando..." : "Conectar con Strava"}
  </button>
) : (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{ fontSize: 13, opacity: 0.85 }}>
      ✅ Strava conectado
    </div>

    <button
      onClick={disconnectStrava}
      style={{
        fontSize: 12,
        padding: "6px 10px",
        opacity: 0.8,
      }}
    >
      Desconectar
    </button>
  </div>
)}



  {stravaError && (
    <div style={{ marginTop: 8, color: "crimson", fontSize: 13 }}>
      {stravaError}
    </div>
  )}
</div>

{!stravaIsConnected && (
  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
    {stravaStatusLoading ? "Comprobando Strava..." : "❌ Strava no conectado"}
  </div>
)}



</div>



      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {activities.map((a) => {
  const past = isPast(a.starts_at);

  return (
    <div
      key={a.id}
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        opacity: past ? 0.7 : 1,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
        {dayLabel(a.starts_at)}
      </div>

      <strong style={{ fontSize: 16 }}>{a.title}</strong>

      <div style={{ fontSize: 14, marginTop: 4 }}>
        🕒 <strong>{formatTime(a.starts_at)}</strong>
        {a.location && (
          <span style={{ opacity: 0.7 }}> • {a.location}</span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => markAttendance(a.id, "going")}
          disabled={past}
          style={{
            fontWeight: attendance[a.id] === "going" ? "bold" : "normal",
            opacity: past ? 0.5 : 1,
            cursor: past ? "not-allowed" : "pointer",
          }}
        >
          Voy ✅
        </button>

        <button
          onClick={() => markAttendance(a.id, "not_going")}
          disabled={past}
          style={{
            marginLeft: 10,
            fontWeight:
              attendance[a.id] === "not_going" ? "bold" : "normal",
            opacity: past ? 0.5 : 1,
            cursor: past ? "not-allowed" : "pointer",
          }}
        >
          No puedo ❌
        </button>
      </div>

      {past && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          Actividad finalizada ⏱️
        </div>
      )}

<div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
  {(() => {
    const info = goingInfo[a.id];
    const count = info?.count || 0;
    const users = info?.users || [];

    if (count === 0) return "Aún nadie confirma asistencia.";
    if (users.length === 0) return `Van: ${count}`;

    const extra = count - users.length;

    return (
      <>
        Van:{" "}
        {users.map((u, idx) => (
          <span key={u.id}>
            <Link to={`/u/${u.id}`} style={{ textDecoration: "underline" }}>
              {u.name}
            </Link>
            {idx < users.length - 1 ? ", " : ""}
          </span>
        ))}
        {extra > 0 ? ` y ${extra} más` : ""} ({count})
      </>
    );
  })()}
</div>

      <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
        Tu respuesta:{" "}
        {attendance[a.id] === "going"
          ? "Voy ✅"
          : attendance[a.id] === "not_going"
          ? "No puedo ❌"
          : "—"}
      </div>
    </div>
  );
})}

    </div>
  );
}