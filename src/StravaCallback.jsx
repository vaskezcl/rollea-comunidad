import { useEffect, useState } from "react";

export default function StravaCallback() {
  const [msg, setMsg] = useState("Conectando con Strava...");

  useEffect(() => {
  async function run() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      setMsg("Error de Strava: " + error);
      return;
    }

    if (!code || !state) {
      setMsg("Faltan parámetros (code/state).");
      return;
    }

    setMsg("Guardando tokens...");

    const callbackUrl = `https://crehuacuhxpgdcohumlf.functions.supabase.co/strava-callback?code=${encodeURIComponent(
      code
    )}&state=${encodeURIComponent(state)}`;

    try {
      await fetch(callbackUrl, { redirect: "follow" });
    } catch (e) {}

    window.location.href = "/?strava=connected";
  }

  run();
}, []);


  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>Strava</h2>
      <p>{msg}</p>
    </div>
  );
}
