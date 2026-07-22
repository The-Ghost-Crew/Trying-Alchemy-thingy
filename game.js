(function () {
"use strict";
// Everything in this file used to be implicit globals — discovered,
// recipeList, universe, every render/save/load function — all directly
// reachable and rewritable from the browser console by name (e.g.
// `discovered.add("everything")` just worked). Wrapping the whole file in
// this closure removes that specific attack surface entirely: nothing in
// here exists outside this function unless explicitly attached to window,
// which nothing is. This does NOT hide the source (view-source still shows
// everything) — it stops the "one-line console paste" class of exploit,
// which was the actual highest-priority ask.

const STORAGE_KEY = "alchemy_discovered_elements";
const ORDER_STORAGE_KEY = "alchemy_discovery_order";
const TIMESTAMPS_KEY = "alchemy_discovery_timestamps";

// While a speedrun is active, ALL progress persistence (elements, order,
// timestamps, signature) silently redirects to a parallel set of keys —
// the normal save is never read or written mid-run, so ending a run
// restores it byte-identical. Anti-cheat runs unchanged on the speedrun
// data itself.
let speedrunActive = false;
function activeKey(base) {
    return speedrunActive ? "speedrun_" + base : base;
}

// ---------- Element icons ----------
//
// No manifest file, on purpose. A recipe needs a list because it encodes a
// relationship that can't be inferred from anywhere else — an icon doesn't,
// because the filename already IS the complete registration. Adding an
// icon is exactly one step: drop element-icons/<name>.svg into the repo,
// named like the element with spaces as hyphens. Nothing else to update,
// nothing to forget to sync.
const ELEMENT_ICON_DIR = "element-icons/";
const missingIcons = new Set(); // elements confirmed to have no icon this session — avoids re-requesting the same 404 on every re-render

function elementIconSlug(element) {
    // Case-preserving on purpose, as of the capitalization update: if
    // "earth" and "Earth" are meant to be visually distinguishable, their
    // icon files can't collide on the same lowercase name. A lowercase
    // element's icon stays exactly as documented before (all lowercase);
    // a NEW capitalized element needing its own art now needs a
    // capitalized filename to match — e.g. "Earth" -> Earth.svg,
    // deliberately separate from earth.svg.
    return element.trim().replace(/\s+/g, "-");
}

function elementIconPath(element) {
    // "nothing happens" is the one exception to both conventions below —
    // a JPEG instead of an SVG, underscore instead of a hyphen — matching
    // the actual file that exists for it, the only non-SVG icon in the set.
    if (element === NOTHING_HAPPENS) return `${ELEMENT_ICON_DIR}nothing_happens.jpeg`;

    // encodeURIComponent, not just the raw slug — "#" specifically is a
    // URL fragment delimiter, so element-icons/C#.svg would make the
    // browser request "element-icons/C" and treat ".svg" as a page
    // anchor, never actually asking the server for the real file at all.
    // This isn't specific to "#" either: "+", "(", ")", "%", "&", "/" all
    // have their own special meaning in a URL. encodeURIComponent handles
    // every one of them at once — the file on disk keeps its natural
    // name exactly matching the element; only the request URL changes.
    return `${ELEMENT_ICON_DIR}${encodeURIComponent(elementIconSlug(element))}.svg`;
}

// Returns an <img> if this element might have an icon, or null if it's
// already confirmed not to. Failure (404) is handled gracefully — the
// image just removes itself and the tile falls back to plain text, same
// as it looks today for every element without custom art yet.
function createElementIcon(element) {
    if (missingIcons.has(element)) return null;

    const img = document.createElement("img");
    img.src = elementIconPath(element);
    img.alt = "";
    img.className = "element-icon";
    img.loading = "lazy"; // only actually fetched once the tile scrolls into view — keeps a large discovered list from firing hundreds of requests at once on load
    img.onerror = () => {
        missingIcons.add(element);
        img.remove();
    };
    return img;
}

const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

// ---------- Colorology ----------
//
// A handful of elements happen to share a name with a real, named color —
// discovered completely independently, by averaging hex codes the same
// way this game averages ideas. When an element's name matches one of
// these (case-insensitively), its tile background becomes that color's
// actual hex instead of the normal panel color. Lowercased keys, since
// matching is always case-insensitive — "Water" and "water" are the same
// lookup.
const COLOROLOGY_COLORS = {
    "red": "#ff0000",
    "orange": "#ffa500",
    "yellow": "#ffff00",
    "green": "#00ff00",
    "blue": "#0000ff",
    "purple": "#800080",
    "white": "#ffffff",
    "black": "#000000",
    "grey": "#808080",
    "rose gold": "#b76e79",
    "brown": "#653700",
    "coral": "#ff7f50",
    "smoke": "#bfc8c3",
    "tide": "#beb4ab",
    "googol": "#41c379",
    "googolplex": "#93af3c",
    "emerald": "#028f1e",
    "beryl": "#71dcb8",
    "gold": "#ffd700",
    "plutonium": "#35fa00",
    "heartbreaker": "#cc76a3",
    "punch": "#dc4333",
    "coconut": "#965a3e",
    "water": "#d4f1f9",
    "fire": "#8f3f2a",
    "earth": "#a2653e",
    "ocean": "#005493",
    "maroon": "#800000",
    "free speech red": "#c00000",
    "mesopotamian dagger": "#804040",
    "spooky tangerine": "#ff6b00",
    "philippine orange": "#ff7300",
    "inferno orange": "#ff4400",
    "safety orange": "#ff6600",
    "redяum": "#ff2200",
    "boiling magma": "#ff3300",
    "lucky orange": "#ff7700",
    "burtuqali orange": "#ff6700",
    "phaser beam": "#ff4d00",
    "mystic red": "#ff5500",
    "furious red": "#ff1100",
    "ultimate orange": "#ff4200",
    "ferrari red": "#ff2800",
    "shining gold": "#ffd200",
    "sunset strip": "#ffbc00",
    "mandarin jelly": "#ff8800",
    "king nacho": "#ffb800",
    "amber": "#ffbf00",
    "sunflower mango": "#ffb700",
    "sun crete": "#ff8c00",
    "imperial yellow": "#ffb200",
    "nacho cheese": "#ffbb00",
    "selective yellow": "#ffba00",
    "yamabuki gold": "#ffa400",
    "middle yellow": "#ffeb00",
    "tweety": "#ffef00",
    "lemon": "#fff700",
    "dorn yellow": "#fff200",
    "citrus splash": "#ffc400",
    "lisbon lemon": "#fffb00",
    "sailor moon": "#ffee00",
    "teal": "#008080",
    "hulk": "#008000",
    "waystone green": "#00c000",
    "blue party parrot": "#8080ff",
    "navy blue": "#000080",
    "hello darkness my old friend": "#802280",
    "trendy pink": "#805d80",
    "violettuce": "#882055",
    "cupidity": "#406040",
    "brandy punch": "#c07c40",
    "tapestry red": "#c06960",
    "silver": "#c0c0c0",
    "lemon peel": "#ffed80",
    "vivid tangerine": "#ff9980",
    "apricot flower": "#ffbb80",
    "orchid orange": "#ffa180",
    "rich glow": "#ffe8a0",
    "rich black": "#004040",
    "spikey red": "#600000",
    "dried mustard": "#804a00",
    "calm cupid": "#c6b0b9",
    "sunken gold": "#b29700",
    "light relax": "#caddde",
    "sahara gravel": "#dfc08a",
    "sinag gold": "#ffd500",
    "yellow flash": "#ffca00",
    "sizzling sunrise": "#ffdb00",
    "electric glow": "#ffd100",
    "school bus": "#ffd800",
    "terrapin": "#807f4a",
    "orange rufous": "#c05200",
    "mahogany": "#c04000",
    "golden yellow": "#ffdf00",
    "cyber yellow": "#ffd400",
    "soviet gold": "#ffd900",
    "mandarin peel": "#ff9f00",
    "yellow tang": "#ffd300",
    "summer sun": "#ffdc00",
    "star": "#ffe500",
    "graham crust": "#806240",
    "spring fever": "#e5e3bf",
    "warmth of teamwork": "#803020",
    "sunny summer": "#ffc900",
    "usc gold": "#ffcc00",
    "wheel of dharma": "#ffcd00",
    "orange peel": "#ffa000",
    "super saiyan": "#ffdd00",
    "fluorescent orange": "#ffcf00",
    "demonic yellow": "#ffe700",
    "fresh squeezed": "#ffad00",
    "pico orange": "#ffa300",
    "heat wave": "#ff7a00",
    "barcelona orange": "#ff9500",
    "molten core": "#ff5800",
    "princeton orange": "#ff8f00",
    "tangerine": "#ff9300",
    "aerospace orange": "#ff4f00",
    "ginger": "#b06500",
    "coffee addiction": "#883300",
    "chrome yellow": "#ffa700",
    "cheese": "#ffa600",
    "yellow rose": "#fff000",
    "shade of amber": "#ff7e00",
    "vitamin c": "#ff9900",
    "ucla gold": "#ffb300",
    "american orange": "#ff8b00",
    "the new black": "#ff8400",
    "orange juice": "#ff7f00",
    "flash of orange": "#ffaa00",
    "carolling candlelight": "#ffb850",
    "lamplight": "#ffd140",
    "vivid orange": "#ff5f00",
    "cadmium yellow": "#fff600",
    "spiced cashews": "#d3b080",
    "red dit": "#ff4500",
    "coquelicot": "#ff3800",
    "maximum orange": "#ff5b00",
    "honey crisp": "#e9c160",
};

const COLOROLOGY_SEEN_KEY = "alchemy_colorology_seen";
const COLOROLOGY_DISABLED_KEY = "alchemy_colorology_disabled";
let colorologyDisabled = false; // colors ON by default — the whole point is that it's a surprise to find

function loadColorologyPrefs() {
    try {
        colorologyDisabled = localStorage.getItem(COLOROLOGY_DISABLED_KEY) === "true";
    } catch (e) { /* private browsing or similar — default stands */ }
}

function colorologyHex(element) {
    // Base elements are excluded on purpose: water, fire, and earth are
    // ALL real colorology matches, and they're three of the four things
    // every player starts with. Coloring them would mean the popup fires
    // the instant anyone opens the game, before they've combined
    // anything — the opposite of "notice this just happened."
    if (BASE_ELEMENTS.includes(element.toLowerCase())) return null;
    return COLOROLOGY_COLORS[element.toLowerCase()] || null;
}

function colorologySeen() {
    try { return localStorage.getItem(COLOROLOGY_SEEN_KEY) === "true"; }
    catch (e) { return false; }
}

function markColorologySeen() {
    try { localStorage.setItem(COLOROLOGY_SEEN_KEY, "true"); } catch (e) {}
}

function setColorologyDisabled(value) {
    colorologyDisabled = value;
    try { localStorage.setItem(COLOROLOGY_DISABLED_KEY, value ? "true" : "false"); } catch (e) {}
}

// Fires once, ever — the first time a player has (or discovers) any
// element whose name matches a real color. Checked both at load time
// (an existing save might already contain a match from before this
// feature existed) and at the moment of a brand new discovery.
function maybeShowColorologyPopup(elementName) {
    if (colorologyDisabled || colorologySeen()) return;
    if (!colorologyHex(elementName)) return;
    const popup = document.getElementById("colorology-popup");
    const body = document.getElementById("colorology-popup-body");
    if (!popup || !body) return;
    body.textContent = `Notice ${elementName}'s background just changed color? That's not random — it's colorology.`;
    popup.hidden = false;
}

function checkExistingDiscoveriesForColorology() {
    if (colorologyDisabled || colorologySeen()) return;
    for (const el of discovered) {
        if (colorologyHex(el)) {
            maybeShowColorologyPopup(el);
            return;
        }
    }
}


// A hardcoded, always-present "wildcard" element: any combo with no real
// recipe now discovers this instead of producing a dead end, and it
// absorbs anything it touches afterward (nothing happens + X = nothing
// happens, always). Reserved and enforced in combine() below regardless
// of what recipes.js might say — a real recipe accidentally using this
// name can never override the hardcoded behavior.
const NOTHING_HAPPENS = "nothing happens";

const discovered = new Set(BASE_ELEMENTS);
let discoveryOrder = [...BASE_ELEMENTS]; // oldest-first record of when each element was actually found
// Deliberately separate from discoveryOrder, not folded into it — order can
// be reconstructed after the fact by anyone reading the source; a genuine
// history of WHEN things happened, spread across real wall-clock time,
// can't be retroactively fabricated without either waiting that real time
// or writing something far more elaborate than a one-shot script. This is
// what a direct localStorage write can't produce for free.
let discoveryTimestamps = Object.fromEntries(BASE_ELEMENTS.map(el => [el, 0]));

const recipes = {};        // lookup: "a|b" -> result
const recipeList = [];     // full list: { a, b, result }
const universe = new Set(BASE_ELEMENTS);
const recipesByElement = new Map(); // element -> recipes it appears in as an ingredient (built once, not scanned each call)

// ---------- Shared animated loader ----------
// Same emblem as alchemy-logo.svg (center node + four base elements), minus
// the arced ring text — that used <textPath> ids, which would collide if
// this markup is ever inserted twice on the same page (page loader + graph
// loader can both be present). Rotation uses native SVG <animateTransform>
// rather than CSS, since it needs to rotate around an off-center pivot
// point (200,200) reliably across browsers.
function loaderSVG(size) {
    return `
<svg viewBox="0 0 400 400" width="${size}" height="${size}" role="img" aria-label="Loading">
  <circle cx="200" cy="200" r="150" fill="none" stroke="#c9a227" stroke-width="2"/>
  <circle cx="200" cy="200" r="143" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.5"/>
  <g>
    <animateTransform attributeName="transform" type="rotate" from="0 200 200" to="360 200 200" dur="9s" repeatCount="indefinite"/>
    <line x1="200" y1="200" x2="200" y2="140" stroke="#4a4f68" stroke-width="1.5"/>
    <line x1="200" y1="200" x2="256" y2="200" stroke="#4a4f68" stroke-width="1.5"/>
    <line x1="200" y1="200" x2="200" y2="260" stroke="#4a4f68" stroke-width="1.5"/>
    <line x1="200" y1="200" x2="144" y2="200" stroke="#4a4f68" stroke-width="1.5"/>
    <g transform="translate(200,120)">
      <circle r="20" fill="#14151f" stroke="#b5453f" stroke-width="2"/>
      <path d="M 0,-9 L 8,7 L -8,7 Z" fill="#b5453f"/>
    </g>
    <g transform="translate(276,200)">
      <circle r="20" fill="#14151f" stroke="#c9a227" stroke-width="2"/>
      <path d="M 0,-9 L 8,7 L -8,7 Z" fill="none" stroke="#c9a227" stroke-width="1.6"/>
      <line x1="-5" y1="2" x2="5" y2="2" stroke="#c9a227" stroke-width="1.6"/>
    </g>
    <g transform="translate(200,280)">
      <circle r="20" fill="#14151f" stroke="#5b8fb0" stroke-width="2"/>
      <path d="M 0,9 L 8,-7 L -8,-7 Z" fill="#5b8fb0"/>
    </g>
    <g transform="translate(124,200)">
      <circle r="20" fill="#14151f" stroke="#5c8c5a" stroke-width="2"/>
      <path d="M 0,9 L 8,-7 L -8,-7 Z" fill="none" stroke="#5c8c5a" stroke-width="1.6"/>
      <line x1="-5" y1="-2" x2="5" y2="-2" stroke="#5c8c5a" stroke-width="1.6"/>
    </g>
  </g>
  <circle cx="200" cy="200" r="7" fill="#ece3cc" stroke="#14151f" stroke-width="1.5"/>
</svg>`;
}

// ---------- Recipe loading / reloading ----------

let recipesLoadStatus = { ok: null, time: null, count: 0, error: null };

function resetRecipeData() {
    // A plain re-fetch only ever ADDS entries. If a recipe is ever removed
    // or renamed in recipes.js, an additive reload would leave the old,
    // now-fake entry behind forever. Clearing everything first makes a
    // reload an honest, exact mirror of whatever's currently in the file.
    Object.keys(recipes).forEach(k => delete recipes[k]);
    recipeList.length = 0;
    recipesByElement.clear();
    universe.clear();
    BASE_ELEMENTS.forEach(el => universe.add(el));
    universe.add(NOTHING_HAPPENS);
    conflictingRecipes.length = 0;
    speedTierData = null;   // tiers/step lengths recompute lazily against the fresh data
    srPreviewScope = null;
    srPreviewData = null;
    srDatalistKey = null;
}

let usedPrefetch = false;

async function loadRecipes({ forceFresh = false } = {}) {
    resetRecipeData();
    try {
        let code;
        if (!forceFresh && !usedPrefetch && window.__recipesPrefetch) {
            // Reuse the fetch that was already kicked off at the very top
            // of <head>, instead of starting a second one from scratch.
            usedPrefetch = true;
            code = await window.__recipesPrefetch;
        } else {
            const res = await fetch("recipes.js", { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            code = await res.text();
        }
        // recipes.js is just a long list of recipe("a","b","c") calls. It
        // used to run via indirect eval, which executes in global scope —
        // that only worked because recipe() used to be a global. Phase 1
        // made recipe() private along with everything else, which broke
        // this without anyone noticing until now. Passing recipe in as a
        // function PARAMETER instead means recipes.js's calls resolve to
        // this local argument, not a global lookup — recipe() stays fully
        // private, and recipes.js needs no changes at all.
        const runRecipes = new Function("recipe", code);
        runRecipes(recipe);
        recipesLoadStatus = { ok: true, time: new Date(), count: recipeList.length, error: null };
    } catch (e) {
        recipesLoadStatus = { ok: false, time: new Date(), count: recipeList.length, error: e.message };
        console.error("Could not load recipes.js:", e);
    }
}

// An element is reachable if it's a base element, or if some recipe
// producing it has BOTH ingredients already reachable. This is a fixpoint
// computation on purpose, not a one-hop check: an orphan's consumer is
// itself an orphan, and that thing's consumer is an orphan too, arbitrarily
// deep. A shallow "check its direct recipe" version would miss any of that.
function computeReachable() {
    const reachable = new Set([...BASE_ELEMENTS, NOTHING_HAPPENS]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const r of recipeList) {
            if (!reachable.has(r.result) && reachable.has(r.a) && reachable.has(r.b)) {
                reachable.add(r.result);
                changed = true;
            }
        }
    }
    return reachable;
}

function computeOrphanReport() {
    const reachable = computeReachable();
    const orphans = [];

    universe.forEach(el => {
        if (reachable.has(el)) return;

        const producingRecipes = recipeList.filter(r => r.result === el);
        let reason;
        if (producingRecipes.length === 0) {
            reason = "Never appears as the result of any recipe.";
        } else {
            const blockers = new Set();
            producingRecipes.forEach(r => {
                if (!reachable.has(r.a)) blockers.add(r.a);
                if (!reachable.has(r.b)) blockers.add(r.b);
            });
            const list = [...blockers].join(", ");
            reason = `Only makeable using ${list}, which ${blockers.size > 1 ? "are" : "is"} itself unreachable.`;
        }

        orphans.push({ element: el, reason });
    });

    return orphans.sort((a, b) => a.element.localeCompare(b.element));
}

function renderOrphanReport() {
    const container = document.getElementById("orphan-report");
    if (!container) return;
    container.innerHTML = "";

    const orphans = computeOrphanReport();

    if (orphans.length === 0) {
        const p = document.createElement("p");
        p.className = "tree-hint";
        p.textContent = "No orphans — every element traces back to air, water, earth, or fire.";
        container.appendChild(p);
        return;
    }

    const heading = document.createElement("p");
    heading.className = "tree-dead-note";
    heading.textContent = `${orphans.length} orphan element${orphans.length > 1 ? "s" : ""} — unreachable from the base elements:`;
    container.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "orphan-list";
    orphans.forEach(o => {
        const li = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = o.element;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(" — " + o.reason));
        list.appendChild(li);
    });
    container.appendChild(list);
}

// Since case became meaningful, the same conceptual element spelled two
// different ways (e.g. "corpse" in one recipe, "Corpse" in another) is no
// longer silently unified — it becomes two genuinely separate elements.
// Flagging every same-case-different-spelling pair was the wrong bar,
// though — "Earth" vs. "earth" both working perfectly as independent,
// fully functional elements IS the disambiguation feature working
// correctly, not a bug. The actual fingerprint of a typo is narrower: one
// spelling can never be produced by anything while the other spelling
// works fine. That asymmetry — not the mere existence of two spellings —
// is what actually indicates an accidental mismatch.
function computeCaseCollisions() {
    const reachable = computeReachable();
    const groups = new Map(); // lowercase form -> Set of actual-case variants seen

    universe.forEach(el => {
        const lower = el.toLowerCase();
        if (!groups.has(lower)) groups.set(lower, new Set());
        groups.get(lower).add(el);
    });

    const collisions = [];
    groups.forEach((variants, lower) => {
        if (variants.size <= 1) return;

        const variantList = [...variants].sort();
        const reachableVariants = variantList.filter(v => reachable.has(v));
        const unreachableVariants = variantList.filter(v => !reachable.has(v));

        // Only suspicious when there's a real split: at least one spelling
        // demonstrably works and at least one demonstrably doesn't. If
        // every variant is equally reachable (or equally unreachable),
        // that's not evidence of a typo — the unreachable-only case is
        // already covered by the orphan report anyway.
        if (reachableVariants.length > 0 && unreachableVariants.length > 0) {
            collisions.push({ lower, reachableVariants, unreachableVariants });
        }
    });

    return collisions.sort((a, b) => a.lower.localeCompare(b.lower));
}

function renderCaseCollisionReport() {
    const container = document.getElementById("case-collision-report");
    if (!container) return;
    container.innerHTML = "";

    const collisions = computeCaseCollisions();

    if (collisions.length === 0) {
        const p = document.createElement("p");
        p.className = "tree-hint";
        p.textContent = "No suspicious capitalization mismatches — case-based pairs that both work (like intentional disambiguation) aren't flagged.";
        container.appendChild(p);
        return;
    }

    const heading = document.createElement("p");
    heading.className = "tree-dead-note";
    heading.textContent = `${collisions.length} likely capitalization typo${collisions.length > 1 ? "s" : ""} — one spelling below can never actually be produced, which usually means it's an accidental mismatch rather than an intentional distinction:`;
    container.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "orphan-list";
    collisions.forEach(c => {
        const li = document.createElement("li");
        li.textContent = `${c.unreachableVariants.join(", ")} — unreachable; probably meant to match ${c.reachableVariants.join(" or ")}.`;
        list.appendChild(li);
    });
    container.appendChild(list);
}

function renderConflictingRecipesReport() {
    const container = document.getElementById("conflicting-recipes-report");
    if (!container) return;
    container.innerHTML = "";

    if (conflictingRecipes.length === 0) {
        const p = document.createElement("p");
        p.className = "tree-hint";
        p.textContent = "No wasted recipes — every combination that's defined more than once agrees on the result.";
        container.appendChild(p);
        return;
    }

    const heading = document.createElement("p");
    heading.className = "tree-dead-note";
    heading.textContent = `${conflictingRecipes.length} wasted recipe${conflictingRecipes.length > 1 ? "s" : ""} — the same two ingredients are defined more than once with a different result. Only the first ever actually fires, in whatever order recipes.js defines them:`;
    container.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "orphan-list";
    conflictingRecipes.forEach(c => {
        const li = document.createElement("li");
        li.textContent = `${c.a} + ${c.b} — makes "${c.keptResult}"; "${c.wastedResult}" is defined too but can never fire.`;
        list.appendChild(li);
    });
    container.appendChild(list);
}

function updateRecipesStatusDisplay() {
    const el = document.getElementById("recipes-status");
    if (!el || !recipesLoadStatus.time) return;

    const timeStr = recipesLoadStatus.time.toLocaleTimeString();

    if (recipesLoadStatus.ok) {
        el.textContent = `Loaded ${recipesLoadStatus.count} recipes, ${universe.size} total elements, at ${timeStr}.`;
        el.className = "tree-hint";
    } else {
        el.textContent = `Failed to load at ${timeStr}: ${recipesLoadStatus.error}. Check the console, or that recipes.js has no syntax errors.`;
        el.className = "tree-dead-note";
    }
}

async function reloadRecipes() {
    await loadRecipes({ forceFresh: true });
    updateProgressDisplays();
    render();
    treeDirty = true;
    setsDirty = true;
    graphLoadFailed = false;
    updateRecipesStatusDisplay();
    try {
        renderOrphanReport();
    } catch (e) {
        // A crash in here shouldn't be able to leave the rest of a reload
        // half-applied — the recipe count/status above has already updated
        // correctly by this point regardless of what happens next.
        console.error("Orphan report failed:", e);
    }
    try {
        renderCaseCollisionReport();
    } catch (e) {
        console.error("Case collision report failed:", e);
    }
    try {
        renderConflictingRecipesReport();
    } catch (e) {
        console.error("Conflicting recipes report failed:", e);
    }
}

function setupRecipeReload() {
    const btn = document.getElementById("reload-recipes-btn");
    btn?.addEventListener("click", () => reloadRecipes());
}

function indexRecipe(el, entry) {
    if (!recipesByElement.has(el)) recipesByElement.set(el, []);
    recipesByElement.get(el).push(entry);
}

const conflictingRecipes = []; // { a, b, keptResult, wastedResult } — same ingredient pair, two different results, only one can ever fire

function recipe(a, b, result) {
    const aTrimmed = a.trim();
    const bTrimmed = b.trim();
    const resultTrimmed = result.trim();

    // Case is now part of an element's identity, not stripped at the door —
    // "earth" and "Earth" are genuinely different elements, distinguished
    // exactly as written here. Only whitespace gets normalized.
    const key = [aTrimmed, bTrimmed].sort().join("|");

    if (recipes[key]) {
        // Previously this threw and killed every recipe() call after it in
        // the file — one duplicate during editing would silently truncate
        // the whole list. Now it just logs and skips that one line.
        console.warn(`Skipped duplicate combo "${aTrimmed} + ${bTrimmed}" — already makes "${recipes[key]}".`);

        // A genuinely wasted recipe: the same ingredient pair defined
        // twice with a DIFFERENT result. Only one can ever actually fire
        // (whichever was defined first), so the other is dead weight in
        // the file — worth surfacing somewhere more visible than a
        // console warning almost nobody will ever open.
        if (recipes[key] !== resultTrimmed) {
            conflictingRecipes.push({
                a: aTrimmed,
                b: bTrimmed,
                keptResult: recipes[key],
                wastedResult: resultTrimmed
            });
        }
        return;
    }

    recipes[key] = resultTrimmed;
    const entry = { a: aTrimmed, b: bTrimmed, result: resultTrimmed };
    recipeList.push(entry);

    indexRecipe(aTrimmed, entry);
    if (bTrimmed !== aTrimmed) indexRecipe(bTrimmed, entry);

    universe.add(aTrimmed);
    universe.add(bTrimmed);
    universe.add(resultTrimmed);
}

function combine(a, b) {
    // Absorbing rule, unconditional: touching nothing happens always
    // produces nothing happens, overriding any real recipe.js entry.
    if (a === NOTHING_HAPPENS || b === NOTHING_HAPPENS) return NOTHING_HAPPENS;
    const key = [a, b].sort().join("|");
    // Previously returned null here for "no recipe" — that's now the
    // fallback that discovers nothing happens instead of a dead end.
    return recipes[key] || NOTHING_HAPPENS;
}

// Was previously an O(recipeList.length) scan on every call. isExhausted()
// alone calls this multiple times per element per render, so at ~200
// recipes and ~150 discovered elements that added up to tens of thousands
// of redundant array scans per tap. Now it's a single Map lookup.
function recipesInvolving(el) {
    return recipesByElement.get(el) || [];
}

// An element is a dead end once EVERY recipe it appears in as an
// ingredient already leads to a result you've discovered — meaning it
// cannot possibly hand you anything new from here on, regardless of
// which partner element you eventually pick up. An element with zero
// recipes at all counts too (vacuously true), covering elements that
// were never combinable in the first place. This is discovery-dependent
// on purpose: an element can go from active to dead end the moment its
// last reachable output gets discovered, even by an unrelated combo.
function isExhausted(el) {
    if (!universe.has(el)) return false;
    const relevant = recipesInvolving(el);
    return relevant.every(r => discovered.has(r.result));
}

// Hint Mode: does this element have at least one combo you could make
// RIGHT NOW — both the other ingredient already in hand, and the result
// not yet found? By definition this can never be true for an exhausted
// element (that's what exhausted means), so no special-casing is needed
// to keep the two concepts from overlapping.
function hasActionableCombo(el) {
    return recipesInvolving(el).some(r => !discovered.has(r.result) && discovered.has(r.a) && discovered.has(r.b));
}

// ---------- Integrity / anti-cheat ----------
//
// Four independent checks, each calling recordStrike() when triggered.
// recordStrike() requires TWO DISTINCT check types to agree within a
// rolling window before the real penalty (wipe + timed lock) fires — a
// single check alone is only logged, never enough on its own. This is
// intentional: several loosely-related timing heuristics aren't actually
// independent evidence, they're the same signal measured multiple times,
// and a hair-trigger single detector risks nuking a legitimate player's
// save over a false positive. Requiring corroboration from a genuinely
// different kind of check is the actual safeguard here.
//
// None of this is presented as unbeatable — it isn't, and can't be, on a
// fully client-side static site. It raises the floor from "paste one
// console line" to "actually read and reverse engineer this file."

const SIGNATURE_KEY = "alchemy_save_signature";
const ANTICHEAT_KEY = "alchemy_anticheat_state";
const STRIKE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes — extended from 10, more room for strikes to age out harmlessly
const STRIKE_TYPES_REQUIRED = 2; // kept at 2 — raising this weakens protection against fabricated saves without addressing the actual source of false positives, which is the rate check specifically (loosened separately, below)
const PENALTY_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Not a real secret — it ships in this public file and can be extracted by
// anyone who reads it. This stops hand-editing localStorage JSON in the
// Application tab without reading the source; it does not stop someone who
// reads the source and computes a matching signature themselves. Said
// plainly here rather than implying otherwise.
const INTEGRITY_SALT = "alchemy-v3-integrity-9f2b";

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
}

function computeSignature(elementsArray) {
    return simpleHash([...elementsArray].sort().join(",") + INTEGRITY_SALT);
}

let reconciledUnknownElements = new Set(); // elements whose order was GUESSED, not recorded — see loadProgress()

function loadAnticheatState() {
    try {
        const saved = localStorage.getItem(ANTICHEAT_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.warn("Could not load anticheat state:", e);
    }
    return { strikes: [], penaltyUntil: null };
}

function saveAnticheatState(state) {
    try {
        localStorage.setItem(ANTICHEAT_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Could not save anticheat state:", e);
    }
}

function recordStrike(type, detail) {
    const state = loadAnticheatState();
    const now = Date.now();
    state.strikes = state.strikes || [];
    state.strikes.push({ type, detail, time: now });
    state.strikes = state.strikes.filter(s => now - s.time <= STRIKE_WINDOW_MS);

    // Deliberately vague: logging the exact type + detail here would hand
    // anyone poking around a free readout of exactly which check fired and
    // why, letting them iterate directly against it. A generic notice is
    // enough for a legitimate player to know something happened, without
    // handing over a debugging guide.
    console.warn("[integrity] A check flagged this session.");

    const distinctTypes = new Set(state.strikes.map(s => s.type));
    if (distinctTypes.size >= STRIKE_TYPES_REQUIRED) {
        applyPenalty(state);
    } else {
        saveAnticheatState(state);
    }
}

// Previously, an old strike only ever got cleaned up as a side effect of a
// NEW strike happening to trigger the filter in recordStrike() above. A
// single isolated flag with nothing after it was harmless either way (one
// strike alone never triggers anything), but it would sit in storage
// indefinitely rather than actually clearing. This runs it proactively —
// a long stretch of clean play now visibly, actively "redeems" any old
// flag instead of just leaving it inert.
function pruneExpiredStrikes() {
    const state = loadAnticheatState();
    if (!state.strikes || state.strikes.length === 0) return;

    const now = Date.now();
    const before = state.strikes.length;
    state.strikes = state.strikes.filter(s => now - s.time <= STRIKE_WINDOW_MS);

    if (state.strikes.length !== before) {
        saveAnticheatState(state);
    }
}

function applyPenalty(state) {
    resetProgress();
    const penaltyUntil = Date.now() + PENALTY_DURATION_MS;
    saveAnticheatState({ strikes: [], penalized: true, penaltyUntil, lastPenaltyTime: Date.now() });
    showPenaltyLock(penaltyUntil);
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

let isPenaltyLocked = false;

function playPenaltyJingle() {
    // A playful "wah wah wah waaaah" — the self-aware, universally
    // recognized "oops" sound. The actual penalty is the wipe and the
    // timer; this is meant to be funny, not another way to be mean about
    // it. playTone() already no-ops internally if sound is muted.
    // Gain boosted ~4x from the original 0.15/0.18 — still comfortably
    // under 1.0, so no clipping/distortion, just genuinely audible now.
    playTone(392.0, 0.35, 0, 0.6); // G4
    playTone(369.99, 0.35, 0.4, 0.6); // F#4
    playTone(349.23, 0.35, 0.8, 0.6); // F4
    playTone(329.63, 0.9, 1.2, 0.72); // E4 — held longer, the "waaaah"
}

function showPenaltyLock(penaltyUntil) {
    isPenaltyLocked = true;
    const loader = document.getElementById("page-loader");
    if (!loader) return;

    loader.classList.remove("hidden");
    // The spinning emblem was missing here entirely before — showPenaltyLock
    // was replacing the loader's whole innerHTML with just text, silently
    // dropping the animation that shows during normal loading. Included now.
    loader.innerHTML = `
      ${loaderSVG(140)}
      <p id="page-loader-text">Progress reset — integrity check failed</p>
      <p id="penalty-detail">Multiple independent checks flagged this save, so progress has been cleared. You can play again in <span id="penalty-countdown"></span>.</p>
    `;

    const tick = () => {
        const remaining = penaltyUntil - Date.now();
        const countdownEl = document.getElementById("penalty-countdown");
        if (!countdownEl) return;
        if (remaining <= 0) {
            clearInterval(interval);
            if (jingleInterval) clearInterval(jingleInterval);
            location.reload();
            return;
        }
        countdownEl.textContent = formatDuration(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);

    // Only set up the repeating interval at all if sound is actually on —
    // no point scheduling a no-op call every few seconds for an hour if
    // it's just going to silently do nothing each time.
    let jingleInterval = null;
    if (soundEnabled) {
        playPenaltyJingle();
        jingleInterval = setInterval(playPenaltyJingle, 4000);
    }
}

// Checks whether a discovered element could plausibly have been earned:
// does it have ANY valid recipe at all, and — for elements with genuinely
// tracked order — was at least one producing recipe's pair already known
// before this element was recorded? Elements from saves made before order
// tracking existed are exempted from the ordering half of this check,
// since their order was guessed at load time, not recorded — applying a
// strict check to guessed data would falsely flag long-time legitimate
// players on their first load under this system.
function validateDiscoveryPlausibility() {
    const orderIndex = new Map(discoveryOrder.map((el, i) => [el, i]));

    for (const el of discovered) {
        // The wildcard has no fixed defining recipe by design — ANY
        // undefined combo produces it, so "zero producers in recipeList"
        // is exactly what legitimate play looks like for this one
        // element, not a red flag.
        if (BASE_ELEMENTS.includes(el) || el === NOTHING_HAPPENS || !universe.has(el)) continue;

        const producers = recipeList.filter(r => r.result === el);
        if (producers.length === 0) {
            recordStrike("plausibility", `"${el}" has no valid recipe anywhere but is marked discovered.`);
            return;
        }

        if (reconciledUnknownElements.has(el)) continue; // no trustworthy order data to check

        const elIndex = orderIndex.has(el) ? orderIndex.get(el) : -1;
        if (elIndex === -1) continue;

        const hasValidOrder = producers.some(r => {
            const aIndex = orderIndex.has(r.a) ? orderIndex.get(r.a) : -1;
            const bIndex = orderIndex.has(r.b) ? orderIndex.get(r.b) : -1;
            return aIndex !== -1 && bIndex !== -1 && aIndex < elIndex && bIndex < elIndex;
        });

        if (!hasValidOrder) {
            recordStrike("plausibility", `"${el}" appears before any valid recipe for it could have fired.`);
            return;
        }
    }
}

// A patched Function.prototype.toString could lie about this too — a known
// limit, not a claim this is airtight. It still catches the common case of
// a script overriding a built-in without also covering its tracks.
const NATIVE_CHECK_TARGETS = [
    ["Date.now", Date.now],
    ["Array.prototype.push", Array.prototype.push],
    ["Set.prototype.add", Set.prototype.add],
    ["JSON.stringify", JSON.stringify]
];

function checkNativeFunctionsIntact() {
    for (const [name, fn] of NATIVE_CHECK_TARGETS) {
        let native = false;
        try {
            native = Function.prototype.toString.call(fn).includes("[native code]");
        } catch (e) {
            native = false;
        }
        if (!native) {
            recordStrike("tamper", `${name} no longer looks like native code — possibly monkey-patched.`);
            return;
        }
    }
}

// Genuine play necessarily produces a timestamp for every single
// discovery, one at a time, as it happens. A direct-write exploit that
// fabricates a large finished state in one shot has no reason to also
// fabricate a believable timestamp for every entry — and the given
// regression-test script didn't. A large bulk of discovered elements with
// no timestamp at all, not explained by the legacy-save exemption, is
// exactly the fingerprint of "this state was written, not played into
// existence." Threshold is deliberately generous (15) so a handful of
// genuinely ambiguous entries — a legacy save, a partial import — never
// causes a false flag on their own.
const UNTIMESTAMPED_BULK_THRESHOLD = 15;

function validateDiscoveryTiming() {
    let untimestampedCount = 0;

    for (const el of discovered) {
        if (BASE_ELEMENTS.includes(el)) continue;
        if (reconciledUnknownElements.has(el)) continue; // legacy exemption — see loadProgress()
        if (!(el in discoveryTimestamps)) untimestampedCount++;
    }

    if (untimestampedCount > UNTIMESTAMPED_BULK_THRESHOLD) {
        recordStrike("timing", `${untimestampedCount} discovered elements have no recorded timestamp at all.`);
    }
}

const recentComboTimestamps = [];
const COMBO_WINDOW_SIZE = 10; // raised from 6 — 10 full combos means 20 taps
const COMBO_WINDOW_MS = 900; // tightened from 1000 — together this requires ~45ms average per tap to trigger, well past fast-but-human territory

function recordComboTiming() {
    const now = performance.now();
    recentComboTimestamps.push(now);
    if (recentComboTimestamps.length > COMBO_WINDOW_SIZE) recentComboTimestamps.shift();

    if (recentComboTimestamps.length === COMBO_WINDOW_SIZE) {
        const span = recentComboTimestamps[recentComboTimestamps.length - 1] - recentComboTimestamps[0];
        if (span < COMBO_WINDOW_MS) {
            recordStrike("rate", `${COMBO_WINDOW_SIZE} combo attempts completed in ${Math.round(span)}ms.`);
        }
    }
}

function saveProgress() {
    try {
        const elementsArr = [...discovered];
        localStorage.setItem(activeKey(STORAGE_KEY), JSON.stringify(elementsArr));
        localStorage.setItem(activeKey(SIGNATURE_KEY), computeSignature(elementsArr));
        localStorage.setItem(activeKey(ORDER_STORAGE_KEY), JSON.stringify(discoveryOrder));
        localStorage.setItem(activeKey(TIMESTAMPS_KEY), JSON.stringify(discoveryTimestamps));
    } catch (e) {
        console.warn("Could not save progress:", e);
    }
}

// Threshold shared in spirit with UNTIMESTAMPED_BULK_THRESHOLD: a SMALL
// number of elements with no recorded order is the expected, harmless
// shape of a genuine pre-existing save upgrading to a newer version of
// this feature. A LARGE fraction of the save falling into that same
// "unknown, exempt from strict checks" bucket is no longer a small legacy
// gap — it's the entire save being suspiciously untracked, which is
// itself exactly the shape a fabricated save takes if it simply leaves
// discoveryOrder sparse to dodge the plausibility/timing checks below.
// That dodge is now evidence in its own right, not a free pass.
const SPARSE_HISTORY_BULK_THRESHOLD = 15;

function loadProgress() {
    let loadedElements = null;

    try {
        const saved = localStorage.getItem(activeKey(STORAGE_KEY));
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                loadedElements = parsed.filter(el => typeof el === "string");
            }
        }
    } catch (e) {
        console.warn("Could not load saved progress:", e);
    }

    if (loadedElements) {
        const storedSignature = localStorage.getItem(activeKey(SIGNATURE_KEY));
        const expectedSignature = computeSignature(loadedElements);

        // A MISSING signature used to be silently trusted, as a
        // backward-compatibility path for saves made before this system
        // existed. That silent trust was exactly the hole a direct
        // localStorage write walked through, since it never bothered to
        // set one at all. Now any mismatch — missing or wrong — records a
        // strike. The data is still granted provisionally either way;
        // whether this becomes the real penalty is decided by
        // corroboration with the other independent checks below, not by
        // this one signal alone. This does mean every existing legitimate
        // save gets exactly one harmless "signature" strike on its very
        // first load under this version — saveProgress() is called again
        // at the end of this function specifically to heal that
        // immediately, so it can never accumulate or repeat.
        if (storedSignature !== expectedSignature) {
            recordStrike(
                "signature",
                storedSignature === null
                    ? "No signature found for saved elements."
                    : "Saved elements did not match their stored signature."
            );
        }
        loadedElements.forEach(el => discovered.add(el));
    }

    try {
        const savedOrder = localStorage.getItem(activeKey(ORDER_STORAGE_KEY));
        if (savedOrder) {
            const parsedOrder = JSON.parse(savedOrder);
            if (Array.isArray(parsedOrder)) {
                discoveryOrder = parsedOrder.filter(el => typeof el === "string");
            }
        }
    } catch (e) {
        console.warn("Could not load discovery order:", e);
    }

    try {
        const savedTimestamps = localStorage.getItem(activeKey(TIMESTAMPS_KEY));
        if (savedTimestamps) {
            const parsedTimestamps = JSON.parse(savedTimestamps);
            if (parsedTimestamps && typeof parsedTimestamps === "object" && !Array.isArray(parsedTimestamps)) {
                discoveryTimestamps = parsedTimestamps;
            }
        }
    } catch (e) {
        console.warn("Could not load discovery timestamps:", e);
    }

    // Anything discovered but missing from the order list — saves made
    // before this feature existed, or added some other way — is treated
    // as the OLDEST possible entry, per the explicit rule that ambiguous
    // elements should sink to the bottom of "Recent" sort, not land
    // somewhere arbitrary in the middle. Tracked separately here because
    // validateDiscoveryPlausibility() and validateDiscoveryTiming() must
    // NOT apply strict checks to elements whose order/timing was only
    // ever guessed.
    const known = new Set(discoveryOrder);
    const unknownFirst = [...discovered].filter(el => !known.has(el));
    reconciledUnknownElements = new Set(unknownFirst);
    discoveryOrder = [...unknownFirst, ...discoveryOrder];

    if (unknownFirst.length > SPARSE_HISTORY_BULK_THRESHOLD) {
        recordStrike(
            "plausibility",
            `${unknownFirst.length} discovered elements have no order history at all — too large to be an ordinary legacy gap.`
        );
    }

    // Self-heal: whatever's now in memory gets a fresh, currently-valid
    // signature and a complete timestamp/order record immediately, rather
    // than waiting for the player's next discovery. A legitimate old save
    // only ever sees this exactly once.
    saveProgress();
}

function resetProgress() {
    discovered.clear();
    BASE_ELEMENTS.forEach(el => discovered.add(el));
    discoveryOrder = [...BASE_ELEMENTS];
    discoveryTimestamps = Object.fromEntries(BASE_ELEMENTS.map(el => [el, 0]));
    reconciledUnknownElements = new Set();
    first = null;
    lastDiscovered = null;
    if (lastDiscoveredTimer) {
        clearTimeout(lastDiscoveredTimer);
        lastDiscoveredTimer = null;
    }
    try {
        localStorage.removeItem(activeKey(STORAGE_KEY));
        localStorage.removeItem(activeKey(SIGNATURE_KEY));
        localStorage.removeItem(activeKey(ORDER_STORAGE_KEY));
        localStorage.removeItem(activeKey(TIMESTAMPS_KEY));
    } catch (e) {
        console.warn("Could not clear saved progress:", e);
    }
}

function validDiscoveredCount() {
    let count = 0;
    discovered.forEach(el => { if (universe.has(el)) count++; });
    return count;
}

function deadEndDiscoveredCount() {
    let count = 0;
    discovered.forEach(el => { if (isExhausted(el)) count++; });
    return count;
}

// ---------- Sound ----------

const SOUND_STORAGE_KEY = "alchemy_sound_enabled";
let soundEnabled = true;
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    return audioCtx;
}

function playTone(freq, duration, delay, gainValue) {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = gainValue;

        osc.connect(gain);
        gain.connect(ctx.destination);

        const startTime = ctx.currentTime + delay;
        osc.start(startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        osc.stop(startTime + duration + 0.02);
    } catch (e) {
        console.warn("Sound playback failed:", e);
    }
}

// ---------- Background music ----------
//
// A separate tone scheduler from playTone() above, on purpose. playTone()
// is tuned for short percussive SFX (discovery chime, penalty jingle) —
// instant attack, quick decay. Sustained musical notes want a soft linear
// attack before that same exponential decay, so this gets its own
// function rather than overloading playTone() for two different jobs.
function playMusicTone(freq, start, duration, type, volume) {
    if (!soundEnabled || !musicEnabled) return;
    try {
        const ctx = getAudioCtx();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration + 0.05);
    } catch (e) {
        console.warn("Music playback failed:", e);
    }
}

// D3 + A3 is an open fifth — the same interval a hurdy-gurdy or bagpipe
// drone uses, which is exactly why it reads as "archaic" rather than just
// "quiet background hum." Kept from the original test, since it was
// already the right instinct. The whole melody sits in D Dorian, not a
// plain minor scale — Dorian's natural (not flattened) 6th is what gives
// modal/medieval-sounding music its particular character, and it's the
// difference between "old" and merely "sad."
//
// Phrase B previously started at t=16.0 while phrase A's last note ended
// around t=9.5 — a genuine 6.5s dead zone with nothing but the quiet drone
// underneath, which is exactly the "silence" being heard. Phrase B is
// shifted 6s earlier here, right after phrase A settles, closing that gap
// instead of just turning something up to mask it.
const AMBIENT_LOOP_DURATION_MS = 23500; // matches the tightened ~22.85s of content, small clean tail before looping

let musicVolume = 1.0; // multiplier applied to every note below, controlled by the volume slider

function playAmbientLoop() {
    if (!musicEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.1;
    const v = gain => gain * musicVolume;

    // Drone: open fifth (D-A) under phrase A, shifting to an open fourth
    // (D-G) under phrase B — one small harmonic movement across the loop,
    // rather than one static chord droning the whole time.
    playMusicTone(146.83, now, 10, "sine", v(0.05)); // D3
    playMusicTone(220.0, now, 10, "triangle", v(0.03)); // A3
    playMusicTone(146.83, now + 10, 14, "sine", v(0.05)); // D3
    playMusicTone(196.0, now + 10, 14, "triangle", v(0.03)); // G3

    // Phrase A — the original contemplative stepwise line. Left musically
    // intact, since it's specifically what already sounded right.
    const phraseA = [
        { n: 293.66, t: 0.0, l: 0.9 }, // D4
        { n: 349.23, t: 1.1, l: 0.7 }, // F4
        { n: 392.0, t: 2.2, l: 1.0 }, // G4
        { n: 440.0, t: 3.5, l: 0.8 }, // A4
        { n: 392.0, t: 4.7, l: 0.9 }, // G4
        { n: 349.23, t: 5.8, l: 0.9 }, // F4
        { n: 329.63, t: 7.0, l: 0.8 }, // E4
        { n: 293.66, t: 8.1, l: 1.4 } // D4 — settles
    ];

    // Phrase B — starts at t=10.0 now (a natural half-second breath after
    // phrase A, not a 6.5s void). Rises past phrase A's range, uses
    // Dorian's natural 6th (B) and 7th (C) on the way up, peaks on D5,
    // then descends back to the tonic.
    const phraseB = [
        { n: 440.0, t: 10.0, l: 0.8 }, // A4
        { n: 493.88, t: 11.2, l: 0.7 }, // B4 — Dorian 6th
        { n: 523.25, t: 12.3, l: 0.9 }, // C5
        { n: 587.33, t: 13.6, l: 1.0 }, // D5 — peak of the whole phrase
        { n: 523.25, t: 15.0, l: 0.8 }, // C5
        { n: 493.88, t: 16.1, l: 0.8 }, // B4
        { n: 440.0, t: 17.2, l: 0.8 }, // A4
        { n: 392.0, t: 18.4, l: 0.8 }, // G4
        { n: 349.23, t: 19.6, l: 0.9 }, // F4
        { n: 293.66, t: 20.9, l: 1.8 } // D4 — resolves home, held longest
    ];

    phraseA.forEach(note => playMusicTone(note.n, now + note.t, note.l, "triangle", v(0.045)));
    phraseB.forEach(note => playMusicTone(note.n, now + note.t, note.l, "triangle", v(0.045)));

    // Sparse high shimmer — different register and timbre from the main
    // melody, meant to read as a faint magical glint rather than add to
    // the melodic line itself.
    playMusicTone(587.33, now + 8.3, 0.5, "sine", v(0.02)); // D5, as phrase A settles
    playMusicTone(880.0, now + 13.8, 0.4, "sine", v(0.018)); // A5, at phrase B's peak
}

const MUSIC_STORAGE_KEY = "alchemy_music_enabled";
const MUSIC_VOLUME_KEY = "alchemy_music_volume";
let musicEnabled = true; // on by default — "can be disabled" implies opt-out, not opt-in
let musicLoopInterval = null;

function loadMusicPreference() {
    try {
        const saved = localStorage.getItem(MUSIC_STORAGE_KEY);
        if (saved !== null) musicEnabled = saved === "true";
    } catch (e) {
        console.warn("Could not load music preference:", e);
    }
    try {
        const savedVolume = localStorage.getItem(MUSIC_VOLUME_KEY);
        if (savedVolume !== null) {
            const parsed = parseFloat(savedVolume);
            if (!Number.isNaN(parsed)) musicVolume = Math.min(1, Math.max(0, parsed));
        }
    } catch (e) {
        console.warn("Could not load music volume:", e);
    }
}

// Real bug, not a tuning issue: ctx.resume() is asynchronous, and
// ctx.currentTime does not advance while a context is suspended. The
// previous version fired resume() and immediately scheduled notes against
// ctx.currentTime in the same synchronous tick, before resume() had
// actually completed — scheduling everything against a stale, frozen time
// reference. Awaiting it first, exactly like the working reference script
// did, is the actual fix.
let musicStartInFlight = false; // closes a real race: the old check-then-await-then-set pattern left a window where rapid toggling could start multiple independent loops

async function startMusic() {
    if (musicLoopInterval || musicStartInFlight) return; // already running, or another start is already in progress
    musicStartInFlight = true;
    try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === "suspended") {
            try {
                await ctx.resume();
            } catch (e) {
                console.warn("Could not resume audio context:", e);
                return;
            }
        }
        // Re-checked here on purpose: if the player toggled music off while
        // this was waiting on the context to resume, honor that instead of
        // starting anyway.
        if (!musicEnabled) return;
        playAmbientLoop();
        musicLoopInterval = setInterval(playAmbientLoop, AMBIENT_LOOP_DURATION_MS);
    } finally {
        musicStartInFlight = false;
    }
}

