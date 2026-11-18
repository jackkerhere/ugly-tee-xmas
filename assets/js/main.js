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


  const SONG_SRC = "assets/song.mp3";
  const STORE_OPENED = "uglytee-opened";
  const STORE_WANT = "uglytee-want-play";
  const STORE_TIME = "uglytee-song-time";
  const STORE_MUTED = "uglytee-song-muted";

  function storeGet(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  function storeSet(key, val) {
    try { sessionStorage.setItem(key, val); } catch {}
  }
  function storeOn(key) { return storeGet(key) === "1"; }

  function songEl() { return $("#site-song"); }

  function muteIcon(muted) {
    if (muted) {
      return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.4 2.4c.1-.2.1-.4.1-.6zm2.5 0c0 .9-.2 1.8-.5 2.6l1.5 1.5c.7-1.2 1-2.6 1-4.1 0-4.3-3-7.9-7-8.8v2.1c2.9.8 5 3.5 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.2 4.2c-.7.5-1.5.9-2.4 1.1v2.1c1.4-.3 2.7-1 3.8-1.9L19.7 21 21 19.7 4.3 3zM12 4 9.9 6.1 12 8.2V4z"/></svg>';
    }
    return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z"/></svg>';
  }

  function syncMuteFab() {
    const audio = songEl();
    const fab = $("#mute-fab");
    if (!fab || !audio) return;
    const muted = !!audio.muted;
    fab.innerHTML = muteIcon(muted);
    fab.setAttribute("aria-label", muted ? "Unmute song" : "Mute song");
    fab.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  function showMuteFab() {
    const fab = $("#mute-fab");
    if (fab) {
      fab.hidden = false;
      fab.classList.add("is-on");
      syncMuteFab();
    }
  }

  function showResume(show) {
    const bar = $("#resume-song");
    if (!bar) return;
    bar.hidden = !show;
    bar.classList.toggle("is-on", !!show);
  }

  function saveSongTime() {
    const audio = songEl();
    if (!audio || !isFinite(audio.currentTime)) return;
    storeSet(STORE_TIME, String(audio.currentTime));
  }

  function restoreSongTime() {
    const audio = songEl();
    if (!audio) return;
    const saved = parseFloat(storeGet(STORE_TIME) || "");
    if (isFinite(saved) && saved > 0) {
      const apply = () => {
        try { audio.currentTime = saved; } catch {}
      };
      if (audio.readyState >= 1) apply();
      else audio.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  /* Must be called synchronously from a click/tap handler so iOS Safari
     and Android Chrome treat it as a user gesture. */
  function startSongFromGesture() {
    const audio = songEl();
    if (!audio) return;
    audio.loop = true;
    audio.setAttribute("loop", "");
    if (storeGet(STORE_MUTED) === "1") audio.muted = true;
    restoreSongTime();
    const playResult = audio.play();
    storeSet(STORE_WANT, "1");
    showMuteFab();
    showResume(false);
    if (playResult && typeof playResult.then === "function") {
      playResult.catch(function () {
        showResume(true);
      });
    }
  }

  function tryResumeSong() {
    const audio = songEl();
    if (!audio || !storeOn(STORE_WANT)) return;
    showMuteFab();
    if (storeGet(STORE_MUTED) === "1") audio.muted = true;
    restoreSongTime();
    const playResult = audio.play();
    if (playResult && typeof playResult.then === "function") {
      playResult.then(function () { showResume(false); }).catch(function () { showResume(true); });
    }
  }

  function openInvite() {
    const screen = $("#gift-screen");
    const btn = $("#gift-open");
    document.body.classList.add("is-open");
    storeSet(STORE_OPENED, "1");
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
    showMuteFab();
  }

  function applyGiftVisibility() {
    const screen = $("#gift-screen");
    const opened = storeOn(STORE_OPENED);
    const params = new URLSearchParams(location.search);
    const preopen = params.get("opened") === "1" || params.get("open") === "1";
    if (!screen) {
      if (opened || preopen) {
        document.body.classList.add("is-open");
        showMuteFab();
      }
      return;
    }
    if (opened || preopen) {
      document.body.classList.add("is-open");
      screen.classList.add("is-away");
      screen.setAttribute("aria-hidden", "true");
      const main = $("#main");
      if (main) main.removeAttribute("aria-hidden");
      showMuteFab();
    } else {
      document.body.classList.remove("is-open");
      screen.classList.remove("is-away");
      screen.removeAttribute("aria-hidden");
      const main = $("#main");
      if (main) main.setAttribute("aria-hidden", "true");
    }
  }

  function giftGate() {
    applyGiftVisibility();
    const opened = storeOn(STORE_OPENED);
    const params = new URLSearchParams(location.search);
    const preopen = params.get("opened") === "1" || params.get("open") === "1";
    if (opened || preopen) tryResumeSong();
  }

  let playerBound = false;
  function player() {
    const audio = songEl();
    if (!audio) return;
    audio.loop = true;
    audio.preload = "auto";
    if (storeGet(STORE_MUTED) === "1") audio.muted = true;

    if (!playerBound) {
      playerBound = true;
      audio.addEventListener("timeupdate", () => {
        saveSongTime();
        const cur = $("#time-cur");
        const seek = $("#seek");
        if (cur) cur.textContent = fmtTime(audio.currentTime);
        if (seek && isFinite(audio.duration) && audio.duration > 0) {
          seek.value = String((audio.currentTime / audio.duration) * 100);
        }
      });
      audio.addEventListener("loadedmetadata", () => {
        const dur = $("#time-dur");
        if (dur) dur.textContent = fmtTime(audio.duration);
        restoreSongTime();
      });
      audio.addEventListener("play", () => {
        storeSet(STORE_WANT, "1");
        showResume(false);
        syncPlayerButtons();
      });
      audio.addEventListener("pause", syncPlayerButtons);
      audio.addEventListener("volumechange", syncMuteFab);
      audio.addEventListener("error", () => {
        const missing = $("#player-missing");
        if (missing) {
          missing.hidden = false;
          missing.textContent = "The party song couldn’t be loaded. Check assets/song.mp3.";
        }
      });

      const fab = $("#mute-fab");
      if (fab && !fab.dataset.bound) {
        fab.dataset.bound = "1";
        fab.addEventListener("click", () => {
          const a = songEl();
          if (!a) return;
          a.muted = !a.muted;
          storeSet(STORE_MUTED, a.muted ? "1" : "0");
          syncMuteFab();
        });
      }
      const resumeBtn = $("#resume-song-btn");
      if (resumeBtn && !resumeBtn.dataset.bound) {
        resumeBtn.dataset.bound = "1";
        resumeBtn.addEventListener("click", () => startSongFromGesture());
      }
      // Delegation so the gift button still works after SPA swaps.
      document.addEventListener("click", (e) => {
        const btn = e.target.closest && e.target.closest("#gift-open");
        if (!btn) return;
        startSongFromGesture();
        openInvite();
      });
    }

    bindPlayerControls();
    syncMuteFab();
    if (storeOn(STORE_WANT) || storeOn(STORE_OPENED)) showMuteFab();
  }

  function fmtTime(t) {
    if (!isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
  function playIcon() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
  }
  function pauseIcon() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  }
  function syncPlayerButtons() {
    const audio = songEl();
    const playBtn = $("#play-btn");
    if (!audio || !playBtn) return;
    const paused = audio.paused;
    playBtn.dataset.state = paused ? "paused" : "playing";
    playBtn.innerHTML = paused ? playIcon() : pauseIcon();
    playBtn.setAttribute("aria-label", paused ? "Play song" : "Pause song");
  }
  function bindPlayerControls() {
    const audio = songEl();
    const playBtn = $("#play-btn");
    const seek = $("#seek");
    const dur = $("#time-dur");
    if (audio && dur && isFinite(audio.duration) && audio.duration > 0) {
      dur.textContent = fmtTime(audio.duration);
    }
    if (playBtn && !playBtn.dataset.bound) {
      playBtn.dataset.bound = "1";
      playBtn.innerHTML = playIcon();
      playBtn.addEventListener("click", () => {
        const a = songEl();
        if (!a) return;
        if (a.paused) startSongFromGesture();
        else a.pause();
      });
    }
    if (seek && !seek.dataset.bound) {
      seek.dataset.bound = "1";
      seek.addEventListener("input", () => {
        const a = songEl();
        if (!a || !isFinite(a.duration)) return;
        a.currentTime = (Number(seek.value) / 100) * a.duration;
        saveSongTime();
      });
    }
    syncPlayerButtons();
  }

  window.InvitePlayer = { tryPlay: startSongFromGesture };


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

  function pageKey(url) {
    const path = new URL(url, location.href).pathname;
    if (/itinerary\.html$/i.test(path)) return "itinerary";
    if (/menu\.html$/i.test(path)) return "menu";
    if (/me\.html$/i.test(path)) return "me";
    return "home";
  }

  function updateNavCurrent() {
    const key = pageKey(location.href);
    $all(".site-nav a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const target = pageKey(href);
      if (target === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function afterPageChange() {
    updateNavCurrent();
    carryTokenInLinks();
    personalizeGift();
    applyGiftVisibility();
    mapDialog();
    reveals();
    renderMenu();
    renderGuestPage();
    bindPlayerControls();
  }

  function ensureHomeChrome(doc) {
    const wrap = $(".wrap");
    if (!wrap) return;
    if (!$("#gift-screen") && doc.querySelector("#gift-screen")) {
      wrap.insertBefore(doc.querySelector("#gift-screen"), wrap.firstChild);
    }
    if (!$("#map-dialog") && doc.querySelector("#map-dialog")) {
      wrap.appendChild(doc.querySelector("#map-dialog"));
    }
  }

  async function swapTo(href, push) {
    const url = new URL(href, location.href);
    const k = currentToken();
    if (k && !url.searchParams.get("k")) url.searchParams.set("k", k);
    const res = await fetch(url.pathname + url.search, { credentials: "same-origin" });
    if (!res.ok) {
      location.href = url.href;
      return;
    }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const newMain = doc.querySelector("#main");
    const oldMain = $("#main");
    if (!newMain || !oldMain) {
      location.href = url.href;
      return;
    }
    ensureHomeChrome(doc);
    oldMain.replaceWith(newMain);
    document.title = doc.title;
    const keepOpen = storeOn(STORE_OPENED) || document.body.classList.contains("is-open");
    document.body.className = doc.body.className;
    if (keepOpen) document.body.classList.add("is-open");
    if (push) {
      history.pushState({ spa: true }, "", url.pathname + url.search + url.hash);
    }
    window.scrollTo(0, 0);
    afterPageChange();
  }

  function spaNavigate() {
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!isSitePage(href)) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      // Same-page hash only
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      e.preventDefault();
      swapTo(url.href, true).catch(() => { location.href = url.href; });
    });
    window.addEventListener("popstate", () => {
      swapTo(location.href, false).catch(() => { location.reload(); });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);
    if (params.get("shot") === "1") {
      document.documentElement.classList.add("is-shot");
    }
    buildStars();
    buildSnow();
    carryTokenInLinks();
    personalizeGift();
    player();
    giftGate();
    mapDialog();
    reveals();
    renderMenu();
    renderGuestPage();
    spaNavigate();
  });
})();
