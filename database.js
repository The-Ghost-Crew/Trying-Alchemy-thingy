(function () {
"use strict";

const ELEMENT_ICON_DIR = "element-icons/";
const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

// Mirrors the hardcoded wildcard element from game.js — always present
// here too, with its own bespoke detail page instead of the normal
// made-from/combines-into layout.
const NOTHING_HAPPENS = "nothing happens";

// ---------- Colorology ----------
// Mirrors the same table in game.js — an element that happens to share
// a name with a real, named color gets a stamp on its detail page here.
// Unlike the live game, there's no popup timing to worry about, so base
// elements aren't excluded — water/fire/earth genuinely are colorology
// matches, and this is a reference tool, not a play-through experience.
//
// Populated asynchronously from colorology-data.json (see
// loadColorologyData below) rather than hardcoded here — that file is
// regenerated on a schedule by a GitHub Action pulling from the
// color-name-list package, which keeps growing over time on its own.
let COLOROLOGY_COLORS = {};

function colorologyHex(element) {
    return COLOROLOGY_COLORS[element.toLowerCase()] || null;
}

// Fire-and-forget, same reasoning as the live game: this is a reference
// tool's cosmetic extra, not something worth ever blocking on. If the
// fetch fails, COLOROLOGY_COLORS just stays empty and colorologyHex()
// keeps returning null, same as before this feature existed.
async function loadColorologyData() {
    try {
        const res = await fetch("colorology-data.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = await res.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("colorology-data.json did not contain the expected object shape");
        }
        COLOROLOGY_COLORS = parsed;
        // Refresh whatever's actually on screen so newly-colorable tiles
        // show up without needing a manual reload.
        if (!document.getElementById("browse-view").classList.contains("hidden")) {
            renderBrowse();
        } else {
            const currentHash = decodeURIComponent(location.hash.slice(1));
            const currentName = currentHash === "nothing_happens" ? NOTHING_HAPPENS : currentHash;
            if (currentName && universe.has(currentName)) renderDetail(currentName);
        }
    } catch (e) {
        console.warn("Could not load colorology data — continuing without it:", e);
    }
}


// ---------- Recipe data ----------
//
// Generalized to N ingredients (>= 2), matching what a mod file uploaded
// through the Mods system can define — not just the fixed 2-ingredient
// shape of the real recipes.js. There's deliberately no sorted-key lookup
// dict here: this tool only ever needs to CATALOG relationships (made
// from / combines into / tiers), never decide a single winning result
// the way actual gameplay code has to. That means base-game and uploaded
// recipes can simply accumulate together — no override tracking needed,
// and ordered-component mods (X+Y=A, Y+X=B as two genuinely different
// recipes) are preserved correctly for free, since nothing ever sorts or
// merges by key.

const recipeList = [];
const universe = new Set([...BASE_ELEMENTS, NOTHING_HAPPENS]);
const recipesByElement = new Map();
const missingIcons = new Set();
const seenRecipeSignatures = new Set(); // exact (ingredients in given order + result) dedup

function indexRecipe(el, entry) {
    if (!recipesByElement.has(el)) recipesByElement.set(el, []);
    recipesByElement.get(el).push(entry);
}

function recipe(...args) {
    if (args.length < 3) return; // needs at least 2 ingredients + 1 result

    const ingredients = args.slice(0, -1).map(x => String(x).trim());
    const result = String(args[args.length - 1]).trim();

    const signature = ingredients.join("|") + "=>" + result;
    if (seenRecipeSignatures.has(signature)) return; // exact duplicate — skip, don't clutter the listings
    seenRecipeSignatures.add(signature);

    const entry = { ingredients, result };
    recipeList.push(entry);
    new Set(ingredients).forEach(ing => indexRecipe(ing, entry));

    ingredients.forEach(i => universe.add(i));
    universe.add(result);
}

function resetRecipeData() {
    recipeList.length = 0;
    universe.clear();
    universe.add(NOTHING_HAPPENS);
    BASE_ELEMENTS.forEach(el => universe.add(el));
    recipesByElement.clear();
    seenRecipeSignatures.clear();
    tierData = null;
}

async function loadRecipes() {
    const res = await fetch("recipes.js", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    const runRecipes = new Function("recipe", code);
    runRecipes(recipe);
}

// ---------- Tiers + shortest path ----------
//
// tier(x) = 0 for the four starting elements. For everything else, it's
// the SHORTEST possible depth achievable by any recipe that produces it —
// 1 + the highest of ITS ingredients' own tiers, minimized across every
// recipe that makes it, not just whichever one happens to be listed
// first in the file. bestRecipe records which specific recipe actually
// achieves that minimum, which the shortest-path view then walks back
// through.

function computeTiers() {
    const tier = new Map();
    const bestRecipe = new Map();

    BASE_ELEMENTS.forEach(el => tier.set(el, 0));

    let changed = true;
    while (changed) {
        changed = false;
        recipeList.forEach(entry => {
            if (entry.ingredients.some(i => !tier.has(i))) return;
            const candidate = Math.max(...entry.ingredients.map(i => tier.get(i))) + 1;
            if (!tier.has(entry.result) || candidate < tier.get(entry.result)) {
                tier.set(entry.result, candidate);
                bestRecipe.set(entry.result, entry);
                changed = true;
            }
        });
    }

    return { tier, bestRecipe };
}

// Flattens the minimal recipe tree for a target into a deduplicated,
// dependency-ordered build sequence — each intermediate element appears
// only once, even if it's reused as an ingredient more than once further
// up the tree.
function buildOrder(target, bestRecipe) {
    const visited = new Set(BASE_ELEMENTS);
    const order = [];

    function visit(el) {
        if (visited.has(el)) return;
        visited.add(el);
        const entry = bestRecipe.get(el);
        if (!entry) return; // unreachable from the base elements
        entry.ingredients.forEach(visit);
        order.push(entry);
    }

    visit(target);
    return order;
}

let tierData = null; // set once loadRecipes() resolves

// Step length is a genuinely different measurement from tier: tier is
// recipe DEPTH (how many layers), step length is the total COUNT of
// unique elements in the shortest full build order. An element can have
// a shallow tier but a huge step length if its dependency tree is wide
// rather than deep. Computed once for every element via memoized set
// union (processed in tier order, so each element's dependency set is
// built from its ingredients' ALREADY-computed sets) rather than
// re-walking the tree from scratch per element — verified to produce
// identical results to a naive per-element walk, just far more
// efficiently across ~2000 elements.
function computeStepLengths(bestRecipe, tier) {
    const depSet = new Map();
    BASE_ELEMENTS.forEach(el => depSet.set(el, new Set()));

    const sortedByTier = [...tier.keys()]
        .filter(el => !BASE_ELEMENTS.includes(el))
        .sort((a, b) => tier.get(a) - tier.get(b));

    sortedByTier.forEach(el => {
        const entry = bestRecipe.get(el);
        if (!entry) return;
        const combined = new Set([el]);
        entry.ingredients.forEach(ing => {
            const s = depSet.get(ing) || new Set();
            s.forEach(x => combined.add(x));
        });
        depSet.set(el, combined);
    });

    const stepLength = new Map();
    depSet.forEach((set, el) => stepLength.set(el, set.size));
    return stepLength;
}

// ---------- Icons (same logic as game.js, verbatim) ----------

function elementIconSlug(element) {
    return element.trim().replace(/\s+/g, "-");
}

function elementIconPath(element) {
    // "nothing happens" is the one exception — a JPEG instead of an SVG,
    // underscore instead of a hyphen — matching the actual file that
    // exists for it, mirroring the same special case in game.js.
    if (element === NOTHING_HAPPENS) return `${ELEMENT_ICON_DIR}nothing_happens.jpeg`;
    return `${ELEMENT_ICON_DIR}${encodeURIComponent(elementIconSlug(element))}.svg`;
}

function tryLoadIcon(element, imgEl) {
    if (missingIcons.has(element)) {
        imgEl.hidden = true;
        return;
    }
    imgEl.src = elementIconPath(element);
    imgEl.alt = "";
    imgEl.hidden = false;
    imgEl.onerror = () => {
        missingIcons.add(element);
        imgEl.hidden = true;
    };
}

// ---------- Navigation ----------

function showElement(name) {
    if (!universe.has(name)) return;
    // The wildcard gets the memorable secret phrase instead of its
    // URL-encoded literal name (which would read as "nothing%20happens").
    location.hash = name === NOTHING_HAPPENS ? "#nothing_happens" : `#${encodeURIComponent(name)}`;
    renderDetail(name);
}

function showBrowse() {
    stopNothingMessages();
    document.body.classList.remove("void");
    const results = document.getElementById("search-results");
    if (results) results.innerHTML = "";
    location.hash = "";
    document.getElementById("browse-view").classList.remove("hidden");
    document.getElementById("detail-view").classList.remove("active");
}

function elementLink(name) {
    const a = document.createElement("a");
    a.href = `#${encodeURIComponent(name)}`;
    a.textContent = name;
    a.addEventListener("click", e => {
        e.preventDefault();
        showElement(name);
    });
    return a;
}

let browseSortMode = "tier";
let browseSearchQuery = ""; // lowercased, for matching
let browseSearchQueryRaw = ""; // original casing, for display text only

function renderBrowse() {
    if (browseSortMode === "steps") renderBrowseByStepLength();
    else renderBrowseByTier();
}

function setupSortToggle() {
    const buttons = document.querySelectorAll(".sort-toggle");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            browseSortMode = btn.dataset.sort;
            buttons.forEach(b => b.classList.toggle("active", b.dataset.sort === browseSortMode));
            renderBrowse();
        });
    });
}