function stopMusic() {
    if (musicLoopInterval) {
        clearInterval(musicLoopInterval);
        musicLoopInterval = null;
    }
    // Notes already scheduled within the current ~23.5s loop will still play
    // out to completion — Web Audio scheduling can't retroactively cancel
    // oscillators once started. This only stops the NEXT loop from
    // starting. Worth knowing if instant cutoff ever matters more than a
    // clean fade-out does.
}

// Browsers won't play audio until a real user gesture happens on the
// page — this listens for the very first one, page-wide, and starts music
// then if it's enabled. Matches the pattern already proven to work in
// testing, rather than hoping ctx.resume() opportunistically succeeds on
// its own near page load.
function armFirstInteractionMusicStart() {
    const tryStart = () => {
        if (musicEnabled) startMusic();
        document.removeEventListener("click", tryStart);
        document.removeEventListener("touchstart", tryStart);
    };
    document.addEventListener("click", tryStart, { once: true });
    document.addEventListener("touchstart", tryStart, { once: true });
}

function updateMusicToggleLabel() {
    const btn = document.getElementById("music-toggle");
    if (!btn) return;
    btn.textContent = musicEnabled ? "Music: On" : "Music: Off";
    btn.classList.toggle("muted", !musicEnabled);
}

function setupMusicToggle() {
    const btn = document.getElementById("music-toggle");
    if (!btn) return;

    updateMusicToggleLabel();

    btn.addEventListener("click", () => {
        musicEnabled = !musicEnabled;
        try {
            localStorage.setItem(MUSIC_STORAGE_KEY, String(musicEnabled));
        } catch (e) {
            console.warn("Could not save music preference:", e);
        }
        updateMusicToggleLabel();
        if (musicEnabled) startMusic();
        else stopMusic();

        // Simple UI-level guard alongside the deeper fix in startMusic()
        // itself — stops literal rapid double-taps from firing two click
        // events before the first one's even been processed.
        btn.disabled = true;
        setTimeout(() => {
            btn.disabled = false;
        }, 250);
    });
}

