import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function toUnixSeconds(d: Date) {
  return Math.floor(d.getTime() / 1000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Validar usuario
    const supaAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // 2) Leer tokens Strava (service role)
    const supaAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: tok, error: tokErr } = await supaAdmin
      .from("strava_tokens")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokErr) throw new Error(tokErr.message);
    if (!tok?.access_token) {
      return new Response(JSON.stringify({ error: "Strava not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Año a sincronizar (default: año actual)
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : new Date().getFullYear();

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return new Response(JSON.stringify({ error: "Invalid year" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const after = toUnixSeconds(new Date(year, 0, 1, 0, 0, 0)); // 1 Ene
    const before = toUnixSeconds(new Date(year + 1, 0, 1, 0, 0, 0)); // 1 Ene sig

    // 4) Traer actividades del año, paginado
    let page = 1;
    const perPage = 200;
    let totalDistanceM = 0;
    let totalCount = 0;

    while (true) {
      const apiUrl = new URL("https://www.strava.com/api/v3/athlete/activities");
      apiUrl.searchParams.set("after", String(after));
      apiUrl.searchParams.set("before", String(before));
      apiUrl.searchParams.set("page", String(page));
      apiUrl.searchParams.set("per_page", String(perPage));

      const r = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });

      if (!r.ok) {
        const body = await r.text();
        return new Response(
          JSON.stringify({ error: "Strava API error", status: r.status, body }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const acts = await r.json();
      if (!Array.isArray(acts) || acts.length === 0) break;

      for (const a of acts) {
        // ✅ SOLO patinaje
        if (a?.sport_type === "InlineSkate") {
          totalCount += 1;
          totalDistanceM += Math.round(a?.distance || 0);
        }
      }

      if (acts.length < perPage) break;
      page += 1;
    }

    // 5) Guardar en yearly_stats
    const { error: upErr } = await supaAdmin.from("yearly_stats").upsert(
      {
        user_id: userId,
        year,
        sport_type: "InlineSkate",
        distance_m: totalDistanceM,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,year,sport_type" }
    );

    if (upErr) throw new Error(upErr.message);

    return new Response(
      JSON.stringify({
        year,
        sport_type: "InlineSkate",
        distance_m: totalDistanceM,
        km: Math.round((totalDistanceM / 1000) * 100) / 100,
        activities_count: totalCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
