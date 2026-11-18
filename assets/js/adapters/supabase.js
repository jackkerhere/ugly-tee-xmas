/**
 * Supabase adapter STUB.
 * Not connected. Do not add a project URL, API key, or real data here.
 * Jack has not chosen a service yet — do not sign up from this preview.
 *
 * Intended shape once wired (server-side / RLS, never a public list of draws):
 *   getGuestByToken(k)  -> select only the row matching the token
 *                          (name, secret_santa_for, ugly_tee_for, bringing)
 *   saveBringing(k, payload) -> update bringing fields for that token only
 *   listMenuItems()     -> select dish, category, display_name only
 *                          (never draw recipients)
 *   listHostProvisions() -> static or a small host_items table
 *
 * Required later: a table such as `guests` with a unique unguessable `token`,
 * row-level security so the anonymous client can read/update only WHERE token = k,
 * and no select-all policy on draw columns.
 */
(function (global) {
  const notConfigured = (method) =>
    Promise.resolve({
      ok: false,
      reason: "not-configured",
      message: "Supabase is not connected in this preview (" + method + ")."
    });

  const adapter = {
    name: "supabase",
    getGuestByToken: () => notConfigured("getGuestByToken"),
    saveBringing: () => notConfigured("saveBringing"),
    clearBringing: () => notConfigured("clearBringing"),
    listMenuItems: () => notConfigured("listMenuItems"),
    listHostProvisions: () => notConfigured("listHostProvisions")
  };

  if (global.InviteData) {
    global.InviteData.register("supabase", adapter);
  }
})(window);