function setupMusicVolumeSlider() {
    const slider = document.getElementById("music-volume");
    const label = document.getElementById("music-volume-label");
    if (!slider) return;

    slider.value = Math.round(musicVolume * 100);
    if (label) label.textContent = `${slider.value}%`;

    // Live-updates the multiplier used by the NEXT scheduled loop. Already
    // in-flight notes from the current loop keep whatever volume they were
    // scheduled with — same reasoning as stopMusic() not cutting off notes
    // already committed to the audio graph.
    slider.addEventListener("input", () => {
        musicVolume = Number(slider.value) / 100;
        if (label) label.textContent = `${slider.value}%`;
        try {
            localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
        } catch (e) {
            console.warn("Could not save music volume:", e);
        }
    });
}

function playDiscoverySound() {
    playTone(523.25, 0.12, 0, 0.18);    // C5
    playTone(783.99, 0.16, 0.09, 0.18); // G5
}

function playNothingSound() {
    playTone(196, 0.18, 0, 0.12); // low dull note
}

function loadSoundPreference() {
    try {
        const saved = localStorage.getItem(SOUND_STORAGE_KEY);
        if (saved !== null) soundEnabled = saved === "true";
    } catch (e) {
        console.warn("Could not load sound preference:", e);
    }
}

function setupSoundToggle() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;

    const updateLabel = () => {
        btn.textContent = soundEnabled ? "Sound: On" : "Sound: Off";
        btn.classList.toggle("muted", !soundEnabled);
    };
    updateLabel();

    btn.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        try {
            localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
        } catch (e) {
            console.warn("Could not save sound preference:", e);
        }
        updateLabel();

        if (soundEnabled) {
            // Turning the master switch on is meant to be the one action
            // that brings everything back, music included, rather than
            // needing a second separate toggle for the common "just turn
            // it all on" case.
            if (!musicEnabled) {
                musicEnabled = true;
                try {
                    localStorage.setItem(MUSIC_STORAGE_KEY, "true");
                } catch (e) {
                    console.warn("Could not save music preference:", e);
                }
                updateMusicToggleLabel();
            }
            startMusic();
            playDiscoverySound(); // quick confirmation blip
        } else {
            stopMusic();
        }
    });
}

