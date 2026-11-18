/**
 * Shared UI: gift gate, motion, snow, audio player, menu + guest page hooks.
 */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }


  const DEFAULT_GREETING = "A little something for you";

  function currentToken() {
    return (new URLSearchParams(location.search).get("k") || "").trim();
  }

  function withToken(href) {
    const k = currentToken();
    if (!k) return href;
    let path = href;
    let hash = "";
    let query = "";
    const hashAt = path.indexOf("#");
    if (hashAt >= 0) {
      hash = path.slice(hashAt);
      path = path.slice(0, hashAt);
    }
    const qAt = path.indexOf("?");
    if (qAt >= 0) {
      query = path.slice(qAt + 1);
      path = path.slice(0, qAt);
    }
    const params = new URLSearchParams(query);
    params.set("k", k);
    return path + "?" + params.toString() + hash;
  }

  function isSitePage(href) {
    if (!href) return false;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
    if (/^https?:/i.test(href) || href.startsWith("//")) return false;
    if (href.startsWith("assets/")) return false;
    const path = href.split("?")[0].split("#")[0];
    return path === "" || path.endsWith(".html") || path === "./" || path === "/";
  }

  function carryTokenInLinks(root) {
    if (!currentToken()) return;
    $all("a[href]", root).forEach((a) => {
      const href = a.getAttribute("href");
      if (!isSitePage(href)) return;
      a.setAttribute("href", withToken(href));
    });
  }

  function personalizeGift() {
    const line = $("#gift-greeting");
    if (!line) return Promise.resolve();
    const token = currentToken();
    if (!token || !window.InviteData) {
      line.textContent = DEFAULT_GREETING;
      return Promise.resolve();
    }
    return window.InviteData.getGuestByToken(token).then((res) => {
      if (res && res.ok && res.guest && res.guest.name) {
        line.textContent = "Hey, " + res.guest.name;
        const btn = $("#gift-open");
        if (btn) btn.setAttribute("aria-label", "Tap to open your invitation, " + res.guest.name);
      } else {
        line.textContent = DEFAULT_GREETING;
      }
    });
  }

  function buildStars() {
    const layer = $(".stars");
    if (!layer) return;
    const count = 48;
    for (let i = 0; i < count; i += 1) {
      const s = document.createElement("span");
      s.className = "star" + (i % 7 === 0 ? " lg" : "");
      s.style.left = Math.random() * 100 + "%";
      s.style.top = Math.random() * 100 + "%";
      s.style.opacity = String(0.35 + Math.random() * 0.6);
      layer.appendChild(s);
    }
  }

  function buildSnow() {
    const layer = $(".snow");
    if (!layer || reduce || document.documentElement.classList.contains("is-shot")) return;
    const count = window.innerWidth < 500 ? 22 : 36;
    const glyphs = ["✦", "❄", "·", "✸"];
    for (let i = 0; i < count; i += 1) {
      const f = document.createElement("span");
      f.className = "flake";
      f.textContent = glyphs[i % glyphs.length];
      f.style.left = Math.random() * 100 + "%";
      f.style.setProperty("--dur", 10 + Math.random() * 14 + "s");
      f.style.setProperty("--delay", -Math.random() * 16 + "s");
      f.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
      f.style.fontSize = 8 + Math.random() * 10 + "px";
      layer.appendChild(f);
    }
  }

  function reveals() {
    const items = $all(".reveal");
    if (!items.length) return;
    if (reduce) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const delay = Number(el.dataset.delay || 0);
          setTimeout(() => el.classList.add("is-in"), delay);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => io.observe(el));
  }

  function openInvite(playSong) {
    const screen = $(".gift-screen");
    const btn = $(".gift-open");
    document.body.classList.add("is-open");
    try { sessionStorage.setItem("uglytee-opened", "1"); } catch {}
    if (btn) btn.classList.add("is-opening");
    const delay = reduce ? 0 : 620;
    setTimeout(() => {
      if (screen) {
        screen.classList.add("is-away");
        screen.setAttribute("aria-hidden", "true");
      }
      const main = $("#main");
      if (main) main.removeAttribute("aria-hidden");
    }, delay);
    if (playSong) window.InvitePlayer && window.InvitePlayer.tryPlay();
  }

  function giftGate() {
    const screen = $(".gift-screen");
    if (!screen) return;
    const params = new URLSearchParams(location.search);
    const preopen = params.get("opened") === "1" || params.get("open") === "1";
    let already = false;
    try { already = sessionStorage.getItem("uglytee-opened") === "1"; } catch {}
    if (preopen || already) {
      openInvite(false);
      return;
    }
    const btn = $(".gift-open");
    if (btn) {
      btn.addEventListener("click", () => openInvite(true));
    }
    const main = $("#main");
    if (main) main.setAttribute("aria-hidden", "true");
  }

  function player() {
    const audio = $("#song");
    const playBtn = $("#play-btn");
    const seek = $("#seek");
    const cur = $("#time-cur");
    const dur = $("#time-dur");
    const missing = $("#player-missing");
    if (!audio || !playBtn) {
      window.InvitePlayer = { tryPlay: function () {} };
      return;
    }

    let ready = false;
    let failed = false;

    function fmt(t) {
      if (!isFinite(t)) return "0:00";
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      return m + ":" + String(s).padStart(2, "0");
    }

    function showMissing(msg) {
      failed = true;
      if (missing) {
        missing.hidden = false;
        missing.textContent = msg;
      }
      playBtn.setAttribute("disabled", "disabled");
      playBtn.setAttribute("aria-label", "Song not available yet");
    }

    audio.addEventListener("loadedmetadata", () => {
      ready = true;
      if (dur) dur.textContent = fmt(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (cur) cur.textContent = fmt(audio.currentTime);
      if (seek && isFinite(audio.duration) && audio.duration > 0) {
        seek.value = String((audio.currentTime / audio.duration) * 100);
      }
    });
    audio.addEventListener("ended", () => {
      playBtn.dataset.state = "paused";
      playBtn.innerHTML = playIcon();
    });
    audio.addEventListener("error", () => {
      showMissing("The party song isn’t here yet. Add assets/song.mp3 and the player will work.");
    });
    audio.addEventListener("play", () => {
      playBtn.dataset.state = "playing";
      playBtn.innerHTML = pauseIcon();
    });
    audio.addEventListener("pause", () => {
      playBtn.dataset.state = "paused";
      playBtn.innerHTML = playIcon();
    });

    function playIcon() {
      return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    }
    function pauseIcon() {
      return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    }

    playBtn.innerHTML = playIcon();
    playBtn.addEventListener("click", () => {
      if (failed) return;
      if (audio.paused) audio.play().catch(() => {
        showMissing("The party song isn’t here yet. Add assets/song.mp3 and the player will work.");
      });
      else audio.pause();
    });

    if (seek) {
      seek.addEventListener("input", () => {
        if (!isFinite(audio.duration)) return;
        audio.currentTime = (Number(seek.value) / 100) * audio.duration;
      });
    }

    // Probe the file so a missing mp3 shows the fallback without a click.
    fetch("assets/song.mp3", { method: "HEAD" }).then((res) => {
      if (!res.ok) showMissing("The party song isn’t here yet. Add assets/song.mp3 and the player will work.");
    }).catch(() => {
      showMissing("The party song isn’t here yet. Add assets/song.mp3 and the player will work.");
    });

    window.InvitePlayer = {
      tryPlay: function () {
        if (failed) return;
        audio.play().catch(function () { /* Autoplay may still wait for a later tap on the player. */ });
      }
    };
  }

  function mapDialog() {
    const openers = $all("[data-open-map]");
    const backdrop = $("#map-dialog");
    if (!openers.length || !backdrop) return;
    const closeBtn = $("[data-close-map]", backdrop);
    function open(e) {
      e.preventDefault();
      backdrop.classList.add("is-on");
      backdrop.setAttribute("aria-hidden", "false");
      if (closeBtn) closeBtn.focus();
    }
    function close() {
      backdrop.classList.remove("is-on");
      backdrop.setAttribute("aria-hidden", "true");
    }
    openers.forEach((el) => el.addEventListener("click", open));
    if (closeBtn) closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  function renderMenu() {
    const root = $("#menu-root");
    if (!root || !globalInvite()) return;
    const data = window.InviteData;
    Promise.all([data.listMenuItems(), data.listHostProvisions()]).then(([menu, host]) => {
      const cats = (menu.categories || ["Main", "Side", "Dessert", "Snack", "Other"]);
      const items = menu.items || [];
      let html = "";
      html += "<div class='section-head reveal is-in'><div class='cloud-title'><h1 class='outline-red' style='-webkit-text-stroke:4px #fff'>The menu</h1></div>";
      html += "<p class='lede'>Potluck dishes will show up here as guests add them on their page. Soft drinks, mixers and ice are on us to organise — specifics still to come. Jack covers alcohol.</p></div>";

      const labels = { Main: "Mains", Side: "Sides", Dessert: "Desserts", Snack: "Snacks", Other: "Other" };
      html += "<div class='menu-group reveal' id='potluck'><h2>Potluck</h2><div>";
      cats.forEach((cat) => {
        const rows = items.filter((it) => it.category === cat);
        html += "<h3 style='margin-top:1rem;font-size:1.05rem;color:var(--cream)'>" + escapeHtml(labels[cat] || cat) + "</h3>";
        html += "<ul class='menu-list'>";
        if (rows.length) {
          rows.forEach((row) => {
            html += "<li class='menu-item'><span>" + escapeHtml(row.dish);
            if (row.notes) html += " <small>(" + escapeHtml(row.notes) + ")</small>";
            html += "</span><span class='who'>" + escapeHtml(row.guestName) + "</span></li>";
          });
        } else {
          html += "<li class='menu-slot'>Waiting for a sign-up — placeholder</li>";
        }
        html += "</ul>";
      });
      html += "</div></div>";

      html += "<div class='menu-group reveal' id='drinks'><h2>Drinks &amp; ice</h2>";
      html += "<ul class='menu-list'>";
      (host.provisions || []).forEach((p) => {
        html += "<li class='menu-item'><span><strong>" + escapeHtml(p.category) + "</strong> — " + escapeHtml(p.item) + "<br><small>" + escapeHtml(p.note) + "</small></span></li>";
      });
      html += "</ul>";
      if (host.alcoholNote) {
        html += "<p class='host-note'>" + escapeHtml(host.alcoholNote) + "</p>";
      }
      html += "</div>";
      root.innerHTML = html;
      reveals();
    });
  }

  function renderGuestPage() {
    const root = $("#me-root");
    if (!root || !globalInvite()) return;
    const params = new URLSearchParams(location.search);
    const token = (params.get("k") || "").trim();
    const data = window.InviteData;

    if (!token) {
      root.innerHTML = gateHtml("This is a private page for each guest.", "Open the personal link that was sent to you. It looks like me.html?k=… — there’s no password.");
      return;
    }

    data.getGuestByToken(token).then((res) => {
      if (!res.ok) {
        root.innerHTML = gateHtml("We can’t open this personal link.", "Please ask Jack for your invite link. There’s no password — the link itself is the key.");
        return;
      }
      const g = res.guest;
      const bringing = g.bringing || { dish: "", category: "Main", notes: "" };
      root.innerHTML = `
        ${g.token === "demo" ? '<p class="banner-demo">Preview data only — not a real draw. This is Demo Guest.</p>' : ""}
        <p class="hi"><span class="outline-red">Hi, ${escapeHtml(g.name)}</span></p>
        <p class="lede" style="margin-bottom:1.5rem">This page is just for you. Please don’t share your link — it shows your Secret Santa and ugly-tee person.</p>
        <div class="secret-grid">
          <article class="card secret-card reveal">
            <p class="icon" aria-hidden="true">🎁</p>
            <h3>Your Secret Santa</h3>
            <p>You’re getting a gift for</p>
            <p class="for">${escapeHtml(g.secretSantaFor)}</p>
          </article>
          <article class="card secret-card reveal">
            <p class="icon" aria-hidden="true">👕</p>
            <h3>Your ugly tee</h3>
            <p>You’re buying an ugly Christmas tee for</p>
            <p class="for">${escapeHtml(g.uglyTeeFor)}</p>
          </article>
        </div>
        <form class="card form reveal" id="bringing-form" style="margin-top:1.25rem">
          <h3>What I’m bringing</h3>
          <p>This is a potluck. Your dish will appear on the Menu tab.</p>
          <label for="dish">Dish</label>
          <input id="dish" name="dish" type="text" maxlength="80" required placeholder="Add your dish (or leave a placeholder for now)" value="${escapeAttr(bringing.dish || "")}">
          <label for="category">Category</label>
          <select id="category" name="category">
            ${["Main","Side","Dessert","Snack","Other"].map((c) =>
              `<option value="${c}" ${bringing.category === c ? "selected" : ""}>${c}</option>`
            ).join("")}
          </select>
          <label for="notes">Notes <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <textarea id="notes" name="notes" maxlength="160" placeholder="Allergies, serving size…">${escapeHtml(bringing.notes || "")}</textarea>
          <div class="form-actions">
            <button class="btn btn-gold" type="submit">Save dish</button>
            <button class="btn btn-ghost" type="button" id="clear-dish" style="color:var(--ink);border-color:#e0d4bf">Clear</button>
          </div>
          <p class="form-status" id="form-status" hidden></p>
        </form>
      `;
      const form = $("#bringing-form");
      const status = $("#form-status");
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        data.saveBringing(token, {
          dish: $("#dish").value,
          category: $("#category").value,
          notes: $("#notes").value
        }).then((out) => {
          if (!out.ok) {
            status.hidden = false;
            status.style.color = "var(--red-deep)";
            status.textContent = out.message || "Couldn’t save just now.";
            return;
          }
          status.hidden = false;
          status.style.color = "var(--green-deep)";
          status.textContent = "Saved. It will show on the Menu tab in this browser (preview only).";
        });
      });
      const clearBtn = $("#clear-dish");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          data.clearBringing(token).then(() => {
            $("#dish").value = "";
            $("#notes").value = "";
            status.hidden = false;
            status.style.color = "var(--green-deep)";
            status.textContent = "Cleared from the preview menu.";
          });
        });
      }
      reveals();
      carryTokenInLinks(root);
    });
  }

  function gateHtml(title, body) {
    return `<div class="gate"><div class="card"><h1>${escapeHtml(title)}</h1><p style="margin-top:0.7rem">${escapeHtml(body)}</p><p style="margin-top:1rem"><a class="btn btn-gold" href="${withToken("index.html")}">Back to Home</a></p></div></div>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }
  function escapeAttr(str) { return escapeHtml(str); }
  function globalInvite() { return window.InviteData; }

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);
    if (params.get("shot") === "1") {
      document.documentElement.classList.add("is-shot");
    }
    buildStars();
    buildSnow();
    carryTokenInLinks();
    personalizeGift();
    giftGate();
    player();
    mapDialog();
    reveals();
    renderMenu();
    renderGuestPage();
  });
})();
