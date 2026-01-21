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

      // 👇 llama a tu Edge Function callback (Supabase)
      const res = await fetch(
        `https://crehuacuhxpgdcohumlf.functions.supabase.co/strava-callback?code=${encodeURIComponent(
          code
        )}&state=${encodeURIComponent(state)}`
      );

      // Si tu función hace redirect 302, fetch puede devolver ok=false o status raro según el navegador.
      // Así que manejamos ambos casos:
      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        setMsg("Falló el callback: " + text);
        return;
      }

      // Si responde JSON OK:
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