let first = null;
let lastDiscovered = null;
let lastDiscoveredTimer = null;

function markJustDiscovered(element) {
    lastDiscovered = element;
    if (lastDiscoveredTimer) clearTimeout(lastDiscoveredTimer);
    // Without this, lastDiscovered stays set forever, and since render()
    // rebuilds every tile from scratch (even just from typing in search),
    // that same tile would replay its "just found" flash animation on
    // every single re-render, not just once.
    lastDiscoveredTimer = setTimeout(() => {
        lastDiscovered = null;
        lastDiscoveredTimer = null;
        render();
    }, 2000);
}

function updateProgressDisplays() {
    const count = validDiscoveredCount();
    let total = universe.size;
    if (speedrunActive && speedrunConfig && Array.isArray(speedrunConfig.scope)) total = speedrunConfig.scope.length;
    const deadEnds = deadEndDiscoveredCount();
    const complete = count >= total && total > 0;

    const targetedRun = speedrunActive && speedrunConfig && speedrunConfig.mode === "target";
    document.querySelectorAll(".progress-fraction").forEach(
        n => (n.textContent = targetedRun ? speedrunConfig.target : `${count} / ${total}`)
    );
    document.querySelectorAll(".dead-end-count").forEach(
        n => (n.textContent = `${deadEnds} dead end${deadEnds === 1 ? "" : "s"} found`)
    );

    const seal = document.getElementById("progress-seal");
    if (seal) seal.classList.toggle("complete", complete);

    const banner = document.getElementById("complete-banner");
    if (banner) banner.hidden = !complete;
}

// ---------- Elements tab ----------

function makeElementTile(element) {
    const button = document.createElement("button");
    button.className = "element-tile";
    button.setAttribute("aria-pressed", element === first ? "true" : "false");
    if (element === first) button.classList.add("selected");
    if (isExhausted(element)) button.classList.add("dead-end");
    if (hintModeEnabled && hasActionableCombo(element)) button.classList.add("hintable");
    if (greenHintPair && greenHintPair.includes(element)) button.classList.add("hint-pair");
    if (element === lastDiscovered) button.classList.add("just-found");
    if (element === NOTHING_HAPPENS) button.classList.add("nothing-happens-tile");

    if (!colorologyDisabled) {
        const hex = colorologyHex(element);
        if (hex) {
            button.classList.add("colorology-tile");
            button.style.background = hex;
            // Standard perceived-luminance check — picks readable text
            // for whichever color happens to land here, since these are
            // real color hexes, not something tuned for this palette.
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
            button.style.color = luminance > 150 ? "#14151f" : "#f4f1e8";
            button.style.borderColor = luminance > 150 ? "rgba(20,21,31,0.35)" : "rgba(244,241,232,0.35)";
        }
    }

    const icon = createElementIcon(element);
    if (icon) button.appendChild(icon);
    button.title = element; // full name always available, even when the visible label is truncated
    const label = document.createElement("span");
    label.className = "tile-label";
    label.textContent = element;
    button.appendChild(label);

    button.onclick = () => {
        // The run's clock starts on the player's first actual interaction,
        // not on the Start button — pressing Start then walking away for
        // a minute shouldn't count against the time.
        if (speedrunActive && speedrunRun && !speedrunRun.startedAt && !speedrunRun.finished) {
            speedrunRun.startedAt = Date.now();
            persistSpeedrunState();
            startSpeedrunTimerInterval();
        }

        if (first === null) {
            first = element;
            render();
            return;
        }

        const chosenFirst = first;
        let result = combine(chosenFirst, element);

        // Premature-run scoping: a recipe whose result the player never
        // unlocked in normal play doesn't exist for this run — the combo
        // just fizzles, exactly like an undefined one.
        if (speedrunActive && speedrunScopeSet && result && !speedrunScopeSet.has(result)) {
            result = null;
        }
        recordComboTiming();
        resetHintIdleTimer(); // "nothing has been combined" — this IS a combine attempt, whether it succeeds or not

        const resultEl = document.getElementById("result");
        const isNothingSelfCombo = chosenFirst === NOTHING_HAPPENS && element === NOTHING_HAPPENS;
        resultEl.textContent = isNothingSelfCombo
            ? "Something happened, you just don't know what?"
            : result
                ? `${chosenFirst} + ${element} = ${result}`
                : `${chosenFirst} + ${element} = nothing happens`;

        resultEl.classList.remove("flash");
        void resultEl.offsetWidth; // restart the animation even for repeat results
        resultEl.classList.add("flash");

        if (result && !discovered.has(result)) {
            discovered.add(result);
            discoveryOrder.push(result);
            discoveryTimestamps[result] = Date.now();
            markJustDiscovered(result);
            saveProgress();
            treeDirty = true; // rebuilt lazily next time the Family Tree tab is opened
            setsDirty = true;
            graphLoadFailed = false;
            playDiscoverySound();
            speedrunOnDiscovery();
            maybeShowColorologyPopup(result);
        } else if (!result) {
            playNothingSound();
        }

        first = null;
        updateProgressDisplays();
        render();
    };

    return button;
}

const DEADEND_COLLAPSE_KEY = "alchemy_deadend_collapsed";
let deadEndCollapsed = true; // default collapsed — dead ends can outnumber active elements fast

function loadDeadEndCollapsePreference() {
    try {
        const saved = localStorage.getItem(DEADEND_COLLAPSE_KEY);
        if (saved !== null) deadEndCollapsed = saved === "true";
    } catch (e) {
        console.warn("Could not load dead-end section preference:", e);
    }
}

function applyDeadEndCollapse() {
    document.querySelectorAll(".dead-end-toggle-target").forEach(box => {
        box.hidden = deadEndCollapsed;
    });
    document.querySelectorAll(".dead-end-toggle-btn").forEach(btn => {
        btn.classList.toggle("collapsed", deadEndCollapsed);
    });
}

function setupDeadEndToggle() {
    document.querySelectorAll(".dead-end-toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            deadEndCollapsed = !deadEndCollapsed;
            try {
                localStorage.setItem(DEADEND_COLLAPSE_KEY, String(deadEndCollapsed));
            } catch (e) {
                console.warn("Could not save dead-end section preference:", e);
            }
            applyDeadEndCollapse();
        });
    });
    applyDeadEndCollapse();
}

const SORT_MODE_KEY = "alchemy_sort_mode";
let sortMode = "alpha"; // "alpha" | "recent"

function loadSortModePreference() {
    try {
        const saved = localStorage.getItem(SORT_MODE_KEY);
        if (saved === "alpha" || saved === "recent" || saved === "tier") sortMode = saved;
    } catch (e) {
        console.warn("Could not load sort mode preference:", e);
    }
}

const HINT_MODE_KEY = "alchemy_hint_mode";
let hintModeEnabled = false; // off by default — an opt-in assist, not a surprise for new players

function loadHintModePreference() {
    try {
        const saved = localStorage.getItem(HINT_MODE_KEY);
        if (saved !== null) hintModeEnabled = saved === "true";
    } catch (e) {
        console.warn("Could not load hint mode preference:", e);
    }
}

function setupColorologyToggle() {
    const btn = document.getElementById("colorology-toggle");
    if (!btn) return;

    const updateLabel = () => {
        btn.textContent = colorologyDisabled ? "Colors: Off" : "Colors: On";
        btn.classList.toggle("muted", colorologyDisabled);
    };
    updateLabel();

    btn.addEventListener("click", () => {
        setColorologyDisabled(!colorologyDisabled);
        updateLabel();
        render(); // re-apply or strip tile backgrounds immediately
    });
}

function setupColorologyPopup() {
    const popup = document.getElementById("colorology-popup");
    const okayBtn = document.getElementById("colorology-okay-btn");
    const disableBtn = document.getElementById("colorology-disable-btn");
    if (!popup) return;

    okayBtn?.addEventListener("click", () => {
        markColorologySeen();
        popup.hidden = true;
    });

    disableBtn?.addEventListener("click", () => {
        markColorologySeen();
        setColorologyDisabled(true);
        popup.hidden = true;
        const toggleBtn = document.getElementById("colorology-toggle");
        if (toggleBtn) {
            toggleBtn.textContent = "Colors: Off";
            toggleBtn.classList.add("muted");
        }
        render(); // strip the backgrounds that are currently showing
    });
}

function setupHintModeToggle() {
    const btn = document.getElementById("hint-mode-toggle");
    if (!btn) return;

    const updateLabel = () => {
        btn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
        btn.classList.toggle("muted", !hintModeEnabled);
    };
    updateLabel();

    btn.addEventListener("click", () => {
        if (speedrunActive) return; // locked for the whole run, whichever way it was set at start
        hintModeEnabled = !hintModeEnabled;
        try {
            localStorage.setItem(HINT_MODE_KEY, String(hintModeEnabled));
        } catch (e) {
            console.warn("Could not save hint mode preference:", e);
        }
        updateLabel();
        render(); // re-sort/re-style the Elements tab immediately
        if (hintModeEnabled) resetHintIdleTimer();
        else stopHintIdleTimer();
    });
}

// ---------- Hint Mode: idle "what to make next" nudge ----------
//
// Blue (hintable) means "this element can combine with SOMETHING you
// have." Green means something more specific: "these two exact elements
// combine with each other" — a real answer, not just a general nudge.
// Only surfaces after sustained idle time, so it doesn't undercut the
// point of Hint Mode by handing out answers to someone still actively
// working things out.
const HINT_IDLE_DELAY_MS = 20000;
let hintIdleTimer = null;
let greenHintPair = null; // [elementA, elementB] currently suggested, or null

function findRandomActionablePair() {
    const candidates = recipeList.filter(
        r => discovered.has(r.a) && discovered.has(r.b) && !discovered.has(r.result)
    );
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return [pick.a, pick.b];
}

function showGreenHint() {
    if (!hintModeEnabled) return;
    greenHintPair = findRandomActionablePair(); // re-picks fresh each time — if still idle after 20s more, the suggestion can rotate rather than staying static forever
    render();
}

function clearGreenHint() {
    if (greenHintPair !== null) {
        greenHintPair = null;
        render();
    }
}

// Called on every combine ATTEMPT (not searching, not sorting, not tab
// switching) — "nothing has been combined" means exactly that.
function resetHintIdleTimer() {
    if (hintIdleTimer) {
        clearInterval(hintIdleTimer);
        hintIdleTimer = null;
    }
    clearGreenHint();
    if (!hintModeEnabled) return;
    hintIdleTimer = setInterval(showGreenHint, HINT_IDLE_DELAY_MS);
}

function stopHintIdleTimer() {
    if (hintIdleTimer) {
        clearInterval(hintIdleTimer);
        hintIdleTimer = null;
    }
    clearGreenHint();
}

const AI_NOTICE_KEY = "alchemy_ai_notice_read";
let aiNoticeRead = false;
let aiBodyExpanded = true; // set correctly in setupAiNoticeAck() based on aiNoticeRead — separate from aiNoticeRead itself, so it can be reopened for rereading anytime, whether just acknowledged or read weeks ago

function loadAiNoticePreference() {
    try {
        const saved = localStorage.getItem(AI_NOTICE_KEY);
        if (saved === "true") aiNoticeRead = true;
    } catch (e) {
        console.warn("Could not load AI notice preference:", e);
    }
}

function updateCreditsBadge() {
    const badge = document.getElementById("credits-badge");
    if (badge) badge.hidden = aiNoticeRead;
}

// card thickness/prominence tracks whether it's EVER been read (aiNoticeRead);
// body visibility tracks whether it's OPEN RIGHT NOW (aiBodyExpanded) — these
// are independent so it can shrink down after being read, while still being
// reopened to reread without regaining its original full-size treatment.
function applyAiDisclosureState() {
    const card = document.getElementById("ai-disclosure");
    const body = document.getElementById("ai-disclosure-body");
    const toggle = document.getElementById("ai-disclosure-toggle");
    if (!card || !body || !toggle) return;

    card.classList.toggle("collapsed", aiNoticeRead);
    body.hidden = !aiBodyExpanded;
    toggle.classList.toggle("collapsed", !aiBodyExpanded);
}

function moveAiDisclosureToBottom() {
    const card = document.getElementById("ai-disclosure");
    const panel = document.getElementById("tab-credits");
    if (card && panel) panel.appendChild(card); // re-parenting to its own parent just moves it to the end
}

// Generic collapsible pattern: any button with class "simple-toggle" shows
// or hides its next sibling element. No persisted state (resets collapsed
// on reload, which is fine for a credits list) and no per-entry JS needed —
// adding artist #3, #10, #30 later is just adding another button+div pair
// in the HTML, not new code here.
function setupSimpleToggles() {
    document.querySelectorAll(".simple-toggle").forEach(btn => {
        const target = btn.nextElementSibling;
        if (!target) return;
        btn.classList.toggle("collapsed", target.hidden);
        btn.addEventListener("click", () => {
            target.hidden = !target.hidden;
            btn.classList.toggle("collapsed", target.hidden);
        });
    });
}

function setupAiNoticeAck() {
    aiBodyExpanded = !aiNoticeRead; // starts open if never read; starts closed (but reopenable) if already acknowledged in a past session

    if (aiNoticeRead) moveAiDisclosureToBottom();
    applyAiDisclosureState();
    updateCreditsBadge();

    const toggleBtn = document.getElementById("ai-disclosure-toggle");
    toggleBtn?.addEventListener("click", () => {
        aiBodyExpanded = !aiBodyExpanded;
        applyAiDisclosureState();
    });

    const ackBtn = document.getElementById("ai-notice-ack");
    if (!ackBtn) return;

    const updateAckButton = () => {
        ackBtn.textContent = aiNoticeRead ? "Read" : "I've read this";
        ackBtn.classList.toggle("acknowledged", aiNoticeRead);
    };
    updateAckButton();

    ackBtn.addEventListener("click", () => {
        if (aiNoticeRead) return; // already acknowledged, nothing to toggle back
        aiNoticeRead = true;
        try {
            localStorage.setItem(AI_NOTICE_KEY, "true");
        } catch (e) {
            console.warn("Could not save AI notice preference:", e);
        }
        updateAckButton();
        updateCreditsBadge();

        // Live transition on the exact click, not just next reload — moves
        // to the bottom and collapses immediately, matching what a
        // returning visitor would see.
        aiBodyExpanded = false;
        moveAiDisclosureToBottom();
        applyAiDisclosureState();
    });
}


