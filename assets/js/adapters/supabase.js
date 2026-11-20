/**
 * Supabase adapter STUB.
 * Not connected. Do not add a project URL, API key, or real data here.
 * Jack has not chosen a service yet — do not sign up from this preview.
 *
 * Intended shape once wired (server-side / RLS, never a public list of draws):
 *   getGuestByToken(k)  -> select only the row matching the token
 *                          (name, secret_santa_for, ugly_tee_for, bringing)
 *   loginWithPin(pin)   -> must run server-side (RPC or edge function).
 *                          Store only hashed PINs. Rate-limit attempts.
 *                          Return a token on success, or an error.
 *                          Never ship guest PINs (or a PIN list) to the client.
 *   saveBringing(k, payload) -> update bringing fields for that token only
 *   listMenuItems()     -> select dish, category, display_name only
 *                          (never draw recipients)
 *   listHostProvisions() -> static or a small host_items table
 *
 *   Secret Santa chat (not approved to connect yet — document only):
 *   threads table       -> one row per santa/giftee pair
 *                          (id, santa_guest_id, giftee_guest_id).
 *                          Never expose santa_guest_id to the giftee.
 *   messages table      -> thread_id, sender_role ('santa' | 'giftee'),
 *                          body, created_at.
 *                          Persist the sender as a role, not a display name.
 *   listMessages(k, thread, since)
 *                       -> thread is 'giftee' (I am the santa) or 'santa'
 *                          (I am the giftee). Resolve the pair server-side
 *                          from the caller's token. Return only messages
 *                          after `since`. Each item includes sender role,
 *                          body, and timestamp — never the santa's name,
 *                          token, or guest id, when the caller is the giftee.
 *   sendMessage(k, thread, text)
 *                       -> insert with sender_role inferred from the token
 *                          (do not trust a client-supplied sender). Rate-limit.
 *   wishlists table     -> guest_id, text, updated_at
 *   getWishlist(k, scope)
 *                       -> 'mine' is the caller's row; 'giftee' is the
 *                          wishlist of the person they are buying for.
 *                          A guest must not read their santa's wishlist.
 *   setWishlist(k, text) -> update only the caller's row.
 *
 * Required later: a table such as `guests` with a unique unguessable `token`,
 * row-level security so the anonymous client can read/update only WHERE token = k,
 * and no select-all policy on draw columns.
 *
 * Chat RLS (when a backend is approved):
 *   - A guest may SELECT only threads where they are santa_guest_id or giftee_guest_id.
 *   - A guest may INSERT messages only on those threads, with sender_role matching
 *     their side of the pair (enforced in an RPC or trigger, not by the client).
 *   - A guest may SELECT their own wishlist, and the wishlist of their giftee only.
 *   - Views or RPCs used by the giftee must return role labels (e.g. "Your Secret
 *     Santa"), never the santa's identity.
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
    loginWithPin: () => notConfigured("loginWithPin"),
    saveBringing: () => notConfigured("saveBringing"),
    clearBringing: () => notConfigured("clearBringing"),
    listMenuItems: () => notConfigured("listMenuItems"),
    listHostProvisions: () => notConfigured("listHostProvisions"),
    listMessages: () => notConfigured("listMessages"),
    sendMessage: () => notConfigured("sendMessage"),
    getWishlist: () => notConfigured("getWishlist"),
    setWishlist: () => notConfigured("setWishlist")
  };

  if (global.InviteData) {
    global.InviteData.register("supabase", adapter);
  }
})(window);
