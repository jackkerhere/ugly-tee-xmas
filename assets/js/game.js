/**
 * Who Stole Christmas? — player Game tab, host screen, TV, and public guides.
 * Roles never come from the client; the host shuffle deals them on the server.
 */
(function (global) {
  const STORE_HOST = "uglytee-host-token";
  const POLL_HOST = 4000;
  const POLL_TV = 1000;
  const POLL_PLAYER = 5000;
  const SPARE_VOTE = "spare";
  let pollTimer = null;
  let pollOnVisible = null;
  let lastSig = "";
  let playerPickRound = "";
  let hostSetupPending = false;
  let pickId = "";
  let pickId2 = "";
  let pickId3 = "";

  const ROLE_META = {
    grinch: { icon: "💚", name: "Grinch", side: "Bad", portrait: "grinch" },
    tough_grinch: { icon: "💪", name: "Tough Grinch", side: "Bad", portrait: "tough-grinch" },
    krampus: { icon: "🐐", name: "Krampus", side: "Bad", portrait: "krampus" },
    santa: { icon: "🎅", name: "Santa", side: "Nice", portrait: "santa" },
    reindeer: { icon: "🦌", name: "Reindeer", side: "Nice", portrait: "reindeer" },
    detective: { icon: "🔎", name: "Elf Detective", side: "Nice", portrait: "elf-detective" },
    mrs_claus: { icon: "☕", name: "Mrs Claus", side: "Nice", portrait: "mrs-claus" },
    gingerbread: { icon: "🍪", name: "Gingerbread Man", side: "Nice", portrait: "gingerbread-man" },
    fruitcake: { icon: "🍰", name: "Fruitcake", side: "Nice", portrait: "fruitcake" },
    witness: { icon: "👀", name: "Witness", side: "Nice", portrait: "witness" },
    liar_elf: { icon: "🤥", name: "Liar Elf", side: "Nice", portrait: "liar-elf" },
    citizen: { icon: "🎄", name: "Citizen", side: "Nice", portrait: "citizen" },
    snowman: { icon: "⛄", name: "Snowman", side: "Alone", portrait: "snowman" },
    ghost: { name: "Ghosts", portrait: "ghost" }
  };

  function api() { return global.InviteData; }
  function ui() { return global.UglyTeeUI || {}; }
  function $(sel, root) { return (ui().$ || function (s, r) { return (r || document).querySelector(s); })(sel, root); }
  function escapeHtml(str) { return (ui().escapeHtml || function (s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
  })(str); }
  function face(name, opts) {
    if (ui().guestFaceHtml) return ui().guestFaceHtml(name, opts || { className: "is-large", sizes: "96px" });
    return "";
  }
  function rolePortrait(role, className, loading = "eager") {
    if (!role.portrait) return "";
    return `<img class="${className}" src="assets/game-characters/${role.portrait}.webp" width="480" height="480" alt="" loading="${loading}" decoding="async">`;
  }
  function token() { return ui().currentToken ? ui().currentToken() : ""; }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pollOnVisible) {
      document.removeEventListener("visibilitychange", pollOnVisible);
      pollOnVisible = null;
    }
  }

  function startPoll(fn, ms) {
    stopPoll();
    pollTimer = setInterval(fn, ms);
    pollOnVisible = () => {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", pollOnVisible);
  }

  function hostToken() {
    try { return (sessionStorage.getItem(STORE_HOST) || "").trim(); }
    catch (_) { return ""; }
  }
  function setHostToken(t) {
    try {
      if (t) sessionStorage.setItem(STORE_HOST, t);
      else sessionStorage.removeItem(STORE_HOST);
    } catch (_) { /* ignore */ }
  }

  function phaseLabel(d) {
    const phase = (d && d.phase) || "not_started";
    const n = d && d.nightNumber;
    if (phase === "not_started" || phase === "setup") return "Waiting for the host";
    if (phase === "shuffled") return "Roles are in — story not started";
    if (phase === "reveal") {
      const mode = d.reveal && d.reveal.mode;
      if (mode === "intro") return "The story begins";
      if (mode === "night") return "Morning reveal · Night " + n;
      if (mode === "vote") return "The vote is in";
      if (mode === "twist" || mode === "recount") return "Plot twist!";
      return "Meanwhile…";
    }
    if (phase === "night") return "Night " + n;
    if (phase === "day") return "Day " + (d.dayNumber || n);
    if (phase === "twist") return "A twist?";
    if (phase === "gingerbread") return "The cookie has thoughts";
    if (phase === "ended") return "That’s a wrap";
    return phase;
  }

  function docsHtml(opts) {
    const back = opts && opts.backGame ? '<p class="game-docs-back"><a href="game.html">← Back to Game</a></p>' : "";
    return `
      <div class="game-docs">
        <a class="btn btn-gold" href="guide.html">Character Guide</a>
        <a class="btn btn-ghost game-docs-alt" href="how-to-play.html">How to Play</a>
      </div>
      <p class="game-docs-note">Everyone can read these — no PIN, no secrets.</p>
      ${back}`;
  }

  const GUIDE_GROUPS = [
    ["Concertorants", "town", ["santa", "reindeer", "detective", "mrs_claus", "gingerbread", "fruitcake", "liar_elf", "citizen"]],
    ["Grinches", "grinches", ["grinch", "tough_grinch"]],
    ["Wanderers", "wanderers", ["krampus", "snowman"]],
    ["Ghosts", "ghosts", ["ghost"]]
  ];

  const GUIDE_DETAILS = {
    "grinch": {
      "description": "Concerto is Santa’s home, and nowhere loves Christmas more. For years, the Grinches tried to ruin it. They stole the bells and salted the hot chocolate. Every year, the village celebrated anyway. This year, the Grinches moved to Concerto and started posing as neighbours. Now they’re trying to steal Christmas right from under Santa’s nose.",
      "abilities": [
        "Each night, choose one target together with the other Grinches."
      ],
      "winCondition": "The Grinches win when they match or outnumber all other living players combined."
    },
    "tough_grinch": {
      "description": "The Tough Grinch helped carry the stolen presents out of Concerto in a single sack. When the sack split halfway up the hill, they carried the presents the rest of the way anyway.",
      "abilities": [
        "Choose one target together with the other Grinches each night.",
        "Your extra life protects you from one night hit. How you survived stays secret. If the village votes you out, you become a ghost immediately."
      ],
      "winCondition": "The Grinches win when they match or outnumber all other living players combined."
    },
    "santa": {
      "description": "Santa knows Concerto one rooftop at a time. With the presents gone and the streets dark, there’s still one more name to check before he can call it a night.",
      "abilities": [
        "Save one person each night, including yourself. Choose somebody different from the previous night."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "reindeer": {
      "description": "The Reindeer usually guides the sleigh through the thickest snow. Tonight, their hoofprints stop outside someone’s door.",
      "abilities": [
        "Guard one other person each night. You can guard the same person again.",
        "Your target survives an attack if you make it through the night."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "detective": {
      "description": "The Elf Detective found an empty hook where the village’s oldest bell used to hang. Now there’s a notebook full of suspects and a magnifying glass fogged up from the cold.",
      "abilities": [
        "Check one person each night. You’ll get one yes or no answer for whether they’re a Grinch, the Tough Grinch, or Krampus."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "mrs_claus": {
      "description": "Mrs Claus keeps the kettle on long after the Christmas market closes. At the back of her cupboard, next to the good cocoa, is a little tin marked FOR EMERGENCIES.",
      "abilities": [
        "Use Hot Cocoa once per game to save that night’s targets. Cocoa can save you on the first night only.",
        "Use Coal once per game to poison one person.",
        "You can use one item per night."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "gingerbread": {
      "description": "The Gingerbread Man escaped the bakery before anyone could put on the second gumdrop button. They’re still touchy about being called a party snack.",
      "abilities": [
        "You have no special night action while alive.",
        "When eliminated, choose one living player to hit on your way out."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "fruitcake": {
      "description": "This Fruitcake has survived three Christmas markets, a week on the post office shelf, and a family that keeps wrapping it up again. A little trouble in Concerto hardly seems worth mentioning.",
      "abilities": [
        "You have no special night action.",
        "Your extra life protects you from one night hit. How you survived stays secret. If the village votes you out, you become a ghost immediately."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "liar_elf": {
      "description": "The Liar Elf swears they spent Christmas Eve knitting scarves for the elderly. Their scarf has no stitches, and Concerto’s oldest resident says she’d remember.",
      "abilities": [
        "You have no special night action.",
        "You can only lie. If you tell the truth, you’re out."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "citizen": {
      "description": "The Citizen helped hang the lanterns, knows who burns the mince pies, and has lived in Concerto long enough to notice when someone seems a little too cheerful after Christmas goes missing.",
      "abilities": [
        "Vote with the village during the day. Check in each night just like everyone else.",
        "You have no special power."
      ],
      "winCondition": "The Concertorants win when every Grinch and Krampus is out."
    },
    "krampus": {
      "description": "When Concerto’s last lantern goes out, Krampus is just getting started. By morning, they’ll look like any other neighbour at the market and probably ask if you slept well.",
      "abilities": [
        "Choose one target on your own each night."
      ],
      "winCondition": "Be the last player standing."
    },
    "snowman": {
      "description": "The Snowman has stood in the square through every carol, every snowstorm, and every argument about where to put the tree. This year, they’re hoping the village will finally give them a reason to leave.",
      "abilities": [
        "You have no special night action."
      ],
      "winCondition": "Get voted out by the village. Everyone else keeps playing."
    },
    "ghost": {
      "description": "There’s a cold spot at the market where the cocoa never stays hot. The Ghosts meet there after dark to compare notes and decide whose turn it is to rattle a window.",
      "abilities": [
        "Together, share one clue each morning about what caused one player’s death. Keep the killer’s name secret.",
        "Together, haunt one living player to stop their next vote.",
        "Once per game, the Ghosts can take over one living player’s vote."
      ],
      "winCondition": "Each Ghost can predict the winning side. If more than half of the predictions are correct, every Ghost earns a gachapon spin."
    }
  };

  const GUIDE_TWISTS = [
    ["🌨️", "Blizzard", "No kills or saves tonight. Players still lock in a night tap, so nobody can tell."],
    ["📜", "Naughty List Leak", "The host reveals one living innocent (not a Grinch or Krampus). Not their exact role."],
    ["🗳️", "Secret Recount", "Wipe today’s votes and vote again."],
    ["🎁", "Gift Swap", "Two living players swap votes today."],
    ["🥛", "Egg-nog Hangover", "One random living player cannot vote today."],
    ["👕", "Ugly Tee Audit", "The host picks a living player. Their vote counts twice today."]
  ];

  function guideInnerHtml() {
    return `
      <header class="guide-hero">
        <p class="kicker">Who Stole Christmas?</p>
        <h1 class="outline-red">Character Guide</h1>
        <p class="lede">Choose a character to open their card. Roles are dealt when the host shuffles.</p>
      </header>
      ${GUIDE_GROUPS.map(([side, family, roles]) => `
        <section class="guide-side">
          <h2>${side}</h2>
          <ul class="guide-list guide-character-grid">
            ${roles.map(role => {
              const character = ROLE_META[role];
              return `<li class="guide-character">
                <h3><button class="guide-character-button" type="button" data-guide-role="${role}" data-card-family="${family}" aria-haspopup="dialog">
                  ${rolePortrait(character, "guide-portrait", "lazy")}
                  <span>${escapeHtml(character.name)}</span>
                  <span class="guide-character-arrow" aria-hidden="true">›</span>
                </button></h3>
              </li>`;
            }).join("")}
          </ul>
        </section>`).join("")}
      <section class="guide-side">
        <h2>Host optional chaos</h2>
        <ul class="guide-list">
          ${GUIDE_TWISTS.map(([symbol, name, blurb]) => `<li>
            <span class="guide-icon" aria-hidden="true">${symbol}</span>
            <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(blurb)}</p></div>
          </li>`).join("")}
        </ul>
      </section>
      ${docsHtml({ backGame: true })}
    `;
  }

  function characterCardHtml(role) {
    const character = ROLE_META[role];
    const details = GUIDE_DETAILS[role];
    const [side, family] = GUIDE_GROUPS.find(([, , roles]) => roles.includes(role));
    return `
      <article class="character-card" data-card-family="${family}">
        <div class="character-card-controls">
          <button class="character-card-like" type="button" aria-pressed="false" disabled>
            <span class="character-card-heart" aria-hidden="true">♡</span>
            <span class="character-card-count">–</span>
          </button>
          <button class="character-card-close" type="button" aria-label="Close character card" autofocus>×</button>
        </div>
        <p class="character-card-like-status" role="status"></p>
        <a class="character-card-sign-in" href="game.html" hidden>Sign in to like this card</a>
        <header class="character-card-heading">
          <p class="character-card-faction">${side}</p>
          <h2 id="character-card-title">${escapeHtml(character.name)}</h2>
        </header>
        ${rolePortrait(character, "character-card-portrait")}
        <p class="character-card-bio">${escapeHtml(details.description)}</p>
        <section class="character-card-section">
          <h3>Abilities</h3>
          <ul>${details.abilities.map(ability => `<li>${escapeHtml(ability)}</li>`).join("")}</ul>
        </section>
        <section class="character-card-section">
          <h3>Win condition</h3>
          <p>${escapeHtml(details.winCondition)}</p>
        </section>
      </article>
    `;
  }

  function howtoInnerHtml() {
    return `
      <header class="guide-hero">
        <p class="kicker">Who Stole Christmas?</p>
        <h1 class="outline-red">How to Play</h1>
        <p class="lede">A comedic Christmas murder mystery at Brenda and Jack’s. Someone stole Christmas. You have ugly tees, snacks, and one job: figure it out — or get away with it.</p>
      </header>
      <ol class="howto-steps">
        <li><h3>Setup</h3><p>Open the <a href="game.html">Game tab</a>, sign in, and tap <strong>Join lobby</strong>. Jack hosts. The lobby takes 5 to 15 players and closes when Jack shuffles. The 13-player deck includes two Fruitcakes. The game adds one Citizen at 14 players and two at 15. You see your own card after the shuffle.</p></li>
        <li><h3>Night</h3><p>Everyone still in the game locks in something on their phone — even if your role has no power — so nobody can tell who is acting. Submissions are locked. The Grinches steal together; Krampus steals alone; Santa, the Reindeer, the Detective and Mrs Claus do their quiet festive work.</p></li>
        <li><h3>Morning reveal</h3><p>The TV tells it like a cliffhanger: someone is on the brink… then BAM, they’re out, or a mysterious rescue saves them. The host advances the story beat by beat. If someone survives a night hit, the reason stays secret. The Tough Grinch and both Fruitcakes can each survive one night hit.</p></li>
        <li><h3>Day vote</h3><p>Discuss for 3 minutes, then vote for a player or choose <strong>Spare everyone</strong>. A player with the most votes becomes a ghost immediately, even with an extra life. Everyone stays in if Spare everyone wins, the top vote ties, or no votes are counted. If the Snowman is voted out, they wanted this, they win, and the game continues. Anyone who is out takes a shot or a gachapon capsule.</p></li>
        <li><h3>Ghosts</h3><p>Out players haunt, request a killer clue, may possess one vote once a game, and can predict the winning side.</p></li>
        <li><h3>Twists</h3><p>Once a day the host may play one optional Twist card (or skip): Blizzard, Naughty List Leak, Secret Recount, Gift Swap, Egg-nog Hangover, or Ugly Tee Audit. The TV gets a dramatic reveal. The host can always skip.</p></li>
        <li><h3>How to win</h3><p><strong>Nice</strong> win when every Grinch and Krampus is out. <strong>Grinches</strong> win when living Grinches are at least as many as everyone else still alive (Krampus counts as not a Grinch). <strong>Krampus</strong> wins only if last standing. The Snowman’s win does not end the game.</p></li>
      </ol>
      <p class="howto-foot">The game uses a smaller deck for groups of 5 to 12 players.</p>
      ${docsHtml({ backGame: true })}
    `;
  }

  function hubInnerHtml() {
    return `
      <header class="guide-hero">
        <p class="kicker">Ugly Tee Christmas</p>
        <h1 class="outline-red">Who Stole Christmas?</h1>
        <p class="lede">A Mafia-style party game.</p>
      </header>
      <div id="game-play-root"></div>
      <div class="game-hub-grid">
        <a class="card game-hub-card" href="how-to-play.html"><h2>How to Play</h2><p>Setup, nights, morning reveals, votes, ghosts, twists, and how to win.</p></a>
        <a class="card game-hub-card" href="guide.html"><h2>Character Guide</h2><p>Every role, the ghosts, and the twist cards — no spoilers about tonight’s deal.</p></a>
        <a class="card game-hub-card" href="tv.html"><h2>TV screen</h2><p>The big public view: the story, who’s in, and the winner. No secrets.</p></a>
      </div>
      <p class="game-docs-note"><a href="host.html">Host screen</a> — for the narrator only.</p>
    `;
  }

  function renderGuide(root) {
    if (!root) return;
    root.innerHTML = `
      <div class="guide-page">${guideInnerHtml()}</div>
      <dialog class="guide-character-dialog" id="guide-character-dialog" aria-modal="true" aria-labelledby="character-card-title"></dialog>
    `;
    const page = $(".guide-page", root);
    const dialog = $("#guide-character-dialog", root);
    const data = api();
    const guestToken = token();
    let activeRole = null;
    let opener = null;
    let fallback = false;
    let likes = new Map();
    let canLike = false;
    let loaded = false;
    let reading = false;
    let saving = false;
    let revision = 0;
    let likeError = "";

    function renderLikes() {
      if (!activeRole || !dialog.hasAttribute("open")) return;
      const button = $(".character-card-like", dialog);
      const { count = 0, liked = false } = likes.get(activeRole) || {};
      $(".character-card-heart", dialog).textContent = liked ? "♥" : "♡";
      $(".character-card-count", dialog).textContent = loaded ? count.toLocaleString() : "–";
      const action = canLike ? (liked ? "Unlike" : "Like") + " " + ROLE_META[activeRole].name + ", " : "";
      button.setAttribute("aria-label", loaded ? action + count + (count === 1 ? " like" : " likes") : "Likes");
      button.setAttribute("aria-pressed", String(liked));
      button.disabled = !loaded || !canLike;
      button.setAttribute("aria-busy", String(saving));
      $(".character-card-like-status", dialog).textContent = likeError;
      $(".character-card-sign-in", dialog).hidden = !loaded || canLike;
    }

    function setLikes(result) {
      if (!result?.ok || !Array.isArray(result.likes)) throw new Error("Likes unavailable");
      likes = new Map(result.likes.map(({role, count, liked}) => [role, { count: Number(count) || 0, liked: liked === true }]));
      canLike = result.canLike === true;
      loaded = true;
      likeError = "";
    }

    async function refreshLikes() {
      if (reading || saving) return;
      const startedAt = revision;
      reading = true;
      try {
        const result = await data.characterLikes(guestToken);
        if (root.isConnected && startedAt === revision) setLikes(result);
      } catch {
        if (!loaded && startedAt === revision) likeError = "Couldn’t load likes. Reopen the card to try again.";
      } finally {
        reading = false;
        if (root.isConnected) renderLikes();
      }
    }

    function releaseCard() {
      if (dialog.hasAttribute("open")) return;
      activeRole = null;
      if (fallback) page.inert = false;
      fallback = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    }

    function closeCard() {
      if (!dialog.hasAttribute("open")) return;
      if (fallback) {
        dialog.removeAttribute("open");
        dialog.classList.remove("character-dialog-fallback");
        releaseCard();
      } else {
        dialog.close();
      }
    }

    page.addEventListener("click", event => {
      const button = event.target.closest("[data-guide-role]");
      if (!button || dialog.hasAttribute("open")) return;
      activeRole = button.dataset.guideRole;
      opener = button;
      dialog.innerHTML = characterCardHtml(activeRole);
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        fallback = true;
        page.inert = true;
        dialog.classList.add("character-dialog-fallback");
        dialog.setAttribute("open", "");
      }
      $(".character-card-close", dialog).focus({ preventScroll: true });
      renderLikes();
      refreshLikes();
    });

    dialog.addEventListener("close", releaseCard);
    dialog.addEventListener("keydown", event => {
      if (!fallback) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeCard();
      } else if (event.key === "Tab") {
        const controls = dialog.querySelectorAll("button:not(:disabled), a:not([hidden])");
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    dialog.addEventListener("click", async event => {
      if (event.target.closest(".character-card-close, .character-card-sign-in")) {
        closeCard();
        return;
      }
      if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          closeCard();
        }
        return;
      }
      if (!event.target.closest(".character-card-like") || !activeRole || !canLike || saving) return;
      const role = activeRole;
      const liked = !(likes.get(role)?.liked);
      saving = true;
      revision += 1;
      likeError = "";
      renderLikes();
      try {
        const result = await data.setCharacterLike(guestToken, role, liked);
        if (root.isConnected) setLikes(result);
      } catch {
        if (activeRole === role) likeError = "Couldn’t save your like. Try again.";
      } finally {
        saving = false;
        if (root.isConnected) renderLikes();
      }
    });
    refreshLikes();
  }
  function renderHowto(root) {
    if (!root) return;
    root.innerHTML = '<div class="guide-page">' + howtoInnerHtml() + "</div>";
  }
  function renderHub(root) {
    if (!root) return;
    stopPoll();
    root.innerHTML = '<div class="guide-page">' + hubInnerHtml() + "</div>";
    const playRoot = $("#game-play-root", root);
    if (token()) {
      playRoot.insertAdjacentHTML("afterend", '<p class="logout-line"><button class="game-sign-out" type="button">Sign out</button></p>');
      const signOut = $(".game-sign-out", root);
      if (ui().logoutGuest) signOut.addEventListener("click", ui().logoutGuest);
      renderLobby(playRoot);
    } else {
      playRoot.innerHTML = `<article class="card game-wait">
        <h2>Join the game</h2>
        <button type="button" class="btn btn-gold" id="game-sign-in">Sign in to play</button>
      </article>`;
      $("#game-sign-in", playRoot).addEventListener("click", () => {
        if (ui().renderClaimGate) ui().renderClaimGate(playRoot);
      });
    }
  }

  function renderLobby(root) {
    const a = api();
    const guestToken = token();
    let polling = false;
    let updating = false;
    let revision = 0;
    let lastLobby = "";
    root.innerHTML = '<p class="lede" style="text-align:center">Opening the lobby…</p>';
    if (!guestToken || !a || !a.gameLobby) return;

    const paint = (lobby) => {
      if (!root.isConnected) return;
      if (!lobby || !lobby.ok) {
        if (lastLobby === "error") return;
        lastLobby = "error";
        root.innerHTML = `<article class="card game-wait">
          <h2>Couldn’t open the lobby</h2>
          <p>${escapeHtml((lobby && lobby.message) || "Check your sign-in and try again.")}</p>
        </article>`;
        return;
      }
      if (!lobby.open && lobby.joined && !lobby.isHost) {
        renderPlayer(root);
        return;
      }
      const next = JSON.stringify(lobby);
      if (lastLobby === next) return;
      lastLobby = next;
      const canJoin = lobby.count < lobby.maxPlayers;
      const choice = lobby.joined
        ? '<button id="game-leave-lobby" class="btn btn-gold" type="button">Leave lobby</button>'
        : `<button id="game-join-lobby" class="btn btn-gold" type="button"${canJoin ? "" : " disabled"}>Join lobby</button>`;
      const status = lobby.joined ? "You’re in. Wait for Jack to shuffle." : canJoin ? "" : "The lobby is full.";
      const heading = lobby.isHost ? "You’re hosting" : lobby.open ? "Game lobby" : "This round has started";
      const previousButton = root.contains(document.activeElement) && document.activeElement.id;
      root.innerHTML = `<article class="card game-wait game-lobby">
        <h2>${heading}</h2>
        <p id="game-lobby-count" aria-live="polite">${lobby.count} of ${lobby.maxPlayers} players joined</p>
        ${lobby.isHost ? '<a class="btn btn-gold" href="host.html">Open host screen</a>' : lobby.open ? `<p>${status}</p>${choice}` : '<a href="tv.html">Watch on the TV screen</a>'}
        <p class="form-status" id="game-status" role="status" hidden></p>
      </article>`;
      const button = $("#game-join-lobby, #game-leave-lobby", root);
      if (!button) return;
      if (previousButton === button.id && !button.disabled) button.focus();
      button.addEventListener("click", async () => {
        if (updating) return;
        button.disabled = true;
        updating = true;
        revision += 1;
        try {
          const changed = await a.gameLobbySet(guestToken, !lobby.joined);
          if (changed && changed.ok) paint(changed);
          else setStatus(root, (changed && changed.message) || "Couldn’t update the lobby. Try again.", false);
        } catch (_) {
          setStatus(root, "Couldn’t update the lobby. Try again.", false);
        } finally {
          updating = false;
          button.disabled = false;
        }
      });
    };
    const refresh = async () => {
      if (!root.isConnected || polling || updating) return;
      polling = true;
      const startingRevision = revision;
      try {
        const state = await a.gameLobby(guestToken);
        if (startingRevision === revision) paint(state);
      }
      catch (_) {
        if (!lastLobby && startingRevision === revision) paint(null);
      } finally {
        polling = false;
      }
    };
    startPoll(refresh, POLL_PLAYER);
    refresh();
  }

  function rosterHtml(players, opts) {
    const list = players || [];
    if (!list.length) return '<p class="game-muted">The roster appears after the host shuffles.</p>';
    const showFace = !opts || opts.faces !== false;
    return '<ul class="game-roster">' + list.map((p) => {
      const out = p.alive === false ? " is-out" : "";
      return `<li class="game-roster-item${out}">
        ${showFace ? face(p.display_name, { className: "is-small", sizes: "72px" }) : ""}
        <span>${escapeHtml(p.display_name || "")}${p.alive === false ? " <em>out</em>" : ""}</span>
      </li>`;
    }).join("") + "</ul>";
  }

  function revealHtml(d) {
    const r = d && d.reveal;
    if (!r || !r.current) return "";
    const beats = (r.current.beats || []);
    if (!beats.length) return "";
    return `<section class="game-reveal" aria-live="polite">
      ${beats.map((b, i) => `<p class="game-beat${i === beats.length - 1 ? " is-latest" : ""}">${escapeHtml(b.text || b)}</p>`).join("")}
    </section>`;
  }

  function pickGrid(people, selected, selfId, disabledIds) {
    const block = new Set((disabledIds || []).filter(Boolean).map(String));
    return '<div class="game-pick-grid" role="group">' + (people || []).map((p) => {
      const id = String(p.id);
      if (selfId && id === String(selfId)) return "";
      const on = selected && id === String(selected);
      const dis = block.has(id);
      return `<button type="button" class="game-pick${on ? " is-on" : ""}" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(p.display_name)}" ${dis ? "disabled" : ""}>
        ${face(p.display_name, { className: "is-small", sizes: "64px" })}
        <span>${escapeHtml(p.display_name)}</span>
      </button>`;
    }).join("") + "</div>";
  }

  function bindPicks(root, onLock) {
    const buttons = $allC(".game-pick", root);
    buttons.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.classList.contains("is-on")));
      btn.addEventListener("click", () => {
        pickId = btn.getAttribute("data-id") || "";
        buttons.forEach((b) => {
          b.classList.toggle("is-on", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    });
    const lock = $("#game-lock", root);
    if (lock) lock.addEventListener("click", () => onLock(pickId));
  }
  function $allC(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function setStatus(root, msg, ok) {
    const el = $("#game-status", root);
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = ok ? "var(--green-deep)" : "var(--red-deep)";
  }

  function submit(action, target, extra, extraText) {
    const a = api();
    if (!a || !a.gameSubmit) return Promise.resolve({ ok: false, message: "Game is not available." });
    return a.gameSubmit(token(), action, target || null, extra || null, extraText || null);
  }

  function actionPanel(d) {
    const you = d.you || {};
    const living = d.living || [];
    const dead = d.dead || [];
    if (d.phase === "ended") {
      return `<div class="card game-action"><h3>That’s a wrap</h3><p>${escapeHtml(d.winnerText || "The game is over.")}</p>
        ${you.alive === false ? "<p>You’re out — take a shot or draw a gachapon capsule.</p>" : ""}
        ${d.ghostsBonus ? "<p>The ghosts called it: every ghost spins the gachapon.</p>" : ""}</div>`;
    }
    if (d.pendingGingerbread) {
      return `<div class="card game-action"><h3>Take someone with you</h3>
        <p>You’re the Gingerbread Man, and you’re out. Pick one living player.</p>
        ${d.locked ? "<p>Locked in. Wait for the host.</p>" : pickGrid(living, pickId, you.id) + '<button class="btn btn-gold" type="button" id="game-lock">Lock in</button>'}
        <p class="form-status" id="game-status" hidden></p></div>`;
    }
    if (!you.alive) {
      const clue = d.phase === "night" && !d.locked;
      return `<div class="card game-action">
        ${rolePortrait(ROLE_META.ghost, "game-ghost-portrait")}
        <h3>Ghost duties</h3>
        <p>You’re out — take a shot or a gachapon capsule. As a ghost, you still have night work when the lights go down.</p>
        ${d.phase !== "night" ? "<p>Wait for night for clues, haunts, and (once) a possession.</p>" : ""}
        ${d.phase === "night" && d.locked ? "<p>Locked in. Wait for the host.</p>" : ""}
        ${d.phase === "night" && !d.locked ? `
          <div class="game-pick-block" data-grid="clue">
            <h4>Clue — pick someone already out</h4>
            ${pickGrid(dead, pickId)}
            <button class="btn btn-gold" type="button" id="game-lock-clue">Lock clue</button>
          </div>
          <div class="game-pick-block" data-grid="haunt">
            <h4>Haunt — they lose tomorrow’s vote</h4>
            ${pickGrid(living, pickId2)}
            <button class="btn btn-gold" type="button" id="game-lock-haunt">Lock haunt</button>
          </div>
          ${d.possessAvailable ? `<div class="game-pick-block" data-grid="possess">
            <h4>Possess a vote (once a game)</h4>
            <p>Pick the living player whose vote you take, then who that vote should land on.</p>
            <p>Whose vote:</p>
            ${pickGrid(living, pickId3)}
            <p>The vote goes to:</p>
            ${pickGrid(living, pickId)}
            <button class="btn btn-gold" type="button" id="game-lock-possess">Lock possession</button>
          </div>` : ""}
          ${!you.prediction ? `<h4>Predict the winner</h4>
            <div class="game-docs">
              <button type="button" class="btn btn-ghost" data-predict="nice">Nice</button>
              <button type="button" class="btn btn-ghost" data-predict="grinches">Grinches</button>
              <button type="button" class="btn btn-ghost" data-predict="krampus">Krampus</button>
            </div>` : `<p>Your prediction is locked in.</p>`}
        ` : ""}
        <p class="form-status" id="game-status" hidden></p></div>`;
    }
    if (d.phase === "day") {
      if (you.isHaunted || you.isHungover) {
        const why = you.isHungover ? "Egg-nog Hangover" : "a haunt";
        return `<div class="card game-action"><h3>You cannot vote today</h3><p>${why} has you sitting this one out. Enjoy the show. Or don’t.</p></div>`;
      }
      if (d.locked) return '<div class="card game-action"><h3>Day vote</h3><p>Your vote is locked in. Watch the TV for the result.</p></div>';
      return `<div class="card game-action"><h3>Day vote</h3>
        <p>Vote for a player or choose Spare everyone. Everyone stays in if Spare everyone wins, the top vote ties, or no votes are counted.</p>
        <button type="button" class="game-pick game-pick-spare${pickId === SPARE_VOTE ? " is-on" : ""}" data-id="${SPARE_VOTE}">Spare everyone</button>
        ${pickGrid(living, pickId, you.id)}
        <button class="btn btn-gold" type="button" id="game-lock">Lock in your vote</button>
        <p class="form-status" id="game-status" role="status" hidden></p></div>`;
    }
    if (d.phase === "night") {
      if (d.locked) {
        return `<div class="card game-action"><h3>Night ${d.nightNumber}</h3><p>Locked in. Put the phone down and look innocent.</p></div>`;
      }
      const act = you.nightAction;
      if (act === "item") {
        const cocoa = you.cocoaUsed ? "" : '<button type="button" class="btn btn-gold" id="game-cocoa">Pour Hot Cocoa</button>';
        const coal = you.coalUsed ? "" : '<p>Or give Coal to someone:</p>' + pickGrid(living, pickId) + '<button type="button" class="btn btn-gold" id="game-coal">Give Coal</button>';
        return `<div class="card game-action"><h3>Mrs Claus</h3>
          <p>One item per night, each item once per game. Or settle in and save them for later.</p>
          ${cocoa}${coal}
          <button type="button" class="btn btn-ghost" id="game-skip">Settle in (no item)</button>
          <p class="form-status" id="game-status" hidden></p></div>`;
      }
      let title = "Settle in for the night";
      let hint = "Pick someone to keep an eye on. This doesn’t do anything — but everyone taps something, so nobody can tell who has a power.";
      let action = "watch";
      let disabled = [];
      if (act === "steal") { title = "Grinches steal together"; hint = "Agree on one person with your fellow Grinches."; action = "steal"; }
      if (act === "krampus_steal") { title = "Krampus hunts"; hint = "Pick one person to steal tonight."; action = "krampus_steal"; }
      if (act === "save") {
        title = "Santa saves";
        hint = "Pick someone to save, including yourself. You cannot save the same person two nights in a row.";
        action = "save";
        if (you.blockedSaveId) disabled = [you.blockedSaveId];
      }
      if (act === "guard") { title = "Reindeer, stand watch"; hint = "Guard someone else. You may repeat. You cannot guard yourself."; action = "guard"; }
      if (act === "check") { title = "Elf Detective"; hint = "Check one person. After the night you’ll learn if they’re bad or not."; action = "check"; }
      const allowSelf = action === "save";
      return `<div class="card game-action" data-action="${action}" data-allow-self="${allowSelf ? "1" : ""}">
        <h3>${escapeHtml(title)}</h3><p>${escapeHtml(hint)}</p>
        ${pickGrid(living, pickId, allowSelf ? null : you.id, disabled)}
        <button class="btn btn-gold" type="button" id="game-lock">Lock in</button>
        <p class="form-status" id="game-status" hidden></p></div>`;
    }
    if (d.phase === "shuffled") {
      return `<div class="card game-action"><h3>Card received</h3><p>The host has shuffled. Read your role, then wait — the story hasn’t started yet. Phones down until the TV begins.</p></div>`;
    }
    if (d.phase === "reveal" || d.phase === "twist" || d.phase === "morning") {
      return `<div class="card game-action"><h3>Watch the TV</h3><p>The host is telling it beat by beat. Don’t shout the ending, even if your phone already knew.</p>
        ${you.nightAction === "check" && d.detectiveResult ? `<p class="game-detect">Your check: <strong>${escapeHtml(d.detectiveResult.targetName)}</strong> is ${d.detectiveResult.isBad ? "bad" : "not bad"}.</p>` : ""}
      </div>`;
    }
    return "";
  }

  function roleCardHtml(d) {
    const you = d.you || {};
    const meta = ROLE_META[you.role] || { name: you.roleName || "Role", side: "" };
    const fellows = (d.fellowGrinches || []).map((g) => escapeHtml(g.display_name)).join(", ");
    return `<article class="card game-role-card">
      ${rolePortrait(meta, "game-role-portrait")}
      <p class="kicker">${escapeHtml(meta.side)}</p>
      <h2>${escapeHtml(you.roleName || meta.name)}</h2>
      <p>${escapeHtml(you.ability || "")}</p>
      ${fellows ? `<p class="game-fellows">The other Grinches: <strong>${fellows}</strong></p>` : ""}
      ${d.witnessGrinchName ? `<p class="game-fellows">On night 1 you saw this Grinch: <strong>${escapeHtml(d.witnessGrinchName)}</strong>. Hint only.</p>` : ""}
      ${you.alive === false ? "<p>You’re out — shot or a gachapon capsule, as usual.</p>" : ""}
    </article>`;
  }

  function renderPlayerInto(root, d) {
    const waiting = !d || !d.dealt || !d.isPlayer;
    const hostWait = d && d.isHost && !d.isPlayer;
    let body = "";
    if (hostWait) {
      body = `<div class="game-wait card"><p class="game-wait-emoji">🎬</p>
        <h3>You’re the host</h3>
        <p>You don’t get a role. Open the <a href="host.html">host screen</a> to shuffle and run the story.</p></div>
        ${docsHtml({ backGame: false })}`;
    } else if (waiting) {
      body = `<div class="game-wait card">
        <p class="game-wait-emoji">🎁</p>
        <h3>Roles haven’t been dealt yet</h3>
        <p>Waiting for the host to shuffle…</p>
      </div>${docsHtml({ backGame: false })}`;
    } else {
      const action = actionPanel(d);
      const reference = roleCardHtml(d) + docsHtml({ backGame: false });
      body = d.phase === "day" ? action + reference : reference + action;
    }
    root.innerHTML = body;
    if (waiting || hostWait) return;

    const you = d.you || {};
    if (d.pendingGingerbread && !d.locked) {
      bindPicks(root, (id) => {
        if (!id) { setStatus(root, "Pick someone.", false); return; }
        submit("gingerbread", id).then((res) => afterSubmit(root, res));
      });
    } else if (d.phase === "day" && you.alive && !you.isHaunted && !you.isHungover && !d.locked) {
      bindPicks(root, async (id) => {
        if (!id) { setStatus(root, "Pick a player or choose Spare everyone.", false); return; }
        const lock = $("#game-lock", root);
        lock.disabled = true;
        try {
          const result = id === SPARE_VOTE ? await submit("vote", null, null, SPARE_VOTE) : await submit("vote", id);
          await afterSubmit(root, result);
        } catch (_) {
          setStatus(root, "Couldn’t lock in your vote. Try again.", false);
        } finally {
          lock.disabled = false;
        }
      });
    } else if (d.phase === "night" && you.alive && !d.locked) {
      const box = $(".game-action", root);
      const act = box && box.getAttribute("data-action");
      if (act === "watch" || act === "steal" || act === "krampus_steal" || act === "save" || act === "guard" || act === "check") {
        bindPicks(root, (id) => {
          const allowSelf = box.getAttribute("data-allow-self") === "1";
          if (!id && act !== "watch") { setStatus(root, "Pick someone.", false); return; }
          if (act === "watch") {
            submit("watch", id || null).then((res) => afterSubmit(root, res));
            return;
          }
          submit(act, id).then((res) => afterSubmit(root, res));
        });
      }
      const cocoa = $("#game-cocoa", root);
      if (cocoa) cocoa.addEventListener("click", () => submit("cocoa").then((res) => afterSubmit(root, res)));
      const coal = $("#game-coal", root);
      if (coal) {
        $allC(".game-pick", root).forEach((btn) => btn.addEventListener("click", () => {
          pickId = btn.getAttribute("data-id") || "";
          $allC(".game-pick", root).forEach((b) => b.classList.toggle("is-on", b === btn));
        }));
        coal.addEventListener("click", () => {
          if (!pickId) { setStatus(root, "Pick someone for Coal.", false); return; }
          submit("coal", pickId).then((res) => afterSubmit(root, res));
        });
      }
      const skip = $("#game-skip", root);
      if (skip) skip.addEventListener("click", () => submit("skip").then((res) => afterSubmit(root, res)));
    } else if (d.phase === "night" && you.alive === false) {
      $allC(".game-pick", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id") || "";
          const block = btn.closest("[data-grid]") || btn.closest("div.game-pick-grid");
          const grid = (block && block.getAttribute && block.getAttribute("data-grid")) || "";
          if (grid === "clue") pickId = id;
          else if (grid === "haunt") pickId2 = id;
          else if (grid === "possess") {
            const label = ((btn.closest("p") && btn.closest("p").previousElementSibling) || {}).textContent || "";
            // two grids inside possess: first = voter (pickId3), second = target (pickId)
            const grids = $allC(".game-pick-grid", block);
            const gi = Array.prototype.indexOf.call(grids, btn.closest(".game-pick-grid"));
            if (gi === 0) pickId3 = id;
            else pickId = id;
          } else {
            const prev = block && block.previousElementSibling;
            const label = (prev && prev.textContent) || "";
            if (/Clue/i.test(label)) pickId = id;
            else pickId2 = id;
          }
          const scope = btn.closest(".game-pick-grid") || block;
          $allC(".game-pick", scope).forEach((b) => b.classList.toggle("is-on", b === btn));
        });
      });
      const clue = $("#game-lock-clue", root);
      if (clue) clue.addEventListener("click", () => {
        if (!pickId) { setStatus(root, "Pick someone who is already out.", false); return; }
        submit("clue", pickId).then((res) => afterSubmit(root, res));
      });
      const haunt = $("#game-lock-haunt", root);
      if (haunt) haunt.addEventListener("click", () => {
        if (!pickId2) { setStatus(root, "Pick someone to haunt.", false); return; }
        submit("haunt", pickId2).then((res) => afterSubmit(root, res));
      });
      const poss = $("#game-lock-possess", root);
      if (poss) poss.addEventListener("click", () => {
        if (!pickId3 || !pickId) { setStatus(root, "Pick whose vote you take, and who it should land on.", false); return; }
        submit("possess", pickId3, pickId).then((res) => afterSubmit(root, res));
      });
      $allC("[data-predict]", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          submit("predict", null, null, btn.getAttribute("data-predict")).then((res) => afterSubmit(root, res));
        });
      });
    }
  }

  function afterSubmit(root, res) {
    if (!res || !res.ok) {
      setStatus(root, (res && (res.message || res.reason)) || "Couldn’t lock that in.", false);
      return;
    }
    clearPicks();
    return refreshPlayer(root, true);
  }

  function clearPicks() {
    pickId = "";
    pickId2 = "";
    pickId3 = "";
  }

  function refreshPlayer(root, force) {
    const a = api();
    if (!a || !token() || !a.gameMe) {
      renderPlayerInto(root, { dealt: false, isPlayer: false });
      return Promise.resolve();
    }
    return a.gameMe(token()).then((d) => {
      if (!root.isConnected) return;
      if (!d || !d.ok) {
        renderPlayerInto(root, { dealt: false, isPlayer: false });
        return;
      }
      if (root.id === "game-play-root" && (!d.dealt || !d.isPlayer)) {
        renderLobby(root);
        return;
      }
      const round = [d.phase, d.nightNumber, d.dayNumber].join("|");
      if (round !== playerPickRound) {
        clearPicks();
        playerPickRound = round;
      }
      const sig = [round, d.dealt, d.locked, d.winnerSide, d.reveal?.beatIndex, d.reveal?.sceneIndex, d.you?.role,
        d.you?.alive, d.you?.isHaunted, d.you?.isHungover, (d.submitted || []).join(",")].join("|");
      if (!force && sig === lastSig) return;
      lastSig = sig;
      renderPlayerInto(root, d);
    }).catch(() => {});
  }

  function renderPlayer(root, tok) {
    if (!root) return;
    lastSig = "";
    playerPickRound = "";
    clearPicks();
    root.innerHTML = '<p class="lede" style="text-align:center">Opening the game…</p>';
    refreshPlayer(root, true);
    startPoll(() => refreshPlayer(root, false), POLL_PLAYER);
  }

  /* ---------- Host ---------- */
  function renderHost(root) {
    if (!root) return;
    stopPoll();
    lastSig = "";
    if (!hostToken()) {
      renderHostLogin(root);
      return;
    }
    refreshHost(root, true);
    startPoll(() => refreshHost(root, false), POLL_HOST);
  }

  function renderHostLogin(root) {
    const a = api();
    root.innerHTML = `<div class="card game-host-login">
      <h1>Host screen</h1>
      <p>Jack, sign in with the 6-digit PIN you use on My page.</p>
      <form id="host-login">
        <label for="host-pin">Your 6-digit PIN</label>
        <input id="host-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required>
        <button class="btn btn-gold" type="submit" disabled>Open host screen</button>
        <p class="form-status" id="game-status" hidden></p>
      </form>
    </div>`;
    if (!a) return;
    const form = $("#host-login", root);
    const submit = $("button[type=submit]", form);
    let hostId = "";
    a.listGuestsPublic().then((res) => {
      const hosts = (res && res.ok ? res.guests || [] : []).filter((g) =>
        g.display_name === "Jack" && !g.is_demo && !g.is_test
      );
      if (hosts.length === 1) {
        hostId = hosts[0].id;
        submit.disabled = false;
      } else {
        setStatus(root, "Could not load Jack’s guest account. Reload to try again.", false);
      }
    }).catch(() => setStatus(root, "Could not load Jack’s guest account. Reload to try again.", false));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const pin = $("#host-pin", root).value;
      submit.disabled = true;
      a.gameHostLogin(hostId, pin).then((res) => {
        if (res && res.ok && res.hostToken) {
          setHostToken(res.hostToken);
          renderHost(root);
          return;
        }
        setStatus(root, (res && res.message) || "Could not open the host screen.", false);
      }).catch(() => setStatus(root, "Could not open the host screen.", false))
        .finally(() => { submit.disabled = false; });
    });
  }

  function refreshHost(root, force) {
    const a = api();
    const ht = hostToken();
    if (!a || !ht || (!force && hostSetupPending)) return Promise.resolve();
    return a.gameHostState(ht).then((d) => {
      if (!root.isConnected || (!force && hostSetupPending)) return;
      if (!d || !d.ok) {
        if (d && d.reason === "forbidden") {
          setHostToken("");
          renderHostLogin(root);
        }
        return;
      }
      const sig = JSON.stringify({
        p: d.phase, sc: d.reveal && d.reveal.sceneIndex, b: d.reveal && d.reveal.beatIndex,
        sub: d.submittedCount, exp: d.expectedCount, deal: d.dealt, tw: d.availableTwists, w: d.winnerSide,
        lobby: d.lobby
      });
      if (!force && sig === lastSig) return;
      lastSig = sig;
      paintHost(root, d);
    }).catch(() => {});
  }

  function bindHostSetup(root, selector, run, message) {
    const button = $(selector, root);
    if (!button) return;
    button.addEventListener("click", async () => {
      if (hostSetupPending) return;
      hostSetupPending = true;
      button.disabled = true;
      try {
        const result = await run();
        if (result && result.ok) await refreshHost(root, true);
        else setStatus(root, (result && result.message) || message, false);
      } catch (_) {
        setStatus(root, message, false);
      } finally {
        hostSetupPending = false;
        button.disabled = false;
      }
    });
  }

  function hostLobbyHtml(d) {
    if (!d.lobby) return '<div class="card game-shuffle-wrap"><h3>Lobby</h3><p>Reload this page to open the lobby.</p></div>';
    const { count, minPlayers, maxPlayers, members } = d.lobby;
    const ready = count >= minPlayers && count <= maxPlayers;
    return `<div class="card game-shuffle-wrap game-lobby">
      <h3>Lobby</h3>
      <p id="host-player-count" aria-live="polite">${count} of ${maxPlayers} players joined</p>
      ${d.dealt ? "<p>Roles dealt. The lobby is closed for this round.</p>" : '<p>Players join from the <a href="game.html">Game tab</a>.</p>'}
      ${!d.dealt && members.length ? '<ul class="game-lobby-members">' + members.map((member) => `<li>${escapeHtml(member.display_name)}</li>`).join("") + '</ul>' : ""}
      ${!ready ? `<p>At least ${minPlayers} players must join before you can shuffle.</p>` : ""}
      <button type="button" class="btn btn-gold btn-shuffle" id="host-shuffle"${ready ? "" : " disabled"}>${d.canReshuffle ? "Shuffle again" : "Shuffle roles"}</button>
      ${d.canStart ? '<button type="button" class="btn btn-gold" id="host-start">Start the story</button>' : ""}
      <p class="form-status" id="game-status" role="status" hidden></p>
    </div>`;
  }

  function paintHost(root, d) {
    const a = api();
    const ht = hostToken();
    const roles = d.roles || [];
    const twists = d.availableTwists || [];
    let mid = "";
    if (d.canShuffle) {
      mid += hostLobbyHtml(d);
    } else if (d.phase === "ended") {
      mid += `<div class="card game-shuffle-wrap game-lobby">
        <button class="btn btn-gold" id="host-new-lobby" type="button">Open a new lobby</button>
        <p class="form-status" id="game-status" role="status" hidden></p>
      </div>`;
    }
    if (d.phase === "reveal") {
      mid += `<div class="card"><button type="button" class="btn btn-gold btn-shuffle" id="host-advance">Next beat</button>
        <p class="form-status" id="game-status" role="status" hidden></p>
        <p class="game-muted">Advance one TV beat at a time.</p></div>`;
    } else if (d.phase === "twist") {
      const beforeVote = d.reveal?.mode === "post_morning";
      mid += `<div class="card"><h3>Optional twist</h3>
        ${beforeVote ? "<p>Give everyone 3 minutes to discuss before opening the vote.</p>" : ""}
        <p>One card a day, or skip.</p>
        <div class="game-twist-grid">${twists.map((t) =>
          `<button type="button" class="btn btn-ghost" data-twist="${escapeHtml(t.id)}">${escapeHtml(t.name)}</button>`
        ).join("")}
        <button type="button" class="btn btn-gold" id="host-skip-twist">${beforeVote ? "Skip twist and open voting" : "Skip twists today"}</button></div>
        <div id="twist-targets"></div>
        <p class="form-status" id="game-status" hidden></p></div>`;
    } else if (d.phase === "night" || d.phase === "day" || d.phase === "gingerbread") {
      const voting = d.phase === "day";
      mid += `<div class="card"><p>Locked in: <strong>${d.submittedCount || 0} / ${d.expectedCount || 0}</strong></p>
        ${voting ? "<p>Players can vote for someone or choose Spare everyone.</p>" : ""}
        <button type="button" class="btn btn-gold btn-shuffle" id="host-advance">${voting ? "Reveal vote" : "Advance"}</button>
        <p class="form-status" id="game-status" role="status" hidden></p></div>`;
    }
    if (roles.length) {
      mid += `<div class="card game-host-roles"><h3>Roles (host only)</h3>
        <ul class="game-host-role-list">${roles.map((r) =>
          `<li><strong>${escapeHtml(r.display_name)}</strong> — ${escapeHtml((ROLE_META[r.role] || {}).icon || "")} ${escapeHtml(r.roleName)}${r.alive ? "" : " (out)"}</li>`
        ).join("")}</ul></div>`;
    }

    root.innerHTML = `
      <header class="guide-hero">
        <p class="kicker">Host · ${escapeHtml(d.hostName || "")}</p>
        <h1 class="outline-red">Who Stole Christmas?</h1>
        <p class="game-phase-tag">${escapeHtml(phaseLabel(d))}</p>
      </header>
      <article class="card game-script"><h3>Host script</h3><p>${escapeHtml(d.script || "")}</p></article>
      ${revealHtml(d)}
      ${mid}
      ${rosterHtml(d.players)}
      <p class="game-docs-note"><a href="tv.html" target="_blank" rel="noopener">Open the TV screen</a> · <a href="guide.html">Character Guide</a> · <a href="how-to-play.html">How to Play</a></p>
      <p class="logout-line"><a href="host.html" id="host-logout">Log out of host screen</a></p>
    `;

    bindHostSetup(root, "#host-shuffle", () => a.gameHostDealLobby(ht), "Couldn’t shuffle. Try again.");
    bindHostSetup(root, "#host-start", () => a.gameHostStart(ht), "Couldn’t start the story. Try again.");
    bindHostSetup(root, "#host-new-lobby", () => a.gameHostReset(ht), "Couldn’t open a new lobby. Try again.");
    bindHostSetup(root, "#host-advance", () => a.gameHostAdvance(ht), "Couldn’t advance the reveal. Try again.");
    bindHostSetup(root, "#host-skip-twist", () => a.gameHostSkipTwist(ht), "Couldn’t skip the twist. Try again.");
    $allC("[data-twist]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-twist");
        const card = (d.availableTwists || []).find((t) => t.id === id);
        const living = d.livingForPicks || [];
        if (card && (card.needsTarget || card.needsTarget2)) {
          const pool = id === "naughty_list" ? living.filter((p) => p.innocent) : living;
          const box = $("#twist-targets", root);
          box.innerHTML = `<p>Pick ${card.needsTarget2 ? "two players" : "a player"}.</p>${pickGrid(pool, pickId)}
            ${card.needsTarget2 ? pickGrid(pool, pickId2) : ""}
            <button type="button" class="btn btn-gold" id="twist-lock">Play ${escapeHtml(card.name)}</button>`;
          const grids = $allC(".game-pick-grid", box);
          grids.forEach((grid, gi) => {
            $allC(".game-pick", grid).forEach((b) => b.addEventListener("click", () => {
              const pid = b.getAttribute("data-id");
              if (gi === 0) pickId = pid; else pickId2 = pid;
              $allC(".game-pick", grid).forEach((x) => x.classList.toggle("is-on", x === b));
            }));
          });
          $("#twist-lock", box).addEventListener("click", () => {
            if (!pickId || (card.needsTarget2 && !pickId2)) { setStatus(root, "Pick the player(s).", false); return; }
            a.gameHostPlayTwist(ht, id, pickId, pickId2 || null).then((res) => {
              if (!res || !res.ok) setStatus(root, (res && res.message) || "Could not play that twist.", false);
              else { lastSig = ""; refreshHost(root, true); }
            });
          });
          return;
        }
        a.gameHostPlayTwist(ht, id, null, null).then((res) => {
          if (!res || !res.ok) setStatus(root, (res && res.message) || "Could not play that twist.", false);
          else { lastSig = ""; refreshHost(root, true); }
        });
      });
    });
    const lo = $("#host-logout", root);
    if (lo) lo.addEventListener("click", (e) => { e.preventDefault(); setHostToken(""); renderHost(root); });
  }

  /* ---------- TV ---------- */
  function bindTvMusic() {
    const audio = $("#tv-background-music");
    const button = $("#tv-music-toggle");
    const status = $("#tv-music-status");
    if (!audio || !button || button.dataset.bound) return;
    button.dataset.bound = "true";
    audio.volume = 0.3;

    const sync = () => {
      button.textContent = audio.paused ? "Play background music" : "Pause background music";
    };
    audio.addEventListener("play", sync);
    audio.addEventListener("pause", sync);
    button.addEventListener("click", async () => {
      if (status) status.textContent = "";
      if (!audio.paused) {
        audio.pause();
        return;
      }
      try {
        await audio.play();
      } catch (_) {
        if (status) status.textContent = "Music couldn’t start. Try pressing Play again.";
      }
      sync();
    });
    sync();
  }

  function renderTv(root) {
    if (!root) return;
    bindTvMusic();
    const slideshow = global.ConcertoTvSlideshow;
    let signature = "";
    let fetching = false;
    const data = api();
    if (slideshow && data && data.listGuestsPublic) {
      data.listGuestsPublic().then((result) => {
        if (result && result.ok) slideshow.preload(result.guests || [], face);
      }).catch(() => {});
    }

    const paint = (d) => {
      const waiting = !d.dealt;
      const reveal = slideshow ? slideshow.render(d, { face, escapeHtml }) : "";
      const phaseText = d.phase === "gingerbread" ? "The village waits" : phaseLabel(d);
      const rosterReady = d.phase !== "reveal" || Number.isInteger(d.reveal?.current?.beatCount);
      root.innerHTML = `
        <div class="tv-frame">
          <p class="kicker">Who Stole Christmas?</p>
          <h1 class="tv-title outline-red">${escapeHtml(phaseText)}</h1>
          ${waiting ? '<p class="tv-wait">Waiting for the host to shuffle…</p>' : ""}
          ${d.phase === "day" ? '<p class="tv-wait">Voting is open on your phones.</p>' : ""}
          ${reveal}
          ${d.phase === "ended" && d.winnerText ? `<p class="tv-winner">${escapeHtml(d.winnerText)}</p>` : ""}
          ${rosterReady ? '<h2 class="tv-sub">Who’s in</h2>' + rosterHtml(d.players || [], { faces: true }) : ""}
          <p class="tv-docs"><a href="how-to-play.html">How to Play</a> · <a href="guide.html">Character Guide</a></p>
        </div>`;
    };

    const tick = async () => {
      if (!data || !data.gamePublic || fetching || document.hidden || !root.isConnected) return;
      fetching = true;
      try {
        const d = await data.gamePublic();
        if (!d || !d.ok || !root.isConnected) return;
        if (slideshow) slideshow.preload(d.players || [], face);
        const next = JSON.stringify([d.phase, d.dealt, d.nightNumber, d.dayNumber, d.reveal, d.winnerText, d.players]);
        if (next === signature) return;
        signature = next;
        paint(d);
      } catch (_) {
        // Keep the last visible slide if the connection drops.
      } finally {
        fetching = false;
      }
    };
    paint({ dealt: false, phase: "not_started" });
    tick();
    startPoll(tick, POLL_TV);
  }

  global.UglyTeeGame = {
    renderPlayer,
    renderHost,
    renderTv,
    renderGuide,
    renderHowto,
    renderHub,
    stop: stopPoll,
    guideInnerHtml,
    howtoInnerHtml
  };
})(window);