const STEP_LENGTH_DISPLAY_CAP = 100;

function renderBrowseByStepLength() {
    const container = document.getElementById("tier-list");
    container.innerHTML = "";

    const { stepLength } = tierData;
    const ranked = [...universe]
        .filter(el => !BASE_ELEMENTS.includes(el) && stepLength.has(el))
        .sort((a, b) => stepLength.get(b) - stepLength.get(a));

    const query = browseSearchQuery;

    const heading = document.createElement("p");
    heading.className = "tier-heading";
    heading.textContent = "Longest build paths";
    container.appendChild(heading);

    const sub = document.createElement("p");
    sub.className = "tier-sub";
    if (query) {
        const matchCount = ranked.filter(el => el.toLowerCase().includes(query)).length;
        sub.textContent = `Ranked by total unique elements needed in the shortest build order. Showing ${matchCount} match${matchCount === 1 ? "" : "es"} for "${browseSearchQueryRaw}", searched against the full list — rank numbers are each element's true rank, not renumbered for the filtered view.`;
    } else {
        const shownCount = Math.min(STEP_LENGTH_DISPLAY_CAP, ranked.length);
        sub.textContent = `Ranked by total unique elements needed in the shortest build order — not the same as tier, which only measures recipe depth. Showing the top ${shownCount} of ${ranked.length} reachable elements.`;
    }
    container.appendChild(sub);

    // Rank numbers are computed against the FULL list first, then the
    // list is filtered for display — so a match keeps its true rank
    // (e.g. "#47") instead of being renumbered relative to the filtered
    // subset, which is what "still correct data" means here.
    const withRank = ranked.map((el, i) => ({ el, rank: i + 1 }));
    const visible = query
        ? withRank.filter(x => x.el.toLowerCase().includes(query))
        : withRank.slice(0, STEP_LENGTH_DISPLAY_CAP);

    visible.forEach(({ el, rank }) => {
        const row = document.createElement("div");
        row.className = "rank-row";

        const rankEl = document.createElement("span");
        rankEl.className = "rank-num";
        rankEl.textContent = `${rank}.`;
        row.appendChild(rankEl);

        const link = elementLink(el);
        link.className = "rank-name";
        row.appendChild(link);

        const count = document.createElement("span");
        count.className = "rank-count";
        count.textContent = `${stepLength.get(el)} steps`;
        row.appendChild(count);

        container.appendChild(row);
    });
}

