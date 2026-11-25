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
  let townHallTimer = null;
  let stopPlayerTurnLayout = null;
  let lastSig = "";
  let hostSetupPending = false;
  let hostStateVersion = 0;

  const ROLE_META = {
    grinch: { icon: "💚", name: "Grinch", side: "Bad", portrait: "grinch" },
    tough_grinch: { icon: "💪", name: "Tough Grinch", side: "Bad", portrait: "tough-grinch", hp: 2 },
    krampus: { icon: "🐐", name: "Krampus", side: "Alone", portrait: "krampus" },
    santa: { icon: "🎅", name: "Santa Claus", side: "Nice", portrait: "santa" },
    reindeer: { icon: "🦌", name: "Reindeer", side: "Nice", portrait: "reindeer" },
    detective: { icon: "🔎", name: "Elf Detective", side: "Nice", portrait: "elf-detective" },
    mrs_claus: { icon: "☕", name: "Mrs Claus", side: "Nice", portrait: "mrs-claus" },
    gingerbread: { icon: "🍪", name: "Gingerbread Man", side: "Nice", portrait: "gingerbread-man" },
    fruitcake: { icon: "🍰", name: "Fruitcake", side: "Nice", portrait: "fruitcake", hp: 2 },
    witness: { icon: "👀", name: "Witness", side: "Nice", portrait: "witness" },
    liar_elf: { icon: "🤥", name: "Liar Elf", side: "Nice", portrait: "liar-elf" },
    citizen: { icon: "🎄", name: "Citizen", side: "Nice", portrait: "citizen" },
    snowman: { icon: "⛄", name: "Snowman", side: "Alone", portrait: "snowman" },
    ghost: { name: "Ghosts", side: "Ghost", portrait: "ghost", hp: 0 }
  };

  const CARD_TEAMS = {
    Nice: { label: "Good", name: "Concertorants", family: "town" },
    Bad: { label: "Bad", name: "Grinches", family: "grinches" },
    Alone: { label: "Neutral", name: "Wanderer", family: "wanderers" },
    Ghost: { label: "Neutral", name: "Ghosts", family: "ghosts" }
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
    clearTimeout(townHallTimer);
    townHallTimer = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pollOnVisible) {
      document.removeEventListener("visibilitychange", pollOnVisible);
      pollOnVisible = null;
    }
    stopPlayerTurnLayout?.();
    stopPlayerTurnLayout = null;
  }

  function startPoll(fn, ms) {
    stopPoll();
    pollTimer = setInterval(fn, ms);
    pollOnVisible = () => {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", pollOnVisible);
  }

  function townHallClock(root, snapshot, onEnd) {
    clearTimeout(townHallTimer);
    townHallTimer = null;
    if (snapshot.phase !== "town_hall") return;
    const clocks = [...root.querySelectorAll("[data-town-hall-clock]")];
    const remaining = Math.min(210000, Date.parse(snapshot.townHallEndsAt) - Date.parse(snapshot.serverNow));
    if (!clocks.length || !Number.isFinite(remaining)) return;
    const end = performance.now() + remaining;
    const draw = () => {
      if (!root.isConnected || !clocks.some(clock => clock.isConnected)) return;
      const left = end - performance.now();
      const seconds = Math.max(0, Math.ceil(left / 1000));
      const display = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      for (const clock of clocks) {
        if (clock.isConnected && clock.textContent !== display) clock.textContent = display;
      }
      if (left <= 0) onEnd();
      else townHallTimer = setTimeout(draw, Math.min(200, left));
    };
    draw();
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

  function morningLabel(d) {
    const night = Number(d?.nightNumber);
    return Number.isInteger(night) && night > 0 ? "Morning " + (night + 1) : "Morning";
  }

  function isFirstMorning(d) {
    return Number(d?.nightNumber) === 1 && ["reveal", "town_hall", "day", "morning", "twist"].includes(d?.phase);
  }

  function firstMorningNote() {
    return "There is no Morning 1. Town Hall and the first vote happen now.";
  }

  function phaseLabel(d) {
    const phase = (d && d.phase) || "not_started";
    const n = d && d.nightNumber;
    if (phase === "not_started" || phase === "setup") return "Waiting for the host";
    if (phase === "shuffled") return "Roles are in. Night 1 is next.";
    if (phase === "reveal") {
      const mode = d.reveal && d.reveal.mode;
      if (mode === "intro") return "The story begins";
      if (mode === "night") return morningLabel(d) + " · Reveal";
      if (mode === "vote") return morningLabel(d) + " · Vote result";
      if (mode === "twist" || mode === "recount") return morningLabel(d) + " · Plot twist";
      return "Meanwhile…";
    }
    if (phase === "night") return "Night " + n;
    if (phase === "day" || phase === "morning") return morningLabel(d);
    if (phase === "town_hall") return morningLabel(d) + " · Town Hall";
    if (phase === "twist") return morningLabel(d) + (d.reveal?.mode === "post_vote" ? " · After the vote" : " · Town hall");
    if (phase === "gingerbread") return morningLabel(d) + " · The village waits";
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

  const ROLE_LORE = {
    "grinch": "Every Christmas, the Grinches crept into Concerto to spoil Santa’s day. The village always found a way to celebrate. This year, the Grinches moved in as friendly neighbours and stole Christmas before Santa woke.",
    "tough_grinch": "The Tough Grinch carried the stolen gifts uphill in one sack. When it split, they took the lot under one arm. By breakfast, they were back in Concerto, offering to help look.",
    "krampus": "No one recalls when Krampus arrived in Concerto. One night, the baker found hoofprints by the window and a thank-you note for the last mince pie. By morning, the new neighbour was already buying bread.",
    "santa": "Santa Claus has called Concerto home for so long that he knows every chimney by feel. Even now, with his own gifts gone, he still stops at the homes that leave a light on.",
    "reindeer": "The Reindeer once brought Santa home through a blizzard when even the bells had frozen. They learnt every path by the sound of snow underfoot. If a neighbour needs a lookout, they know the way.",
    "detective": "The Elf Detective took their first case when the bakery’s mince pies began to vanish. The baker’s cat walked free. Now a missing bell has put the whole village in their notebook.",
    "mrs_claus": "Mrs Claus can tell who’s at the door by how they knock. She keeps a pot of hot cocoa ready for her guests and a little surprise for anyone on the naughty list.",
    "gingerbread": "The Gingerbread Man escaped the bakery before the baker could add the third gumdrop button. They’ve worn the first two like medals ever since. Nobody in Concerto calls them a snack twice.",
    "fruitcake": "Some say the Fruitcake first came to Concerto in Santa’s sack. It keeps turning up under the tree with a fresh tag and the same ribbon. The oldest villager swears they wrapped it as a child.",
    "liar_elf": "The Liar Elf once sold a neighbour a treasure map that led straight to the neighbour’s front step. The hole was empty. The Elf insists the treasure moved out that morning and left no address.",
    "citizen": "The Citizen has hung lanterns in Concerto since they were tall enough to reach the hooks. They know who burns the mince pies and which doors always stick. The new neighbours ask for directions a little too often.",
    "snowman": "The children gave the Snowman a carrot, a scarf, and a spot in the square. That was years ago. The Snowman has stood through every carol since and has a bag packed under the bench.",
    "ghost": "The Ghosts of Christmas Past meet where Concerto’s market lamps go cold. They tell stories no one thought to ask them when they were alive. When they run out of stories, they rattle the shutters.",
    "witness": "The Witness went out for more firewood on the night Christmas vanished. They saw someone they knew do something that made no sense. They’ve kept the shutters closed ever since."
  };

  const TOWN_GOAL = "Get every Grinch and Krampus out.";
  const GRINCH_GOAL = "Match or outnumber all other living players combined.";
  const KRAMPUS_GOAL = "Take out one Grinch and one Concertorant with your own night hits (the round continues), or be the last one standing.";
  const KRAMPUS_WIN = "Krampus earned a personal win.";
  const SNOWMAN_GOAL = "Win if the village votes you out. The round keeps going. If a night hit takes you out, you become a ghost.";
  const GHOST_GOAL = "You’re already dead, sorry.";
  const SANTA_NOTE = "You can pick yourself. You cannot pick the same person twice in a row.";
  const GUARD_EFFECT = "Protect someone else if you survive the night.";
  const GUARD_NOTE = "You can’t guard yourself. You can guard the same player again.";
  const INVESTIGATE_EFFECT = "Check one other living player each night.";
  const INVESTIGATE_NOTE = "Get a private Yes for a Grinch, Tough Grinch or Krampus. Everyone else gives No.";
  const COCOA_EFFECT = "Protect whoever is targeted tonight.";
  const COCOA_NOTE = "One item per night. Cocoa can save you on Night 1 or 2. Cocoa keeps its targets secret.";
  const BITTER_BISCUIT = "Bitter Biscuit";
  const BISCUIT_EFFECT = "Deal 1 damage to a player.";
  const LIAR_EFFECT = "Tell the truth and you’re punished. Take a shot for each truth.";
  const GHOST_CLUE = "Share one clue as a group each morning about what caused a death. Keep the killer’s name secret.";
  const GHOST_HAUNT = "Block a player’s next vote.";
  const GHOST_SHOT = "Choose one living player to take a shot.";
  const SHAPESHIFT = ["Shapeshift", "Take human form each morning and blend in with the village."];
  const NIGHT_SHIELD = "Survive your first unsaved night hit.";
  const SHIELD_NOTE = "Extra HP only helps at night. A morning vote still takes you out.";

  const GUIDE_DETAILS = {
    grinch: {
      ability: SHAPESHIFT,
      skills: [["Hunt", "Pick one target with the other Grinches each night."]],
      goal: GRINCH_GOAL
    },
    tough_grinch: {
      ability: SHAPESHIFT,
      skills: [["Hunt", "Pick one target with the other Grinches each night."], ["Night Shield", NIGHT_SHIELD]],
      note: SHIELD_NOTE + " How you survived stays secret.",
      goal: GRINCH_GOAL
    },
    santa: {
      skills: [["Save", "Protect one player each night."]],
      note: SANTA_NOTE,
      goal: TOWN_GOAL
    },
    reindeer: {
      skills: [["Guard", GUARD_EFFECT]],
      note: GUARD_NOTE,
      goal: TOWN_GOAL
    },
    detective: {
      skills: [["Investigate", INVESTIGATE_EFFECT]],
      note: INVESTIGATE_NOTE,
      goal: TOWN_GOAL
    },
    mrs_claus: {
      skills: [["Hot Cocoa", COCOA_EFFECT, "Once"], [BITTER_BISCUIT, BISCUIT_EFFECT, "Once"]],
      note: COCOA_NOTE,
      goal: TOWN_GOAL
    },
    gingerbread: {
      skills: [["Final Hit", "Choose one living player to hit when you’re out."]],
      goal: TOWN_GOAL
    },
    fruitcake: {
      skills: [["Night Shield", NIGHT_SHIELD]],
      note: SHIELD_NOTE + " How you survived stays secret.",
      goal: TOWN_GOAL
    },
    liar_elf: {
      skills: [["Only Lies", LIAR_EFFECT]],
      goal: TOWN_GOAL
    },
    citizen: {
      skills: [],
      goal: TOWN_GOAL
    },
    krampus: {
      ability: SHAPESHIFT,
      skills: [["Hunt", "Pick one target on your own each night."]],
      goal: KRAMPUS_GOAL
    },
    snowman: {
      skills: [],
      goal: SNOWMAN_GOAL
    },
    ghost: {
      skills: [["Clue", GHOST_CLUE], ["Haunt", GHOST_HAUNT], ["Give a Shot", GHOST_SHOT]],
      note: "Pick one action each night. The Ghosts can give one shot as a group.",
      goal: GHOST_GOAL
    }
  };

  const GUIDE_TWISTS = [
    ["🌨️", "Blizzard", "Stops attacks and saves for the current night. Players still lock in their actions."],
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
        <h2>Host powers</h2>
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
    const { skills: rows, note, goal } = GUIDE_DETAILS[role];
    const { family } = CARD_TEAMS[character.side];
    return `
      <div class="character-card-view" data-card-family="${family}">
        <div class="character-card-controls">
          <button class="character-card-like" type="button" aria-pressed="false" disabled>
            <span class="character-card-heart" aria-hidden="true">♡</span>
            <span class="character-card-count">–</span>
          </button>
          <a class="character-card-sign-in" href="game.html" hidden>Sign in to like this card</a>
          <button class="character-card-close" type="button" aria-label="Close character card" autofocus>×</button>
        </div>
        <p class="character-card-like-status" role="status"></p>
        <article class="role-card character-card" data-card-family="${family}">
          ${roleCardContents(role, { title: character.name, rows, note, goal, guide: true })}
        </article>
      </div>
    `;
  }

  function roleCardContents(role, { title, rows, note, goal, guide = false, phase, out = false, lives, livesMax } = {}) {
    const character = ROLE_META[role] || {};
    const team = CARD_TEAMS[character.side];
    const maxHp = livesMax ?? character.hp ?? 1;
    const hp = out ? 0 : (lives ?? maxHp);
    const hpLabel = guide ? (maxHp ? "Starting HP" : "HP") : "HP";
    const hpValue = !guide && livesMax != null ? `${hp} / ${livesMax}` : String(hp);
    const portrait = rolePortrait(character, "role-card-portrait");
    const nameTag = guide ? "h2" : "h1";
    const sectionTag = guide ? "h3" : "h2";
    const skillsId = guide ? "character-card-skills-title" : "player-card-skills-title";
    const lore = ROLE_LORE[role];
    const ability = GUIDE_DETAILS[role]?.ability;
    return `
      <header class="role-card-header">
        <div class="role-card-stats">
          ${team ? `<div class="role-card-team">
            <strong>${team.label}</strong><span>${team.name}</span>
          </div>` : ""}
          <div class="role-card-hp">
            <span>${hpLabel}</span><strong>${hpValue}</strong>
          </div>
        </div>
        <div class="role-card-name">
          <${nameTag}${guide ? ' id="character-card-title"' : ""}>${escapeHtml(title)}</${nameTag}>
          ${phase ? `<span class="player-card-phase">${escapeHtml(phase)}</span>` : ""}
        </div>
      </header>
      ${portrait ? `<div class="role-card-art">${portrait}</div>` : ""}
      ${lore ? `<p class="role-card-lore">${escapeHtml(lore)}</p>` : ""}
      ${ability ? `<section class="role-card-ability">
        <${sectionTag}>Ability</${sectionTag}>
        <p><strong>${escapeHtml(ability[0])}</strong> ${escapeHtml(ability[1])}</p>
      </section>` : ""}
      <section class="role-card-skills" aria-labelledby="${skillsId}">
        <${sectionTag} id="${skillsId}">Skills</${sectionTag}>
        ${rows.length ? `<ul class="player-card-skills" role="list">${rows.map(([name, effect, uses]) => `<li>
          <span><strong>${escapeHtml(name)}</strong> ${escapeHtml(effect)}</span>
          ${uses ? `<span class="player-skill-uses">${escapeHtml(uses)}</span>` : ""}
        </li>`).join("")}</ul>` : '<p class="role-card-skill-note">No skill.</p>'}
        ${note ? `<p class="role-card-skill-note">${escapeHtml(note)}</p>` : ""}
      </section>
      ${goal ? `<p class="role-card-goal"><strong>How to win</strong><span>${escapeHtml(goal)}</span></p>` : ""}
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
        <li><h3>Night</h3><p>Start at Night 1. Everyone still in the game makes a private choice on their phone. Submissions are locked. The Grinches steal together; Krampus steals alone; Santa, the Reindeer, the Detective and Mrs Claus do their quiet festive work.</p></li>
        <li><h3>Morning reveal</h3><p>There is no Morning 1. After Night 1, the first reveal, Town Hall and the first vote happen on Morning 2. The TV tells it like a cliffhanger: someone is on the brink… then BAM, they’re out, or a mysterious rescue saves them. The host advances the story beat by beat. If someone survives a night hit, the reason stays secret. The Tough Grinch and both Fruitcakes can each survive one night hit.</p></li>
        <li><h3>Day vote</h3><p>Discuss for 3 minutes and 30 seconds, then vote for a player or choose <strong>Spare everyone</strong>. A player with the most votes becomes a ghost immediately, even with an extra life. Everyone stays in if Spare everyone wins, the top vote ties, or no votes are counted. If the Snowman is voted out, they wanted this, they win, and the game continues. Anyone who is out takes a shot or a gachapon capsule. If you close the page or sign out, you stay in the game — sign back in with your PIN.</p></li>
        <li><h3>Ghosts</h3><p>The Ghosts can share one clue each morning about what caused a death. Keep the killer’s name secret. Ghosts can also block a player’s next vote or choose someone to take a shot.</p></li>
        <li><h3>Twists</h3><p>The host can play one power per night and the morning that follows. Play Blizzard before pressing Next at night. The other powers are played in the morning.</p></li>
        <li><h3>How to win</h3><p><strong>Concertorants</strong> win when every Grinch and Krampus is out. <strong>Grinches</strong> win when living Grinches are at least as many as everyone else still alive (Krampus counts as not a Grinch). <strong>Krampus</strong> wins the round if he is the last one standing. He can also earn a personal win by taking out one Grinch and one Concertorant with his own night attacks; that personal win does not end the round. The round continues after a Snowman win too.</p></li>
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
        <a class="card game-hub-card" href="how-to-play.html"><h2>How to Play</h2></a>
        <a class="card game-hub-card" href="guide.html"><h2>Character Guide</h2></a>
      </div>
      <p class="game-docs-note"><a href="host.html">Host screen</a></p>
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
    const signedIn = Boolean(token());
    document.body.classList.toggle("game-player-view", signedIn && root.id === "game-hub-root");
    root.innerHTML = signedIn
      ? '<div class="game-player-shell"><div id="game-play-root"></div></div>'
      : '<div class="guide-page game-home">' + hubInnerHtml() + "</div>";
    const playRoot = $("#game-play-root", root);
    if (signedIn) {
      playRoot.insertAdjacentHTML("afterend", '<p class="logout-line"><button class="game-sign-out" type="button">Sign out</button></p>');
      const signOut = $(".game-sign-out", root);
      if (ui().logoutGuest) {
        signOut.addEventListener("click", (event) => {
          if (global.confirm("Sign out on this phone? You stay in the game and can sign back in with your PIN.")) ui().logoutGuest(event);
        });
      }
      renderLobby(playRoot);
    } else {
      playRoot.innerHTML = `<article class="card game-wait">
        <h2>Join the game</h2>
        <button type="button" class="btn btn-gold" id="game-sign-in">Sign in</button>
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
    root.innerHTML = '<p class="lede page-status">Opening the lobby…</p>';
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
      const status = lobby.joined ? "You’re in. Wait for the host to shuffle." : canJoin ? "" : "The lobby is full.";
      const heading = lobby.isHost ? "You’re hosting" : lobby.open ? (lobby.rehearsal ? "Rehearsal lobby" : "Game lobby") : "This round has started";
      const previousButton = root.contains(document.activeElement) && document.activeElement.id;
      root.innerHTML = `<article class="card game-wait game-lobby">
        <h2>${heading}</h2>
        <p id="game-lobby-count" aria-live="polite">${lobby.count} of ${lobby.maxPlayers} players joined</p>
        ${lobby.isHost ? '<a class="btn btn-gold" href="host.html">Open host screen</a>' : lobby.open ? `<p>${status}</p>${choice}` : '<p>Wait for the host to open the next lobby.</p>'}
        <p class="form-status" id="game-status" role="status" hidden></p>
      </article>`;
      const button = $("#game-join-lobby, #game-leave-lobby", root);
      if (!button) return;
      if (previousButton === button.id && !button.disabled) button.focus();
      button.addEventListener("click", async () => {
        if (updating) return;
        if (lobby.joined && !global.confirm("Leave the lobby? You can join again before the host shuffles.")) return;
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

  function playerSkills(d, role) {
    const { you, phase } = d;
    const left = (used) => used ? "0 left" : "1 left";
    const perNight = (locked) => phase === "night" ? (locked ? "0 tonight" : "1 tonight") : "1/night";
    const nightly = perNight(d.locked);
    const hunt = ["Hunt", "Pick a target together", nightly];
    const shield = ["Night Shield", NIGHT_SHIELD, "Passive"];
    switch (role) {
      case "grinch": return { rows: [hunt] };
      case "tough_grinch": return { rows: [hunt, shield], note: SHIELD_NOTE };
      case "krampus": return { rows: [["Hunt", "Pick a target alone", nightly]] };
      case "santa": return {
        rows: [["Save", "Protect one player", nightly]],
        note: SANTA_NOTE
      };
      case "reindeer": return {
        rows: [["Guard", GUARD_EFFECT, nightly]],
        note: GUARD_NOTE
      };
      case "detective": return {
        rows: [["Investigate", INVESTIGATE_EFFECT, nightly]],
        note: INVESTIGATE_NOTE
      };
      case "mrs_claus": return {
        rows: [
          ["Hot Cocoa", COCOA_EFFECT, left(you.cocoaUsed)],
          [BITTER_BISCUIT, BISCUIT_EFFECT, left(you.coalUsed)]
        ],
        note: COCOA_NOTE
      };
      case "gingerbread": return {
        rows: [["Final Hit", "Hit a player when you’re out", left(d.pendingGingerbread && d.locked)]]
      };
      case "fruitcake": return { rows: [shield], note: SHIELD_NOTE };
      case "liar_elf": return { rows: [["Only Lies", LIAR_EFFECT, "Always"]] };
      case "citizen": return { rows: [] };
      case "snowman": return { rows: [] };
      case "witness": return {
        rows: [["Glimpse", "Learn a Grinch’s name", left(d.witnessGrinchName)]],
        note: "Night 1 only. Hint without naming them."
      };
      case "ghost": return {
        rows: [
          ["Clue", "Ask what caused a death", nightly],
          ["Haunt", "Block a player’s next vote", nightly],
          ["Give a Shot", "Choose one living player", nightly]
        ],
        note: "Pick one action each night."
      };
      default: return { rows: you.ability ? [["Ability", you.ability, ""]] : [] };
    }
  }

  const NIGHT_CHOICES = {
    steal: ["Hunt with the Grinches", "Choose a target"],
    krampus_steal: ["Hunt alone", "Choose a target"],
    save: ["Save a player", "Choose a player to save"],
    guard: ["Guard a player", "Choose another player"],
    check: ["Investigate", "Choose a player to check"],
    watch: ["Night check-in", "Choose a player to watch"]
  };

  function playerOptions(people, excluded = []) {
    return (people || []).filter(({ id }) => !excluded.includes(id))
      .map(({ id, display_name }) => ({ value: id, label: display_name, portrait: true }));
  }

  function playerField(label, options, name = "target", required = true) {
    return { label, options, name, required, playerPicker: true };
  }

  function turnSelectHtml({ options, name, required }, labelledBy = "") {
    return `<select name="${name}"${required ? " required" : ""}${labelledBy ? ` aria-labelledby="${labelledBy}"` : ""}>
      <option value="">${required ? "Select an option" : "No selection"}</option>
      ${options.map(({ value, label, portrait }) =>
        `<option value="${escapeHtml(value)}"${portrait ? " data-portrait" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>`;
  }

  function playerPickerHtml(field, id) {
    const label = escapeHtml(field.label);
    return `<div class="player-turn-field" data-player-picker>
      <span id="${id}-label">${label}</span>
      ${turnSelectHtml(field, `${id}-label`)}
      <button class="player-picker-trigger" type="button" aria-haspopup="dialog" aria-expanded="false"
        aria-controls="${id}-dialog" aria-labelledby="${id}-label ${id}-value" hidden>
        <span class="player-picker-value" id="${id}-value"></span>
      </button>
      <dialog class="player-picker-dialog" id="${id}-dialog" aria-labelledby="${id}-title">
        <div class="player-picker-header">
          <h2 id="${id}-title">${label}</h2>
          <button class="player-picker-close" type="button" autofocus>Close</button>
        </div>
        <ul class="player-picker-list" role="list"></ul>
      </dialog>
    </div>`;
  }

  function pickerRowHtml(label, portrait, symbol) {
    const icon = portrait
      ? face(label, { sizes: "44px" })
      : symbol ? `<span class="night-action-symbol">${escapeHtml(symbol)}</span>` : "";
    return `${portrait || symbol ? `<span class="player-picker-avatar" aria-hidden="true">${icon}</span>` : ""}
      <span class="player-picker-name">${escapeHtml(label)}</span>`;
  }

  function pickerOptionHtml(option) {
    return pickerRowHtml(option.textContent, option.hasAttribute("data-portrait"));
  }

  function bindPlayerPickers(container, statusRoot) {
    $allC("[data-player-picker]", container).forEach((field) => {
      const select = $("select", field);
      const trigger = $(".player-picker-trigger", field);
      const dialog = $(".player-picker-dialog", field);
      if (typeof dialog.showModal !== "function") return;
      const list = $(".player-picker-list", dialog);
      const updateValue = () => {
        $(".player-picker-value", trigger).innerHTML = pickerOptionHtml(select.options[select.selectedIndex]);
      };
      updateValue();
      trigger.hidden = false;
      select.hidden = true;
      select.addEventListener("change", updateValue);
      select.addEventListener("invalid", (event) => {
        event.preventDefault();
        if (select.form && $(":invalid:not(form, fieldset)", select.form) === select) {
          setStatus(statusRoot, "Make a selection before locking in.", false);
          trigger.focus();
        }
      });

      trigger.addEventListener("click", () => {
        list.innerHTML = Array.from(select.options).filter((option) => option.value || !select.required)
          .map((option) => `<li><button type="button" class="player-picker-option" data-pick-value="${escapeHtml(option.value)}"
            aria-pressed="${option.selected}">${pickerOptionHtml(option)}</button></li>`).join("");
        dialog.showModal();
        trigger.setAttribute("aria-expanded", "true");
        const selected = select.value && $('[aria-pressed="true"]', list);
        if (selected) selected.focus();
        else list.scrollTop = 0;
      });
      dialog.addEventListener("click", (event) => {
        const option = event.target.closest(".player-picker-option");
        if (option) {
          select.value = option.dataset.pickValue;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          dialog.close();
        } else if (event.target.closest(".player-picker-close") || event.target === dialog) {
          dialog.close();
        }
      });
      dialog.addEventListener("close", () => {
        trigger.setAttribute("aria-expanded", "false");
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      });
    });
  }

  function playerTurn(d) {
    const { you, phase, locked } = d;
    const others = playerOptions(d.living, [you.id]);
    const living = playerOptions(d.living);
    if (phase === "ended") {
      const bonus = "";
      const personalWin = d.krampusWon && d.winnerSide !== "krampus" && you.role !== "krampus" ? " " + KRAMPUS_WIN : "";
      return { title: "Game over", note: (d.winnerText || "The round is over.") + personalWin + bonus };
    }
    if (d.pendingGingerbread) {
      if (locked) return { title: "Final pick locked in", note: "Wait for the reveal." };
      return {
        title: "Make your final pick",
        actions: [{ id: "gingerbread", fields: [playerField("Choose a living player", others)] }]
      };
    }
    if (you.alive === false) {
      if (phase !== "night") return { title: "You’re no longer with us. RIP" };
      if (locked) return { title: "Ghost choice locked in", note: "Wait for the morning reveal." };
      const actions = [];
      const dead = playerOptions(d.dead);
      if (dead.length) actions.push({ id: "clue", label: "Request a clue", fields: [playerField("Choose someone already out", dead)] });
      if (living.length) {
        actions.push({ id: "haunt", label: "Haunt a player", fields: [playerField("Block whose next vote?", living)] });
        actions.push({ id: "shot", label: "Give a Shot", fields: [playerField("Who takes a shot?", living)] });
      }
      return { title: "Ghost duties", actions };
    }
    if (phase === "day") {
      if (you.isHaunted || you.isHungover) {
        const note = you.isHungover ? "Egg-nog Hangover blocks your vote." : "A ghost’s haunt blocks your vote.";
        return { title: "Sitting out this vote", note };
      }
      if (locked) return { title: "Vote locked in", note: "Wait for the result." };
      return {
        title: "Cast your vote", button: "Lock in vote",
        actions: [{ id: "vote", fields: [playerField("Vote for a player or spare everyone", [
          { value: SPARE_VOTE, label: "Spare everyone" }, ...others
        ])] }]
      };
    }
    if (phase === "night") {
      if (locked) return { title: "Night choice locked in", note: "Wait for the morning reveal." };
      const skill = you.nightAction;
      if (skill === "item") {
        const actions = [{ id: "skip", label: "Save my items" }];
        if (!you.cocoaUsed) actions.push({ id: "cocoa", label: "Pour Hot Cocoa" });
        if (!you.coalUsed && living.length) actions.push({
          id: "coal", label: "Give a Bitter Biscuit", fields: [playerField("Choose a player", living)]
        });
        if (actions.length === 1) {
          return { title: "Night check-in", note: "You’ve used both items.", button: "Check in", actions };
        }
        return { title: "Choose an item", actions };
      }
      const id = Object.hasOwn(NIGHT_CHOICES, skill) ? skill : "watch";
      const [title, label] = NIGHT_CHOICES[id];
      const options = id === "save" ? playerOptions(d.living, [you.blockedSaveId]) : others;
      if (!options.length && id !== "watch") return { title, note: "There are no eligible targets." };
      return {
        title,
        actions: [{ id, fields: [playerField(label, options, "target", id !== "watch")] }]
      };
    }
    if (phase === "shuffled") return { title: "Your role is " + (you.roleName || ROLE_META[you.role]?.name || "listed above") + "." };
    if (phase === "town_hall") return { title: "Town Hall", clock: true };
    if (phase === "reveal" && d.reveal?.mode === "night") return { title: "The next morning" };
    if (phase === "twist") return { title: "Town hall", note: "Discuss with the village and wait for the host." };
    return { title: "Reveal in progress", note: "Wait for the host to open the next turn." };
  }

  const NIGHT_COVER_CHOICES = [
    ["🏮", "Lantern"], ["🔔", "Bell"], ["🎀", "Ribbon"], ["🕯️", "Candle"],
    ["⭐", "Star"], ["❄️", "Snowflake"], ["🧣", "Scarf"], ["🎁", "Gift"]
  ];

  function nightCoverChoices(d, action) {
    // Vary the decoration by player and night and keep the order stable when polling.
    const key = `${d.you.id}:${d.nightNumber}`;
    let hash = 0;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const start = (hash >>> 0) % NIGHT_COVER_CHOICES.length;
    return Array.from({ length: 4 }, (_, index) => {
      const [symbol, label] = NIGHT_COVER_CHOICES[(start + index) % NIGHT_COVER_CHOICES.length];
      return { symbol, label, value: String(index), action };
    });
  }

  function nightChoicesHtml(choices, name) {
    return choices.map(({ value, label, portrait, symbol, action, target, needsTarget }) => `
      <label class="player-picker-option night-action-option">
        <input type="radio" class="night-action-radio" name="${name}" value="${escapeHtml(value)}"
          ${action ? `data-action="${action}"` : ""}${target ? " data-player-target" : ""}${needsTarget ? " data-needs-target" : ""}>
        ${pickerRowHtml(label, portrait, symbol)}
      </label>`).join("");
  }

  function playerNightHtml(d, turn) {
    if (d.locked) {
      return '<p class="player-night-ready" role="status">Locked in. Wait for morning.</p>';
    }
    const actions = turn.actions || [];
    const first = actions[0];
    const coal = actions.find(({ id }) => id === "coal");
    const cover = !first || (actions.length === 1 && ["watch", "skip"].includes(first.id));
    let prompt;
    let choices;
    if (cover) {
      prompt = "Pick a check-in. It has no effect on the game.";
      choices = nightCoverChoices(d, first?.id || "watch");
    } else if (actions.length > 1) {
      prompt = turn.title;
      choices = actions.map(({ id, label }) => ({
        value: id, label, action: id, needsTarget: id === "coal",
        symbol: { skip: "🎀", cocoa: "☕", coal: "🎁" }[id]
      }));
    } else {
      prompt = first.fields[0].label;
      choices = first.fields[0].options.map((option) => ({ ...option, action: first.id, target: true }));
    }

    return `<button type="button" class="btn btn-gold player-night-open" id="game-night-open"
        aria-haspopup="dialog" aria-controls="game-night-dialog">Night action</button>
      <dialog class="player-night-dialog" id="game-night-dialog" aria-labelledby="game-night-title">
        <form id="game-night-form">
          <header class="player-picker-header">
            <h2 id="game-night-title">Night action</h2>
            <button type="button" class="player-picker-close" autofocus>Back to card</button>
          </header>
          <p class="night-action-prompt" id="game-night-prompt">${escapeHtml(prompt)}</p>
          <div class="night-action-list">
            <fieldset aria-labelledby="game-night-prompt">
              ${nightChoicesHtml(choices, "night-choice")}
            </fieldset>
            ${coal ? `<fieldset id="game-night-coal-targets" disabled hidden>
              <legend>Who gets the Bitter Biscuit?</legend>
              ${nightChoicesHtml(coal.fields[0].options, "night-target")}
            </fieldset>` : ""}
          </div>
          <footer class="night-action-footer">
            <p class="form-status" id="game-status" role="status" hidden></p>
            <button type="submit" class="btn btn-gold" id="game-night-lock" disabled>Lock in</button>
          </footer>
        </form>
      </dialog>`;
  }

  function bindPlayerNight(root) {
    const form = $("#game-night-form", root);
    if (!form) return;
    const dialog = $("#game-night-dialog", root);
    const launcher = $("#game-night-open", root);
    const lock = $("#game-night-lock", form);
    const followup = $("#game-night-coal-targets", form);
    let submitting = false;
    let saved = false;
    const selected = () => $('input[name="night-choice"]:checked', form);
    const targetFor = (choice) => {
      if (choice.hasAttribute("data-player-target")) return choice.value;
      if (choice.hasAttribute("data-needs-target")) return $(":checked", followup)?.value;
      return null;
    };
    const update = () => {
      const choice = selected();
      const needsTarget = choice?.hasAttribute("data-needs-target");
      if (followup) followup.disabled = followup.hidden = !needsTarget;
      lock.disabled = submitting || saved || !choice || (needsTarget && !targetFor(choice));
    };

    launcher.addEventListener("click", () => dialog.showModal());
    $(".player-picker-close", dialog).addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (launcher.isConnected && !launcher.disabled) launcher.focus({ preventScroll: true });
    });
    form.addEventListener("change", () => {
      update();
      setStatus(root, "", false);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (lock.disabled) return;
      const choice = selected();
      submitting = true;
      update();
      setStatus(root, "", false);
      try {
        const result = await submit(choice.dataset.action, targetFor(choice));
        if (result?.ok) {
          saved = true;
          launcher.disabled = true;
          launcher.textContent = "Locked in. Wait for morning.";
          dialog.close();
          await refreshPlayer(root, true);
        } else {
          setStatus(root, result?.message || "Couldn’t lock that in. Try again.", false);
        }
      } catch {
        setStatus(root, "Couldn’t lock that in. Try again.", false);
      } finally {
        submitting = false;
        update();
      }
    });
  }

  function playerTurnHtml(turn) {
    const actions = turn.actions || [];
    const button = turn.button || (actions.length === 1 && actions[0].label) || "Lock in";
    const picker = actions.length > 1
      ? `<label class="player-turn-field">Choose your move<select id="game-action-choice" name="action">${actions.map(({ id, label }) =>
          `<option value="${id}">${escapeHtml(label)}</option>`).join("")}</select></label>`
      : "";
    const fields = actions.map((action, index) => {
      const rows = (action.fields || []).map((field) => field.playerPicker
        ? playerPickerHtml(field, `pick-${action.id}-${field.name}`)
        : `<label class="player-turn-field">${escapeHtml(field.label)}${turnSelectHtml(field)}</label>`
      ).join("");
      return `<fieldset class="player-turn-targets" data-move="${action.id}"${index ? " disabled hidden" : ""}>${rows}</fieldset>`;
    }).join("");
    return `<section class="game-action player-card-turn">
      <h2>${escapeHtml(turn.title)}</h2>
      ${turn.clock ? '<p data-town-hall-clock role="timer">3:30</p>' : ""}
      ${turn.note ? `<p>${escapeHtml(turn.note)}</p>` : ""}
      ${actions.length ? `<form id="game-turn-form" data-default-move="${actions[0].id}">
        ${picker}${fields}
        <button class="btn btn-gold" type="submit" id="game-lock">${escapeHtml(button)}</button>
        <p class="form-status" id="game-status" role="status" hidden></p>
      </form>` : ""}
    </section>`;
  }

  function playerPrivateNotes(d, ghost) {
    if (ghost) {
      return typeof d.ghostClue === "string" && d.ghostClue
        ? `<p class="player-card-private player-card-ghost-clue"><strong>Ghost clue</strong> ${escapeHtml(d.ghostClue)}</p>`
        : "";
    }
    const allies = (d.fellowGrinches || []).map(({ display_name }) => display_name).join(", ");
    const notes = [];
    if (d.ghostShot) notes.push("The Ghosts picked you to take a shot.");
    if (allies) notes.push(`Your fellow Grinches are <strong>${escapeHtml(allies)}</strong>.`);
    if (d.witnessGrinchName) notes.push(`You saw <strong>${escapeHtml(d.witnessGrinchName)}</strong>. Hint only.`);
    if (d.privateNotice) notes.push(escapeHtml(d.privateNotice));
    if (d.krampusNotice) notes.push(escapeHtml(d.krampusNotice));
    if (d.detectiveResult) {
      const check = d.detectiveResult;
      notes.push(`Last check: <strong>${escapeHtml(check.targetName)}</strong> · ${check.isBad ? "Yes" : "No"}`);
    }
    return notes.map((note) => `<p class="player-card-private">${note}</p>`).join("");
  }

  function playerCardHtml(d) {
    const ghost = d.you.alive === false && !d.pendingGingerbread;
    const role = ghost ? "ghost" : d.you.role;
    const meta = ROLE_META[role] || {};
    const { rows, note } = playerSkills(d, role);
    const title = ghost ? "Ghost" : d.you.roleName || meta.name || "Your role";
    const { family = "town" } = CARD_TEAMS[meta.side] || {};
    const goal = GUIDE_DETAILS[role]?.goal || (role === "witness" ? TOWN_GOAL : "");
    const phase = { shuffled: "Ready", ended: "Game over" }[d.phase] || phaseLabel(d);
    const turn = playerTurn(d);
    const supportsDialog = typeof global.HTMLDialogElement?.prototype.showModal === "function";
    const privateNight = supportsDialog && d.phase === "night" && !ghost && !d.pendingGingerbread;
    const turnHtml = privateNight ? "" : playerTurnHtml(turn);
    const supportsTurnPanel = !privateNight && turn.actions?.length && supportsDialog;
    return `<article class="role-card game-role-card player-card" data-card-family="${family}">
      ${privateNight ? playerNightHtml(d, turn) : ""}
      ${roleCardContents(role, { title, rows, note, goal, phase, out: d.you.alive === false, lives: d.you.lives, livesMax: d.you.livesMax })}
      ${isFirstMorning(d) ? `<p class="player-card-morning-note">${escapeHtml(firstMorningNote())}</p>` : ""}
      ${playerPrivateNotes(d, ghost)}
      ${d.krampusWon && d.you.role === "krampus" ? '<p class="player-card-private" role="status"><strong>You earned your Krampus win.</strong></p>' : ""}
      ${supportsTurnPanel ? `
        <button type="button" class="btn btn-gold player-turn-open" aria-haspopup="dialog"
          aria-controls="player-turn-dialog" hidden>${escapeHtml(turn.title)}</button>
        <dialog id="player-turn-dialog" class="player-turn-dialog" aria-label="${escapeHtml(turn.title)}">
          <button type="button" class="player-turn-close" autofocus>Back to card</button>
        </dialog>
      ` : ""}
      ${turnHtml}
    </article>`;
  }

  function bindPlayerTurn(root) {
    const form = $("#game-turn-form", root);
    if (!form) return;
    const panel = $("#player-turn-dialog", root);
    if (panel) {
      const launcher = $(".player-turn-open", root);
      const turn = form.closest(".player-card-turn");
      const shortScreen = global.matchMedia("(max-height: 610px) and (max-width: 450px)");
      const setTurnLayout = () => {
        launcher.hidden = !shortScreen.matches;
        if (shortScreen.matches) panel.append(turn);
        else {
          if (panel.open) panel.close();
          panel.after(turn);
        }
      };
      setTurnLayout();
      shortScreen.addEventListener("change", setTurnLayout);
      stopPlayerTurnLayout = () => shortScreen.removeEventListener("change", setTurnLayout);
      launcher.addEventListener("click", () => panel.showModal());
      $(".player-turn-close", panel).addEventListener("click", () => panel.close());
      panel.addEventListener("close", () => {
        if (launcher.isConnected && !launcher.hidden) launcher.focus({ preventScroll: true });
      });
    }
    bindPlayerPickers(form, root);
    const choice = $("#game-action-choice", form);
    const lock = $("#game-lock", form);
    const move = () => choice?.value || form.dataset.defaultMove;
    form.addEventListener("change", (event) => {
      if (event.target === choice) {
        $allC("[data-move]", form).forEach((group) => {
          group.disabled = group.hidden = group.dataset.move !== move();
        });
      }
      setStatus(root, "", false);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (lock.disabled) return;
      const data = new FormData(form);
      const action = move();
      const target = data.get("target");
      const extra = data.get("extra");
      lock.disabled = true;
      setStatus(root, "", false);
      try {
        const result = action === "vote" && target === SPARE_VOTE
          ? await submit("vote", null, null, SPARE_VOTE)
          : await submit(action, target, extra, data.get("extraText"));
        if (result?.ok) await refreshPlayer(root, true);
        else setStatus(root, result?.message || "Couldn’t lock that in. Try again.", false);
      } catch {
        setStatus(root, "Couldn’t lock that in. Try again.", false);
      } finally {
        lock.disabled = false;
      }
    });
  }

  function renderPlayerInto(root, d) {
    stopPlayerTurnLayout?.();
    stopPlayerTurnLayout = null;
    if (!d?.dealt || !d.isPlayer || !d.you) {
      root.innerHTML = d?.isHost
        ? '<article class="card game-wait"><h2>You’re hosting</h2><a href="host.html">Open host controls</a></article>'
        : '<article class="card game-wait"><h2>Waiting for roles</h2><p>The host will deal when the group is ready.</p></article>';
      return;
    }
    root.innerHTML = playerCardHtml(d);
    bindPlayerNight(root);
    bindPlayerTurn(root);
    townHallClock(root, d, () => refreshPlayer(root, false));
  }

  function refreshPlayer(root, force) {
    const a = api();
    if (!a || !token() || !a.gameMe) {
      renderPlayerInto(root, null);
      return Promise.resolve();
    }
    return a.gameMe(token()).then((d) => {
      if (!root.isConnected) return;
      if (!d?.ok) {
        lastSig = "";
        renderPlayerInto(root, null);
        return;
      }
      if (root.id === "game-play-root" && (!d.dealt || !d.isPlayer)) {
        renderLobby(root);
        return;
      }
      const sig = JSON.stringify([
        d.phase, d.nightNumber, d.dayNumber, d.reveal?.mode, d.winnerText, d.krampusWon, d.locked,
        d.pendingGingerbread, d.you, d.living, d.dead, d.submitted,
        d.detectiveResult, d.fellowGrinches, d.witnessGrinchName, d.townHallEndsAt, d.ghostClue, d.ghostShot,
        d.privateNotice, d.krampusNotice
      ]);
      if (!force && sig === lastSig) return;
      lastSig = sig;
      renderPlayerInto(root, d);
    }).catch(() => {});
  }

  function renderPlayer(root) {
    if (!root) return;
    lastSig = "";
    root.innerHTML = '<p class="lede player-loading">Opening your role…</p>';
    refreshPlayer(root, true);
    startPoll(() => refreshPlayer(root, false), POLL_PLAYER);
  }

  /* ---------- Host ---------- */
  const STORE_HOST_ROLES = "uglytee-host-roles-open";
  let hostRolesOpen = false;

  function renderHost(root) {
    if (!root) return;
    stopPoll();
    lastSig = "";
    try { hostRolesOpen = sessionStorage.getItem(STORE_HOST_ROLES) === "1"; }
    catch (_) { /* keep the current view preference */ }
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

  function displaySignature(d, { upcoming = false } = {}) {
    if (!d) return null;
    return [d.phase, d.dealt, d.nightNumber, d.dayNumber, d.reveal,
      upcoming ? null : d.townHallEndsAt, d.winnerText, d.winnerSide, d.krampusWon, d.players];
  }

  function hostTvMatches(state, preview) {
    if (!state?.ok || !preview?.ok || !preview.from || !preview.currentTv) return false;
    const from = preview.from;
    if (state.phase !== from.phase || state.nightNumber !== from.nightNumber || state.dayNumber !== from.dayNumber) {
      return false;
    }
    if (state.phase === "reveal") {
      return state.reveal?.mode === from.revealMode && state.reveal?.sceneIndex === from.sceneIndex &&
        state.reveal?.beatIndex === from.beatIndex;
    }
    if (state.phase === "twist") return state.reveal?.mode === from.revealMode;
    return true;
  }

  function readHostTvPreview(api, token) {
    return Promise.resolve().then(() => api.gameHostTvPreview?.(token)).catch(() => null);
  }

  function applyHostSnapshot(root, d, force) {
    if (!root.isConnected) return;
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
      nightSubmissions: d.phase === "night" ? d.submitted?.map(({ id }) => id) : null,
      lobby: d.lobby, krampusWon: d.krampusWon, townHallEndsAt: d.townHallEndsAt,
      canStartTownHall: d.canStartTownHall, canAdvance: d.canAdvance, canCloseTurn: d.canCloseTurn,
      canPlayNightBlizzard: d.canPlayNightBlizzard, nightBlizzardActive: d.nightBlizzardActive,
      rehearsal: d.rehearsal, waitingNames: d.waitingNames, waitingGhostNames: d.waitingGhostNames,
      preview: d.tvPreview && [displaySignature(d.tvPreview.currentTv), displaySignature(d.tvPreview.tv, { upcoming: true }),
        d.tvPreview.nextAction, d.tvPreview.nextScreen],
      roles: d.roles?.map(({ id, role, roleName, display_name, alive }) => [id, role, roleName, display_name, alive])
    });
    if (!force && sig === lastSig) return;
    lastSig = sig;
    paintHost(root, d);
  }

  function refreshHost(root, force) {
    const a = api();
    const ht = hostToken();
    if (!a || !ht || (!force && hostSetupPending)) return Promise.resolve();
    const version = hostStateVersion;
    return Promise.all([a.gameHostState(ht), readHostTvPreview(a, ht)]).then(([d, preview]) => {
      if (ht !== hostToken() || version !== hostStateVersion || (!force && hostSetupPending)) return;
      const match = hostTvMatches(d, preview);
      applyHostSnapshot(root, match ? { ...d, tvPreview: preview } : d, force);
    }).catch(() => {});
  }

  function bindHostSetup(root, selector, run, message, { useSnapshot = false, confirmation = "" } = {}) {
    const button = $(selector, root);
    if (!button) return;
    button.addEventListener("click", async () => {
      if (hostSetupPending || (confirmation && !global.confirm(confirmation))) return;
      hostSetupPending = true;
      const requestingHost = hostToken();
      const hadFocus = document.activeElement === button;
      let keepDisabled = false;
      button.disabled = true;
      if (useSnapshot) setStatus(root, "", false);
      try {
        const result = await run();
        if (requestingHost !== hostToken()) return;
        if (result && result.ok) {
          if (useSnapshot) {
            keepDisabled = true;
            hostStateVersion += 1;
            const preview = await readHostTvPreview(api(), requestingHost);
            if (requestingHost !== hostToken()) return;
            const next = hostTvMatches(result, preview) ? { ...result, tvPreview: preview } : result;
            applyHostSnapshot(root, next, true);
            if (hadFocus) $("#host-advance", root)?.focus();
          } else {
            await refreshHost(root, true);
          }
        } else {
          setStatus(root, (result && result.message) || message, false);
        }
      } catch (_) {
        setStatus(root, message, false);
      } finally {
        hostSetupPending = false;
        button.disabled = keepDisabled;
      }
    });
  }

  function hostLobbyHtml(d) {
    if (!d.lobby) return '<div class="card game-shuffle-wrap"><h3>Lobby</h3><p>Reload this page to open the lobby.</p></div>';
    const { count, minPlayers, maxPlayers, members } = d.lobby;
    const ready = count >= minPlayers && count <= maxPlayers;
    return `<div class="card game-shuffle-wrap game-lobby">
      <p id="host-player-count" aria-live="polite">${count} ${count === 1 ? "player" : "players"} joined</p>
      ${d.dealt
        ? "<p>Check that everyone has their role.</p>"
        : '<p>Players tap <strong>Join lobby</strong> on their phones.</p>'}
      ${!d.dealt && members.length ? '<ul class="game-lobby-members">' + members.map((member) => `<li>${escapeHtml(member.display_name)}</li>`).join("") + '</ul>' : ""}
      ${!ready ? `<p>At least ${minPlayers} players must join before you can shuffle.</p>` : ""}
      <div class="game-host-lobby-actions">
        ${d.canStart ? '<button type="button" class="btn btn-gold" id="host-start">Start Night 1</button>' : ""}
        <button type="button" class="btn ${d.canReshuffle ? "game-host-secondary" : "btn-gold"}" id="host-shuffle"${ready ? "" : " disabled"}>${d.canReshuffle ? "Shuffle again" : "Shuffle roles"}</button>
      </div>
      <p class="form-status" id="game-status" role="status" hidden></p>
    </div>`;
  }

  function hostRolesHtml(assignments) {
    return `<details class="card game-host-roles"${hostRolesOpen ? " open" : ""}>
      <summary>Role assignments (host only)</summary>
      <ul class="game-host-role-grid" role="list">${assignments.map((assignment) => {
        const role = ROLE_META[assignment.role] || {};
        const player = assignment.display_name || "";
        const out = assignment.alive === false;
        return `<li class="game-host-role-card${out ? " is-out" : ""}">
          <div class="game-host-role-art">
            ${rolePortrait(role, "game-host-role-portrait", "lazy")}
            <div class="game-host-role-assignee">
              <span aria-hidden="true">${face(player, { className: "game-host-role-avatar", sizes: "36px" })}</span>
              <span class="game-host-role-player-name">${escapeHtml(player)}</span>
            </div>
          </div>
          <div class="game-host-role-label">
            <span class="game-host-role-name">${escapeHtml(assignment.roleName || role.name || "Role")}</span>
            ${out ? '<span class="game-host-role-status">Out</span>' : ""}
          </div>
        </li>`;
      }).join("")}</ul>
    </details>`;
  }

  function hostNightChecklist(d, roles) {
    const submitted = new Set((d.submitted || []).map(({ id }) => id));
    return `<ul class="game-host-night-checklist" role="list">${roles.map(({ id, role, roleName, display_name, alive }) => {
      const complete = submitted.has(id);
      const meta = ROLE_META[alive === false ? "ghost" : role] || ROLE_META[role] || {};
      const label = alive === false ? "Ghost" : (roleName || meta.name || "Role");
      return `<li class="game-host-night-seat">
        ${rolePortrait(meta, "game-host-night-portrait", "lazy")}
        <span class="game-host-night-name"><strong>${escapeHtml(display_name)}</strong><span>${escapeHtml(label)}</span></span>
        <span class="game-host-night-status${complete ? " is-ready" : ""}" aria-hidden="true">${complete ? "✓" : "○"}</span>
        <span class="visually-hidden">${complete ? "Locked in" : "Waiting"}</span>
      </li>`;
    }).join("")}</ul>`;
  }

  const HOST_TURNS = {
    night: {
      title: "Night actions",
      instruction: "Everyone still in, and any ghosts, should lock in on their phones. You can close the night anyway if someone is stuck.",
      action: "Next"
    },
    day: {
      title: "Voting is open",
      instruction: "Ask players to vote on their phones. They can vote for a player or choose Spare everyone.",
      action: "Next"
    },
    gingerbread: {
      title: "Gingerbread’s final pick",
      instruction: "Wait for the Gingerbread player to lock in privately, then reveal the pick on TV.",
      action: "Reveal the pick"
    }
  };

  const HOST_STATUS = '<p class="form-status" id="game-status" role="status" hidden></p>';

  function hostPhaseLabel(d) {
    if (d.canShuffle && !d.dealt) return "Lobby";
    if (d.phase === "shuffled") return "Ready?";
    if (d.phase === "ended") return "Game over";
    return phaseLabel(d);
  }

  function hostNightPowersHtml(d) {
    if (!d.canPlayNightBlizzard && !d.nightBlizzardActive) return "";
    const active = d.nightBlizzardActive;
    return `<section class="game-host-night-powers" aria-labelledby="host-night-powers-heading">
      <h4 id="host-night-powers-heading">Host powers</h4>
      <button type="button" class="btn game-host-secondary" id="host-night-blizzard"
        aria-describedby="host-night-power-status"${active ? " disabled" : ""}>Blizzard</button>
      <p id="host-night-power-status" role="status">${active ? "Blizzard is set for tonight." : "Stops tonight’s attacks and saves."}</p>
    </section>`;
  }

  function hostTwistsHtml(d) {
    const beforeVote = d.reveal?.mode !== "post_vote";
    const twists = (d.availableTwists || []).filter(({ id }) => id !== "blizzard");
    const timed = beforeVote && d.canStartTownHall === true;
    const nextStep = beforeVote ? "Open voting" : "Start the next night";
    const skipLabel = twists.length ? "Skip twist and " + nextStep.toLowerCase() : nextStep;
    const title = twists.length ? "Optional Twist cards" : beforeVote ? "Town hall" : "Next night";
    return `<section class="card game-host-controls">
      <h3>${title}</h3>
      ${beforeVote && !timed ? "<p>Give everyone 3 minutes and 30 seconds to discuss.</p>" : ""}
      ${twists.length ? `<p>${timed ? "Play a power before you start the timer." : "Play one power or continue."}</p>
      <div class="game-twist-grid">${twists.map((twist) => `
        <button type="button" class="game-host-twist-card" data-twist="${escapeHtml(twist.id)}"
          aria-pressed="false" aria-controls="twist-targets">
          <span class="game-host-twist-title">${escapeHtml(twist.name)}</span>
          <span class="game-host-twist-effect">${escapeHtml(twist.hint || "")}</span>
        </button>`).join("")}</div>
      <div id="twist-targets" class="game-host-twist-targets"></div>` : ""}
      <button type="button" class="btn btn-gold" id="${timed ? "host-town-hall-start" : "host-skip-twist"}">${timed ? "Start timer" : skipLabel}</button>
      ${HOST_STATUS}
    </section>`;
  }

  function bindHostTwists(root, d, playTwist) {
    const cards = $allC("[data-twist]", root);
    cards.forEach((button) => {
      button.addEventListener("click", () => {
        if (hostSetupPending) return;
        const card = (d.availableTwists || []).find(({ id }) => id === button.dataset.twist);
        if (!card) return;
        const box = $("#twist-targets", root);
        cards.forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
        const players = d.livingForPicks || [];
        const pool = card.id === "naughty_list" ? players.filter(({ innocent }) => innocent) : players;
        const options = playerOptions(pool);
        const pickLabel = card.id === "naughty_list" ? "Choose an innocent player to reveal" : "Choose a living player";
        box.innerHTML = `
          <h4>${escapeHtml(card.name)}</h4>
          ${card.needsTarget ? `<div class="game-host-twist-picks">
            ${playerPickerHtml(playerField(card.needsTarget2 ? "First player" : pickLabel, options), "twist-first")}
            ${card.needsTarget2 ? playerPickerHtml(playerField("Second player", options, "extra"), "twist-second") : ""}
          </div>` : ""}
          <button type="button" class="btn btn-gold" id="twist-lock"${card.needsTarget ? " disabled" : ""}>Play ${escapeHtml(card.name)}</button>`;
        const lock = $("#twist-lock", box);
        const first = $('select[name="target"]', box);
        const second = $('select[name="extra"]', box);
        bindPlayerPickers(box, root);
        box.onchange = () => {
          const samePlayer = second?.value && first.value === second.value;
          lock.disabled = !first?.value || (card.needsTarget2 && (!second?.value || samePlayer));
          setStatus(root, samePlayer ? "Choose two different players." : "", false);
        };
        if (!card.needsTarget) lock.focus();
        bindHostSetup(root, "#twist-lock", () => playTwist(card.id, first?.value || null, second?.value || null), "Couldn’t play that Twist. Try again.");
      });
    });
  }

  function hostTvPreviewHtml(projection) {
    if (!projection?.currentTv) return "";
    const card = (title, snapshot, message, cueLabel, next = false) => {
      const cue = global.ConcertoTvSlideshow?.hostCue(snapshot);
      return `<article class="host-tv-preview">
        <h2>${title}</h2>
        <div class="host-tv-preview-screen">
          ${snapshot ? tvFrameHtml(snapshot, { preview: true, clock: !next })
            : `<p class="host-tv-preview-message">${escapeHtml(message)}</p>`}
        </div>
        ${cue ? `<p class="host-tv-preview-cue"><strong>${cueLabel}</strong> ${escapeHtml(cue)}</p>` : ""}
      </article>`;
    };
    return `<section class="host-tv-preview-grid" aria-label="TV screens">
      ${card("On TV", projection.currentTv, "", "Say now")}
      ${projection.nextScreen || projection.tv
        ? card("Up next", projection.tv, projection.nextScreen || "", "Say next", true) : ""}
    </section>`;
  }

  function hostWaitingHtml(d) {
    const waiting = d.waitingNames || [];
    if (!waiting.length) return "";
    return `<p class="game-host-waiting">Still waiting on ${waiting.map((name) => escapeHtml(name)).join(", ")}.</p>`;
  }

  function hostToolsHtml(d) {
    return `<section class="card game-host-tools">
      ${d.rehearsal
        ? `<p class="game-host-rehearsal">Rehearsal is on. Test elves sign in with PIN <strong>${escapeHtml(d.rehearsalPin || "")}</strong>.</p>`
        : "<p>Party lobby. Open rehearsal only when you want a practice round.</p>"}
      <div class="game-host-lobby-actions">
        ${d.canOpenRehearsal ? '<button type="button" class="btn game-host-secondary" id="host-open-rehearsal">Open rehearsal</button>' : ""}
        ${d.canOpenParty ? '<button type="button" class="btn game-host-secondary" id="host-open-party">Open party lobby</button>' : ""}
        <button type="button" class="btn game-host-secondary" id="host-clear-lockouts">Clear PIN lockouts</button>
      </div>
    </section>`;
  }

  function paintHost(root, d) {
    const previousRoles = $(".game-host-roles", root);
    if (previousRoles) hostRolesOpen = previousRoles.open;
    const a = api();
    const ht = hostToken();
    const roles = d.roles || [];
    const turn = HOST_TURNS[d.phase];
    let mid = "";
    if (d.canShuffle) {
      mid = hostLobbyHtml(d);
    } else if (d.phase === "ended") {
      mid = `<section class="card game-host-controls">
        <h3>Game over</h3>
        ${d.winnerText ? `<p>${escapeHtml(d.winnerText)}</p>` : ""}
        ${d.krampusWon && d.winnerSide !== "krampus" ? `<p>${KRAMPUS_WIN}</p>` : ""}
        <button class="btn btn-gold" id="host-new-lobby" type="button">Open a new lobby</button>
        ${HOST_STATUS}
      </section>`;
    } else if (d.phase === "reveal") {
      const latestBeat = d.reveal?.current?.beats?.at(-1);
      mid = `<section class="card game-host-controls game-host-reveal">
        ${latestBeat && !d.tvPreview ? `<p class="game-host-tv-line" aria-live="polite">${escapeHtml(latestBeat.text || latestBeat)}</p>` : ""}
        <button type="button" class="btn btn-gold" id="host-advance">Show next</button>
        ${HOST_STATUS}
      </section>`;
    } else if (d.phase === "town_hall") {
      mid = `<section class="card game-host-controls">
        <h3>Town Hall</h3>
        <p data-town-hall-clock role="timer">3:30</p>
        <p>Voting opens when time is up.</p>
        <button type="button" class="btn game-host-secondary" id="host-town-hall-skip">Skip timer</button>
        ${HOST_STATUS}
      </section>`;
    } else if (d.phase === "twist") {
      mid = hostTwistsHtml(d);
    } else if (turn) {
      mid = `<section class="card game-host-controls">
        <h3>${turn.title}</h3>
        <p>${turn.instruction}</p>
        <p role="status"><strong>${d.submittedCount || 0} / ${d.expectedCount || 0}</strong> locked in</p>
        ${d.phase === "night" ? hostNightChecklist(d, roles) + hostNightPowersHtml(d) : hostWaitingHtml(d)}
        <button type="button" class="btn btn-gold" id="host-advance"${
          d.canAdvance === false || (["night", "day"].includes(d.phase) && d.submittedCount < d.expectedCount) ? " disabled" : ""
        }>${turn.action}</button>
        ${d.canCloseTurn && d.canAdvance === false ? `<button type="button" class="btn game-host-secondary" id="host-close-turn">${d.phase === "night" ? "Close night anyway" : "Close vote anyway"}</button>` : ""}
        ${HOST_STATUS}
      </section>`;
    }
    if (roles.length && d.phase !== "night") mid += hostRolesHtml(roles);

    root.innerHTML = `
      <header class="guide-hero game-host-header">
        <p class="kicker">Host · ${escapeHtml(d.hostName || "")}</p>
        <h1 class="outline-red">Who Stole Christmas?</h1>
        <p class="game-phase-tag">${escapeHtml(hostPhaseLabel(d))}</p>
        ${isFirstMorning(d) ? `<p class="game-host-morning-note">${escapeHtml(firstMorningNote())}</p>` : ""}
        <a class="btn btn-ghost game-host-tv-link" href="tv.html" target="_blank" rel="noopener">Open the TV screen</a>
      </header>
      ${hostToolsHtml(d)}
      ${hostTvPreviewHtml(d.tvPreview)}
      ${mid}
      <p class="logout-line"><a href="host.html" id="host-logout">Sign out</a></p>
    `;

    bindHostSetup(root, "#host-shuffle", () => a.gameHostDealLobby(ht), "Couldn’t shuffle. Try again.", {
      confirmation: d.canReshuffle ? "Shuffle again? This will replace everyone’s card." : ""
    });
    bindHostSetup(root, "#host-start", () => a.gameHostStart(ht), "Couldn’t start Night 1. Try again.");
    bindHostSetup(root, "#host-new-lobby", () => a.gameHostReset(ht), "Couldn’t open a new lobby. Try again.", {
      confirmation: "Open a new lobby? This ends the current game."
    });
    bindHostSetup(root, "#host-advance", () => a.gameHostAdvance(ht), "Couldn’t continue. Try again.");
    bindHostSetup(root, "#host-close-turn", () => a.gameHostCloseTurn(ht), "Couldn’t close the turn. Try again.", {
      confirmation: d.phase === "night"
        ? "Close the night anyway? Anyone who has not locked in will check in, and missing ghost actions will be skipped."
        : "Close the vote anyway? Anyone who has not voted will not cast a ballot."
    });
    bindHostSetup(root, "#host-open-rehearsal", () => a.gameHostOpenRehearsal(ht), "Couldn’t open rehearsal. Try again.", {
      confirmation: "Start rehearsal? This opens a test lobby with 13 QA elves and ends the current game."
    });
    bindHostSetup(root, "#host-open-party", () => a.gameHostOpenParty(ht), "Couldn’t open the party lobby. Try again.", {
      confirmation: "End rehearsal and open the party lobby? Test elves will leave the table."
    });
    bindHostSetup(root, "#host-clear-lockouts", () => a.gameHostClearPinLockouts(ht), "Couldn’t clear PIN lockouts. Try again.", {
      confirmation: "Clear PIN lockouts? Anyone who was locked out can try again now."
    });
    bindHostSetup(root, "#host-night-blizzard", () => a.gameHostPlayTwist(ht, "blizzard"),
      "Couldn’t play Blizzard. Try again.", {
        useSnapshot: true,
        confirmation: "Play Blizzard? This stops tonight’s attacks and saves."
      });
    townHallClock(root, d, () => refreshHost(root, true));
    bindHostSetup(root, "#host-town-hall-start", () => a.gameHostStartTownHall(ht),
      "Couldn’t start the timer. Try again.", { useSnapshot: true });
    bindHostSetup(root, "#host-town-hall-skip", () => a.gameHostSkipTownHall(ht, d.townHallEndsAt),
      "Couldn’t skip the timer. Try again.", {
        useSnapshot: true,
        confirmation: "Skip the rest of Town Hall and open voting now?"
      });
    bindHostSetup(root, "#host-skip-twist", () => a.gameHostSkipTwist(ht), "Couldn’t skip the Twist. Try again.");
    bindHostTwists(root, d, (id, first, second) => a.gameHostPlayTwist(ht, id, first, second));
    const roleDetails = $(".game-host-roles", root);
    roleDetails?.addEventListener("toggle", () => {
      if (!roleDetails.isConnected) return;
      hostRolesOpen = roleDetails.open;
      try { sessionStorage.setItem(STORE_HOST_ROLES, hostRolesOpen ? "1" : "0"); }
      catch (_) { /* the open state still persists between redraws */ }
    });
    const lo = $("#host-logout", root);
    lo?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!global.confirm("Sign out of the host screen? The game keeps going. Sign back in with your PIN.")) return;
      setHostToken("");
      renderHost(root);
    });
  }

  /* ---------- TV ---------- */
  function tvFrameHtml(d, { preview = false, clock = true } = {}) {
    const slideshow = global.ConcertoTvSlideshow;
    const reveal = slideshow ? slideshow.render(d, { face, escapeHtml, announce: !preview }) : "";
    const rosterReady = d.players?.length && ["setup", "shuffled"].includes(d.phase);
    const townHall = d.phase === "town_hall" ||
      (d.phase === "twist" && d.reveal?.mode === "post_morning");
    const mainTitle = d.phase === "day" ? "Vote on your phone."
      : townHall ? "Town Hall" : phaseLabel(d);
    const heading = preview ? "h3" : "h1";
    const setting = d.phase === "night" ? "night" : townHall ? "town-hall"
      : d.phase === "day" || d.phase === "twist" ? "square" : "village";
    const frameClass = reveal ? "tv-frame has-tv-slide" : "tv-frame";

    return `<div class="${frameClass}"${reveal ? "" : ` data-tv-setting="${setting}"`}>
      ${reveal ? "" : `<p class="kicker">Who Stole Christmas?</p>
        <${heading} class="tv-title outline-red">${escapeHtml(mainTitle)}</${heading}>`}
      ${!d.dealt ? '<p class="tv-wait">Waiting for the host to shuffle…</p>' : ""}
      ${d.phase === "town_hall" ? `<p class="tv-clock"${clock ? ' data-town-hall-clock role="timer"' : ""}>3:30</p>` : ""}
      ${reveal}
      ${d.phase === "ended" && d.winnerText ? `<p class="tv-winner">${escapeHtml(d.winnerText)}</p>` : ""}
      ${d.phase === "ended" && d.krampusWon && d.winnerSide !== "krampus" ? `<p class="tv-winner">${KRAMPUS_WIN}</p>` : ""}
      ${rosterReady ? '<p class="tv-sub">Who’s in</p>' + rosterHtml(d.players, { faces: true }) : ""}
    </div>`;
  }

  function renderTv(root) {
    if (!root) return;
    const audio = $("#tv-background-music");
    const musicPhases = new Set(["reveal", "night", "day", "town_hall", "twist", "gingerbread"]);
    let musicActive = false;
    if (audio) audio.volume = 0.3;
    const slideshow = global.ConcertoTvSlideshow;
    let signature = "";
    let currentFrame = "";
    let fetching = false;
    const data = api();
    if (slideshow && data && data.listGuestsPublic) {
      data.listGuestsPublic().then((result) => {
        if (result && result.ok) slideshow.preload(result.guests || [], face);
      }).catch(() => {});
    }

    const paint = (d) => {
      const frame = tvFrameHtml(d);
      if (frame !== currentFrame) {
        root.innerHTML = frame;
        currentFrame = frame;
      }
      slideshow?.preloadComic?.(d);
      townHallClock(root, d, () => {
        paint({ ...d, phase: "day" });
        void tick();
      });
    };

    const tick = async () => {
      if (!data || !data.gamePublic || fetching || document.hidden || !root.isConnected) return;
      fetching = true;
      try {
        const d = await data.gamePublic();
        if (!d || !d.ok || !root.isConnected) return;
        if (slideshow) slideshow.preload(d.players || [], face);
        const shouldPlayMusic = musicPhases.has(d.phase);
        if (audio && shouldPlayMusic !== musicActive) {
          musicActive = shouldPlayMusic;
          if (musicActive) audio.play().catch(() => {});
          else audio.pause();
        }
        const next = JSON.stringify(displaySignature(d));
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
    tvFrameHtml,
    hostTvPreviewHtml,
    renderGuide,
    renderHowto,
    renderHub,
    stop: stopPoll,
    guideInnerHtml,
    howtoInnerHtml
  };
})(window);
