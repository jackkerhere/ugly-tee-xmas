(function (global) {
  "use strict";

  const guestScenes = new Set(["hit", "vote", "snowman", "gingerbread"]);
  const portraitSizes = "(min-width: 700px) 256px, 148px";
  const preloaded = new Set();
  let warmPortraits;

  function lastBeat(scene, reveal) {
    const count = scene.beatCount || (scene.kind === "gingerbread" ? 2 : 3);
    return reveal.beatIndex >= count - 1;
  }

  function render(snapshot, { face, escapeHtml }) {
    const reveal = snapshot?.reveal;
    if (snapshot?.phase !== "reveal" || !reveal) return "";

    const scene = reveal.current;
    const kicker = reveal.mode === "night" ? "Dawn in Concerto" : reveal.mode === "vote" ? "The town hall" : "";
    const slide = (kind, title, copy = "", name = "") => {
      const faceHtml = name ? face(name, { className: "is-tv-slide", sizes: portraitSizes }) : "";
      return `<section class="tv-slideshow" data-slide="${kind}" aria-live="polite" aria-atomic="true">
        ${faceHtml ? `<div class="tv-slide-portrait" aria-hidden="true">
          ${faceHtml}${kind === "ghost" ? '<span class="tv-slide-ghost"></span>' : ""}
        </div>` : ""}
        <div class="tv-slide-content">
          ${kicker ? `<p class="tv-slide-kicker">${kicker}</p>` : ""}
          ${title ? `<h2 class="tv-slide-title">${escapeHtml(title)}</h2>` : ""}
          ${copy ? `<p class="tv-slide-copy">${escapeHtml(copy)}</p>` : ""}
        </div>
      </section>`;
    };

    if (!scene) {
      return reveal.mode === "night" && !reveal.sceneCount ? slide("quiet", "Everyone survived the night.") : "";
    }

    const beat = scene.beats?.at(-1);
    const text = typeof beat === "string" ? beat : beat?.text;
    if (scene.kind === "clue") return slide("clue", "Ghost clue", text);
    if (scene.kind === "quiet" || scene.kind === "blizzard") {
      if (!lastBeat(scene, reveal)) return slide("suspense", "The village takes a breath.");
      return slide("quiet", "Everyone survived the night.");
    }

    if (guestScenes.has(scene.kind)) {
      const guest = (snapshot.players || []).find((player) => player.id === scene.targetId);
      const name = guest?.display_name;
      const subject = name || "A guest";
      if (lastBeat(scene, reveal)) {
        if (scene.outcome === "spared") return slide("quiet", "Spare everyone won. No one was voted out.");
        if (scene.outcome === "no_votes") return slide("quiet", "No votes were counted. No one was voted out.");
        if (scene.outcome === "tie") return slide("quiet", "No one was voted out.");
        if (scene.outcome === "out" || scene.outcome === "snowman") {
          return slide("ghost", subject + " became a ghost.", "", name);
        }
        if (scene.outcome === "saved") return slide("survived", subject + " survived.", "", name);
      }
      if (name && reveal.beatIndex > 0) return slide("portrait", name, "The village waits.", name);
      return slide("suspense", "The village takes a breath.");
    }

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

  global.ConcertoTvSlideshow = { render, preload };
})(window);