// ---------- Browse view: tier-grouped listing ----------

function renderBrowseByTier() {
    const container = document.getElementById("tier-list");
    container.innerHTML = "";

    const { tier } = tierData;
    const maxTier = Math.max(0, ...[...tier.values()]);

    const query = browseSearchQuery;

    for (let t = 0; t <= maxTier; t++) {
        const elementsAtTier = [...universe]
            .filter(el => tier.get(el) === t && (!query || el.toLowerCase().includes(query)))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        if (elementsAtTier.length === 0) continue; // includes: this tier had matches before filtering, but none survived the search — heading correctly disappears too, not just the tiles

        const heading = document.createElement("p");
        heading.className = "tier-heading";
        heading.textContent = t === 0 ? "Starting elements" : `Tier ${t}`;
        container.appendChild(heading);

        const sub = document.createElement("p");
        sub.className = "tier-sub";
        sub.textContent = t === 0
            ? "Available from the very start."
            : `Reachable using only tier ${t - 1} elements or lower.`;
        container.appendChild(sub);

        const grid = document.createElement("div");
        grid.className = "element-grid";
        elementsAtTier.forEach(el => grid.appendChild(makeElementTile(el)));
        container.appendChild(grid);

        // The wildcard is deliberately NOT shown here — it's hidden on
        // purpose, reachable only via the secret #nothing_happens hash,
        // not through normal browsing.
    }

    // Anything in universe with no tier at all is unreachable from the
    // base elements — same concept as the main game's orphan report.
    // The wildcard is deliberately excluded here (see above).
    const unreachable = [...universe]
        .filter(el => !tier.has(el) && el !== NOTHING_HAPPENS && (!query || el.toLowerCase().includes(query)))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (unreachable.length > 0) {
        const heading = document.createElement("p");
        heading.className = "tier-heading";
        heading.textContent = "Unreachable";
        container.appendChild(heading);

        const sub = document.createElement("p");
        sub.className = "tier-sub";
        sub.textContent = "Never produced by any recipe — can't currently be reached from the starting elements.";
        container.appendChild(sub);

        const grid = document.createElement("div");
        grid.className = "element-grid";
        unreachable.forEach(el => grid.appendChild(makeElementTile(el)));
        container.appendChild(grid);
    }
}