function setupSortToggle() {
    const buttons = document.querySelectorAll(".sort-toggle");
    buttons.forEach(btn => btn.classList.toggle("active", btn.dataset.sort === sortMode));

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            sortMode = btn.dataset.sort;
            try {
                localStorage.setItem(SORT_MODE_KEY, sortMode);
            } catch (e) {
                console.warn("Could not save sort mode preference:", e);
            }
            buttons.forEach(b => b.classList.toggle("active", b.dataset.sort === sortMode));
            render();
        });
    });
}

function sortElements(list) {
    if (sortMode === "recent") {
        // Most recently discovered first. Anything with no known position
        // in discoveryOrder counts as rank -1 — older than anything that
        // IS tracked — so it sinks to the bottom instead of landing
        // somewhere arbitrary.
        return [...list].sort((a, b) => {
            const aRank = discoveryOrder.indexOf(a);
            const bRank = discoveryOrder.indexOf(b);
            if (aRank !== bRank) return bRank - aRank; // higher index = more recent = shown first
            return a.localeCompare(b, undefined, { sensitivity: "base" }); // stable tiebreaker, case-insensitive so "Earth" and "earth" don't split apart
        });
    }
    // Explicit case-insensitive comparator — a plain .sort() sorts by raw
    // character code, which puts every capitalized element before every
    // lowercase one as one big block, rather than mixing "Earth" in
    // alphabetically next to "earth" the way a reader would expect.
    return [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function render() {
    const activeBox = document.getElementById("elements");
    const deadBox = document.getElementById("dead-end-elements");
    const deadSection = document.getElementById("dead-end-section");
    if (!activeBox || !deadBox) return;

    activeBox.innerHTML = "";
    deadBox.innerHTML = "";

    const query = (document.getElementById("search")?.value || "").toLowerCase().trim();

    const filtered = sortElements([...discovered].filter(el => universe.has(el))).filter(el =>
        el.toLowerCase().includes(query)
    );

    let active = filtered.filter(el => !isExhausted(el));
    const dead = filtered.filter(el => isExhausted(el));

    if (hintModeEnabled) {
        // Three tiers layered ON TOP of the existing sort mode, not a
        // replacement for it — each group keeps normal alpha/recent order
        // among itself. The green pair (if any) sits above the general
        // blue-hintable group, since it's a more specific, more actionable
        // suggestion than "this combines with something, unspecified."
        const isGreenPair = el => greenHintPair && greenHintPair.includes(el);
        const greenPair = active.filter(isGreenPair);
        const hintable = active.filter(el => hasActionableCombo(el) && !isGreenPair(el));
        const rest = active.filter(el => !hasActionableCombo(el) && !isGreenPair(el));
        active = [...greenPair, ...hintable, ...rest];
    }

    if (sortMode === "tier") {
        renderTierGrouped(activeBox, active);
        renderTierGrouped(deadBox, dead);
    } else {
        renderFlatRow(activeBox, active);
        renderFlatRow(deadBox, dead);
    }

    if (deadSection) deadSection.hidden = dead.length === 0;
}

// A single wrapping row of tiles — what render() always produced before
// tier grouping existed, now shared by both the flat modes (alpha/
// recent) and as the building block inside each tier group below.
function renderFlatRow(container, list) {
    const row = document.createElement("div");
    row.className = "element-tile-row";
    list.forEach(el => row.appendChild(makeElementTile(el)));
    container.appendChild(row);
}

// Groups a list into tier headings + rows, reusing the same memoized
// tier cache already built for the speedrun step-length picker — no
// separate computation, and it's invalidated on the same recipe-reload
// path that cache already handles. Elements with no computed tier (the
// wildcard, or anything genuinely unreachable through real recipes) land
// in a trailing "Other" group instead of being silently dropped.
function renderTierGrouped(container, list) {
    const data = ensureSpeedTierData();
    const tierMap = data ? data.tier : new Map();

    const groups = new Map();
    const other = [];
    list.forEach(el => {
        if (tierMap.has(el)) {
            const t = tierMap.get(el);
            if (!groups.has(t)) groups.set(t, []);
            groups.get(t).push(el);
        } else {
            other.push(el);
        }
    });

    [...groups.keys()].sort((a, b) => a - b).forEach(t => {
        const heading = document.createElement("p");
        heading.className = "tier-group-heading";
        heading.textContent = t === 0 ? "Starting elements" : `Tier ${t}`;
        container.appendChild(heading);
        renderFlatRow(container, groups.get(t));
    });

    if (other.length > 0) {
        const heading = document.createElement("p");
        heading.className = "tier-group-heading";
        heading.textContent = "Other";
        container.appendChild(heading);
        renderFlatRow(container, other);
    }
}

// ---------- Shared detail content (used by graph panel AND list view) ----------

function buildDetailFragment(element, depths) {
    const frag = document.createDocumentFragment();

    const heading = document.createElement("h3");
    const icon = createElementIcon(element);
    if (icon) heading.appendChild(icon);
    heading.appendChild(document.createTextNode(element));
    frag.appendChild(heading);

    if (element === NOTHING_HAPPENS) {
        const p1 = document.createElement("p");
        p1.className = "tree-origin";
        p1.textContent = "Made from any two elements that don't have a recipe together.";
        frag.appendChild(p1);
        const p2 = document.createElement("p");
        p2.className = "tree-used-label";
        p2.textContent = "Combines into:";
        frag.appendChild(p2);
        const p3 = document.createElement("p");
        p3.className = "tree-origin";
        p3.textContent = "Anything + nothing happens → nothing happens. Always.";
        frag.appendChild(p3);
        const note = document.createElement("p");
        note.className = "tree-dead-note";
        note.textContent = "Nothing happens + nothing happens is worth trying, for what it's worth.";
        frag.appendChild(note);
        return frag;
    }

    const origin = recipeList.find(r => r.result === element);
    const originLine = document.createElement("p");
    originLine.className = "tree-origin";
    originLine.textContent = origin ? `Made from ${origin.a} + ${origin.b}` : "Starting element";
    frag.appendChild(originLine);

    // Depth is shown as a number here on purpose — it's the same value the
    // graph encodes as a green-to-red color, and a color-only signal is a
    // real accessibility gap (red/green is the most common form of color
    // blindness). This makes sure the number is available either way.
    if (depths && depths.has(element)) {
        const depthLine = document.createElement("p");
        depthLine.className = "tree-origin";
        const d = depths.get(element);
        depthLine.textContent = `${d} step${d === 1 ? "" : "s"} from the base elements`;
        frag.appendChild(depthLine);
    }

    const usedIn = recipeList.filter(r => (r.a === element || r.b === element) && discovered.has(r.result));
    if (usedIn.length > 0) {
        const usedHeading = document.createElement("p");
        usedHeading.className = "tree-used-label";
        usedHeading.textContent = "Combines into:";
        frag.appendChild(usedHeading);

        const list = document.createElement("ul");
        usedIn.forEach(r => {
            const partner = r.a === element ? r.b : r.a;
            const li = document.createElement("li");
            li.textContent = `+ ${partner} → ${r.result}`;
            list.appendChild(li);
        });
        frag.appendChild(list);
    }

    if (isExhausted(element)) {
        const deadNote = document.createElement("p");
        deadNote.className = "tree-dead-note";
        deadNote.textContent = "Dead end — no remaining combination for this element will produce anything new.";
        frag.appendChild(deadNote);
    } else {
        // Not exhausted always means AT LEAST one recipe for this element
        // still leads to an undiscovered result. Split those into
        // "actionable now" (you hold both ingredients) vs "still locked"
        // (you're missing a partner) so a non-exhausted element never
        // renders silently — that silence is exactly what makes a real
        // bug indistinguishable from "just needs a partner you don't have."
        const pending = recipesInvolving(element).filter(r => !discovered.has(r.result));
        const actionable = pending.filter(r => discovered.has(r.a) && discovered.has(r.b));

        if (actionable.length > 0) {
            const hint = document.createElement("p");
            hint.className = "tree-hint";
            hint.textContent = `${actionable.length} undiscovered combination${
                actionable.length > 1 ? "s" : ""
            } waiting among your elements.`;
            frag.appendChild(hint);
        } else {
            const hint = document.createElement("p");
            hint.className = "tree-pending";
            hint.textContent = `Not a dead end yet — ${pending.length} combination${
                pending.length > 1 ? "s" : ""
            } still possible once you find the right partner.`;
            frag.appendChild(hint);
        }
    }

    return frag;
}

function showTreeDetail(element) {
    const panel = document.getElementById("tree-detail");
    if (!panel) return;
    const depths = computeDisplayDepths(new Set([...discovered].filter(el => universe.has(el))));
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(buildDetailFragment(element, depths));
}

function renderTreeList() {
    const container = document.getElementById("tree");
    const deadContainer = document.getElementById("tree-dead-list");
    const deadSection = document.getElementById("tree-dead-section");
    if (!container) return;

    container.innerHTML = "";
    if (deadContainer) deadContainer.innerHTML = "";

    const allValid = [...discovered].filter(el => universe.has(el));
    // Depths must be computed from the FULL discovered set, not the
    // search-filtered subset — otherwise typing a search query would
    // change the "steps from base elements" numbers shown on the cards
    // that remain visible, which would be wrong.
    const depths = computeDisplayDepths(new Set(allValid));

    const query = (document.getElementById("tree-search")?.value || "").toLowerCase().trim();
    const visible = allValid
        .filter(el => el.toLowerCase().includes(query))
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const active = visible.filter(el => !isExhausted(el));
    const dead = visible.filter(el => isExhausted(el));

    active.forEach(element => {
        const card = document.createElement("div");
        card.className = "tree-card";
        card.appendChild(buildDetailFragment(element, depths));
        container.appendChild(card);
    });

    if (deadContainer) {
        dead.forEach(element => {
            const card = document.createElement("div");
            card.className = "tree-card dead-end-card";
            card.appendChild(buildDetailFragment(element, depths));
            deadContainer.appendChild(card);
        });
    }

    if (deadSection) deadSection.hidden = dead.length === 0;
}

// ---------- Family tree: node graph ----------

let simulation = null;
let treeDirty = true; // tree is rebuilt lazily, only when the tab is actually opened
let graphLoadFailed = false; // prevents simple navigation clicks from silently re-hammering a failing CDN
let d3LoadPromise = null;

// D3 is a ~280KB library only needed for the graph view. Loading it
// unconditionally on every page visit charged that cost even to people
// who never open the Family Tree tab. Fetch it once, on demand, the
// first time it's actually needed, and reuse the same promise after that.
function loadD3() {
    if (window.d3) return Promise.resolve();
    if (d3LoadPromise) return d3LoadPromise;

    d3LoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Could not load the graph library"));
        document.head.appendChild(script);
    }).catch(err => {
        // A rejected promise was being cached forever here — one network
        // blip on the CDN would permanently block the graph from ever
        // loading again for the rest of the session, with no way to
        // recover short of a full page reload. Clearing it lets a retry
        // actually try again instead of instantly replaying the old failure.
        d3LoadPromise = null;
        throw err;
    });

    return d3LoadPromise;
}

function ensureTreeUpToDate() {
    if (!treeDirty || graphLoadFailed) return;

    const wrap = document.getElementById("tree-graph-wrap");
    if (wrap && !window.d3) {
        wrap.innerHTML = `${loaderSVG(100)}<p class="graph-loading-text">Loading graph…</p>`;
    }

    loadD3()
        .then(() => {
            renderTree();
            treeDirty = false;
        })
        .catch(err => {
            console.warn(err);
            graphLoadFailed = true;
            // Left dirty on purpose: the list still renders fine below,
            // but treeDirty stays true so a genuinely new discovery still
            // gets a fresh attempt automatically. graphLoadFailed is what
            // actually stops the spam — without it, every tab switch or
            // Graph/List click was silently re-attempting the same failing
            // network request, over and over, with no visible indication
            // that was happening.
            renderTreeList();

            if (wrap) {
                wrap.innerHTML = "";

                const icon = document.createElement("div");
                icon.innerHTML = loaderSVG(70);
                icon.querySelector("animateTransform")?.remove(); // static here — spinning would misleadingly suggest it's still trying
                icon.style.opacity = "0.5";
                wrap.appendChild(icon);

                const msg = document.createElement("p");
                msg.className = "tree-dead-note";
                msg.textContent = "Graph couldn't load (network issue or a blocked script). ";

                const retry = document.createElement("button");
                retry.type = "button";
                retry.className = "view-toggle";
                retry.textContent = "Retry";
                retry.addEventListener("click", () => {
                    graphLoadFailed = false;
                    ensureTreeUpToDate();
                });

                msg.appendChild(retry);
                wrap.appendChild(msg);
            }
        });
}

// Minimum number of combination steps from the base elements, computed
// only over what's actually discovered (not the full recipes.js universe)
// so this can't leak info about undiscovered dependency chains.
function computeDisplayDepths(discoveredSet) {
    const depth = new Map();
    BASE_ELEMENTS.forEach(el => {
        if (discoveredSet.has(el)) depth.set(el, 0);
    });

    let changed = true;
    while (changed) {
        changed = false;
        for (const r of recipeList) {
            if (!discoveredSet.has(r.result)) continue;
            if (depth.has(r.a) && depth.has(r.b)) {
                const candidate = Math.max(depth.get(r.a), depth.get(r.b)) + 1;
                if (!depth.has(r.result) || candidate < depth.get(r.result)) {
                    depth.set(r.result, candidate);
                    changed = true;
                }
            }
        }
    }

    return depth;
}

const DEPTH_COLOR_LOW = { r: 56, g: 191, b: 110 };   // green — base elements, depth 0
const DEPTH_COLOR_HIGH = { r: 214, g: 69, b: 65 };    // red — deepest elements
const USAGE_BLUE_BOOST = 150;

function elementColor(depthRatio, usageRatio) {
    const r = Math.round(DEPTH_COLOR_LOW.r + (DEPTH_COLOR_HIGH.r - DEPTH_COLOR_LOW.r) * depthRatio);
    const g = Math.round(DEPTH_COLOR_LOW.g + (DEPTH_COLOR_HIGH.g - DEPTH_COLOR_LOW.g) * depthRatio);
    const bBase = DEPTH_COLOR_LOW.b + (DEPTH_COLOR_HIGH.b - DEPTH_COLOR_LOW.b) * depthRatio;
    const b = Math.round(Math.min(255, bBase + usageRatio * USAGE_BLUE_BOOST));
    return `rgb(${r}, ${g}, ${b})`;
}

function buildGraphData() {
    const discoveredValid = [...discovered].filter(el => universe.has(el));
    const discoveredSet = new Set(discoveredValid);

    const degree = {};
    discoveredValid.forEach(el => (degree[el] = 0));

    const links = [];
    recipeList.forEach(r => {
        if (!discoveredSet.has(r.result)) return; // spoiler-safe
        if (r.a === r.b) {
            links.push({ source: r.a, target: r.result, self: true });
            degree[r.a] = (degree[r.a] || 0) + 1;
            degree[r.result] = (degree[r.result] || 0) + 1;
        } else {
            links.push({ source: r.a, target: r.result });
            links.push({ source: r.b, target: r.result });
            degree[r.a] = (degree[r.a] || 0) + 1;
            degree[r.b] = (degree[r.b] || 0) + 1;
            degree[r.result] = (degree[r.result] || 0) + 2;
        }
    });

    const depths = computeDisplayDepths(discoveredSet);
    const maxDepth = Math.max(1, ...[...depths.values()]);
    const maxDegree = Math.max(1, ...Object.values(degree));

    const nodes = discoveredValid.map(el => {
        const depth = depths.has(el) ? depths.get(el) : 0; // fallback for edge cases like imported saves
        const deg = degree[el] || 0;
        const depthRatio = depth / maxDepth;
        const usageRatio = deg / maxDegree;
        return {
            id: el,
            deadEnd: isExhausted(el),
            degree: deg,
            depth,
            color: elementColor(depthRatio, usageRatio)
        };
    });

    return { nodes, links };
}

