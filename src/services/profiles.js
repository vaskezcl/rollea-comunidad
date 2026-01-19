import { supabase } from "../supabaseClient";

/**
 * Ensures a profile row exists for the given user.
 * Safe to call multiple times.
 */
export async function ensureProfile(user) {
  if (!user?.id) return;

  const { data: profile, error: selectError } = await supabase
    .from("profiles")
    .select("id, attendance_visibility")
    .eq("id", user.id)
    .maybeSingle();

  if (selectError) {
    console.error("ensureProfile: select error", selectError);
    return;
  }

  if (!profile) {
    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      attendance_visibility: "public",
    });

    if (insertError) {
      console.error("ensureProfile: insert error", insertError);
    }
  }
}

export async function getMyProfile(userId) {
  return supabase
    .from("profiles")
    .select("id, birthdate, birthday_dismissed_on")
    .eq("id", userId)
    .single();
}

export async function updateMyProfile(userId, values) {
  return supabase
    .from("profiles")
    .update(values)
    .eq("id", userId);
}
