/**
 * Pluggable data layer for the invite site.
 * Default adapter is Supabase (RPC only). Add ?demo=1 to use the mock/local adapter.
 * Do not put real guest names or real draw pairings in this file.
 */
(function (global) {
  function selectedAdapter() {
    try {
      if (new URLSearchParams(location.search).get("demo") === "1") return "mock";
    } catch (_) { /* ignore */ }
    return "supabase";
  }

  const config = {
    get adapter() { return selectedAdapter(); }
  };

  const adapters = {};

  function register(name, adapter) {
    adapters[name] = adapter;
  }

  function current() {
    const name = selectedAdapter();
    const adapter = adapters[name];
    if (!adapter) {
      return Promise.reject(new Error("No data adapter registered: " + name));
    }
    return adapter;
  }

  const api = {
    config,
    register,
    listGuestsPublic: () => current().listGuestsPublic(),
    claimGuest: (guestId, pin) => current().claimGuest(guestId, pin),
    getGuestByToken: (token) => current().getGuestByToken(token),
    loginWithPin: (guestId, pin) => current().loginWithPin(guestId, pin),
    saveBringing: (token, payload) => current().saveBringing(token, payload),
    clearBringing: (token) => current().clearBringing(token),
    listMenuItems: () => current().listMenuItems(),
    listHostProvisions: () => current().listHostProvisions(),
    listMessages: (token, thread, since) => current().listMessages(token, thread, since),
    sendMessage: (token, thread, text) => current().sendMessage(token, thread, text),
    getWishlist: (token, scope) => current().getWishlist(token, scope),
    setWishlist: (token, text) => current().setWishlist(token, text),
    unreadCounts: (token) => current().unreadCounts(token),
    markRead: (token, thread) => current().markRead(token, thread),
    gamePublic: () => current().gamePublic(),
    gameMe: (token) => current().gameMe(token),
    gameLobby: (token) => current().gameLobby(token),
    gameLobbySet: (token, joining) => current().gameLobbySet(token, joining),
    gameSubmit: (token, action, target, extra, extraText) => current().gameSubmit(token, action, target, extra, extraText),
    gameClaimHost: (token, hostPin) => current().gameClaimHost(token, hostPin),
    gameHostLogin: (guestId, pin) => current().gameHostLogin(guestId, pin),
    gameHostState: (hostToken) => current().gameHostState(hostToken),
    gameHostDeal: (hostToken, playerIds) => current().gameHostDeal(hostToken, playerIds),
    gameHostDealLobby: (hostToken) => current().gameHostDealLobby(hostToken),
    gameHostStart: (hostToken) => current().gameHostStart(hostToken),
    gameHostAdvance: (hostToken) => current().gameHostAdvance(hostToken),
    gameHostReset: (hostToken) => current().gameHostReset(hostToken),
    gameHostPlayTwist: (hostToken, card, target, target2) => current().gameHostPlayTwist(hostToken, card, target, target2),
    gameHostSkipTwist: (hostToken) => current().gameHostSkipTwist(hostToken)
  };

  global.InviteData = api;
})(window);
