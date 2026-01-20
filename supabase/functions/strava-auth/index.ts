// supabase/functions/strava-auth/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // 1) Leer token del usuario (Supabase session access_token)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2) Cliente para validar usuario (usa ANON, pero con header Authorization)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("STRAVA_CLIENT_ID")!;
    const siteUrl = Deno.env.get("SITE_URL")!; // ej https://rollea.com

    const supaAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // 3) Crear state (anti-CSRF) y guardarlo con Service Role
    const state = crypto.randomUUID();

    const supaAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { error: insErr } = await supaAdmin.from("oauth_states").insert({
      state,
      user_id: userId,
    });

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4) Armar URL de autorización Strava
    const redirectUri = `${supabaseUrl.replace(".supabase.co", ".functions.supabase.co")}/strava-callback`;

    // scopes recomendados para sumar km:
    // read + activity:read_all (para leer actividades y sus distancias)
    const authorizeUrl = new URL("https://www.strava.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("approval_prompt", "auto");
    authorizeUrl.searchParams.set("scope", "read,activity:read_all");
    authorizeUrl.searchParams.set("state", state);

    // 5) Devolver URL al frontend
    return new Response(JSON.stringify({ authorize_url: authorizeUrl.toString() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
