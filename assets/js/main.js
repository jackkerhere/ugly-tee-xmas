/**
 * Shared UI: gift gate, motion, snow, audio player, menu + guest page hooks.
 */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }


  const DEFAULT_GREETING = "A little something for you";

  const STORE_TOKEN = "uglytee-guest-token";
  const STORE_PIN_TRIES = "uglytee-pin-tries";
  const STORE_PIN_LOCK = "uglytee-pin-lock-until";
  const PIN_MAX_TRIES = 5;
  const PIN_LOCK_MS = 60 * 1000;

  function currentToken() {
    const fromUrl = (new URLSearchParams(location.search).get("k") || "").trim();
    if (fromUrl) return fromUrl;
    try { return (sessionStorage.getItem(STORE_TOKEN) || "").trim(); }
    catch { return ""; }
  }

  function persistToken(token) {
    const k = String(token || "").trim();
    try {
      if (k) sessionStorage.setItem(STORE_TOKEN, k);
      else sessionStorage.removeItem(STORE_TOKEN);
    } catch (_) { /* ignore */ }
  }

  function logoutGuest(e) {
    if (e) e.preventDefault();
    persistToken("");
    const url = new URL("me.html", location.href);
    url.searchParams.delete("k");
    if (isDemoMode()) url.searchParams.set("demo", "1");
    const next = url.pathname.split("/").pop() + (url.search || "");
    if (location.pathname.endsWith("me.html") || /me\.html$/i.test(location.pathname)) {
      history.replaceState({ spa: true }, "", next || "me.html");
      renderGuestPage();
      carryTokenInLinks();
      return;
    }
    location.href = next || "me.html";
  }

  function isDemoMode() {
    try { return new URLSearchParams(location.search).get("demo") === "1"; }
    catch { return false; }
  }

  function withToken(href) {
    const k = currentToken();
    const demo = isDemoMode();
    if (!k && !demo) return href;
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
    if (k) params.set("k", k);
    if (demo) params.set("demo", "1");
    const qs = params.toString();
    return path + (qs ? "?" + qs : "") + hash;
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
    if (reduce || document.documentElement.classList.contains("is-shot")) {
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
      html += "<div class='menu-group reveal' id='potluck'><h2>Potluck</h2><div class='menu-cats'>";
      cats.forEach((cat) => {
        const rows = items.filter((it) => it.category === cat);
        html += "<div class='menu-cat'>";
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
        html += "</ul></div>";
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

  function pinLockRemaining() {
    try {
      const until = parseInt(sessionStorage.getItem(STORE_PIN_LOCK) || "0", 10);
      const left = until - Date.now();
      return left > 0 ? left : 0;
    } catch {
      return 0;
    }
  }

  function recordPinFailure() {
    try {
      const tries = parseInt(sessionStorage.getItem(STORE_PIN_TRIES) || "0", 10) + 1;
      sessionStorage.setItem(STORE_PIN_TRIES, String(tries));
      if (tries >= PIN_MAX_TRIES) {
        sessionStorage.setItem(STORE_PIN_LOCK, String(Date.now() + PIN_LOCK_MS));
        sessionStorage.setItem(STORE_PIN_TRIES, "0");
      }
    } catch (_) { /* ignore */ }
  }

  function clearPinFailures() {
    try {
      sessionStorage.removeItem(STORE_PIN_TRIES);
      sessionStorage.removeItem(STORE_PIN_LOCK);
    } catch (_) { /* ignore */ }
  }

  function pinBoxesHtml() {
    return Array.from({ length: 6 }, (_, i) =>
      `<input class="pin-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="${i === 0 ? "one-time-code" : "off"}" aria-label="PIN digit ${i + 1}" data-index="${i}">`
    ).join("");
  }

  const WEAK_PIN_SET = {
    "012345": 1, "123456": 1, "234567": 1, "345678": 1, "456789": 1, "567890": 1,
    "987654": 1, "876543": 1, "765432": 1, "654321": 1, "543210": 1, "432109": 1,
    "321098": 1, "210987": 1, "109876": 1, "098765": 1
  };

  function isWeakPin(digits) {
    const pin = String(digits || "");
    if (!/^\d{6}$/.test(pin)) return true;
    if (/^(.)\1{5}$/.test(pin)) return true;
    return !!WEAK_PIN_SET[pin];
  }

  function startGuestSession(token) {
    const k = String(token || "").trim();
    if (!k) return;
    persistToken(k);
    const url = new URL(location.href);
    url.searchParams.set("k", k);
    const next = url.pathname.split("/").pop() + (url.search ? "?" + url.searchParams.toString() : "") + url.hash;
    history.replaceState({ spa: true }, "", next);
    afterPageChange();
  }

  function backToNameLink() {
    return '<p class="logout-line"><a href="me.html" id="pick-another-name">Choose a different name</a></p>';
  }

  const FACE_SLUGS = {
    andrea: 1, brenda: 1, dharshen: 1, "hui-yi": 1, jack: 1, "jian-han": 1,
    jon: 1, megan: 1, michelle: 1, stuart: 1, thivya: 1, "yen-ting": 1,
    "yi-jia": 1, "zhen-yang": 1
  };

  function guestSlug(name) {
    return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function guestFaceHtml(name, opts) {
    opts = opts || {};
    const slug = guestSlug(name);
    const wrapClass = "who-face-wrap" + (opts.className ? " " + opts.className : "");
    if (!FACE_SLUGS[slug]) {
      return `<span class="${wrapClass}"><span class="who-face is-placeholder" aria-hidden="true">🧝</span></span>`;
    }
    const sizes = opts.sizes || "(min-width: 1280px) 180px, (min-width: 800px) 22vw, 42vw";
    const base = "assets/faces/" + slug;
    const lock = opts.claimed ? '<span class="who-lock" aria-hidden="true">🔒</span>' : "";
    const alt = name ? escapeAttr(name) : "";
    return `<span class="${wrapClass}">
      <picture class="who-face">
        <source type="image/webp" srcset="${base}.webp 240w, ${base}-480.webp 480w" sizes="${sizes}">
        <img src="${base}.jpg" srcset="${base}.jpg 240w, ${base}-480.jpg 480w" sizes="${sizes}" width="240" height="240" alt="${alt}" decoding="async">
      </picture>
      ${lock}
    </span>`;
  }

  function whoGridHtml(guests) {
    const tiles = (guests || []).map((g) => {
      const claimed = !!g.claimed;
      const isTest = !!g.is_test;
      const name = g.display_name || g.name || "";
      return `<button type="button" class="who-tile${claimed ? " is-claimed" : ""}${isTest ? " is-test" : ""}" data-guest-id="${escapeAttr(g.id)}" data-claimed="${claimed ? "1" : "0"}" data-name="${escapeAttr(name)}">
        ${guestFaceHtml(name, { claimed })}
        <span class="who-name">${escapeHtml(name)}</span>
        ${isTest ? '<span class="who-test">test</span>' : ""}
        ${claimed ? '<span class="who-claimed">Claimed — log in with your PIN</span>' : ""}
      </button>`;
    }).join("");
    return `
      <div class="who-gate">
        <div class="section-head" style="margin-bottom:1.1rem">
          <div class="cloud-title"><h1>Who are you?</h1></div>
          <p class="lede">Tap your name to claim your page, or log in if you’ve already created a PIN.</p>
        </div>
        <div class="who-grid" role="list">${tiles}</div>
        <p class="pin-error" id="who-error" hidden></p>
      </div>`;
  }

  function confirmYouHtml(guest) {
    return `
      <div class="pin-gate">
        <div class="card">
          ${guestFaceHtml(guest.name, { className: "is-large", sizes: "176px" })}
          <h1 class="outline-red" style="-webkit-text-stroke:4px #fff">Are you ${escapeHtml(guest.name)}?</h1>
          <p class="pin-lead">Only claim this name if it is you. Your page is private once it is locked to your PIN.</p>
          <div class="form-actions" style="justify-content:center;margin-top:1.2rem">
            <button type="button" class="btn btn-gold" id="confirm-yes">Yes, that’s me</button>
            <button type="button" class="btn btn-ghost" id="confirm-no" style="color:var(--navy);border-color:#e0d4bf">Not me</button>
          </div>
        </div>
      </div>`;
  }

  function createPinHtml(guest, step) {
    const confirm = step === "confirm";
    return `
      <div class="pin-gate">
        <div class="card">
          <h1 class="outline-red" style="-webkit-text-stroke:4px #fff">${confirm ? "Confirm your PIN" : "Create your 6-digit PIN"}</h1>
          <p class="pin-lead">${confirm ? "Type the same PIN once more." : "This is for " + escapeHtml(guest.name) + ". You’ll use it to open your page later."}</p>
          <p class="pin-warn">Only you know this. Don’t share it.</p>
          <form id="pin-form" action="#" novalidate>
            <div class="pin-boxes" role="group" aria-label="${confirm ? "Confirm six-digit PIN" : "New six-digit PIN"}">${pinBoxesHtml()}</div>
            <p class="pin-error" id="pin-error" hidden></p>
            <p style="margin-top:1rem"><button class="btn btn-gold" type="submit">${confirm ? "Save PIN and open my page" : "Continue"}</button></p>
          </form>
          ${backToNameLink()}
        </div>
      </div>`;
  }

  function loginPinHtml(guest) {
    return `
      <div class="pin-gate">
        <div class="card">
          ${guestFaceHtml(guest.name, { className: "is-large", sizes: "176px" })}
          <h1 class="outline-red" style="-webkit-text-stroke:4px #fff">Welcome back, ${escapeHtml(guest.name)}</h1>
          <p class="pin-lead">Enter your 6-digit PIN to open your page.</p>
          <form id="pin-form" action="#" novalidate>
            <div class="pin-boxes" role="group" aria-label="Six-digit PIN">${pinBoxesHtml()}</div>
            <p class="pin-error" id="pin-error" hidden></p>
            <p style="margin-top:1rem"><button class="btn btn-gold" type="submit">Open my page</button></p>
          </form>
          ${backToNameLink()}
        </div>
      </div>`;
  }

  function bindPinBoxes(root, opts) {
    const inputs = $all(".pin-digit", root);
    const error = $("#pin-error", root);
    const autoSubmit = !opts || opts.autoSubmit !== false;
    let submitting = false;

    function digits() {
      return inputs.map((el) => (el.value || "").replace(/\D/g, "").slice(0, 1)).join("");
    }

    function setError(msg) {
      if (!error) return;
      if (!msg) { error.hidden = true; error.textContent = ""; return; }
      error.hidden = false;
      error.textContent = msg;
    }

    function showLockout() {
      const tick = () => {
        const left = pinLockRemaining();
        if (left <= 0) {
          setError("");
          inputs.forEach((el) => { el.disabled = false; });
          if (inputs[0]) inputs[0].focus();
          return;
        }
        const secs = Math.ceil(left / 1000);
        setError("A few too many tries. Please wait " + secs + " second" + (secs === 1 ? "" : "s") + " and try again.");
        inputs.forEach((el) => { el.disabled = true; });
        setTimeout(tick, 250);
      };
      tick();
    }

    function fillFrom(text, start) {
      const nums = String(text || "").replace(/\D/g, "");
      if (!nums) return;
      let i = start;
      for (const ch of nums) {
        if (i >= 6) break;
        inputs[i].value = ch;
        i += 1;
      }
      if (i >= 6) inputs[5].focus();
      else if (inputs[i]) inputs[i].focus();
      if (autoSubmit && digits().length === 6) trySubmit();
    }

    function trySubmit() {
      if (submitting) return;
      const pin = digits();
      if (opts && opts.checkLock && pinLockRemaining() > 0) { showLockout(); return; }
      if (pin.length !== 6) {
        setError("Please enter all six digits.");
        return;
      }
      if (opts && opts.validate && opts.validate(pin, setError) === false) return;
      if (!opts || !opts.onSubmit) return;
      submitting = true;
      Promise.resolve(opts.onSubmit(pin, setError)).then(() => {
        submitting = false;
      }).catch(() => {
        submitting = false;
        setError("Couldn’t check that just now. Please try again.");
      });
    }

    inputs.forEach((el, i) => {
      el.addEventListener("input", () => {
        const v = (el.value || "").replace(/\D/g, "");
        if (v.length > 1) {
          el.value = "";
          fillFrom(v, i);
          return;
        }
        el.value = v.slice(-1);
        if (el.value && inputs[i + 1]) inputs[i + 1].focus();
        if (autoSubmit && digits().length === 6) trySubmit();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !el.value && i > 0) {
          inputs[i - 1].focus();
          inputs[i - 1].value = "";
          e.preventDefault();
        }
        if (e.key === "ArrowLeft" && i > 0) { inputs[i - 1].focus(); e.preventDefault(); }
        if (e.key === "ArrowRight" && inputs[i + 1]) { inputs[i + 1].focus(); e.preventDefault(); }
      });
      el.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        if (!/\d/.test(text)) return;
        e.preventDefault();
        fillFrom(text, 0);
      });
      el.addEventListener("focus", () => el.select());
    });

    const form = $("#pin-form", root);
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        trySubmit();
      });
    }

    if (opts && opts.checkLock && pinLockRemaining() > 0) showLockout();
    else if (inputs[0]) inputs[0].focus();

    return { digits, setError, clear() { inputs.forEach((el) => { el.value = ""; }); } };
  }

  function bindBackToNames(root, guests) {
    const link = $("#pick-another-name", root);
    if (!link) return;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showWhoGrid(root, guests);
    });
  }

  function showLoginPin(root, guests, guest) {
    root.innerHTML = loginPinHtml(guest);
    bindBackToNames(root, guests);
    bindPinBoxes(root, {
      autoSubmit: true,
      checkLock: true,
      onSubmit: (pin, setError) => window.InviteData.loginWithPin(guest.id, pin).then((res) => {
        if (res && res.ok && res.token) {
          clearPinFailures();
          startGuestSession(res.token);
          return;
        }
        recordPinFailure();
        const inputs = $all(".pin-digit", root);
        inputs.forEach((el) => { el.value = ""; });
        if (pinLockRemaining() > 0) return;
        setError((res && res.message) || "That PIN didn’t work. Please try again.");
        if (inputs[0]) inputs[0].focus();
      })
    });
  }

  function showCreatePin(root, guests, guest, firstPin) {
    const confirm = !!firstPin;
    root.innerHTML = createPinHtml(guest, confirm ? "confirm" : "create");
    bindBackToNames(root, guests);
    bindPinBoxes(root, {
      autoSubmit: confirm,
      validate: (pin, setError) => {
        if (!confirm && isWeakPin(pin)) {
          setError("Please pick a harder PIN than a simple sequence or repeated number.");
          return false;
        }
        if (confirm && pin !== firstPin) {
          setError("Those PINs didn’t match. Please try again.");
          return false;
        }
        return true;
      },
      onSubmit: (pin, setError) => {
        if (!confirm) {
          if (isWeakPin(pin)) {
            setError("Please pick a harder PIN than a simple sequence or repeated number.");
            return;
          }
          showCreatePin(root, guests, guest, pin);
          return;
        }
        return window.InviteData.claimGuest(guest.id, pin).then((res) => {
          if (res && res.ok && res.token) {
            startGuestSession(res.token);
            return;
          }
          if (res && res.reason === "claimed") {
            setError(res.message || "That name is already claimed. Log in with your PIN.");
            return;
          }
          setError((res && res.message) || "Couldn’t save that PIN just now. Please try again.");
        });
      }
    });
  }

  function showConfirmYou(root, guests, guest) {
    root.innerHTML = confirmYouHtml(guest);
    $("#confirm-yes", root).addEventListener("click", () => showCreatePin(root, guests, guest));
    $("#confirm-no", root).addEventListener("click", () => showWhoGrid(root, guests));
  }

  function showWhoGrid(root, guests) {
    root.innerHTML = whoGridHtml(guests);
    $all(".who-tile", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const guest = {
          id: btn.getAttribute("data-guest-id"),
          name: btn.getAttribute("data-name") || ""
        };
        if (btn.getAttribute("data-claimed") === "1") showLoginPin(root, guests, guest);
        else showConfirmYou(root, guests, guest);
      });
    });
  }

  function renderClaimGate(root) {
    root.innerHTML = '<p class="lede" style="text-align:center">Finding everyone…</p>';
    window.InviteData.listGuestsPublic().then((res) => {
      if (!res || !res.ok) {
        root.innerHTML = gateHtml("We can’t open the name list just now.", "Please refresh and try again.") +
          '<p class="logout-line"><a href="me.html">Try again</a></p>';
        return;
      }
      showWhoGrid(root, res.guests || []);
    }).catch(() => {
      root.innerHTML = gateHtml("We can’t open the name list just now.", "Please refresh and try again.") +
        '<p class="logout-line"><a href="me.html">Try again</a></p>';
    });
  }

  const CHAT_PROMPTS = ["What size tee?", "Any allergies?", "Wish list?"];
  const CHAT_POLL_MS = 4000;
  let chatPollTimer = null;
  let chatCtx = null;

  function stopChatPoll() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    chatCtx = null;
  }

  function formatChatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return time;
    const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return date + ", " + time;
  }

  function displayAuthorLabel(label) {
    const s = String(label || "").trim();
    if (s === "Your Secret Santa 🎅" || s === "Your Secret Santa") return "🎅 Your Secret Santa";
    return s;
  }

  function messageBubbleHtml(m) {
    const side = m.fromMe ? "me" : "them";
    return `<div class="bubble-row ${side}" data-id="${escapeAttr(m.id)}" data-at="${escapeAttr(m.createdAt)}">
      <div class="bubble">
        <p class="bubble-author">${escapeHtml(displayAuthorLabel(m.authorLabel))}</p>
        <p class="bubble-text">${escapeHtml(m.text)}</p>
        <p class="bubble-time"><time datetime="${escapeAttr(m.createdAt)}">${escapeHtml(formatChatTime(m.createdAt))}</time></p>
      </div>
    </div>`;
  }

  function chatSectionHtml(g, wishlist) {
    const prompts = CHAT_PROMPTS.map((p) =>
      `<button type="button" class="prompt-chip" data-prompt="${escapeAttr(p)}">${escapeHtml(p)}</button>`
    ).join("");
    return `
      <section class="ss-chat" aria-label="Secret Santa chat">
        <div class="section-head" style="margin-top:2rem;margin-bottom:1rem">
          <div class="cloud-title"><h2>Secret Santa chat</h2></div>
          <p class="lede">Two private threads. The person you’re buying a gift for never sees your name — you show up as 🎅 Your Secret Santa.</p>
        </div>
        <form class="card form wishlist-card reveal" id="wishlist-form">
          <h3>My wish list (your Secret Santa sees this)</h3>
          <p>You can change it any time.</p>
          <label class="visually-hidden" for="wishlist-text">My wish list (your Secret Santa sees this)</label>
          <textarea id="wishlist-text" name="wishlist" maxlength="400" rows="3" placeholder="A few gift ideas, sizes, or things to skip…">${escapeHtml(wishlist || "")}</textarea>
          <div class="form-actions">
            <button class="btn btn-gold" type="submit">Save wish list</button>
          </div>
          <p class="form-status" id="wishlist-status" hidden></p>
        </form>
        <div class="card chat-panel reveal" style="margin-top:1.1rem">
          <div class="chat-tabs" role="tablist" aria-label="Secret Santa threads">
            <button type="button" class="chat-tab" role="tab" id="tab-giftee" aria-controls="chat-log" aria-selected="true" data-thread="giftee">Chat with ${escapeHtml(g.secretSantaFor)} (you’re their Santa)</button>
            <button type="button" class="chat-tab" role="tab" id="tab-santa" aria-controls="chat-log" aria-selected="false" data-thread="santa">Chat with your Secret Santa (who has you)</button>
          </div>
          <div class="chat-peer" id="chat-peer"></div>
          <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
          <div class="chat-prompts" id="chat-prompts">${prompts}</div>
          <form class="chat-compose" id="chat-form">
            <label class="visually-hidden" for="chat-input">Message</label>
            <textarea id="chat-input" rows="1" maxlength="400" placeholder="Write a message…" enterkeyhint="send"></textarea>
            <button class="btn btn-gold" type="submit">Send</button>
          </form>
          <p class="chat-status" id="chat-status" hidden></p>
        </div>
      </section>
    `;
  }

  function isChatNearBottom(log) {
    return (log.scrollHeight - log.scrollTop - log.clientHeight) < 80;
  }

  function appendChatMessages(log, messages, forceScroll) {
    if (!messages || !messages.length) return;
    const near = forceScroll || isChatNearBottom(log);
    const html = messages.map(messageBubbleHtml).join("");
    log.insertAdjacentHTML("beforeend", html);
    if (near) log.scrollTop = log.scrollHeight;
  }

  function setChatPeer(thread, guest, gifteeWish) {
    const peer = $("#chat-peer");
    if (!peer) return;
    if (thread === "giftee") {
      const wish = (gifteeWish || "").trim();
      peer.innerHTML = `
        <p class="chat-peer-name">Chat with ${escapeHtml(guest.secretSantaFor)} (you’re their Santa)</p>
        <p class="chat-peer-note">They see you as 🎅 Your Secret Santa — your name stays hidden.</p>
        <div class="peer-wish">
          <h3>Their wish list</h3>
          <p>${wish ? escapeHtml(wish) : "They haven’t added a wish list yet."}</p>
        </div>`;
    } else {
      peer.innerHTML = `
        <p class="chat-peer-name">🎅 Your Secret Santa</p>
        <p class="chat-peer-note">This is the person who has you. They stay anonymous. They can see the wish list you saved above.</p>`;
    }
  }

  function bindWishlist(root, token) {
    const form = $("#wishlist-form", root);
    const status = $("#wishlist-status", root);
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      window.InviteData.setWishlist(token, $("#wishlist-text", root).value).then((out) => {
        status.hidden = false;
        if (!out.ok) {
          status.style.color = "var(--red-deep)";
          status.textContent = out.message || "Couldn’t save just now.";
          return;
        }
        status.style.color = "var(--green-deep)";
        status.textContent = "Saved. Your Secret Santa can see this.";
      });
    });
  }

  function bindChat(root, token, guest) {
    const log = $("#chat-log", root);
    const form = $("#chat-form", root);
    const input = $("#chat-input", root);
    const status = $("#chat-status", root);
    const prompts = $("#chat-prompts", root);
    if (!log || !form || !input) return;

    stopChatPoll();
    chatCtx = { token, thread: "giftee", lastAt: "", guest };

    function setStatus(msg, ok) {
      if (!status) return;
      if (!msg) { status.hidden = true; status.textContent = ""; return; }
      status.hidden = false;
      status.style.color = ok ? "var(--green-deep)" : "var(--red-deep)";
      status.textContent = msg;
    }

    function showThreadChrome(thread) {
      $all(".chat-tab", root).forEach((btn) => {
        const on = btn.getAttribute("data-thread") === thread;
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      if (prompts) prompts.hidden = thread !== "giftee";
      input.placeholder = thread === "giftee"
        ? "Message " + guest.secretSantaFor + "…"
        : "Message your Secret Santa…";
    }

    function loadThread(thread, opts) {
      const fresh = !opts || opts.fresh;
      const since = fresh ? "" : chatCtx.lastAt;
      return window.InviteData.listMessages(token, thread, since).then((res) => {
        if (!res.ok || !chatCtx || chatCtx.thread !== thread) return;
        const messages = res.messages || [];
        if (fresh) {
          const emptyMsg = thread === "giftee"
            ? "No messages yet. Say hi to " + (guest.secretSantaFor || "them") + "!"
            : "No messages yet. Say hi to your Secret Santa!";
          log.innerHTML = messages.length
            ? messages.map(messageBubbleHtml).join("")
            : '<p class="chat-empty">' + escapeHtml(emptyMsg) + "</p>";
          log.scrollTop = log.scrollHeight;
        } else if (messages.length) {
          const empty = log.querySelector(".chat-empty");
          if (empty) empty.remove();
          appendChatMessages(log, messages, false);
        }
        if (messages.length) chatCtx.lastAt = messages[messages.length - 1].createdAt;
      });
    }

    function switchThread(thread) {
      if (!chatCtx) return;
      chatCtx.thread = thread;
      chatCtx.lastAt = "";
      showThreadChrome(thread);
      const wishCall = thread === "giftee"
        ? window.InviteData.getWishlist(token, "giftee")
        : Promise.resolve({ ok: true, text: "" });
      wishCall.then((wish) => {
        setChatPeer(thread, guest, wish && wish.ok ? wish.text : "");
      });
      loadThread(thread, { fresh: true });
    }

    $all(".chat-tab", root).forEach((btn) => {
      btn.addEventListener("click", () => switchThread(btn.getAttribute("data-thread")));
    });

    if (prompts) {
      prompts.addEventListener("click", (e) => {
        const chip = e.target.closest(".prompt-chip");
        if (!chip) return;
        input.value = chip.getAttribute("data-prompt") || "";
        input.focus();
      });
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !chatCtx) return;
      const thread = chatCtx.thread;
      input.value = "";
      window.InviteData.sendMessage(token, thread, text).then((out) => {
        if (!out.ok) {
          setStatus(out.message || "Couldn’t send just now.", false);
          if (!input.value) input.value = text;
          return;
        }
        setStatus("");
        const empty = log.querySelector(".chat-empty");
        if (empty) empty.remove();
        appendChatMessages(log, [out.message], true);
        chatCtx.lastAt = out.message.createdAt;
      });
    });

    showThreadChrome("giftee");
    switchThread("giftee");
    chatPollTimer = setInterval(() => {
      if (!chatCtx) return;
      loadThread(chatCtx.thread, { fresh: false });
      if (chatCtx.thread === "giftee") {
        window.InviteData.getWishlist(token, "giftee").then((wish) => {
          if (chatCtx && chatCtx.thread === "giftee") {
            setChatPeer("giftee", guest, wish && wish.ok ? wish.text : "");
          }
        });
      }
    }, CHAT_POLL_MS);
  }

  function renderGuestPage() {
    const root = $("#me-root");
    if (!root || !globalInvite()) return;
    const token = currentToken();
    const data = window.InviteData;

    if (!token) {
      renderClaimGate(root);
      return;
    }

    data.getGuestByToken(token).then((res) => {
      if (!res.ok) {
        root.innerHTML = gateHtml("We can’t open this personal link.", "Please go back and pick your name, or ask Jack for help.") +
          '<p class="logout-line"><a href="me.html" id="pin-instead">Pick your name instead</a></p>';
        const alt = $("#pin-instead", root);
        if (alt) alt.addEventListener("click", logoutGuest);
        return;
      }
      const g = res.guest;
      const bringing = g.bringing || { dish: "", category: "Main", notes: "" };
      root.innerHTML = `
        ${res.demo || (g.token && String(g.token).indexOf("demo") === 0) ? '<p class="banner-demo">Preview data only — not a real draw.</p>' : ""}
        <p class="hi">${guestFaceHtml(g.name, { className: "is-large", sizes: "124px" })}<span class="outline-red">Hi, ${escapeHtml(g.name)}</span></p>
        <p class="lede" style="margin-bottom:1.5rem">This page is just for you. Please don’t share your link — it shows who you’re getting a gift and an ugly tee for.</p>
        <div class="secret-grid">
          <article class="card secret-card reveal">
            <p class="icon" aria-hidden="true">🎁</p>
            <h3>You are <span class="for">${escapeHtml(g.secretSantaFor)}</span>’s Secret Santa</h3>
            <p class="hint">Buy them a gift. Keep it secret!</p>
          </article>
          <article class="card secret-card reveal">
            <p class="icon" aria-hidden="true">👕</p>
            <h3>You’re getting an ugly tee for:</h3>
            <p class="for">${escapeHtml(g.uglyTeeFor)}</p>
          </article>
        </div>
        ${chatSectionHtml(g, "")}
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
        <p class="logout-line"><a href="me.html" id="logout-link">Not you? Log out</a></p>
      `;
      const logout = $("#logout-link", root);
      if (logout) logout.addEventListener("click", logoutGuest);
      data.getWishlist(token, "mine").then((wish) => {
        const area = $("#wishlist-text", root);
        if (area && wish && wish.ok) area.value = wish.text || "";
      });
      bindWishlist(root, token);
      bindChat(root, token, g);
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
          status.textContent = isDemoMode() ? "Saved. It will show on the Menu tab in this browser (preview only)." : "Saved. It will show on the Menu tab.";
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
            status.textContent = isDemoMode() ? "Cleared from the preview menu." : "Cleared from the menu.";
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
    stopChatPoll();
    updateNavCurrent();
    carryTokenInLinks();
    personalizeGift();
    applyGiftVisibility();
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
  }

  async function swapTo(href, push) {
    const url = new URL(href, location.href);
    const k = currentToken();
    if (k && !url.searchParams.get("k")) url.searchParams.set("k", k);
    if (isDemoMode()) url.searchParams.set("demo", "1");
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
    reveals();
    renderMenu();
    renderGuestPage();
    spaNavigate();
  });
})();
