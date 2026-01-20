import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "./supabaseClient";

export default function UserProfile() {
  const { id } = useParams(); // id del usuario (profiles.id)
  const [profile, setProfile] = useState(null);
  const [goingCount, setGoingCount] = useState(0);
  const [error, setError] = useState("");
  const [memberCommunities, setMemberCommunities] = useState([]);
const [countsByCommunity, setCountsByCommunity] = useState({});
const currentYear = new Date().getFullYear();
const [selectedYear, setSelectedYear] = useState(currentYear);
const [distanceKm, setDistanceKm] = useState(0);

const loadYearDistance = async (year) => {
  const { data, error } = await supabase
    .from("user_year_stats")
    .select("distance_km")
    .eq("user_id", id)
    .eq("sport", "inline_skating")
    .eq("year", year)
    .single();

  // No es error si no hay fila todavía
  if (error && error.code !== "PGRST116") {
    setError(error.message);
    return;
  }

  setDistanceKm(data?.distance_km || 0);
};


  useEffect(() => {
    async function load() {
      setError("");

      // 1) Perfil
      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name, attendance_visibility")
        .eq("id", id)
        .single();

      if (pErr) {
        setError(pErr.message);
        return;
      }
      setProfile(p);

      // 3) Comunidades donde es miembro
const { data: mems, error: mErr } = await supabase
  .from("community_members")
  .select(`
    community_id,
    role,
    communities:communities (
      id,
      name
    )
  `)
  .eq("user_id", id);

if (mErr) {
  setError(mErr.message);
  return;
}

const comms = (mems || [])
  .map((m) => ({
    id: m.communities?.id,
    name: m.communities?.name,
    role: m.role,
  }))
  .filter((c) => c.id);

setMemberCommunities(comms);

// 4) Contar asistencias "going" por comunidad (solo para sus comunidades)
if (comms.length > 0) {
  const communityIds = comms.map((c) => c.id);

  const { data: rows, error: aErr } = await supabase
    .from("attendance")
    .select(`
      status,
      activities:activities (
        community_id
      )
    `)
    .eq("user_id", id)
    .eq("status", "going");

  if (aErr) {
    setError(aErr.message);
    return;
  }

  const counts = {};
  for (const row of rows || []) {
    const cid = row.activities?.community_id;
    if (!cid) continue;
    if (!communityIds.includes(cid)) continue;
    counts[cid] = (counts[cid] || 0) + 1;
  }

  setCountsByCommunity(counts);
  await loadYearDistance(selectedYear);

}



      // 2) Contador de asistencias "going" (solo número)
      const { count, error: cErr } = await supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id)
        .eq("status", "going");

      if (cErr) {
        setError(cErr.message);
        return;
      }
      setGoingCount(count || 0);
    }

    load();
  }, [id, selectedYear]);

function formatKm(value) {
  const n = Number(value || 0);
  return n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}


  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 12 }}>
        <Link to="/">← Volver</Link>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!profile ? (
        <p>Cargando...</p>
      ) : (
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>
            {profile.display_name?.trim() || "Usuario"}
          </h2>

          <div style={{ fontSize: 14, opacity: 0.85 }}>
            Asistencias (Voy): <strong>{goingCount}</strong>
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
  <div style={{ fontWeight: 600, marginBottom: 6 }}>
    Kilómetros en patinaje
  </div>

  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <select
      value={selectedYear}
      onChange={(e) => setSelectedYear(Number(e.target.value))}
      style={{ padding: 8 }}
    >
      {Array.from({ length: 6 }, (_, i) => currentYear - i).map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>

    <div style={{ fontSize: 18 }}>
      <strong>{formatKm(distanceKm)}</strong> km
    </div>
  </div>

  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
    (Luego se sincronizará automáticamente con Strava)
  </div>
</div>


          <div style={{ marginTop: 12 }}>
  <div style={{ fontWeight: 600, marginBottom: 8 }}>Comunidades</div>

  {memberCommunities.length === 0 ? (
    <div style={{ fontSize: 13, opacity: 0.7 }}>
      No pertenece a ninguna comunidad.
    </div>
  ) : (
    memberCommunities.map((c) => (
      <div
        key={c.id}
        style={{
          padding: "8px 0",
          borderTop: "1px solid #f2f2f2",
          fontSize: 14,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          {c.name}{" "}
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            ({c.role})
          </span>
        </div>

        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Voy: <strong>{countsByCommunity[c.id] || 0}</strong>
        </div>
      </div>
    ))
  )}
</div>


          {profile.attendance_visibility === "private" && (
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>
              Este usuario tiene su asistencia en modo privado.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