function makeElementTile(el) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "element-tile";
    if (el === NOTHING_HAPPENS) btn.classList.add("nothing-happens-tile");

    const hex = colorologyHex(el);
    if (hex) {
        btn.classList.add("colorology-tile");
        btn.style.background = hex;
        // Same perceived-luminance check used in alchemy_index.html —
        // picks readable text for whichever real color lands here.
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        btn.style.color = luminance > 150 ? "#14151f" : "#f4f1e8";
        btn.style.borderColor = luminance > 150 ? "rgba(20,21,31,0.35)" : "rgba(244,241,232,0.35)";
    }

    const img = document.createElement("img");
    img.hidden = true;
    tryLoadIcon(el, img);
    btn.appendChild(img);

    btn.title = el; // full name always available, even when the visible label is truncated
    const label = document.createElement("span");
    label.className = "tile-label";
    label.textContent = el;
    btn.appendChild(label);
    btn.addEventListener("click", () => showElement(el));
    return btn;
}

// ---------- Detail view ----------

const NOTHING_MESSAGES = [
    "Nothing is here.",
    "This entry was never finished.",
    "No record exists.",
    "Still nothing.",
    "The archivist made no note here.",
    "Someone erased this before you arrived.",
    "Struck from the record.",
    "This is the whole page.",
    "Don't stare too long.",
    "Some entries are better left blank.",
    "It's still watching this space.",
    "You weren't the first to come looking.",
    "Nothing happened, as advertised.",
    "You weren't meant to find this page.",
    "The book has nothing more to say.",
];
let nothingMessageInterval = null;

function stopNothingMessages() {
    if (nothingMessageInterval) {
        clearInterval(nothingMessageInterval);
        nothingMessageInterval = null;
    }
}