function renderGraph() {
    const wrap = document.getElementById("tree-graph-wrap");
    if (!wrap || typeof d3 === "undefined") return;

    if (simulation) {
        simulation.stop();
        simulation = null;
    }

    wrap.innerHTML = "";

    const width = wrap.clientWidth || 320;
    const height = 420;

    const { nodes, links } = buildGraphData();

    const svg = d3.select(wrap)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", height);

    const g = svg.append("g");

    const zoomBehavior = d3.zoom().scaleExtent([0.15, 4]).on("zoom", event => g.attr("transform", event.transform));
    svg.call(zoomBehavior);

    const link = g.append("g")
        .attr("stroke", "#4a4f68")
        .attr("stroke-width", 1.2)
        .selectAll("line")
        .data(links)
        .join("line");

    const radius = d => 8 + Math.min(d.degree, 6) * 1.4;

    // Fill now encodes depth (green→red) and usage (blue tint) — see
    // buildGraphData(). Dead-end status moved to the stroke/ring instead
    // of fill, since fill is no longer free to mean "dead end": a red
    // ring is a second, independent signal layered on top of it.
    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("data-el", d => d.id)
        .attr("r", radius)
        .attr("fill", d => d.color)
        .attr("stroke", d => (d.deadEnd ? "#ff6b6b" : "#14151f"))
        .attr("stroke-width", d => (d.deadEnd ? 2.5 : 1.5))
        .style("cursor", "pointer")
        .on("click", (event, d) => showTreeDetail(d.id))
        .call(
            d3.drag()
                .on("start", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on("drag", (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on("end", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                })
        );

    // At hundreds of nodes, labeling everything is unreadable regardless
    // of color — this was the real cause of the "clustered mess" look,
    // not the color scheme. Only base elements and well-connected nodes
    // get a permanent label by default; everything else's label still
    // EXISTS (for search to reveal) but starts at opacity 0.
    const showLabel = d => d.depth === 0 || d.degree >= 4;

    const label = g.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .attr("data-el", d => d.id)
        .attr("data-important", d => (showLabel(d) ? "true" : "false"))
        .text(d => d.id)
        .attr("font-size", 9)
        .attr("font-family", "IBM Plex Mono, monospace")
        .attr("fill", "#c7cadb")
        .attr("text-anchor", "middle")
        .attr("dy", d => -radius(d) - 4)
        .attr("opacity", d => (showLabel(d) ? 1 : 0))
        .style("pointer-events", "none");

    const paint = () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => d.x).attr("cy", d => d.y);
        label.attr("x", d => d.x).attr("y", d => d.y);
    };

    // Repulsion scaled to node count — at 500+ nodes, the old fixed -90
    // charge left everything crammed together regardless of color. This
    // costs more compute per tick, which works against the earlier speed
    // fix, so iterations are capped rather than scaled freely too.
    const chargeStrength = -Math.max(90, Math.min(260, nodes.length * 0.9));

    const sim = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(46).strength(0.7))
        .force("charge", d3.forceManyBody().strength(chargeStrength))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => radius(d) + 6))
        .stop();

    const ITERATIONS = Math.min(300, 150 + Math.floor(nodes.length / 3));
    for (let i = 0; i < ITERATIONS; i++) sim.tick();
    paint();

    // Fit the whole graph in view on open instead of showing whatever
    // corner happened to land at (0,0) — critical once graphs get wide
    // enough that they no longer fit the visible area at 1:1 scale.
    if (nodes.length > 0) {
        const xs = nodes.map(d => d.x);
        const ys = nodes.map(d => d.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const graphW = Math.max(maxX - minX, 1);
        const graphH = Math.max(maxY - minY, 1);
        const scale = Math.min(4, Math.max(0.15, Math.min(width / graphW, height / graphH) * 0.85));
        const tx = width / 2 - scale * (minX + maxX) / 2;
        const ty = height / 2 - scale * (minY + maxY) / 2;
        svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    sim.on("tick", paint);
    simulation = sim;

    applyGraphSearchHighlight(document.getElementById("tree-search")?.value || "");
}

// Pure DOM-based highlight, independent of D3's internal selections, so it
// works whenever it's called without needing access to renderGraph()'s
// local state. Dims non-matching nodes instead of removing them — cheap
// (just an opacity toggle) and doesn't touch the simulation at all.
function applyGraphSearchHighlight(query) {
    const wrap = document.getElementById("tree-graph-wrap");
    if (!wrap) return;
    const q = query.toLowerCase().trim();

    wrap.querySelectorAll("circle[data-el]").forEach(el => {
        const match = !q || el.getAttribute("data-el").toLowerCase().includes(q);
        el.setAttribute("opacity", match ? "1" : "0.15");
    });

    wrap.querySelectorAll("text[data-el]").forEach(el => {
        const id = el.getAttribute("data-el").toLowerCase();
        const important = el.getAttribute("data-important") === "true";
        if (!q) {
            el.setAttribute("opacity", important ? "1" : "0");
        } else {
            el.setAttribute("opacity", id.includes(q) ? "1" : "0");
        }
    });
}

function renderTree() {
    renderGraph();
    renderTreeList();
}

function setViewMode(mode) {
    const graphWrap = document.getElementById("tree-graph-wrap");
    const detail = document.getElementById("tree-detail");
    const listWrap = document.getElementById("tree-list-wrap");
    const isGraph = mode === "graph";

    ensureTreeUpToDate();

    if (graphWrap) graphWrap.hidden = !isGraph;
    if (detail) detail.hidden = true;
    if (listWrap) listWrap.hidden = isGraph;

    document.querySelectorAll(".view-toggle").forEach(btn => btn.classList.toggle("active", btn.dataset.view === mode));
}

// ---------- Backup / transfer ----------

function encodeSave() {
    // btoa() only accepts Latin-1 text — a single element name containing
    // a curly apostrophe, an em dash, or any other character outside that
    // range (e.g. "Hawai'i") throws and silently breaks export for the
    // ENTIRE save, not just that one element. Encoding through UTF-8 bytes
    // first means any Unicode character survives the round trip.
    const json = JSON.stringify([...discovered]);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function decodeAndMerge(code) {
    const binary = atob(code.trim());
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("Not a valid backup code");
    let added = 0;
    const importTime = Date.now();
    parsed.forEach(el => {
        if (typeof el === "string" && !discovered.has(el)) {
            discovered.add(el);
            // A backup code has no timestamps, so true original discovery
            // order/time can't survive the trip — treated as "found right
            // now" on this device instead. Still a real timestamp, though,
            // so a legitimate import of a large set doesn't get mistaken
            // for the untimestamped-bulk pattern a fabricated save shows.
            discoveryOrder.push(el);
            discoveryTimestamps[el] = importTime;
            added++;
        }
    });
    return added;
}

function setupBackupControls() {
    const exportBtn = document.getElementById("export-btn");
    const codeBox = document.getElementById("backup-code");
    const importToggle = document.getElementById("import-toggle-btn");
    const importRow = document.getElementById("import-row");
    const importInput = document.getElementById("import-input");
    const importConfirm = document.getElementById("import-confirm-btn");
    const status = document.getElementById("backup-status");

    const showStatus = msg => {
        if (!status) return;
        status.hidden = false;
        status.textContent = msg;
    };

    exportBtn?.addEventListener("click", async () => {
        // Previously uncaught — if encodeSave() threw (as it silently did
        // for any non-Latin-1 character), the click just appeared to do
        // nothing at all, with no visible sign anything went wrong.
        let code;
        try {
            code = encodeSave();
        } catch (e) {
            showStatus("Couldn't generate a backup code. Please let the developer know.");
            console.error("encodeSave failed:", e);
            return;
        }

        if (codeBox) {
            codeBox.hidden = false;
            codeBox.value = code;
            codeBox.select();
        }
        try {
            await navigator.clipboard.writeText(code);
            showStatus("Copied to clipboard.");
        } catch {
            showStatus("Code generated below — copy it manually.");
        }
    });

    importToggle?.addEventListener("click", () => {
        if (importRow) importRow.hidden = !importRow.hidden;
    });

    importConfirm?.addEventListener("click", () => {
        try {
            const added = decodeAndMerge(importInput.value);
            saveProgress();
            updateProgressDisplays();
            render();
            treeDirty = true;
            setsDirty = true;
            graphLoadFailed = false;
            showStatus(added > 0 ? `Added ${added} element(s) from the backup code.` : "Nothing new in that code — you already had it all.");
        } catch {
            showStatus("That code couldn't be read. Double-check you copied it in full.");
        }
    });
}

// ---------- Reset ----------

function setupResetControl() {
    const resetBtn = document.getElementById("reset-btn");
    const confirmBox = document.getElementById("reset-confirm");
    const confirmBtn = document.getElementById("reset-confirm-btn");
    const cancelBtn = document.getElementById("reset-cancel-btn");
    const status = document.getElementById("backup-status");
    if (!resetBtn || !confirmBox) return;

    resetBtn.addEventListener("click", () => {
        resetBtn.hidden = true;
        confirmBox.hidden = false;
    });

    cancelBtn?.addEventListener("click", () => {
        confirmBox.hidden = true;
        resetBtn.hidden = false;
    });

    confirmBtn?.addEventListener("click", () => {
        resetProgress();
        updateProgressDisplays();
        render();
        treeDirty = true;
        setsDirty = true;
        graphLoadFailed = false;

        confirmBox.hidden = true;
        resetBtn.hidden = false;

        if (status) {
            status.hidden = false;
            status.textContent = "Progress reset. Starting fresh with air, water, earth, fire.";
        }
    });
}

function setupTreeSearch() {
    const input = document.getElementById("tree-search");
    if (!input) return;
    input.addEventListener("input", () => {
        renderTreeList();
        applyGraphSearchHighlight(input.value);
    });
}

// ---------- Sets ----------
//
// Built as a list on purpose, not a one-off feature, since more sets are
// planned. Adding a future set is just adding another entry here — nothing
// about the rendering or tracking logic needs to change for it.

// A few elements have more than one accepted spelling in common use.
// Listed as arrays so either form counts, since it's unknown which
// spelling any given recipes.js actually uses.
const PERIODIC_TABLE_ITEMS = [
    "hydrogen", "helium", "lithium", "beryllium", "boron", "carbon", "nitrogen",
    "oxygen", "fluorine", "neon", "sodium", "magnesium", ["aluminium", "aluminum"],
    "silicon", "phosphorus", ["sulfur", "sulphur"], "chlorine", "argon",
    "potassium", "calcium", "scandium", "titanium", "vanadium", "chromium",
    "manganese", "iron", "cobalt", "nickel", "copper", "zinc", "gallium",
    "germanium", "arsenic", "selenium", "bromine", "krypton", "rubidium",
    "strontium", "yttrium", "zirconium", "niobium", "molybdenum", "technetium",
    "ruthenium", "rhodium", "palladium", "silver", "cadmium", "indium", "tin",
    "antimony", "tellurium", "iodine", "xenon", ["caesium", "cesium"], "barium",
    "lanthanum", "cerium", "praseodymium", "neodymium", "promethium",
    "samarium", "europium", "gadolinium", "terbium", "dysprosium", "holmium",
    "erbium", "thulium", "ytterbium", "lutetium", "hafnium", "tantalum",
    ["tungsten", "wolfram"], "rhenium", "osmium", "iridium", "platinum",
    "gold", "mercury", "thallium", "lead", "bismuth", "polonium", "astatine",
    "radon", "francium", "radium", "actinium", "thorium", "protactinium",
    "uranium", "neptunium", "plutonium", "americium", "curium", "berkelium",
    "californium", "einsteinium", "fermium", "mendelevium", "nobelium",
    "lawrencium", "rutherfordium", "dubnium", "seaborgium", "bohrium",
    "hassium", "meitnerium", "darmstadtium", "roentgenium", "copernicium",
    "nihonium", "flerovium", "moscovium", "livermorium", "tennessine",
    "oganesson"
];

const SETS = [
    { id: "periodic-table", name: "Periodic Table", items: PERIODIC_TABLE_ITEMS }
];

function itemIsComplete(item) {
    const names = Array.isArray(item) ? item : [item];
    return names.some(n => discovered.has(n));
}

function itemPrimaryName(item) {
    return Array.isArray(item) ? item[0] : item;
}

let setsDirty = true;

function renderSetsTab() {
    const container = document.getElementById("sets-container");
    if (!container) return;
    container.innerHTML = "";

    SETS.forEach(set => {
        const card = document.createElement("div");
        card.className = "tree-card";

        const completed = set.items.filter(itemIsComplete).length;
        const heading = document.createElement("h3");
        heading.textContent = `${set.name} — ${completed} / ${set.items.length}`;
        card.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "set-grid";
        set.items.forEach(item => {
            const tile = document.createElement("span");
            tile.className = "set-tile" + (itemIsComplete(item) ? " set-tile-done" : "");
            tile.textContent = itemPrimaryName(item);
            grid.appendChild(tile);
        });
        card.appendChild(grid);

        container.appendChild(card);
    });
}

function ensureSetsUpToDate() {
    if (!setsDirty) return;
    renderSetsTab();
    setsDirty = false;
}

function setupTabs() {
    const tabButtons = document.querySelectorAll("button.tab-button");
    const panels = document.querySelectorAll(".tab-panel");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
            if (btn.dataset.tab === "tree") ensureTreeUpToDate();
            if (btn.dataset.tab === "sets") ensureSetsUpToDate();
            if (btn.dataset.tab === "speedrun") refreshSpeedrunSettingsUi();
        });
    });

    document.querySelectorAll(".view-toggle").forEach(btn => {
        btn.addEventListener("click", () => setViewMode(btn.dataset.view));
    });
}

function setupSearch() {
    const search = document.getElementById("search");
    if (!search) return;
    search.addEventListener("input", render);
}

// "load" waits for every resource on the page — fonts included — before
// firing. Fonts have nothing to do with whether the game can run, so
// gating startup on them was adding real, avoidable delay. DOMContentLoaded
// fires as soon as the HTML itself is parsed, which is all this actually
// needs, since game.js sits at the end of <body> and everything it queries
// by ID is already parsed by the time this script runs at all.
// ---------- Phase 3: casual-inspection friction ----------
//
// None of this stops a determined person — it can't, on a static site with
// no server. It's aimed at the "someone on a forum told me to paste this"
// pattern, which is a much closer match to "casual reverse engineering"
// than blocking right-click ever was.

console.log(
    "%cStop.",
    "color: #b5453f; font-size: 42px; font-weight: bold;"
);
console.log(
    "%cThis console lets code run with full access to this page. If someone told you pasting something here would unlock elements or \"hack\" this game, that isn't true — it doesn't work that way, and code you don't understand could do things you don't expect.",
    "font-size: 14px; color: #e8e4d8;"
);
console.log(
    "%cIf you're actually curious how this works, the source is plain, readable JavaScript — view-source is a better place to look than pasting things here.",
    "font-size: 12px; color: #8d92a8;"
);

// DevTools keyboard shortcuts, desktop only — this literally has no effect
// on the iPhone this was tested on, since iOS has no such shortcuts at all.
// The only way to inspect a page on iOS is remote debugging from a
// connected Mac, which happens entirely outside the page and can't be
// touched by anything running in it. Kept anyway since it costs nothing
// and raises the bar by one click for casual desktop users specifically.
document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    const isF12 = event.key === "F12";
    const isInspectCombo = (event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c"].includes(key);
    const isViewSource = (event.ctrlKey || event.metaKey) && key === "u";

    if (isF12 || isInspectCombo || isViewSource) {
        event.preventDefault();
    }
});

// =====================================================================
// SPEEDRUN (v7.0)
// =====================================================================

// ---------- Step-length machinery (ported verbatim from database.js,
// where every function below was already verified against a naive
// per-element walk) ----------

let speedTierData = null;
let srPreviewScope = null; // Set of unlocked elements when previewing/starting below 100%; null = full game
let srPreviewData = null; // { tier, bestRecipe, stepLength } — recomputed lazily after any recipe reload

function computeFullTiers(filterSet) {
    const tier = new Map();
    const bestRecipe = new Map();
    BASE_ELEMENTS.forEach(el => tier.set(el, 0));
    let changed = true;
    while (changed) {
        changed = false;
        recipeList.forEach(entry => {
            if (filterSet && !filterSet.has(entry.result)) return;
            if (!tier.has(entry.a) || !tier.has(entry.b)) return;
            const candidate = Math.max(tier.get(entry.a), tier.get(entry.b)) + 1;
            if (!tier.has(entry.result) || candidate < tier.get(entry.result)) {
                tier.set(entry.result, candidate);
                bestRecipe.set(entry.result, entry);
                changed = true;
            }
        });
    }
    return { tier, bestRecipe };
}

function buildOrderFor(target, bestRecipe) {
    const visited = new Set(BASE_ELEMENTS);
    const order = [];
    function visit(el) {
        if (visited.has(el)) return;
        visited.add(el);
        const entry = bestRecipe.get(el);
        if (!entry) return;
        visit(entry.a);
        visit(entry.b);
        order.push(entry);
    }
    visit(target);
    return order;
}

function computeStepLengths(bestRecipe, tier) {
    const depSet = new Map();
    BASE_ELEMENTS.forEach(el => depSet.set(el, new Set()));
    const sortedByTier = [...tier.keys()]
        .filter(el => !BASE_ELEMENTS.includes(el))
        .sort((a, b) => tier.get(a) - tier.get(b));
    sortedByTier.forEach(el => {
        const entry = bestRecipe.get(el);
        if (!entry) return;
        const setA = depSet.get(entry.a) || new Set();
        const setB = depSet.get(entry.b) || new Set();
        depSet.set(el, new Set([...setA, ...setB, el]));
    });
    const stepLength = new Map();
    depSet.forEach((set, el) => stepLength.set(el, set.size));
    return stepLength;
}

function ensureSpeedTierData() {
    if (speedTierData) return speedTierData;
    if (recipeList.length === 0) return null;
    const { tier, bestRecipe } = computeFullTiers();
    const stepLength = computeStepLengths(bestRecipe, tier);
    speedTierData = { tier, bestRecipe, stepLength };
    return speedTierData;
}

function computeScopedTierData(scopeSet) {
    const { tier, bestRecipe } = computeFullTiers(scopeSet);
    const stepLength = computeStepLengths(bestRecipe, tier);
    return { tier, bestRecipe, stepLength };
}

function highestStepLengthElement(dataOverride) {
    const data = dataOverride || ensureSpeedTierData();
    if (!data) return null;
    let best = null;
    let bestLen = -1;
    data.stepLength.forEach((len, el) => {
        if (BASE_ELEMENTS.includes(el)) return;
        if (len > bestLen) { bestLen = len; best = el; }
    });
    return best;
}

// ---------- Speedrun state ----------

const SPEEDRUN_STATE_KEY = "alchemy_speedrun_state";
const SPEEDRUN_WEBHOOK_URL = "https://discord.com/api/webhooks/1527618062935658508/1HlNzJo4uivrXCJYDbLcg1IS1X3ez2xMWaVGwKV952Nf6zhNP87vL9zRuBc8U0clyodU";

