/**
 * Supabase adapter.
 * Talks to the project only through SECURITY DEFINER RPCs (no direct table access).
 * The publishable key is public by design — never add a service-role key here.
 *
 * PIN checks, draws and santa identity stay on the server:
 *   list_guests_public returns id, display_name, and claimed only;
 *   claim_guest / login_with_pin hash and rate-limit on the server (name + PIN);
 *   get_me returns only the caller’s name and their two giftee names;
 *   list_messages / send_message return a role, never the santa’s name, to the giftee.
 *
 * Preview: add ?demo=1 to use the mock adapter instead.
 */
(function (global) {
  const PROJECT_URL = "https://puufnifihqeujbraurki.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_lMYo6N3A7_ph7VL-mrpfXA_RZ9y-JcV";

  const HOST_PROVISIONS = [
    { category: "Soft drinks", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Mixers", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Ice", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." }
  ];

  const MENU_CATEGORIES = ["Main", "Side", "Dessert", "Snack", "Other"];

  async function rpc(name, args) {
    const res = await fetch(PROJECT_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: "Bearer " + PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args || {})
    });
    let data = null;
    const raw = await res.text();
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!res.ok) {
      const message = (data && (data.message || data.hint)) || "Something went wrong. Please try again.";
      return { ok: false, reason: "error", message };
    }
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
    return { ok: false, reason: "error", message: "Unexpected response." };
  }

  const adapter = {
    name: "supabase",
    listGuestsPublic() {
      return rpc("list_guests_public", {});
    },
    claimGuest(guestId, pin) {
      const digits = String(pin || "").replace(/\D/g, "");
      return rpc("claim_guest", { guest_id: guestId, pin: digits });
    },
    loginWithPin(guestId, pin) {
      const digits = String(pin || "").replace(/\D/g, "");
      return rpc("login_with_pin", { guest_id: guestId, pin: digits });
    },
    getGuestByToken(token) {
      return rpc("get_me", { token: String(token || "").trim() });
    },
    saveBringing(token, payload) {
      return rpc("upsert_dish", {
        token: String(token || "").trim(),
        dish: payload && payload.dish,
        category: payload && payload.category,
        notes: payload && payload.notes
      });
    },
    clearBringing(token) {
      return rpc("clear_dish", { token: String(token || "").trim() });
    },
    listMenuItems() {
      return rpc("menu").then((res) => {
        if (!res.ok) return res;
        return {
          ok: true,
          items: res.items || [],
          categories: res.categories || MENU_CATEGORIES
        };
      });
    },
    listHostProvisions() {
      return Promise.resolve({
        ok: true,
        provisions: HOST_PROVISIONS,
        alcoholNote: "Jack covers alcohol."
      });
    },
    listMessages(token, thread, since) {
      return rpc("list_messages", {
        token: String(token || "").trim(),
        thread,
        since: since || null
      });
    },
    sendMessage(token, thread, text) {
      return rpc("send_message", {
        token: String(token || "").trim(),
        thread,
        body: text
      });
    },
    getWishlist(token, scope) {
      return rpc("get_wishlist", {
        token: String(token || "").trim(),
        scope: scope || "mine"
      });
    },
    setWishlist(token, text) {
      return rpc("set_wishlist", {
        token: String(token || "").trim(),
        body: text
      });
    }
  };

  if (global.InviteData) {
    global.InviteData.register("supabase", adapter);
  }
})(window);
