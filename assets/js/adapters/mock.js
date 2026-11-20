/**
 * Mock / local adapter for the private preview.
 * Contains ONLY obviously fake demo records. No real guests, no real draws.
 * "What I'm bringing" is stored in this browser's localStorage so the Menu tab can show it.
 * Secret Santa chat and wish lists are also localStorage-only in this preview.
 */
(function (global) {
  const STORAGE_KEY = "uglytee-demo-bringing-v1";
  const MSG_KEY = "uglytee-demo-messages-v1";
  const WISH_KEY = "uglytee-demo-wishlist-v1";

  // Obviously fake preview records — not a real draw.
  const DEMO_GUESTS = {
    demo: {
      id: "demo",
      token: "demo",
      name: "Demo Guest",
      secretSantaFor: "Demo Friend A",
      uglyTeeFor: "Demo Friend B"
    },
    "demo-a": {
      id: "demo-a",
      token: "demo-a",
      name: "Demo Friend A",
      secretSantaFor: "Demo Friend B",
      uglyTeeFor: "Demo Guest"
    },
    "demo-b": {
      id: "demo-b",
      token: "demo-b",
      name: "Demo Friend B",
      secretSantaFor: "Demo Guest",
      uglyTeeFor: "Demo Friend A"
    }
  };

  // Host-provided drinks from now.md facts only. Specific brands/items are placeholders.
  const HOST_PROVISIONS = [
    { category: "Soft drinks", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Mixers", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Ice", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." }
  ];

  const MENU_CATEGORIES = ["Main", "Side", "Dessert", "Snack", "Other"];

  // Demo-only seed chat. "demo:santa" messages are from the mock santa role —
  // the sender's demo name is never stored or returned on that thread.
  const SEED_MESSAGES = {
    "demo:giftee": [
      {
        id: "seed-g1",
        createdAt: "2026-11-20T12:00:00.000Z",
        senderRole: "giftee",
        text: "Hi Secret Santa! I wear a medium tee."
      },
      {
        id: "seed-g2",
        createdAt: "2026-11-20T12:04:00.000Z",
        senderRole: "giftee",
        text: "Snacks make me happier than a mug, just so you know."
      }
    ],
    "demo:santa": [
      {
        id: "seed-s1",
        createdAt: "2026-11-20T12:08:00.000Z",
        senderRole: "santa",
        text: "Hey! Any hints for your gift, or a wish list I can peek at?"
      },
      {
        id: "seed-s2",
        createdAt: "2026-11-20T12:11:00.000Z",
        senderRole: "santa",
        text: "No rush — I just want it to feel like you."
      }
    ]
  };

  // "demo:giftee" is Demo Friend A's wish list, shown only to Demo Guest as their santa.
  const SEED_WISHLISTS = {
    demo: "Warm socks and something a bit silly.",
    "demo:giftee": "A funny snack haul. Medium tee if you’re getting clothes."
  };

  function readBringing() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeBringing(map) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readMessages() {
    const stored = readJson(MSG_KEY, null);
    if (stored && typeof stored === "object") return stored;
    const seed = {
      "demo:giftee": SEED_MESSAGES["demo:giftee"].map((m) => ({ ...m })),
      "demo:santa": SEED_MESSAGES["demo:santa"].map((m) => ({ ...m }))
    };
    writeJson(MSG_KEY, seed);
    return seed;
  }

  function writeMessages(map) {
    writeJson(MSG_KEY, map);
  }

  function readWishlists() {
    const stored = readJson(WISH_KEY, null);
    if (stored && typeof stored === "object") return stored;
    const seed = { ...SEED_WISHLISTS };
    writeJson(WISH_KEY, seed);
    return seed;
  }

  function writeWishlists(map) {
    writeJson(WISH_KEY, map);
  }


  const CLAIM_KEY = "uglytee-demo-claims-v1";
  const WEAK_PINS = {
    "012345": 1, "123456": 1, "234567": 1, "345678": 1, "456789": 1, "567890": 1,
    "987654": 1, "876543": 1, "765432": 1, "654321": 1, "543210": 1, "432109": 1,
    "321098": 1, "210987": 1, "109876": 1, "098765": 1
  };

  function isWeakPin(digits) {
    const pin = String(digits || "");
    if (!/^\d{6}$/.test(pin)) return true;
    if (/^(.)\1{5}$/.test(pin)) return true;
    return !!WEAK_PINS[pin];
  }

  function readClaims() {
    const stored = readJson(CLAIM_KEY, null);
    return (stored && typeof stored === "object") ? stored : {};
  }

  function writeClaims(map) {
    writeJson(CLAIM_KEY, map);
  }

  function threadKey(token, thread) {
    return String(token || "").trim() + ":" + thread;
  }

  function presentMessage(token, thread, raw) {
    const fromMe =
      (thread === "giftee" && raw.senderRole === "santa") ||
      (thread === "santa" && raw.senderRole === "giftee");
    let authorLabel;
    if (fromMe) {
      authorLabel = "You";
    } else if (thread === "giftee") {
      const guest = DEMO_GUESTS[token];
      authorLabel = (guest && guest.secretSantaFor) || "Them";
    } else {
      authorLabel = "🎅 Your Secret Santa";
    }
    return {
      id: raw.id,
      createdAt: raw.createdAt,
      text: raw.text,
      fromMe,
      role: raw.senderRole,
      authorLabel
    };
  }

  const adapter = {
    name: "mock",
    listGuestsPublic() {
      const claims = readClaims();
      const guests = Object.values(DEMO_GUESTS)
        .map((g) => ({
          id: g.id,
          display_name: g.name,
          claimed: !!claims[g.id]
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
      return Promise.resolve({ ok: true, guests });
    },
    claimGuest(guestId, pin) {
      const id = String(guestId || "").trim();
      const digits = String(pin || "").replace(/\D/g, "");
      const guest = DEMO_GUESTS[id];
      if (!guest) {
        return Promise.resolve({ ok: false, reason: "not-found", message: "We couldn’t find that guest." });
      }
      if (isWeakPin(digits)) {
        return Promise.resolve({
          ok: false,
          reason: "weak",
          message: "Please pick a harder PIN than a simple sequence or repeated number."
        });
      }
      const claims = readClaims();
      if (claims[id]) {
        return Promise.resolve({
          ok: false,
          reason: "claimed",
          message: "That name is already claimed. Log in with your PIN."
        });
      }
      claims[id] = digits;
      writeClaims(claims);
      return Promise.resolve({ ok: true, token: guest.token });
    },
    // Demo only: PINs live in this browser. No real PINs.
    loginWithPin(guestId, pin) {
      const id = String(guestId || "").trim();
      const digits = String(pin || "").replace(/\D/g, "");
      const guest = DEMO_GUESTS[id];
      if (!guest) {
        return Promise.resolve({ ok: false, reason: "not-found", message: "We couldn’t find that guest." });
      }
      const claims = readClaims();
      if (!claims[id]) {
        return Promise.resolve({
          ok: false,
          reason: "unclaimed",
          message: "That name hasn’t been claimed yet. Create your PIN first."
        });
      }
      if (claims[id] === digits) {
        return Promise.resolve({ ok: true, token: guest.token });
      }
      return Promise.resolve({ ok: false, reason: "invalid", message: "That PIN didn’t work. Please try again." });
    },
    getGuestByToken(token) {
      const key = String(token || "").trim();
      const guest = DEMO_GUESTS[key];
      if (!guest) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      const bringing = readBringing()[key] || null;
      return Promise.resolve({ ok: true, guest: { ...guest, bringing }, demo: true });
    },
    saveBringing(token, payload) {
      const key = String(token || "").trim();
      if (!DEMO_GUESTS[key]) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      const dish = String(payload.dish || "").trim();
      const category = MENU_CATEGORIES.includes(payload.category) ? payload.category : "Other";
      if (!dish) {
        return Promise.resolve({ ok: false, reason: "invalid", message: "Please add a dish name." });
      }
      const map = readBringing();
      map[key] = {
        dish,
        category,
        notes: String(payload.notes || "").trim(),
        updatedAt: new Date().toISOString()
      };
      writeBringing(map);
      return Promise.resolve({ ok: true, bringing: map[key] });
    },
    clearBringing(token) {
      const key = String(token || "").trim();
      const map = readBringing();
      delete map[key];
      writeBringing(map);
      return Promise.resolve({ ok: true });
    },
    listMenuItems() {
      const map = readBringing();
      const items = Object.entries(map).map(([token, bringing]) => {
        const guest = DEMO_GUESTS[token];
        return {
          dish: bringing.dish,
          category: bringing.category,
          notes: bringing.notes,
          guestName: guest ? guest.name : "Demo Guest",
          demo: true
        };
      });
      return Promise.resolve({ ok: true, items, categories: MENU_CATEGORIES });
    },
    listHostProvisions() {
      return Promise.resolve({
        ok: true,
        provisions: HOST_PROVISIONS,
        alcoholNote: "Jack covers alcohol."
      });
    },
    listMessages(token, thread, since) {
      const key = String(token || "").trim();
      if (!DEMO_GUESTS[key]) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      if (thread !== "giftee" && thread !== "santa") {
        return Promise.resolve({ ok: false, reason: "invalid", message: "Unknown thread." });
      }
      const all = readMessages()[threadKey(key, thread)] || [];
      const sinceAt = since ? String(since) : "";
      const messages = all
        .filter((m) => !sinceAt || m.createdAt > sinceAt)
        .map((m) => presentMessage(key, thread, m));
      return Promise.resolve({ ok: true, thread, messages });
    },
    sendMessage(token, thread, text) {
      const key = String(token || "").trim();
      if (!DEMO_GUESTS[key]) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      if (thread !== "giftee" && thread !== "santa") {
        return Promise.resolve({ ok: false, reason: "invalid", message: "Unknown thread." });
      }
      const body = String(text || "").trim();
      if (!body) {
        return Promise.resolve({ ok: false, reason: "invalid", message: "Write a message first." });
      }
      if (body.length > 400) {
        return Promise.resolve({ ok: false, reason: "invalid", message: "That’s a bit long — try under 400 characters." });
      }
      const map = readMessages();
      const tid = threadKey(key, thread);
      if (!map[tid]) map[tid] = [];
      const raw = {
        id: "m-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        senderRole: thread === "giftee" ? "santa" : "giftee",
        text: body
      };
      map[tid].push(raw);
      writeMessages(map);
      return Promise.resolve({ ok: true, message: presentMessage(key, thread, raw) });
    },
    getWishlist(token, scope) {
      const key = String(token || "").trim();
      if (!DEMO_GUESTS[key]) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      const which = scope === "giftee" ? "giftee" : "mine";
      const wishes = readWishlists();
      const text = which === "giftee" ? (wishes[threadKey(key, "giftee")] || "") : (wishes[key] || "");
      return Promise.resolve({ ok: true, scope: which, text });
    },
    setWishlist(token, text) {
      const key = String(token || "").trim();
      if (!DEMO_GUESTS[key]) {
        return Promise.resolve({ ok: false, reason: "not-found" });
      }
      const body = String(text || "").trim();
      if (body.length > 400) {
        return Promise.resolve({ ok: false, reason: "invalid", message: "That’s a bit long — try under 400 characters." });
      }
      const wishes = readWishlists();
      if (body) wishes[key] = body;
      else delete wishes[key];
      writeWishlists(wishes);
      return Promise.resolve({ ok: true, text: body });
    }
  };

  if (global.InviteData) {
    global.InviteData.register("mock", adapter);
  }
})(window);
