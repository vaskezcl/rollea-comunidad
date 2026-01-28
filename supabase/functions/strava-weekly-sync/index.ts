// supabase/functions/strava-weekly-sync/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function toUnixSeconds(d: Date) {
  return Math.floor(d.getTime() / 1000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("STRAVA_CLIENT_ID")!;
    const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET")!;

    const body = await req.json().catch(() => ({}));
    const community_id = body?.community_id as string | undefined;
    const week_start = body?.week_start as string | undefined; // "YYYY-MM-DD"

    if (!community_id || !week_start) {
      return new Response(JSON.stringify({ error: "Missing community_id or week_start" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar usuario con token (anon)
    const supaAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Service role para leer/escribir tokens y upsert totals
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Leer tokens
    const { data: tok, error: tokErr } = await admin
      .from("strava_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokErr || !tok) {
      return new Response(JSON.stringify({ error: "Strava not connected for this user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tok.access_token as string;
    const refreshToken = tok.refresh_token as string;
    const expiresAt = tok.expires_at as number; // unix seconds

    // Refresh si expiró (o está por expirar)
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt < nowSec + 60) {
      const refreshRes = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!refreshRes.ok) {
        const t = await refreshRes.text();
        return new Response(JSON.stringify({ error: "Failed to refresh Strava token", detail: t }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refreshed = await refreshRes.json();
      accessToken = refreshed.access_token;

      await admin.from("strava_tokens").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: refreshed.expires_at,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
    }

    // Calcular rango semana (week_start lunes)
    const start = new Date(`${week_start}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const after = toUnixSeconds(start);
    const before = toUnixSeconds(end);

    // Traer actividades (paginado simple)
    let page = 1;
    const per_page = 200;

    let totalDistance = 0;
    let count = 0;

    while (page <= 5) { // suficiente para la mayoría (1000 acts/semana sería raro)
      const url = new URL("https://www.strava.com/api/v3/athlete/activities");
      url.searchParams.set("after", String(after));
      url.searchParams.set("before", String(before));
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(per_page));

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: "Failed to fetch activities", detail: t }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const acts = await res.json();
      if (!Array.isArray(acts) || acts.length === 0) break;

      for (const a of acts) {
        // Strava: sport_type o type según actividad
        const sport = a.sport_type || a.type;
        if (sport === "InlineSkate") {
          totalDistance += Number(a.distance || 0);
          count += 1;
        }
      }

      if (acts.length < per_page) break;
      page += 1;
    }

    // Upsert weekly total
    const { error: upErr } = await admin
      .from("strava_weekly_totals")
      .upsert({
        community_id,
        user_id: userId,
        week_start,
        sport_type: "InlineSkate",
        distance_m: Math.round(totalDistance),
        activities_count: count,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "community_id,user_id,week_start,sport_type",
      });

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      community_id,
      week_start,
      sport_type: "InlineSkate",
      distance_m: Math.round(totalDistance),
      km: Math.round((totalDistance / 1000) * 100) / 100,
      activities_count: count,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