// mode: "completionist" | "target"; thresholds: ascending milestone
// numbers (element counts, or step counts along the target's build
// order); startedAt: ms timestamp of the FIRST tile click, not the Start
// button — the run doesn't begin until the player actually plays.
let speedrunConfig = null;
let speedrunScopeSet = null;
let speedrunRun = null;
let speedrunTimerInterval = null;

function persistSpeedrunState() {
    try {
        if (!speedrunActive) {
            localStorage.removeItem(SPEEDRUN_STATE_KEY);
            return;
        }
        localStorage.setItem(SPEEDRUN_STATE_KEY, JSON.stringify({
            active: true,
            config: speedrunConfig,
            run: speedrunRun,
        }));
    } catch (e) {
        console.warn("Could not persist speedrun state:", e);
    }
}

// Runs BEFORE loadProgress() at init on purpose: speedrunActive must be
// set first so activeKey() resolves to the speedrun key set and the
// in-progress run's data loads instead of the parked normal save.
function loadSpeedrunState() {
    try {
        const raw = localStorage.getItem(SPEEDRUN_STATE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.active !== true || !parsed.config) return;
        speedrunConfig = parsed.config;
        speedrunScopeSet = Array.isArray(speedrunConfig.scope) ? new Set(speedrunConfig.scope) : null;
        speedrunRun = parsed.run || { startedAt: null, splits: [], finished: false, finishMs: null };
        speedrunActive = true;
    } catch (e) {
        console.warn("Could not load speedrun state:", e);
    }
}

// ---------- Timer ----------

function formatRunTime(ms) {
    const tenths = Math.floor(ms / 100) % 10;
    const s = Math.floor(ms / 1000);
    const sec = s % 60;
    const min = Math.floor(s / 60) % 60;
    const hr = Math.floor(s / 3600);
    const mm = String(min).padStart(hr > 0 ? 2 : 1, "0");
    const ss = String(sec).padStart(2, "0");
    return hr > 0 ? `${hr}:${mm}:${ss}.${tenths}` : `${mm}:${ss}.${tenths}`;
}

function currentRunElapsed() {
    if (!speedrunRun || !speedrunRun.startedAt) return 0;
    if (speedrunRun.finished && speedrunRun.finishMs !== null) return speedrunRun.finishMs;
    return Date.now() - speedrunRun.startedAt;
}

function updateSpeedrunTimerDisplays() {
    const text = speedrunRun && speedrunRun.startedAt ? formatRunTime(currentRunElapsed()) : "0:00.0";
    const bar = document.getElementById("speedrun-timer");
    if (bar) bar.textContent = text;
    const live = document.getElementById("sr-live-time");
    if (live) live.textContent = text;
}

function startSpeedrunTimerInterval() {
    if (speedrunTimerInterval) return;
    speedrunTimerInterval = setInterval(updateSpeedrunTimerDisplays, 100);
}

function stopSpeedrunTimerInterval() {
    if (speedrunTimerInterval) {
        clearInterval(speedrunTimerInterval);
        speedrunTimerInterval = null;
    }
}

// ---------- Run metric + splits ----------

function speedrunTargetBuildSet() {
    if (!speedrunConfig || speedrunConfig.mode !== "target") return null;
    if (Array.isArray(speedrunConfig.targetBuildResults)) return new Set(speedrunConfig.targetBuildResults);
    const data = ensureSpeedTierData();
    if (!data) return null;
    return new Set(buildOrderFor(speedrunConfig.target, data.bestRecipe).map(step => step.result));
}

function speedrunCurrentMetric() {
    if (!speedrunConfig) return 0;
    if (speedrunConfig.mode === "completionist") return validDiscoveredCount();
    const buildSet = speedrunTargetBuildSet();
    if (!buildSet) return 0;
    let count = 0;
    buildSet.forEach(el => { if (discovered.has(el)) count++; });
    return count;
}

// Called after every successful discovery. Records any newly-crossed
// split thresholds at the CURRENT elapsed time, then checks completion.
function speedrunOnDiscovery() {
    if (!speedrunActive || !speedrunRun || speedrunRun.finished) return;

    const metric = speedrunCurrentMetric();
    const elapsed = currentRunElapsed();

    (speedrunConfig.thresholds || []).forEach(at => {
        if (metric >= at && !speedrunRun.splits.some(s => s.at === at)) {
            speedrunRun.splits.push({ at, ms: elapsed });
        }
    });

    const runTotal = Array.isArray(speedrunConfig.scope) ? speedrunConfig.scope.length : universe.size;
    const done = speedrunConfig.mode === "completionist"
        ? validDiscoveredCount() >= runTotal && runTotal > 0
        : discovered.has(speedrunConfig.target);

    if (done) {
        speedrunRun.finished = true;
        speedrunRun.finishMs = elapsed;
        stopSpeedrunTimerInterval();
        updateSpeedrunTimerDisplays();
        recordSpeedrunHistory();
        showSpeedrunFinishBlock();
        // Surface the finish/name prompt immediately instead of leaving it
        // parked in a tab the player isn't currently looking at.
        document.querySelector('button.tab-button[data-tab="speedrun"]')?.click();
    }

    persistSpeedrunState();
    renderSpeedrunSplitsLog();
}

function renderSpeedrunSplitsLog() {
    const log = document.getElementById("sr-splits-log");
    if (!log || !speedrunRun) return;
    log.innerHTML = "";
    const unit = speedrunConfig.mode === "completionist" ? "elements" : "steps";
    speedrunRun.splits
        .slice()
        .sort((a, b) => a.at - b.at)
        .forEach((s, i) => {
            const p = document.createElement("p");
            p.className = "sr-log-line";
            p.textContent = `Split ${i + 1} — ${s.at} ${unit}: ${formatRunTime(s.ms)}`;
            log.appendChild(p);
        });
}

// ---------- Start / end / finish ----------

function computeAutoThresholds(total, n) {
    const out = [];
    for (let i = 1; i <= n; i++) {
        const v = Math.round((total * i) / n);
        if (v >= 1 && (out.length === 0 || v > out[out.length - 1])) out.push(v);
    }
    if (out.length === 0 || out[out.length - 1] !== total) out.push(total);
    return out;
}

function readManualThresholds(containerId, total) {
    const container = document.getElementById(containerId);
    if (!container) return { error: "Split inputs missing." };
    const inputs = container.querySelectorAll("input");
    const values = [];
    for (const input of inputs) {
        const v = Number(input.value);
        if (!Number.isInteger(v) || v < 1 || v > total) {
            return { error: `Every split must be a whole number between 1 and ${total}.` };
        }
        values.push(v);
    }
    for (let i = 1; i < values.length; i++) {
        if (values[i] <= values[i - 1]) return { error: "Splits must be in strictly increasing order." };
    }
    return { values };
}

function setSpeedrunSettingsStatus(msg, isError) {
    const el = document.getElementById("sr-settings-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("sr-status-err", !!isError);
}

async function startSpeedrun() {
    if (speedrunActive || srCountdownRunning) return;
    const data = ensureSpeedTierData();
    if (!data) {
        setSpeedrunSettingsStatus("Recipes are still loading — try again in a moment.", true);
        return;
    }

    const mode = document.querySelector('input[name="sr-subtab"]:checked')?.value === "target" ? "target" : "completionist";
    const hintOn = document.querySelector('input[name="sr-hint"]:checked')?.value === "on";

    // Board eligibility AND the run's scope are both decided by the NORMAL
    // save at this exact moment, before the data swap. 99.9% is not 100%:
    // strict >=, no rounding. A premature run is scoped to ONLY the
    // elements the player had actually unlocked — its total, its splits,
    // its usable recipes all measure against that set, not the full game
    // they haven't seen yet.
    const eligibleForBoard = validDiscoveredCount() >= universe.size && universe.size > 0;
    const scope = eligibleForBoard
        ? [...universe]
        : [...new Set([...BASE_ELEMENTS, ...[...discovered].filter(el => universe.has(el))])];
    const scopeSet = new Set(scope);

    let thresholds;
    let target = null;
    let targetBuildResults = null;

    if (mode === "completionist") {
        const total = scope.length;
        const maxSplits = Math.max(1, Math.ceil(total / 100));
        const count = Number(document.getElementById("sr-comp-count")?.value) || 1;
        if (count < 1 || count > maxSplits) {
            setSpeedrunSettingsStatus(`Split count must be between 1 and ${maxSplits}.`, true);
            return;
        }
        const manual = document.querySelector('input[name="sr-comp-mode"]:checked')?.value === "manual";
        if (manual) {
            const res = readManualThresholds("sr-comp-manual", total);
            if (res.error) { setSpeedrunSettingsStatus(res.error, true); return; }
            thresholds = res.values;
        } else {
            thresholds = computeAutoThresholds(total, count);
        }
    } else {
        target = (document.getElementById("sr-target-input")?.value || "").trim();
        if (!target || !universe.has(target)) {
            setSpeedrunSettingsStatus("Pick a real element to target — it has to exist in the current recipes.", true);
            return;
        }
        if (BASE_ELEMENTS.includes(target)) {
            setSpeedrunSettingsStatus("That's a starting element — it's already discovered the moment the run begins.", true);
            return;
        }
        if (!scopeSet.has(target)) {
            setSpeedrunSettingsStatus("Premature runs can only target elements you've already unlocked in normal play.", true);
            return;
        }
        const runData = eligibleForBoard ? data : computeScopedTierData(scopeSet);
        if (!runData.tier.has(target)) {
            setSpeedrunSettingsStatus("That element is currently unreachable from the starting elements, so a run can never finish.", true);
            return;
        }
        const buildOrder = buildOrderFor(target, runData.bestRecipe);
        targetBuildResults = buildOrder.map(step => step.result);
        const steps = buildOrder.length;
        const maxSplits = Math.max(1, Math.ceil(steps / 10));
        const count = Number(document.getElementById("sr-target-count")?.value) || 1;
        if (count < 1 || count > maxSplits) {
            setSpeedrunSettingsStatus(`Split count must be between 1 and ${maxSplits}.`, true);
            return;
        }
        const manual = document.querySelector('input[name="sr-target-mode"]:checked')?.value === "manual";
        if (manual) {
            const res = readManualThresholds("sr-target-manual", steps);
            if (res.error) { setSpeedrunSettingsStatus(res.error, true); return; }
            thresholds = res.values;
        } else {
            thresholds = computeAutoThresholds(steps, count);
        }
    }

    setSpeedrunSettingsStatus("");

    speedrunConfig = { mode, target, thresholds, hintOn, eligibleForBoard, scope, targetBuildResults };
    speedrunScopeSet = scopeSet;
    speedrunRun = { startedAt: null, splits: [], finished: false, finishMs: null };
    speedrunActive = true;

    // Fresh base-4 dataset on the speedrun keys; the normal save is
    // untouched and waiting for endSpeedrun().
    discovered.clear();
    BASE_ELEMENTS.forEach(el => discovered.add(el));
    discoveryOrder = [...BASE_ELEMENTS];
    discoveryTimestamps = Object.fromEntries(BASE_ELEMENTS.map(el => [el, 0]));
    reconciledUnknownElements = new Set();
    first = null;
    lastDiscovered = null;
    saveProgress();
    persistSpeedrunState();

    // Hint mode: applied in memory only, NOT written to the normal
    // preference key — the player's usual setting comes back untouched
    // when the run ends.
    hintModeEnabled = hintOn;
    applySpeedrunHintLockUi();
    if (hintOn) resetHintIdleTimer(); else stopHintIdleTimer();

    applySpeedrunActiveUi();
    updateProgressDisplays();
    render();
    treeDirty = true;
    setsDirty = true;

    // Straight into playing — the timer starts on their first tile click.
    document.querySelector('button.tab-button[data-tab="lab"]')?.click();

    // Ceremonial countdown. The overlay blocks tile clicks while it runs,
    // so the clock (first-click-started) can't begin until it clears.
    await runSpeedrunCountdown();
}

// Adapted from Ghost's own sketch — same sequential-await structure,
// reskinned onto a themed overlay, and "Go!" swapped for "Alchemy!!".
let srCountdownRunning = false;
async function runSpeedrunCountdown() {
    const overlay = document.getElementById("sr-countdown-overlay");
    const text = document.getElementById("sr-countdown-text");
    if (!overlay || !text) return;
    srCountdownRunning = true;
    overlay.hidden = false;
    for (const step of ["3", "2", "1"]) {
        text.textContent = step;
        await new Promise(r => setTimeout(r, 1000));
    }
    text.textContent = "Alchemy!!";
    await new Promise(r => setTimeout(r, 500));
    text.textContent = "";
    overlay.hidden = true;
    srCountdownRunning = false;
}

function endSpeedrun() {
    if (!speedrunActive) return;
    stopSpeedrunTimerInterval();

    // Clear the speedrun dataset while its keys are still active…
    resetProgress();
    speedrunActive = false;
    speedrunConfig = null;
    speedrunScopeSet = null;
    speedrunRun = null;
    persistSpeedrunState();

    // …then reload the untouched normal save.
    discovered.clear();
    BASE_ELEMENTS.forEach(el => discovered.add(el));
    discoveryOrder = [...BASE_ELEMENTS];
    discoveryTimestamps = Object.fromEntries(BASE_ELEMENTS.map(el => [el, 0]));
    reconciledUnknownElements = new Set();
    loadProgress();
    loadHintModePreference();
    applySpeedrunHintLockUi();
    applySpeedrunActiveUi();
    updateProgressDisplays();
    render();
    treeDirty = true;
    setsDirty = true;
}

// ---------- UI state ----------

function applySpeedrunHintLockUi() {
    const btn = document.getElementById("hint-mode-toggle");
    if (!btn) return;
    btn.disabled = speedrunActive;
    btn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
    btn.classList.toggle("muted", !hintModeEnabled);
    const note = document.getElementById("hint-lock-note");
    if (note) note.hidden = !speedrunActive;
}

function applySpeedrunActiveUi() {
    const bar = document.getElementById("speedrun-timer-bar");
    if (bar) bar.hidden = !speedrunActive;

    const settings = document.getElementById("sr-settings");
    if (settings) settings.hidden = speedrunActive;

    const active = document.getElementById("sr-active");
    if (active) active.hidden = !speedrunActive || (speedrunRun && speedrunRun.finished);

    const finish = document.getElementById("sr-finish");
    if (finish) finish.hidden = !(speedrunActive && speedrunRun && speedrunRun.finished);

    const modeLine = document.getElementById("sr-active-mode");
    if (modeLine && speedrunConfig) {
        modeLine.textContent = speedrunConfig.mode === "completionist"
            ? "Completionist run — discover everything."
            : `Target run — reach "${speedrunConfig.target}".`;
    }

    const goalLine = document.getElementById("speedrun-goal");
    if (goalLine) {
        goalLine.hidden = !(speedrunActive && speedrunConfig && speedrunConfig.mode === "target");
        if (speedrunConfig && speedrunConfig.target) goalLine.textContent = `GOAL: ${speedrunConfig.target}`;
    }

    updateSpeedrunTimerDisplays();
    renderSpeedrunSplitsLog();
    if (speedrunActive && speedrunRun && speedrunRun.startedAt && !speedrunRun.finished) {
        startSpeedrunTimerInterval();
    }
}

// ---------- Local run history (all finished runs, eligible or not) ----------

const SPEEDRUN_HISTORY_KEY = "alchemy_speedrun_history";
const SPEEDRUN_HISTORY_CAP = 50; // newest kept; prevents unbounded localStorage growth

function loadSpeedrunHistory() {
    try {
        const raw = localStorage.getItem(SPEEDRUN_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn("Could not load speedrun history:", e);
        return [];
    }
}

function recordSpeedrunHistory() {
    if (!speedrunConfig || !speedrunRun || !speedrunRun.finished) return;
    try {
        const history = loadSpeedrunHistory();
        history.unshift({
            mode: speedrunConfig.mode,
            target: speedrunConfig.target || null,
            hintOn: !!speedrunConfig.hintOn,
            eligible: !!speedrunConfig.eligibleForBoard,
            timeMs: speedrunRun.finishMs,
            splits: speedrunRun.splits.slice().sort((a, b) => a.at - b.at),
            at: Date.now(),
        });
        localStorage.setItem(SPEEDRUN_HISTORY_KEY, JSON.stringify(history.slice(0, SPEEDRUN_HISTORY_CAP)));
    } catch (e) {
        console.warn("Could not record speedrun history:", e);
    }
    renderSpeedrunHistory();
}

function renderSpeedrunHistory() {
    const list = document.getElementById("sr-history-list");
    if (!list) return;
    list.innerHTML = "";
    const history = loadSpeedrunHistory();
    if (history.length === 0) {
        const p = document.createElement("p");
        p.className = "sr-note";
        p.textContent = "No finished runs yet.";
        list.appendChild(p);
        return;
    }
    history.forEach(run => {
        const p = document.createElement("p");
        p.className = "sr-log-line";
        const kind = run.mode === "target" ? `Target \u00b7 ${run.target}` : "Completionist";
        const when = new Date(run.at).toLocaleString();
        p.textContent = `${kind} \u2014 ${formatRunTime(run.timeMs)} \u2014 Hint ${run.hintOn ? "On" : "Off"}${run.eligible ? "" : " \u2014 local only (started below 100%)"} \u2014 ${when}`;
        list.appendChild(p);
    });
}

function showSpeedrunFinishBlock() {
    applySpeedrunActiveUi();
    const summary = document.getElementById("sr-finish-summary");
    if (summary && speedrunRun) {
        const what = speedrunConfig.mode === "completionist"
            ? "Completionist run finished"
            : `Target run finished — "${speedrunConfig.target}" reached`;
        summary.textContent = `${what} in ${formatRunTime(speedrunRun.finishMs)}.`;
    }

    const sendArea = document.getElementById("sr-send-area");
    const ineligibleNote = document.getElementById("sr-ineligible-note");
    const eligible = !!(speedrunConfig && speedrunConfig.eligibleForBoard);
    if (sendArea) sendArea.hidden = !eligible;
    if (ineligibleNote) ineligibleNote.hidden = eligible;
}

// ---------- Webhook (name filter copied from suggest.js, where it's
// already tested against leet-speak and separator evasion) ----------

const SR_BLOCKED_TERM_ROOTS = ["nigger", "nigga", "faggot", "kike", "tranny"];
const SR_LEET_MAP = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
    "7": "t", "8": "b", "@": "a", "$": "s", "!": "i"
};

function srNormalizeForFilter(text) {
    let normalized = text.toLowerCase();
    normalized = normalized.split("").map(ch => SR_LEET_MAP[ch] || ch).join("");
    normalized = normalized.replace(/[^a-z]/g, "");
    return normalized;
}

function srNameIsBlocked(name) {
    if (!name) return "Enter a name first.";
    if (name.length > 64) return "Name is too long — keep it under 64 characters.";
    if (/(https?:\/\/|www\.|discord\.gg|\.com|\.net|\.org|\.gg)/i.test(name)) {
        return "Links aren't allowed in the runner name.";
    }
    const normalized = srNormalizeForFilter(name);
    if (SR_BLOCKED_TERM_ROOTS.some(term => normalized.includes(term))) {
        return "That name isn't allowed.";
    }
    return null;
}

function setSpeedrunWebhookStatus(msg, isError) {
    const el = document.getElementById("sr-webhook-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("sr-status-err", !!isError);
}

function buildSpeedrunSplitFields() {
    const unit = speedrunConfig.mode === "completionist" ? "elements" : "steps";
    const lines = speedrunRun.splits
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((s, i) => `Split ${i + 1} — ${s.at} ${unit}: ${formatRunTime(s.ms)}`);
    if (lines.length === 0) return [{ name: "Splits", value: "None recorded." }];

    // Discord caps a field's value at 1024 characters — chunk if needed.
    const fields = [];
    let current = [];
    let currentLen = 0;
    lines.forEach(line => {
        if (currentLen + line.length + 1 > 1000) {
            fields.push(current);
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    });
    if (current.length > 0) fields.push(current);
    return fields.map((chunk, i) => ({
        name: fields.length === 1 ? "Splits" : `Splits (${i + 1}/${fields.length})`,
        value: chunk.join("\n"),
    }));
}

async function sendSpeedrunWebhook() {
    if (!speedrunRun || !speedrunRun.finished) return;

    // Belt-and-suspenders with the hidden UI: even a direct call refuses.
    if (!speedrunConfig || !speedrunConfig.eligibleForBoard) {
        setSpeedrunWebhookStatus("This run started below 100% completion, so it isn't eligible for the community board \u2014 it's kept in your local history instead.", true);
        return;
    }

    const nameInput = document.getElementById("sr-runner-name");
    const name = (nameInput?.value || "").trim();
    const blocked = srNameIsBlocked(name);
    if (blocked) {
        setSpeedrunWebhookStatus(blocked, true);
        return;
    }

    const isTarget = speedrunConfig.mode === "target";
    const embed = {
        title: isTarget ? `Target Speedrun: ${speedrunConfig.target}` : "Completionist Speedrun",
        color: isTarget ? 10467021 : 8900331, // grey-blue vs light blue
        fields: [
            { name: "Runner", value: name, inline: true },
            { name: "Hint Mode", value: speedrunConfig.hintOn ? "On" : "Off", inline: true },
            { name: "Time", value: formatRunTime(speedrunRun.finishMs), inline: true },
            ...(isTarget ? [{ name: "Target", value: speedrunConfig.target, inline: true }] : []),
            ...buildSpeedrunSplitFields(),
        ],
    };

    setSpeedrunWebhookStatus("Sending…", false);
    try {
        const res = await fetch(SPEEDRUN_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] }),
        });
        if (res.ok || res.status === 204) {
            setSpeedrunWebhookStatus("Sent — your run is on the board.", false);
        } else {
            setSpeedrunWebhookStatus(`Discord rejected it (HTTP ${res.status}) — try again in a moment.`, true);
        }
    } catch (e) {
        setSpeedrunWebhookStatus("Could not reach Discord — check your connection and try again.", true);
    }
}

