/**
 * Mock / local adapter for the private preview.
 * Contains ONLY obviously fake demo records. No real guests, no real draws.
 * "What I'm bringing" is stored in this browser's localStorage so the Menu tab can show it.
 */
(function (global) {
  const STORAGE_KEY = "uglytee-demo-bringing-v1";

  // Obviously fake preview records — not a real draw.
  const DEMO_GUESTS = {
    demo: {
      token: "demo",
      name: "Demo Guest",
      secretSantaFor: "Demo Friend A",
      uglyTeeFor: "Demo Friend B"
    }
  };

  // Host-provided drinks from now.md facts only. Specific brands/items are placeholders.
  const HOST_PROVISIONS = [
    { category: "Soft drinks", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Mixers", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." },
    { category: "Ice", item: "To be confirmed", note: "Placeholder — specifics not chosen yet." }
  ];

  const MENU_CATEGORIES = ["Main", "Side", "Dessert", "Snack", "Other"];

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

  const adapter = {
    name: "mock",
    // Demo only: PIN 123456 maps to the Demo Guest token. No real PINs.
    loginWithPin(pin) {
      const digits = String(pin || "").replace(/\D/g, "");
      if (digits === "123456") {
        return Promise.resolve({ ok: true, token: "demo" });
      }
      return Promise.resolve({ ok: false, reason: "invalid" });
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
    }
  };

  if (global.InviteData) {
    global.InviteData.register("mock", adapter);
  }
})(window);