function renderDetail(name) {
    document.getElementById("browse-view").classList.add("hidden");
    document.getElementById("detail-view").classList.add("active");
    const results = document.getElementById("search-results");
    if (results) results.innerHTML = "";

    document.getElementById("detail-name").textContent = name;

    const icon = document.getElementById("detail-icon");
    tryLoadIcon(name, icon);

    const stamp = document.getElementById("detail-colorology-stamp");
    if (stamp) {
        const hex = colorologyHex(name);
        stamp.hidden = !hex;
        if (hex) {
            stamp.style.background = hex;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
            stamp.style.color = luminance > 150 ? "#14151f" : "#f4f1e8";
        }
    }

    stopNothingMessages(); // always clear any previous rotation before deciding whether to start a new one

    if (name === NOTHING_HAPPENS) {
        document.body.classList.add("void");
        document.getElementById("detail-tier").textContent = "The wildcard";

        const madeFromEl = document.getElementById("detail-made-from");
        const usedInEl = document.getElementById("detail-used-in");
        const pathEl = document.getElementById("detail-path");
        [madeFromEl, usedInEl, pathEl].forEach(el => { el.innerHTML = ""; });

        const msg = document.createElement("p");
        msg.className = "empty-note";
        madeFromEl.appendChild(msg);
        let i = 0;
        msg.textContent = NOTHING_MESSAGES[0];
        nothingMessageInterval = setInterval(() => {
            msg.style.opacity = "0";
            setTimeout(() => {
                i = (i + 1) % NOTHING_MESSAGES.length;
                msg.textContent = NOTHING_MESSAGES[i];
                msg.style.opacity = "1";
            }, 500);
        }, 2600);

        const usedNote = document.createElement("p");
        usedNote.className = "empty-note";
        usedNote.textContent = "Anything it touches becomes this too. There is no exception.";
        usedInEl.appendChild(usedNote);

        const pathNote = document.createElement("p");
        pathNote.className = "empty-note";
        pathNote.textContent = "There is no path here. There was never meant to be one.";
        pathEl.appendChild(pathNote);

        window.scrollTo(0, 0);
        return;
    }

    document.body.classList.remove("void");

    const { tier, bestRecipe } = tierData;
    const tierEl = document.getElementById("detail-tier");
    if (BASE_ELEMENTS.includes(name)) {
        tierEl.textContent = "Starting element";
    } else if (tier.has(name)) {
        tierEl.textContent = `Tier ${tier.get(name)}`;
    } else {
        tierEl.textContent = "Unreachable from the starting elements";
    }

    // Made from
    const madeFromEl = document.getElementById("detail-made-from");
    madeFromEl.innerHTML = "";
    const madeFrom = recipeList.filter(r => r.result === name);
    if (BASE_ELEMENTS.includes(name)) {
        const p = document.createElement("p");
        p.className = "empty-note";
        p.textContent = "This is a starting element — no recipe needed.";
        madeFromEl.appendChild(p);
    } else if (madeFrom.length === 0) {
        const p = document.createElement("p");
        p.className = "empty-note";
        p.textContent = "No known recipe produces this element yet.";
        madeFromEl.appendChild(p);
    } else {
        madeFrom.forEach(r => {
            const card = document.createElement("div");
            card.className = "tree-card";
            const p = document.createElement("p");
            p.className = "tree-origin";
            r.ingredients.forEach((ing, i) => {
                if (i > 0) p.appendChild(document.createTextNode(" + "));
                p.appendChild(elementLink(ing));
            });
            card.appendChild(p);
            madeFromEl.appendChild(card);
        });
    }

    // Combines into
    const usedInEl = document.getElementById("detail-used-in");
    usedInEl.innerHTML = "";
    const usedIn = recipesByElement.get(name) || [];
    if (usedIn.length === 0) {
        const p = document.createElement("p");
        p.className = "empty-note";
        p.textContent = "This is a dead end — it doesn't combine with anything (yet).";
        usedInEl.appendChild(p);
    } else {
        const card = document.createElement("div");
        card.className = "tree-card";
        usedIn
            .slice()
            .sort((x, y) => x.result.localeCompare(y.result, undefined, { sensitivity: "base" }))
            .forEach(r => {
                const others = [...r.ingredients];
                others.splice(others.indexOf(name), 1); // remove exactly ONE instance of this element, not every occurrence
                const p = document.createElement("p");
                p.className = "tree-origin";
                others.forEach((ing, i) => {
                    p.appendChild(document.createTextNode(i === 0 ? "+ " : " + "));
                    p.appendChild(elementLink(ing));
                });
                p.appendChild(document.createTextNode(" \u2192 "));
                p.appendChild(elementLink(r.result));
                card.appendChild(p);
            });
        usedInEl.appendChild(card);
    }

    // Shortest path
    const pathEl = document.getElementById("detail-path");
    const pathLabel = document.getElementById("detail-path-label");
    pathEl.innerHTML = "";
    if (BASE_ELEMENTS.includes(name)) {
        pathLabel.textContent = "Shortest path";
        const p = document.createElement("p");
        p.className = "empty-note";
        p.textContent = "Already a starting element.";
        pathEl.appendChild(p);
    } else if (!tier.has(name)) {
        pathLabel.textContent = "Shortest path";
        const p = document.createElement("p");
        p.className = "empty-note";
        p.textContent = "No path exists — this element can't currently be reached.";
        pathEl.appendChild(p);
    } else {
        const steps = buildOrder(name, bestRecipe);
        pathLabel.textContent = `Shortest path (${steps.length} step${steps.length === 1 ? "" : "s"})`;
        steps.forEach((step, i) => {
            const row = document.createElement("div");
            row.className = "path-step";
            const num = document.createElement("span");
            num.className = "step-num";
            num.textContent = `${i + 1}.`;
            row.appendChild(num);
            const rest = document.createElement("span");
            step.ingredients.forEach((ing, j) => {
                if (j > 0) rest.appendChild(document.createTextNode(" + "));
                rest.appendChild(elementLink(ing));
            });
            rest.appendChild(document.createTextNode(" = "));
            rest.appendChild(elementLink(step.result));
            row.appendChild(rest);
            pathEl.appendChild(row);
        });
    }

    window.scrollTo(0, 0);
}

// ---------- Search ----------

function setupSearch() {
    const input = document.getElementById("db-search");
    const results = document.getElementById("search-results");

    input.addEventListener("input", () => {
        browseSearchQueryRaw = input.value.trim();
        browseSearchQuery = browseSearchQueryRaw.toLowerCase();

        const onBrowseView = !document.getElementById("browse-view").classList.contains("hidden");
        if (onBrowseView) {
            results.innerHTML = "";
            renderBrowse();
            return;
        }

        // On a detail page — there's no in-place list to filter here, so
        // this is the one place the dropdown still earns its keep.
        results.innerHTML = "";
        const query = browseSearchQuery;
        if (!query) return;

        [...universe]
            .filter(el => el !== NOTHING_HAPPENS && el.toLowerCase().includes(query))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
            .slice(0, 30)
            .forEach(el => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "search-result-item";
                item.title = el;
                const label = document.createElement("span");
                label.className = "tile-label";
                label.textContent = el;
                item.appendChild(label);

                const badge = document.createElement("span");
                badge.className = "tier-badge";
                const t = tierData.tier;
                badge.textContent = BASE_ELEMENTS.includes(el)
                    ? "start"
                    : t.has(el)
                    ? `tier ${t.get(el)}`
                    : "unreachable";
                item.appendChild(badge);

                item.addEventListener("click", () => {
                    input.value = "";
                    browseSearchQuery = "";
                    browseSearchQueryRaw = "";
                    results.innerHTML = "";
                    showElement(el);
                });
                results.appendChild(item);
            });
    });

    document.addEventListener("click", e => {
        if (!results.contains(e.target) && e.target !== input) results.innerHTML = "";
    });
}

function readUploadedFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Could not read file"));
        reader.readAsText(file);
    });
}

function setCustomLoadStatus(msg, isError) {
    const el = document.getElementById("custom-load-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--red)" : "";
}

// ---------- Recipe ideas ----------
//
// For a chosen tier, the eligible ingredient pool is everything strictly
// below it — the same rule the tier system already uses everywhere else
// (tier N is only ever built from tier N-1 or lower). Every possible
// combination of a given size is generated from that pool and compared
// against what's already defined; whatever's left is a genuine gap.
//
// This is real combinatorial explosion territory — C(500, 3) is over 20
// million — so nothing here runs unless a safety check confirms the
// space is small enough to actually enumerate in a browser first.

function combinationsCount(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k); // symmetry — halves the work for large k
    let result = 1;
    for (let i = 0; i < k; i++) {
        result = (result * (n - i)) / (i + 1);
    }
    return Math.round(result);
}

// A generator, not a materialized array — combinations are produced one
// at a time in lexicographic order, so nothing is built in memory beyond
// what's actually being consumed.
function* generateCombinations(pool, k) {
    const n = pool.length;
    if (k > n || k <= 0) return;
    const indices = Array.from({ length: k }, (_, i) => i);
    while (true) {
        yield indices.map(i => pool[i]);
        let i = k - 1;
        while (i >= 0 && indices[i] === n - k + i) i--;
        if (i < 0) return;
        indices[i]++;
        for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
    }
}

function computeMaxArityInRecipes() {
    let max = 2;
    recipeList.forEach(r => { if (r.ingredients.length > max) max = r.ingredients.length; });
    return max;
}

const IDEAS_COMBINATION_SAFETY_CAP = 300000; // refuse rather than freeze the page past this
const IDEAS_DISPLAY_CAP = 300; // shown even when the search itself succeeds

