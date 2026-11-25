(function (global) {
  "use strict";

  const guestScenes = new Set(["hit", "vote", "snowman", "gingerbread"]);
  const portraitSizes = "(min-width: 700px) 256px, 148px";
  const preloaded = new Set();
  const warmPhotos = new Set();
  let warmPortraits;

  const captions = {
    "portrait": [
      "[Name]. Please excuse the third photo corner.",
      "[Name]. The council will want that paperclip back.",
      "Here’s [Name]. We put the lamp on its usual setting.",
      "[Name]. We’ve gone with the good plastic sleeve.",
      "[Name]. The margin is exactly as wide as it looks.",
      "[Name]. We finally found the label maker.",
      "Here’s [Name]. That stand comes with the lunch special.",
      "[Name]. We saved the envelope for later.",
      "[Name]. The tape is holding. I can stop looking at it now.",
      "Here’s [Name]. That’s the flat side of the label."
    ],
    "survival": [
      "[Name] is still in. Keep the chair.",
      "[Name] is still in. The coffee order stands.",
      "[Name] is still in. I’ll leave that form where it is.",
      "[Name] is still in. The parking permit is valid for another day.",
      "[Name] is still in. You can keep the spare key.",
      "[Name] is still in. The pencil can have a break.",
      "[Name] is still in. The peg is doing most of the work.",
      "[Name] is still in. Your place at lunch is secure.",
      "[Name] is still in. We’ve renewed your loan.",
      "[Name] is still in. Put it on the timesheet."
    ],
    "bridge": [
      "Next card. I had enough paper for this.",
      "Here comes the next one. We practised that slide.",
      "One moment. There’s a bit of dust on the stand.",
      "On to the next name. I turned it from the clean corner.",
      "Next up. We borrowed this from the potluck table.",
      "And now the next name. Someone please catch the spool.",
      "Next card. The switch is mainly for me.",
      "Here’s the next one. The hinge has had a service.",
      "There’s another name. I left a blank line.",
      "On we go. I found a second coaster."
    ],
    "death": [
      "[Name] is out. We’ll keep the biscuit here.",
      "[Name] is out. The roster took it quite well.",
      "[Name] is out. I’m keeping the nameplate for the photo.",
      "[Name] is out. I’ve saved your page.",
      "[Name] is out. Straight into the folder marked OUT.",
      "[Name] is out. The casserole can stay.",
      "[Name] is out. I’ll move the chair over here.",
      "[Name] is out. Please leave the nice napkin.",
      "[Name] is out. Keep your half of the ticket.",
      "[Name] is out. I used the last staple for this."
    ],
    "tally": [
      "Here are the totals. The drawer took longer than the count.",
      "The votes are in. I only needed the middle button.",
      "Here are the totals. The calculator has fresh batteries.",
      "The count is ready. Please return the rubber band.",
      "Here are the totals. The bell still works.",
      "The tally is ready. I’ve squared the corners.",
      "Here are the figures. That’s where the clerk hangs the coat.",
      "Here are the totals. We used the good eraser.",
      "The results are at table one. It’s also the only table.",
      "The votes are counted. Please keep your receipt."
    ],
    "verdict": [
      "[Name] is out. Mind the wobbly step.",
      "[Name] is out. The handrail is also under review.",
      "[Name] is out. Thank you for wiping your feet.",
      "[Name] is out. This window is now closed.",
      "[Name] is out. The clerk finally pointed the right way.",
      "[Name] is out. The stool was for the clerk.",
      "[Name] is out. We just sharpened the chalk.",
      "[Name] is out. At least the aisle was clear.",
      "[Name] is out. We have to return those boards by Monday.",
      "[Name] is out. That’s the end of my cue card."
    ],
    "tie": [
      "It’s a tie. Everyone stays. The coats can come back off.",
      "It’s a tie. Everyone stays. I’d already folded the chairs.",
      "It’s a tie. Everyone stays. I’ve saved our page.",
      "It’s a tie. Everyone stays. The queue is for snacks now.",
      "It’s a tie. Everyone stays. We can take the same way back.",
      "It’s a tie. Everyone stays. Your parking is still valid.",
      "It’s a tie. Everyone stays. Please use both stair rails.",
      "It’s a tie. Everyone stays. I can carry this with one hand.",
      "It’s a tie. Everyone stays. Could someone take the signs?",
      "It’s a tie. Everyone stays. Leave the door on the latch."
    ],
    "blizzard": [
      "Snow everywhere. Kills and saves pause tonight. Lock in your choices as usual.",
      "The latch is shut. Kills and saves pause tonight. Lock in as usual.",
      "Put that bucket inside. Kills and saves pause tonight. Lock in as usual.",
      "The bus can wait. Kills and saves pause tonight. Lock in as usual.",
      "Mittens by the radiator. Kills and saves pause tonight. Lock in as usual.",
      "The printer agrees. Kills and saves pause tonight. Lock in as usual.",
      "The broom can stay there. Kills and saves pause tonight. Lock in as usual.",
      "Tea first. Kills and saves pause tonight. Lock in your choices as usual.",
      "That takes care of the draft. Kills and saves pause tonight. Lock in as usual.",
      "I’m putting down snow. Kills and saves pause tonight. Lock in as usual."
    ]
  };


  const powerStories = {
    naughty_list: ["Naughty List Leak", "The village printer has one more page.", "There’s a gold star beside one name.", "One villager is cleared as a suspect."],
    gift_swap: ["Gift Swap", "The clerk put the wrong tags on two envelopes.", "The envelopes have already changed hands.", "Two players’ ballots swap places."],
    hangover: ["Egg-nog Hangover", "Someone ordered the large egg-nog.", "The clerk sets out a glass of water.", "One player sits this vote out."],
    ugly_tee: ["Ugly Tee Audit", "The clerk admired the jumper twice.", "It’s going to need a second stamp.", "One player’s vote counts twice."],
    recount: ["Secret Recount", "The clerk has turned the ballot box upside down.", "Out comes a fresh stack of ballots.", "Previous votes are cleared. Vote again."]
  };

  const nightStories = [
    {
      art: "piano",
      title: "The last bus.",
      open: "Last night, someone left the bakery just in time to miss the bus. Well, almost.",
      identify: name => `It was ${name}. They stood under the bus stop awning. Then, from the flat upstairs, one piano key played. The piano started to tip…`,
      survive: name => `By breakfast, ${name} was back in the square. The piano’s doing less well.`,
      death: name => `And that’s where we cut to black. By morning, ${name} was dead.`
    },
    {
      art: "scarf",
      title: "Dawn breaks over Concerto.",
      open: "The baker opened up at first light. Out in the lane, someone had dropped a scarf.",
      identify: name => `It belonged to ${name}. The baker took it to the square and called out their name.`,
      survive: name => `${name} came to get it. Apparently they were quite warm without it.`,
      death: name => `Just after sunrise, the baker found a body down the lane. It was ${name}.`
    },
    {
      art: "wreath",
      title: "After closing.",
      open: "Someone was taking the shortcut home when the wreath over the arch started to move.",
      identify: name => `It was ${name}. The ribbon went tight. They looked up, just as the last streetlamp went out…`,
      survive: name => `${name} made it to breakfast. They’d like a different route home tomorrow.`,
      death: name => `We’ll leave the lane in the dark. At first light, ${name} was found dead.`
    },
    {
      art: "delivery",
      title: "The morning delivery.",
      open: "At dawn, the baker found a delivery sled in the square. Nobody had signed for it.",
      identify: name => `The tag had one name on it. ${name}. The baker went round the corner to look for them.`,
      survive: name => `There was ${name}, waiting at the counter. They’d been there long enough for two coffees.`,
      death: name => `That’s when the word came from across the square. ${name} was dead.`
    }
  ];

  const comicStories = [
    {
      theme: "bus",
      label: "The last bus",
      art: ["walk", "bus-wait", "shadow", "piano", "bus-dawn"],
      sounds: { 2: "SHFF", 3: "CLANG!" },
      cue: [
        "It was late. Someone took the long way home from the bakery and just caught sight of the last bus stop.",
        "It was [Name]. They ducked into the shelter and checked the timetable. It hadn’t been right all week.",
        "[Name] stopped. A shadow stretched across the snow. Then the street went quiet.",
        "One piano key sounded upstairs. The whole piano tipped over the edge…",
        "Cut to morning. The first bus rolled into Concerto. The village was waiting for news."
      ],
      titles: ["The last bus", "", "", "", "Dawn breaks over Concerto."],
      survive: "[Name] made it to breakfast. Save them a seat.",
      death: "By morning, the village had its answer. [Name] was dead."
    },
    {
      theme: "bakery",
      label: "The bakery awning",
      art: ["dawn-wide", "scarf", "eaves", "awning", "bakery-pause"],
      sounds: { 2: "CRRK", 3: "WHUMP!" },
      cue: [
        "The baker opened at first light. A scarf was lying in the lane.",
        "It belonged to [Name]. They’d stopped under the bakery awning on the way home.",
        "Someone moved back from the roof. A crack ran through the snow.",
        "The snow peeled off in one piece, right above the awning…",
        "At dawn the bell over the bakery door rang. Everyone in the square turned to look."
      ],
      titles: ["At the bakery", "", "", "", ""],
      survive: "There was [Name], back for their scarf.",
      death: "Just after sunrise, the baker found a body down the lane. It was [Name]."
    },
    {
      theme: "arch",
      label: "The oversized wreath",
      art: ["arch-wide", "arch", "ribbon", "wreath-tip", "arch-pause"],
      sounds: { 2: "TWANG!", 3: "WHIRR" },
      cue: [
        "After closing, someone took the shortcut through the old arch.",
        "It was [Name]. They passed under a wreath big enough to roll down Main Street.",
        "Someone tugged from the other side of the arch. The ribbon snapped tight.",
        "The wreath came loose and rolled after them like a great green wheel…",
        "The last streetlamp went out. We’ll pick this up at first light."
      ],
      titles: ["The shortcut", "", "", "", ""],
      survive: "[Name] turned up at breakfast. They’re taking the long way home from now on.",
      death: "At first light, the village heard the news. [Name] was dead."
    },
    {
      theme: "sled",
      label: "The runaway sled",
      art: ["sled-wide", "sled", "sled-load", "sled-tip", "sled-pause"],
      sounds: { 2: "CLICK", 3: "WHOOSH!" },
      cue: [
        "At first light, the baker found a delivery sled at the bottom of the hill.",
        "The tag had one name on it. [Name]. They’d been out late taking a delivery across the square.",
        "A shadow moved away from the sled. Its runners started to creep forward.",
        "Down it went, parcels flying. [Name] looked up at the turn…",
        "Back in the morning, the baker went round the corner to see who was there."
      ],
      titles: ["The delivery sled", "", "", "", ""],
      survive: "[Name] was already inside, having their second coffee.",
      death: "Word came from across the square. [Name] was dead."
    },
    ...(global.ConcertoAdditionalComics || [])
  ];

  function comicFor(night, scene) {
    // Public positions keep the host preview and the TV on the same story.
    return comicStories[(night * 19 + scene * 7) % comicStories.length];
  }

  function photoUrl(filename) {
    return global.ConcertoEmbeddedPhotos?.[filename] ||
      new URL("assets/tv/scenarios/" + filename, global.document.baseURI).href;
  }

  function illustratedNightStory(story, scene, reveal, name) {
    const beat = reveal.beatIndex;
    const panelCount = scene.beatCount;
    const say = line => line.replaceAll("[Name]", name || "the guest");
    if (beat < panelCount - 1) {
      const portrait = beat === (panelCount === 6 ? story.portraitBeat ?? 1 : 1);
      return {
        kind: portrait ? "story-portrait" : "story-shot",
        art: story.art?.[beat] || "photo",
        photo: story.id ? `${story.id}-${beat + 1}.webp` : "",
        title: portrait ? name || "A guest" : story.titles?.[beat] || (beat === 0 ? story.title : ""),
        name: portrait ? name : "",
        cue: say(story.cue[beat]),
        comic: beat + 1,
        theme: story.theme,
        sound: story.sounds?.[beat]
      };
    }
    if (!lastBeat(scene, reveal) || !name) return null;
    if (scene.outcome === "saved" && scene.santaSaved === true) {
      return {
        kind: "santa-save", art: "santa-rescue", title: name + " survived.",
        copy: "Saved by Santa.", cue: "At the last second, Santa swooped in and pulled " + name +
          " out of there.", name, comic: panelCount, theme: story.theme
      };
    }
    if (scene.outcome === "saved") {
      return { kind: "survived", art: "return", title: name + " survived.",
        cue: say(story.survive), name, comic: panelCount, theme: story.theme };
    }
    if (scene.outcome === "out") {
      return { kind: "ghost", art: "grave", title: name + " IS DEAD",
        cue: say(story.death), name, comic: panelCount, theme: story.theme };
    }
    return null;
  }

  function nightStory(snapshot, scene, reveal, name) {
    if (reveal.mode !== "night" || scene.kind !== "hit") return null;
    const night = Math.max(0, (Number(snapshot.nightNumber) || 1) - 1);
    const hit = Number(reveal.sceneIndex) || 0;
    if ([5, 6].includes(scene.beatCount)) {
      const story = scene.beatCount === 6 ? comicFor(night, hit)
        : comicStories[(night + hit) % nightStories.length];
      return illustratedNightStory(story, scene, reveal, name);
    }
    const story = nightStories[(night + hit) % nightStories.length];
    if (reveal.beatIndex === 0) {
      return { kind: "story-opening", art: story.art, title: story.title, cue: story.open };
    }
    if (!name) return null;
    if (!lastBeat(scene, reveal)) {
      return { kind: "story-portrait", art: story.art, title: name, cue: story.identify(name), name };
    }
    const dawnCut = story.art === "piano" || story.art === "wreath";
    if (scene.outcome === "saved") {
      return { kind: "survived", title: name + " survived.", cue: story.survive(name), name, dawnCut };
    }
    if (scene.outcome === "out") {
      return { kind: "ghost", title: name + " IS DEAD", cue: story.death(name), name, dawnCut };
    }
    return null;
  }

  function hostCue(snapshot) {
    if (snapshot?.phase === "reveal") {
      const reveal = snapshot.reveal;
      const scene = reveal?.current;
      if (!scene) return "";
      const name = (snapshot.players || []).find(player => player.id === scene.targetId)?.display_name;
      return nightStory(snapshot, scene, reveal, name)?.cue || "";
    }
    if (snapshot?.phase === "day") return "Time’s up. Pick a player on your phone, or spare everyone. Then lock in your vote.";
    if (snapshot?.phase === "night") return "Phones low. Open Night action, make your choice, and lock it in.";
    if (snapshot?.phase === "town_hall" ||
        (snapshot?.phase === "twist" && snapshot.reveal?.mode === "post_morning")) {
      return "Town Hall. You’ve got three and a half minutes. Let’s hear what people noticed.";
    }
    return "";
  }

  function lastBeat(scene, reveal) {
    const count = scene.beatCount || (scene.kind === "gingerbread" ? 2 : 3);
    return reveal.beatIndex >= count - 1;
  }

  function render(snapshot, { face, escapeHtml, announce = true }) {
    const reveal = snapshot?.reveal;
    if (snapshot?.phase !== "reveal" || !reveal) return "";

    const scene = reveal.current;
    const seed = (Number(snapshot.nightNumber) || 0) * 7
      + (Number(reveal.sceneIndex) || 0) * 3
      + (reveal.mode === "vote" ? 5 : 0)
      + (reveal.mode === "recount" ? 7 : 0);
    const line = (group, name = "") => {
      const choices = captions[group];
      const selection = choices[seed % choices.length];
      let joke = selection.replace(/^\[Name\] (?:survived|is out|is dead|is still in|made it)\.\s*/i, "")
        .replace(/^(?:Here are the totals|Here are the figures|The votes are in|The count is ready|The tally is ready|The results are in)\.\s*/i, "");
      if (group === "portrait") joke = joke.replace(/^(?:Here’s )?\[Name\]\.\s*/, "");
      if (group === "tie") joke = joke.replace(/^It’s a tie\.\s*/, "");
      if (group === "blizzard") joke = joke.split(" Kills and saves")[0];
      return joke.replaceAll("[Name]", name);
    };
    const slide = (kind, title, copy = "", name = "", extra = "", {
      art = "", photo = "", dawnCut = false, comic = null, sound = "", theme = ""
    } = {}) => {
      const faceHtml = name ? face(name, { className: "is-tv-slide", sizes: portraitSizes }) : "";
      const pianoMotion = art === "piano" && ["story-portrait", "story-shot"].includes(kind);
      const engraved = art === "grave" && kind === "ghost";
      const heading = engraved
        ? `<h2 class="tv-slide-title"><span>${escapeHtml(name)}</span> <strong>IS DEAD</strong></h2>`
        : title ? `<h2 class="tv-slide-title">${escapeHtml(title)}</h2>` : "";
      const imageUrl = photo && photoUrl(photo);
      const background = imageUrl ? ` style="${escapeHtml('--story-art: url("' + imageUrl + '")')}"` : "";
      return `<section class="tv-slideshow"${background} data-slide="${kind}"${art ? ` data-story="${art}"` : ""}${
        comic ? ` data-comic-panel="${comic}" data-comic-theme="${theme}"` : ""}${announce ? ' aria-live="polite" aria-atomic="true"' : ""}>
        ${pianoMotion ? '<div class="tv-story-piano-motion" aria-hidden="true"></div>' : ""}
        ${sound ? `<span class="tv-comic-sound" aria-hidden="true">${escapeHtml(sound)}</span>` : ""}
        ${faceHtml ? `<div class="tv-slide-portrait" aria-hidden="true">${faceHtml}</div>` : ""}
        <div class="tv-slide-content">
          ${heading}
          ${copy ? `<p class="tv-slide-copy">${escapeHtml(copy)}</p>` : ""}
          ${extra}
        </div>
        ${dawnCut && announce ? '<div class="tv-story-dawn-cut" aria-hidden="true">Dawn breaks over Concerto.</div>' : ""}
      </section>`;
    };
    const quiet = (title = "Everyone survived the night.") =>
      slide("quiet", title, "", "", "", { art: "quiet-dawn" });
    if (!scene) return reveal.mode === "night" && !reveal.sceneCount ? quiet() : "";

    const mode = reveal.mode;
    const guest = (snapshot.players || []).find((player) => player.id === scene.targetId);
    const name = guest?.display_name;
    const subject = name || "A guest";
    const final = lastBeat(scene, reveal);
    const opening = reveal.beatIndex === 0;

    if (["clue", "haunt", "ghost_haunt"].includes(scene.kind)) return "";
    if (scene.kind === "blizzard") {
      if (final) return quiet();
      return opening ? slide("blizzard", "Blizzard", line("blizzard"))
        : slide("blizzard", "The storm stopped attacks and saves.");
    }
    if (scene.kind === "quiet") {
      return final ? quiet() : quiet(opening ? "Dawn breaks over Concerto." : "The village takes a breath.");
    }

    const storyBeat = nightStory(snapshot, scene, reveal, name);
    if (storyBeat) {
      return slide(storyBeat.kind, storyBeat.title, storyBeat.copy || "", storyBeat.name, "", storyBeat);
    }

    if (guestScenes.has(scene.kind)) {
      const ballot = mode === "vote" && ["vote", "snowman"].includes(scene.kind);
      if (ballot && opening) {
        return slide("votes-in", "The votes are in.", "The clerk has counted every ballot.");
      }
      if (ballot && reveal.beatIndex === 1 && Array.isArray(scene.voteTally)) {
        const tally = scene.voteTally;
        const rows = tally.map(({ option, votes }) => {
          const count = Number(votes);
          return `<li><span>${escapeHtml(option)}</span><strong>${count}</strong></li>`;
        }).join("");
        const board = rows ? `<ul class="tv-vote-counts" aria-label="Votes per option">${rows}</ul>`
          : '<p class="tv-slide-effect">No votes were counted.</p>';
        return slide("tally", "Vote totals", line("tally"), "", board);
      }
      if (final) {
        if (scene.outcome === "spared") return slide("walkaway", "Spare everyone won.", "Everyone stays in.");
        if (scene.outcome === "no_votes") return slide("walkaway", "No votes were counted.", "Everyone stays in.");
        if (scene.outcome === "tie") return slide("walkaway", "It’s a tie.", line("tie"));
        if (scene.outcome === "out" || scene.outcome === "snowman") {
          if (ballot) return slide("verdict", subject + " is out.", line("verdict", subject), name);
          return slide("ghost", subject + " IS DEAD", line("death", subject), name);
        }
        if (scene.outcome === "saved") return slide("survived", subject + " survived.", line("survival", subject), name);
      }
      const portraitBeat = ballot && scene.beatCount >= 4 ? 2 : 1;
      if (ballot && !name && reveal.beatIndex >= portraitBeat) {
        return slide("suspense", "The clerk checks the count.");
      }
      if (name && reveal.beatIndex >= portraitBeat) return slide("portrait", name, line("portrait", name), name);
      return reveal.sceneIndex === 0
        ? slide("suspense", "Dawn breaks over Concerto.")
        : slide("suspense", "The village takes a breath.", line("bridge"));
    }

    if (scene.kind === "twist") {
      const story = powerStories[scene.outcome] || (mode === "recount" ? powerStories.recount : null);
      if (!story) return slide("power", "Meanwhile in Concerto…");
      const [title, setup, reaction, effect] = story;
      if (final && scene.outcome === "naughty_list" && name) {
        return slide("power", title, name + " is cleared.", name);
      }
      return slide("power", title, final ? effect : opening ? setup : reaction);
    }
    const beat = scene.beats?.at(-1);
    const text = typeof beat === "string" ? beat : beat?.text;
    return text ? slide("story", "", text) : "";
  }

  function preload(players, face) {
    for (const player of players || []) {
      const name = player.display_name || player.name;
      if (!name || preloaded.has(name)) continue;
      preloaded.add(name);

      const template = document.createElement("template");
      template.innerHTML = face(name, { className: "is-tv-slide", sizes: portraitSizes });
      const picture = template.content.querySelector("picture");
      if (!picture) continue;

      if (!warmPortraits) {
        warmPortraits = document.createElement("div");
        warmPortraits.hidden = true;
        document.body.append(warmPortraits);
      }
      warmPortraits.append(picture);
      const image = picture.querySelector("img");
      if (image?.decode) void image.decode().catch(() => {});
    }
  }

  function preloadComic(snapshot) {
    const reveal = snapshot.reveal;
    const opening = snapshot.phase === "night";
    if (!opening && (reveal?.mode !== "night" || reveal.current?.kind !== "hit" ||
        reveal.current.beatCount !== 6)) return;

    const night = Math.max(0, (Number(snapshot.nightNumber) || 1) - 1);
    const story = comicFor(night, opening ? 0 : Number(reveal.sceneIndex) || 0);
    if (!story.id) return;

    const first = opening ? 1 : Number(reveal.beatIndex) + 2;
    for (let panel = first; panel <= Math.min(5, first + 1); panel++) {
      const url = photoUrl(`${story.id}-${panel}.webp`);
      if (warmPhotos.has(url)) continue;
      warmPhotos.add(url);
      const image = new Image();
      image.fetchPriority = "low";
      image.src = url;
    }
  }

  function storyLabels() {
    return comicStories.map((_, night) => comicFor(night, 0).label);
  }

  global.ConcertoTvSlideshow = { render, preload, preloadComic, hostCue, storyLabels };
})(window);