// ---------- Settings UI ----------

function formatCompletionPercent(count, total) {
    if (total === 0) return "0%";
    return `${parseFloat(((count / total) * 100).toFixed(3))}%`;
}

function rebuildManualSplitInputs(containerId, count, total, unit) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= count; i++) {
        const label = document.createElement("label");
        label.className = "sr-manual-row";
        const span = document.createElement("span");
        span.textContent = `Split ${i} at ${unit}:`;
        label.appendChild(span);
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = String(total);
        input.placeholder = String(Math.round((total * i) / count));
        label.appendChild(input);
        container.appendChild(label);
    }
}

function refreshSpeedrunSettingsUi() {
    const warning = document.getElementById("sr-warning");
    const data = ensureSpeedTierData();

    if (!data) {
        if (warning) {
            warning.hidden = false;
            warning.textContent = "Recipes are still loading — settings unlock once they're in.";
        }
        return;
    }

    const count = validDiscoveredCount();
    const total = universe.size;
    if (warning) {
        if (count >= total) {
            warning.hidden = false;
            warning.classList.add("sr-warning-ok");
            warning.textContent = "You're at 100% — runs from here are valid for recognition.";
        } else {
            warning.hidden = false;
            warning.classList.remove("sr-warning-ok");
            warning.textContent = `You're at ${formatCompletionPercent(count, total)} (${count}/${total}). Runs started before 100% use fewer elements, so they won't post to the community board \u2014 they're still timed and saved in your local run history below — finish the game first for an official run.`;
        }
    }

    // Completionist — a premature preview measures against the player's
    // own unlocked set, not the full game they haven't seen yet.
    srPreviewScope = count >= total ? null : new Set([...BASE_ELEMENTS, ...[...discovered].filter(el => universe.has(el))]);
    srPreviewData = srPreviewScope ? computeScopedTierData(srPreviewScope) : data;
    const compTotal = srPreviewScope ? srPreviewScope.size : total;
    const compMax = Math.max(1, Math.ceil(compTotal / 100));
    const compMaxNote = document.getElementById("sr-comp-max");
    if (compMaxNote) compMaxNote.textContent = srPreviewScope
        ? `1 to ${compMax} (your ${compTotal} unlocked elements ÷ 100, rounded up)`
        : `1 to ${compMax} (that's ${total} elements ÷ 100, rounded up)`;
    const compCount = document.getElementById("sr-comp-count");
    if (compCount) {
        compCount.max = String(compMax);
        if (!compCount.value || Number(compCount.value) > compMax) compCount.value = String(Math.min(compMax, 5));
    }

    // Target — default to the current highest-step-length element
    const targetInput = document.getElementById("sr-target-input");
    if (targetInput && !targetInput.value) {
        const def = highestStepLengthElement(srPreviewData);
        if (def) targetInput.value = def;
    }
    refreshTargetDependentSettings();

    rebuildDatalist();
    rebuildManualIfVisible();
    renderSpeedrunHistory();
}

function refreshTargetDependentSettings() {
    const data = srPreviewData || ensureSpeedTierData();
    if (!data) return;
    const target = (document.getElementById("sr-target-input")?.value || "").trim();
    const info = document.getElementById("sr-target-steps");
    const maxNote = document.getElementById("sr-target-max");
    const countInput = document.getElementById("sr-target-count");

    if (!target || !universe.has(target) || !data.tier.has(target) || BASE_ELEMENTS.includes(target)) {
        if (info) info.textContent = target ? "Not a reachable, non-starting element — pick another." : "";
        if (maxNote) maxNote.textContent = "";
        return;
    }

    const steps = buildOrderFor(target, data.bestRecipe).length;
    if (info) info.textContent = `"${target}" takes ${steps} step${steps === 1 ? "" : "s"} at its shortest.`;
    const max = Math.max(1, Math.ceil(steps / 10));
    if (maxNote) maxNote.textContent = `1 to ${max} (${steps} steps ÷ 10, rounded up)`;
    if (countInput) {
        countInput.max = String(max);
        if (!countInput.value || Number(countInput.value) > max) countInput.value = String(Math.min(max, 5));
    }
}

let srDatalistKey = null;
function rebuildDatalist() {
    const key = srPreviewScope ? `scope:${srPreviewScope.size}` : `full:${universe.size}`;
    if (srDatalistKey === key) return;
    const list = document.getElementById("sr-target-datalist");
    if (!list) return;
    list.innerHTML = "";
    const data = srPreviewData || ensureSpeedTierData();
    if (!data) return;
    const pool = srPreviewScope ? [...srPreviewScope] : [...universe];
    pool
        .filter(el => !BASE_ELEMENTS.includes(el) && data.tier.has(el))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .forEach(el => {
            const opt = document.createElement("option");
            opt.value = el;
            list.appendChild(opt);
        });
    srDatalistKey = key;
}

function rebuildManualIfVisible() {
    const compManual = document.querySelector('input[name="sr-comp-mode"]:checked')?.value === "manual";
    const compContainer = document.getElementById("sr-comp-manual");
    if (compContainer) compContainer.hidden = !compManual;
    if (compManual) {
        const count = Number(document.getElementById("sr-comp-count")?.value) || 1;
        rebuildManualSplitInputs("sr-comp-manual", count, srPreviewScope ? srPreviewScope.size : universe.size, "element count");
    }

    const targetManual = document.querySelector('input[name="sr-target-mode"]:checked')?.value === "manual";
    const targetContainer = document.getElementById("sr-target-manual");
    if (targetContainer) targetContainer.hidden = !targetManual;
    if (targetManual) {
        const data = srPreviewData || ensureSpeedTierData();
        const target = (document.getElementById("sr-target-input")?.value || "").trim();
        if (data && universe.has(target) && data.tier.has(target)) {
            const steps = buildOrderFor(target, data.bestRecipe).length;
            const count = Number(document.getElementById("sr-target-count")?.value) || 1;
            rebuildManualSplitInputs("sr-target-manual", count, steps, "step");
        }
    }
}

function setupSpeedrunUi() {
    // Sub-tab switching between the two modes
    document.querySelectorAll('input[name="sr-subtab"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const target = document.querySelector('input[name="sr-subtab"]:checked')?.value === "target";
            const compSection = document.getElementById("sr-comp-section");
            const targetSection = document.getElementById("sr-target-section");
            if (compSection) compSection.hidden = target;
            if (targetSection) targetSection.hidden = !target;
        });
    });

    document.getElementById("sr-target-input")?.addEventListener("input", () => {
        refreshTargetDependentSettings();
        rebuildManualIfVisible();
    });
    document.getElementById("sr-comp-count")?.addEventListener("input", rebuildManualIfVisible);
    document.getElementById("sr-target-count")?.addEventListener("input", rebuildManualIfVisible);
    document.querySelectorAll('input[name="sr-comp-mode"], input[name="sr-target-mode"]').forEach(radio => {
        radio.addEventListener("change", rebuildManualIfVisible);
    });

    document.getElementById("sr-start")?.addEventListener("click", startSpeedrun);
    document.getElementById("sr-end")?.addEventListener("click", endSpeedrun);
    document.getElementById("speedrun-end-btn-top")?.addEventListener("click", endSpeedrun);
    document.getElementById("sr-send")?.addEventListener("click", sendSpeedrunWebhook);
    document.getElementById("sr-skip")?.addEventListener("click", endSpeedrun);
}


window.addEventListener("DOMContentLoaded", async () => {
    // Checked first, before anything else runs — this is what makes the
    // lock survive a refresh. A refresh re-runs this whole handler, and
    // this check is still the very first thing it does.
    loadSoundPreference(); // must run before the penalty check below — showPenaltyLock plays a jingle and needs the player's actual saved preference, not the hardcoded default
    loadMusicPreference();
    // If music was left off last time, start the whole page silent rather
    // than SFX-on-but-no-music — the Sound toggle is now the single
    // "everything on" switch (see setupSoundToggle), so this keeps its
    // starting state consistent with what that toggle actually controls.
    if (!musicEnabled) soundEnabled = false;

    const anticheatState = loadAnticheatState();
    if (anticheatState.penaltyUntil && Date.now() < anticheatState.penaltyUntil) {
        showPenaltyLock(anticheatState.penaltyUntil);
        return; // no combining, no saving, nothing else initializes until this clears — including background music, which only makes sense during normal play
    }

    loadSpeedrunState(); // MUST precede loadProgress — sets speedrunActive so activeKey() routes to the run's own data
    loadProgress();
    loadDeadEndCollapsePreference();
    loadSortModePreference();
    loadHintModePreference();
    if (speedrunActive && speedrunConfig) {
        // Mid-run reload: the wizard-chosen hint state overrides the
        // normal preference for the run's duration, exactly as at start.
        hintModeEnabled = !!speedrunConfig.hintOn;
    }
    loadAiNoticePreference();
    loadColorologyPrefs();
    setupTabs();
    setupSearch();
    setupBackupControls();
    setupResetControl();
    setupSoundToggle();
    setupMusicToggle();
    setupMusicVolumeSlider();
    armFirstInteractionMusicStart();
    setupDeadEndToggle();
    setupSortToggle();
    setupHintModeToggle();
    setupSpeedrunUi();
    if (speedrunActive) {
        // Mid-run reload: re-lock hint mode, re-show the timer bar and
        // active/finish blocks, and restart the clock if it was running.
        applySpeedrunHintLockUi();
        applySpeedrunActiveUi();
    }
    setupAiNoticeAck();
    setupColorologyPopup();
    setupColorologyToggle();
    setupSimpleToggles();
    setupRecipeReload();
    setupTreeSearch();

    await loadRecipes();
    updateRecipesStatusDisplay();

    // Each wrapped independently — a bug in any ONE of these (say, an edge
    // case only a much larger recipe set exposes) must not be able to take
    // out the others, or worse, prevent render() and hiding the loading
    // screen from ever running below. That used to all live in one
    // unguarded sequence.
    try {
        renderOrphanReport();
    } catch (e) {
        console.error("Orphan report failed:", e);
    }
    try {
        renderCaseCollisionReport();
    } catch (e) {
        console.error("Case collision report failed:", e);
    }
    try {
        renderConflictingRecipesReport();
    } catch (e) {
        console.error("Conflicting recipes report failed:", e);
    }
    try {
        checkExistingDiscoveriesForColorology();
    } catch (e) {
        console.error("Colorology check failed:", e);
    }
    try {
        validateDiscoveryPlausibility();
    } catch (e) {
        console.error("Plausibility check failed:", e);
    }
    try {
        validateDiscoveryTiming();
    } catch (e) {
        console.error("Timing check failed:", e);
    }
    try {
        checkNativeFunctionsIntact();
    } catch (e) {
        console.error("Native function check failed:", e);
    }

    setInterval(() => {
        try {
            checkNativeFunctionsIntact();
        } catch (e) {
            console.error("Native function check failed:", e);
        }
        try {
            validateDiscoveryPlausibility();
        } catch (e) {
            console.error("Plausibility check failed:", e);
        }
        try {
            validateDiscoveryTiming();
        } catch (e) {
            console.error("Timing check failed:", e);
        }
        try {
            pruneExpiredStrikes();
        } catch (e) {
            console.error("Strike pruning failed:", e);
        }
    }, 30000); // cheap checks — a handful of toString() calls and a couple passes over discovered elements, negligible even on battery

    updateProgressDisplays();
    render();
    if (hintModeEnabled) resetHintIdleTimer();
    // Tree is intentionally NOT built here — it's the hidden tab on load,
    // so building a 150+ node force graph before anyone's asked to see it
    // was pure wasted startup work. It builds lazily on first visit via
    // ensureTreeUpToDate().

    document.getElementById("page-loader")?.classList.add("hidden");
});

// Safety net independent of how fast (or slow) the load actually is —
// a bad connection on the visitor's end isn't something any amount of
// optimizing here can promise around. Suppressed entirely during an
// active penalty lock, which has no skip by design.
setTimeout(() => {
    if (isPenaltyLocked) return;
    const skipBtn = document.getElementById("page-loader-skip");
    if (skipBtn) skipBtn.hidden = false;
}, 15000);

document.getElementById("page-loader-skip")?.addEventListener("click", () => {
    if (isPenaltyLocked) return;
    document.getElementById("page-loader-skip").hidden = true;
    const confirmBox = document.getElementById("page-loader-skip-confirm");
    if (confirmBox) confirmBox.hidden = false;
});

document.getElementById("page-loader-skip-cancel-btn")?.addEventListener("click", () => {
    const confirmBox = document.getElementById("page-loader-skip-confirm");
    if (confirmBox) confirmBox.hidden = true;
    const skipBtn = document.getElementById("page-loader-skip");
    if (skipBtn) skipBtn.hidden = false;
});

document.getElementById("page-loader-skip-confirm-btn")?.addEventListener("click", () => {
    if (isPenaltyLocked) return;
    // Only hides the overlay — the DOMContentLoaded handler's own
    // await loadRecipes() call is a completely separate execution path
    // that was never gated on the loader's visibility in the first place.
    // It keeps running exactly as it would have, and once it resolves,
    // render()/updateProgressDisplays() still fire normally and bring
    // the UI up to date on their own.
    document.getElementById("page-loader")?.classList.add("hidden");
});

window.addEventListener("resize", () => {
    const graphWrap = document.getElementById("tree-graph-wrap");
    if (graphWrap && !graphWrap.hidden) renderGraph();
});

})();