function findRecipeIdeas(targetTier, arity, requiredElement) {
    const { tier } = tierData;

    const pool = [...universe]
        .filter(el => el !== NOTHING_HAPPENS && tier.has(el) && tier.get(el) <= targetTier - 1)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    if (pool.length < arity) {
        return { error: `Only ${pool.length} element${pool.length === 1 ? "" : "s"} exist${pool.length === 1 ? "s" : ""} below tier ${targetTier} — not enough to form a ${arity}-ingredient combination.` };
    }

    let restPool = pool;
    let restArity = arity;
    if (requiredElement) {
        if (!universe.has(requiredElement) || requiredElement === NOTHING_HAPPENS) {
            return { error: `"${requiredElement}" isn't a known element.` };
        }
        if (!pool.includes(requiredElement)) {
            return { error: `"${requiredElement}" isn't a valid ingredient for tier ${targetTier} — it needs to be tier ${targetTier - 1} or lower itself.` };
        }
        // The optimization: rather than generating every combination and
        // throwing out the ones missing the required element, fix it in
        // place and only combine the remaining slots from the rest of
        // the pool. This is a genuinely smaller search — C(pool-1,
        // arity-1) instead of C(pool, arity) — which can succeed even in
        // cases the unfiltered search would refuse as too large.
        restPool = pool.filter(el => el !== requiredElement);
        restArity = arity - 1;
    }

    const totalPossible = restArity === 0 ? 1 : combinationsCount(restPool.length, restArity);
    if (totalPossible > IDEAS_COMBINATION_SAFETY_CAP) {
        return { error: `${totalPossible.toLocaleString()} possible combinations from a pool of ${pool.length} — too many to check in a browser. Try a lower tier or fewer ingredients.` };
    }

    // Existing combos of EXACTLY this arity, as sorted signatures — a
    // 2-ingredient recipe doesn't "use up" a 3-ingredient combination
    // just because it happens to share two elements with it.
    const existingSignatures = new Set();
    recipeList.forEach(r => {
        if (r.ingredients.length === arity) {
            existingSignatures.add([...r.ingredients].sort().join("|"));
        }
    });

    const missing = [];
    const restCombos = restArity === 0 ? [[]] : generateCombinations(restPool, restArity);
    for (const restCombo of restCombos) {
        const combo = requiredElement ? [requiredElement, ...restCombo] : restCombo;
        const signature = [...combo].sort().join("|");
        if (!existingSignatures.has(signature)) missing.push([...combo].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    }

    return { pool: pool.length, totalPossible, missing, requiredElement };
}

function populateIdeasDropdowns() {
    const tierSelect = document.getElementById("ideas-tier-select");
    const aritySelect = document.getElementById("ideas-arity-select");
    if (!tierSelect || !aritySelect) return;

    const maxTier = Math.max(0, ...[...tierData.tier.values()]);
    tierSelect.innerHTML = "";
    for (let t = 1; t <= maxTier; t++) {
        const opt = document.createElement("option");
        opt.value = String(t);
        opt.textContent = `Tier ${t}`;
        tierSelect.appendChild(opt);
    }

    // Only ever offers arities actually present in the loaded data — the
    // real recipes.js is all 2-ingredient, so this stays at just "2"
    // unless a wider mod file is loaded.
    const maxArity = computeMaxArityInRecipes();
    aritySelect.innerHTML = "";
    for (let a = 2; a <= maxArity; a++) {
        const opt = document.createElement("option");
        opt.value = String(a);
        opt.textContent = String(a);
        aritySelect.appendChild(opt);
    }

    const datalist = document.getElementById("ideas-required-datalist");
    if (datalist) {
        datalist.innerHTML = "";
        [...universe]
            .filter(el => el !== NOTHING_HAPPENS)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
            .forEach(el => {
                const opt = document.createElement("option");
                opt.value = el;
                datalist.appendChild(opt);
            });
    }
}

function renderIdeasResults(result) {
    const status = document.getElementById("ideas-status");
    const resultsEl = document.getElementById("ideas-results");
    resultsEl.innerHTML = "";

    if (result.error) {
        status.textContent = result.error;
        status.style.color = "var(--red)";
        return;
    }

    status.style.color = "";
    const scope = result.requiredElement ? ` including "${result.requiredElement}"` : "";
    const missingCount = result.missing.length;
    if (missingCount === 0) {
        status.textContent = `All ${result.totalPossible.toLocaleString()} possible combinations${scope} already have a recipe — no ideas left here.`;
        return;
    }

    const shown = result.missing.slice(0, IDEAS_DISPLAY_CAP);
    status.textContent = `${missingCount.toLocaleString()} of ${result.totalPossible.toLocaleString()} possible combinations${scope} don't have a recipe yet${
        missingCount > IDEAS_DISPLAY_CAP ? ` — showing the first ${IDEAS_DISPLAY_CAP}` : ""
    }.`;

    shown.forEach(combo => {
        const row = document.createElement("p");
        row.className = "idea-row";
        row.textContent = combo.join(" + ");
        resultsEl.appendChild(row);
    });
}

function setupIdeasPanel() {
    const toggleBtn = document.getElementById("ideas-toggle");
    const panel = document.getElementById("ideas-panel");
    const findBtn = document.getElementById("ideas-find-btn");

    toggleBtn?.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
    });

    findBtn?.addEventListener("click", () => {
        const targetTier = Number(document.getElementById("ideas-tier-select")?.value);
        const arity = Number(document.getElementById("ideas-arity-select")?.value);
        if (!targetTier || !arity) return;

        const requiredRaw = document.getElementById("ideas-required-input")?.value.trim() || "";
        // Typed text is matched case-insensitively against the actual
        // universe, then resolved to the element's real stored casing —
        // findRecipeIdeas() and the recipe signatures it compares against
        // both need the exact casing to match correctly.
        const requiredElement = requiredRaw
            ? [...universe].find(el => el.toLowerCase() === requiredRaw.toLowerCase()) || requiredRaw
            : "";

        const status = document.getElementById("ideas-status");
        status.textContent = "Searching\u2026";
        status.style.color = "";
        document.getElementById("ideas-results").innerHTML = "";

        // Deferred so "Searching..." actually paints before the
        // (capped, but still potentially chunky) computation runs.
        setTimeout(() => {
            renderIdeasResults(findRecipeIdeas(targetTier, arity, requiredElement));
        }, 20);
    });
}

function refreshAfterRecipeChange() {
    tierData = computeTiers();
    tierData.stepLength = computeStepLengths(tierData.bestRecipe, tierData.tier);
    populateIdeasDropdowns();
    const ideasStatus = document.getElementById("ideas-status");
    if (ideasStatus) ideasStatus.textContent = "";
    const ideasResults = document.getElementById("ideas-results");
    if (ideasResults) ideasResults.innerHTML = "";

    // A stale search box/dropdown could reference an element that no
    // longer exists in the newly loaded universe.
    const searchInput = document.getElementById("db-search");
    if (searchInput) searchInput.value = "";
    const searchResults = document.getElementById("search-results");
    if (searchResults) searchResults.innerHTML = "";
    browseSearchQuery = "";
    browseSearchQueryRaw = "";

    showBrowse();
    renderBrowse();
}

