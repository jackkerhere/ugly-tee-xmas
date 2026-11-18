/**
 * Pluggable data layer for the invite site.
 * Preview uses the mock/local adapter only.
 * A Supabase adapter stub lives in adapters/supabase.js — not connected.
 * Do not put real guest names or real draw pairings in this file.
 */
(function (global) {
  const config = {
    adapter: "mock"
    // Later, flip to "supabase" once Jack chooses a service and a backend exists.
  };

  const adapters = {};

  function register(name, adapter) {
    adapters[name] = adapter;
  }

  function current() {
    const name = config.adapter;
    const adapter = adapters[name];
    if (!adapter) {
      return Promise.reject(new Error("No data adapter registered: " + name));
    }
    return adapter;
  }

  const api = {
    config,
    register,
    getGuestByToken: (token) => current().getGuestByToken(token),
    saveBringing: (token, payload) => current().saveBringing(token, payload),
    clearBringing: (token) => current().clearBringing(token),
    listMenuItems: () => current().listMenuItems(),
    listHostProvisions: () => current().listHostProvisions()
  };

  global.InviteData = api;
})(window);
