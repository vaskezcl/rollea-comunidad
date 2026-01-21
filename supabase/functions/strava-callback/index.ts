import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!code || !state) {
      return new Response(JSON.stringify({ error: "Missing code/state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("STRAVA_CLIENT_ID")!;
    const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET")!;
    const siteUrl = Deno.env.get("SITE_URL")!; // https://rollea.com

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1) validar state -> user_id
    const { data: stateRow, error: stErr } = await admin
      .from("oauth_states")
      .select("user_id")
      .eq("state", state)
      .single();

    if (stErr || !stateRow?.user_id) {
      return new Response(JSON.stringify({ error: "Invalid state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = stateRow.user_id;

    // 2) intercambiar code por tokens en Strava
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      return new Response(JSON.stringify({ error: tokenJson }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { access_token, refresh_token, expires_at, athlete } = tokenJson;

    // 3) guardar/upsert en DB
    const { error: upErr } = await admin.from("strava_tokens").upsert(
      {
        user_id: userId,
        access_token,
        refresh_token,
        expires_at,
        athlete,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) limpiar state (opcional, recomendado)
    await admin.from("oauth_states").delete().eq("state", state);

    // 5) redirigir al front
    return Response.redirect(`${siteUrl}/?strava=connected`, 302);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
