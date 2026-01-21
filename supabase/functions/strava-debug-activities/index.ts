import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // validar usuario
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

    // leer token strava (service role)
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

    // pedir últimas actividades
    const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30&page=1", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Strava API error", status: r.status, body: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acts = JSON.parse(text);

    const sample = (acts || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      sport_type: a.sport_type,
      distance_m: a.distance,
      start_date: a.start_date,
    }));

    return new Response(JSON.stringify({ sample }), {
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
