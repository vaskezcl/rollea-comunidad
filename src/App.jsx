import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { ensureProfile } from "./services/profiles";
import { getMyProfile, updateMyProfile } from "./services/profiles";



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
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Rollea Comunidad</h1>
      {!session ? <Auth /> : <Dashboard session={session} />}
    </div>
  );
}

function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const signUp = async () => {
    setMsg("");
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    setMsg(error ? error.message : "Cuenta creada. Ahora inicia sesión.");
  };

  const signIn = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setMsg(error ? error.message : "Sesión iniciada.");
  };

  return (
    <div>
      <h2>Ingresar</h2>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />

      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
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


  function isBirthdayToday(birthdate) {
  if (!birthdate) return false;

  const today = new Date();
  const b = new Date(birthdate);

  return (
    today.getDate() === b.getDate() &&
    today.getMonth() === b.getMonth()
  );
}


  useEffect(() => {
  async function loadProfile() {
    const { data, error } = await getMyProfile(userId);
    if (!error && data?.birthdate) {
      setBirthdate(data.birthdate);
      setBirthdayToday(isBirthdayToday(data.birthdate));
    }
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
  .select("id, title, starts_at, location, description")
  .order("starts_at", { ascending: true });

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
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

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
        await updateMyProfile(userId, { birthdate });
        setSavingBirthdate(false);
      }}
    >
      Guardar
    </button>
  </div>
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