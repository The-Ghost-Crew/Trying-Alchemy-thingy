(function () {
"use strict";

const ELEMENT_ICON_DIR = "element-icons/";
const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

// Mirrors the hardcoded wildcard element from game.js — always present
// here too, with its own bespoke detail page instead of the normal
// made-from/combines-into layout.
const NOTHING_HAPPENS = "nothing happens";

// ---------- Recipe data (same 2-ingredient model as the real game.js —
// this reads the actual recipes.js, not the generalized custom-mod one) ----------

const recipes = {};
const recipeList = [];
const universe = new Set([...BASE_ELEMENTS, NOTHING_HAPPENS]);
const recipesByElement = new Map();
const missingIcons = new Set();

function indexRecipe(el, entry) {
    if (!recipesByElement.has(el)) recipesByElement.set(el, []);
    recipesByElement.get(el).push(entry);
}

function recipe(a, b, result) {
    const aT = a.trim();
    const bT = b.trim();
    const resultT = result.trim();
    const key = [aT, bT].sort().join("|");

    if (recipes[key]) return; // silently skip a duplicate, matching the main game's own tolerant behavior

    recipes[key] = resultT;
    const entry = { a: aT, b: bT, result: resultT };
    recipeList.push(entry);
    indexRecipe(aT, entry);
    if (bT !== aT) indexRecipe(bT, entry);

    universe.add(aT);
    universe.add(bT);
    universe.add(resultT);
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
// 1 + the higher of its two ingredients' own tiers, minimized across
// every recipe that makes it, not just whichever one happens to be
// listed first in the file. bestRecipe records which specific recipe
// actually achieves that minimum, which the shortest-path view then
// walks back through.

function computeTiers() {
    const tier = new Map();
    const bestRecipe = new Map();

    BASE_ELEMENTS.forEach(el => tier.set(el, 0));

    let changed = true;
    while (changed) {
        changed = false;
        recipeList.forEach(entry => {
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
        visit(entry.a);
        visit(entry.b);
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
        const setA = depSet.get(entry.a) || new Set();
        const setB = depSet.get(entry.b) || new Set();
        depSet.set(el, new Set([...setA, ...setB, el]));
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

    const heading = document.createElement("p");
    heading.className = "tier-heading";
    heading.textContent = "Longest build paths";
    container.appendChild(heading);

    const sub = document.createElement("p");
    sub.className = "tier-sub";
    const shownCount = Math.min(STEP_LENGTH_DISPLAY_CAP, ranked.length);
    sub.textContent = `Ranked by total unique elements needed in the shortest build order — not the same as tier, which only measures recipe depth. Showing the top ${shownCount} of ${ranked.length} reachable elements.`;
    container.appendChild(sub);

    ranked.slice(0, STEP_LENGTH_DISPLAY_CAP).forEach((el, i) => {
        const row = document.createElement("div");
        row.className = "rank-row";

        const rank = document.createElement("span");
        rank.className = "rank-num";
        rank.textContent = `${i + 1}.`;
        row.appendChild(rank);

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

    for (let t = 0; t <= maxTier; t++) {
        const elementsAtTier = [...universe].filter(el => tier.get(el) === t).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        if (elementsAtTier.length === 0) continue;

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
    const unreachable = [...universe].filter(el => !tier.has(el) && el !== NOTHING_HAPPENS).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
    );
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

    const img = document.createElement("img");
    img.hidden = true;
    tryLoadIcon(el, img);
    btn.appendChild(img);

    btn.appendChild(document.createTextNode(el));
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

    document.getElementById("detail-name").textContent = name;

    const icon = document.getElementById("detail-icon");
    tryLoadIcon(name, icon);

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
            p.appendChild(elementLink(r.a));
            p.appendChild(document.createTextNode(" + "));
            p.appendChild(elementLink(r.b));
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
                const other = r.a === name ? r.b : r.a;
                const p = document.createElement("p");
                p.className = "tree-origin";
                p.appendChild(document.createTextNode("+ "));
                p.appendChild(elementLink(other));
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
            rest.appendChild(elementLink(step.a));
            rest.appendChild(document.createTextNode(" + "));
            rest.appendChild(elementLink(step.b));
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
        const query = input.value.trim().toLowerCase();
        results.innerHTML = "";
        if (!query) return;

        [...universe]
            .filter(el => el !== NOTHING_HAPPENS && el.toLowerCase().includes(query))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
            .slice(0, 30)
            .forEach(el => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "search-result-item";
                item.appendChild(document.createTextNode(el));

                const badge = document.createElement("span");
                badge.className = "tier-badge";
                const t = tierData.tier;
                badge.textContent = BASE_ELEMENTS.includes(el)
                    ? "start"
                    : el === NOTHING_HAPPENS
                    ? "wildcard"
                    : t.has(el)
                    ? `tier ${t.get(el)}`
                    : "unreachable";
                item.appendChild(badge);

                item.addEventListener("click", () => {
                    input.value = "";
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
    renderBrowse();

    const initialRaw = decodeURIComponent(location.hash.slice(1));
    const initial = initialRaw === "nothing_happens" ? NOTHING_HAPPENS : initialRaw;
    if (initial && universe.has(initial)) renderDetail(initial);
});

})();