function setupCustomLoad() {
    const toggleBtn = document.getElementById("custom-load-toggle");
    const panel = document.getElementById("custom-load-panel");
    const loadBtn = document.getElementById("custom-load-btn");
    const resetBtn = document.getElementById("custom-reset-btn");
    const fileInput = document.getElementById("custom-file-input");
    const fileTrigger = document.getElementById("custom-file-trigger");
    const filenameEl = document.getElementById("custom-file-filename");

    toggleBtn?.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
    });

    // Same fix already proven in the Mods system: a hidden native input
    // triggered via a styled button, with no accept attribute — that
    // attribute is specifically what makes iOS Safari default to the
    // Photo Library / Take Photo sheet instead of going straight to the
    // Files picker. Extension validation happens entirely in JS instead.
    fileTrigger?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (filenameEl) filenameEl.textContent = file ? file.name : "No file selected";
    });

    loadBtn?.addEventListener("click", async () => {
        const file = fileInput?.files?.[0];
        if (!file) {
            setCustomLoadStatus("Choose a file first.", true);
            return;
        }
        if (!file.name.toLowerCase().endsWith(".js")) {
            setCustomLoadStatus(`"${file.name}" isn't a .js file.`, true);
            return;
        }

        const includeBase = document.getElementById("custom-include-base")?.checked === true;

        resetRecipeData();

        // Base loads first so a mod's own results still show up alongside
        // it — see the note on recipe() above for why no override
        // tracking is needed here.
        if (includeBase) {
            try {
                await loadRecipes();
            } catch (e) {
                console.warn("Could not load the official recipes.js for merging:", e);
            }
        }

        let code;
        try {
            code = await readUploadedFile(file);
        } catch (e) {
            setCustomLoadStatus("Could not read that file — try again.", true);
            return;
        }

        try {
            new Function("recipe", code)(recipe);
        } catch (e) {
            setCustomLoadStatus(`That file's format is wrong: ${e.message}. Fix it and upload it again.`, true);
            return;
        }

        if (recipeList.length === 0) {
            setCustomLoadStatus("No valid recipes were found in that file — check the format and try again.", true);
            return;
        }

        refreshAfterRecipeChange();

        setCustomLoadStatus(
            `Loaded ${recipeList.length} recipe${recipeList.length === 1 ? "" : "s"}, ${universe.size} elements from "${file.name}"${includeBase ? " (merged with the official data)" : ""}.`,
            false
        );
        if (resetBtn) resetBtn.hidden = false;
    });

    resetBtn?.addEventListener("click", async () => {
        resetRecipeData();
        setCustomLoadStatus("Reloading official data\u2026", false);
        try {
            await loadRecipes();
        } catch (e) {
            setCustomLoadStatus("Could not reload the official data — try refreshing the page.", true);
            return;
        }
        refreshAfterRecipeChange();
        setCustomLoadStatus("", false);
        resetBtn.hidden = true;
        if (fileInput) fileInput.value = "";
        const filenameEl = document.getElementById("custom-file-filename");
        if (filenameEl) filenameEl.textContent = "No file selected";
    });
}

// ---------- Init ----------

function onReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn);
    } else {
        fn();
    }
}

onReady(async () => {
    document.getElementById("back-to-browse").addEventListener("click", showBrowse);
    setupSearch();
    setupSortToggle();
    setupCustomLoad();
    setupIdeasPanel();

    window.addEventListener("hashchange", () => {
        const raw = decodeURIComponent(location.hash.slice(1));
        const name = raw === "nothing_happens" ? NOTHING_HAPPENS : raw;
        if (name && universe.has(name)) renderDetail(name);
        else showBrowse();
    });

    try {
        await loadRecipes();
    } catch (e) {
        document.getElementById("load-status").textContent = "Could not load recipes.js — try refreshing.";
        console.error(e);
        return;
    }

    tierData = computeTiers();
    tierData.stepLength = computeStepLengths(tierData.bestRecipe, tierData.tier);
    document.getElementById("load-status").hidden = true;
    document.getElementById("sort-toggle-row").hidden = false;
    document.getElementById("custom-load-toggle").hidden = false;
    document.getElementById("ideas-toggle").hidden = false;
    populateIdeasDropdowns();
    renderBrowse();

    const initialRaw = decodeURIComponent(location.hash.slice(1));
    const initial = initialRaw === "nothing_happens" ? NOTHING_HAPPENS : initialRaw;
    if (initial && universe.has(initial)) renderDetail(initial);

    loadColorologyData(); // deliberately not awaited — see the function's own comment for why
});

})();
