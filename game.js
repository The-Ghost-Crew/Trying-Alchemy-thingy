const STORAGE_KEY = "alchemy_discovered_elements";

const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

const discovered = new Set(BASE_ELEMENTS);

const recipes = {};        // lookup: "a|b" -> result
const recipeList = [];     // full list: { a, b, result }
const universe = new Set(BASE_ELEMENTS);
const recipesByElement = new Map(); // element -> recipes it appears in as an ingredient (built once, not scanned each call)

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
}

async function loadRecipes() {
    resetRecipeData();
    try {
        const res = await fetch("recipes.js", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        (0, eval)(code); // indirect eval — runs in global scope so recipe(...) reaches the real function
        recipesLoadStatus = { ok: true, time: new Date(), count: recipeList.length, error: null };
    } catch (e) {
        recipesLoadStatus = { ok: false, time: new Date(), count: recipeList.length, error: e.message };
        console.error("Could not load recipes.js:", e);
    }
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
    await loadRecipes();
    updateProgressDisplays();
    render();
    treeDirty = true;
    updateRecipesStatusDisplay();
}

function setupRecipeReload() {
    const btn = document.getElementById("reload-recipes-btn");
    btn?.addEventListener("click", () => reloadRecipes());
}

function indexRecipe(el, entry) {
    if (!recipesByElement.has(el)) recipesByElement.set(el, []);
    recipesByElement.get(el).push(entry);
}

function recipe(a, b, result) {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const resultLower = result.toLowerCase();

    const key = [aLower, bLower].sort().join("|");

    if (recipes[key]) {
        // Previously this threw and killed every recipe() call after it in
        // the file — one duplicate during editing would silently truncate
        // the whole list. Now it just logs and skips that one line.
        console.warn(`Skipped duplicate combo "${aLower} + ${bLower}" — already makes "${recipes[key]}".`);
        return;
    }

    recipes[key] = resultLower;
    const entry = { a: aLower, b: bLower, result: resultLower };
    recipeList.push(entry);

    indexRecipe(aLower, entry);
    if (bLower !== aLower) indexRecipe(bLower, entry);

    universe.add(aLower);
    universe.add(bLower);
    universe.add(resultLower);
}

function combine(a, b) {
    const key = [a, b].map(x => x.toLowerCase()).sort().join("|");
    return recipes[key] || null;
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

function saveProgress() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...discovered]));
    } catch (e) {
        console.warn("Could not save progress:", e);
    }
}

function loadProgress() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;
        parsed.forEach(el => {
            if (typeof el === "string") discovered.add(el.toLowerCase());
        });
    } catch (e) {
        console.warn("Could not load saved progress:", e);
    }
}

function resetProgress() {
    discovered.clear();
    BASE_ELEMENTS.forEach(el => discovered.add(el));
    first = null;
    lastDiscovered = null;
    if (lastDiscoveredTimer) {
        clearTimeout(lastDiscoveredTimer);
        lastDiscoveredTimer = null;
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
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
        if (soundEnabled) playDiscoverySound(); // quick confirmation blip
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
    const total = universe.size;
    const deadEnds = deadEndDiscoveredCount();
    const complete = count >= total && total > 0;

    document.querySelectorAll(".progress-fraction").forEach(n => (n.textContent = `${count} / ${total}`));
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
    button.textContent = element;
    button.className = "element-tile";
    button.setAttribute("aria-pressed", element === first ? "true" : "false");
    if (element === first) button.classList.add("selected");
    if (isExhausted(element)) button.classList.add("dead-end");
    if (element === lastDiscovered) button.classList.add("just-found");

    button.onclick = () => {
        if (first === null) {
            first = element;
            render();
            return;
        }

        const chosenFirst = first;
        const result = combine(chosenFirst, element);

        const resultEl = document.getElementById("result");
        resultEl.textContent = result
            ? `${chosenFirst} + ${element} = ${result}`
            : `${chosenFirst} + ${element} = nothing happens`;

        resultEl.classList.remove("flash");
        void resultEl.offsetWidth; // restart the animation even for repeat results
        resultEl.classList.add("flash");

        if (result && !discovered.has(result)) {
            discovered.add(result);
            markJustDiscovered(result);
            saveProgress();
            treeDirty = true; // rebuilt lazily next time the Family Tree tab is opened
            playDiscoverySound();
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

function setupDeadEndToggle() {
    const toggle = document.getElementById("dead-end-toggle");
    const box = document.getElementById("dead-end-elements");
    if (!toggle || !box) return;

    const apply = () => {
        box.hidden = deadEndCollapsed;
        toggle.classList.toggle("collapsed", deadEndCollapsed);
    };
    apply();

    toggle.addEventListener("click", () => {
        deadEndCollapsed = !deadEndCollapsed;
        try {
            localStorage.setItem(DEADEND_COLLAPSE_KEY, String(deadEndCollapsed));
        } catch (e) {
            console.warn("Could not save dead-end section preference:", e);
        }
        apply();
    });
}

function render() {
    const activeBox = document.getElementById("elements");
    const deadBox = document.getElementById("dead-end-elements");
    const deadSection = document.getElementById("dead-end-section");
    if (!activeBox || !deadBox) return;

    activeBox.innerHTML = "";
    deadBox.innerHTML = "";

    const query = (document.getElementById("search")?.value || "").toLowerCase().trim();

    const filtered = [...discovered]
        .filter(el => universe.has(el))
        .sort()
        .filter(el => el.includes(query));

    const active = filtered.filter(el => !isExhausted(el));
    const dead = filtered.filter(el => isExhausted(el));

    active.forEach(el => activeBox.appendChild(makeElementTile(el)));
    dead.forEach(el => deadBox.appendChild(makeElementTile(el)));

    if (deadSection) deadSection.hidden = dead.length === 0;
}

// ---------- Shared detail content (used by graph panel AND list view) ----------

function buildDetailFragment(element) {
    const frag = document.createDocumentFragment();

    const heading = document.createElement("h3");
    heading.textContent = element;
    frag.appendChild(heading);

    const origin = recipeList.find(r => r.result === element);
    const originLine = document.createElement("p");
    originLine.className = "tree-origin";
    originLine.textContent = origin ? `Made from ${origin.a} + ${origin.b}` : "Starting element";
    frag.appendChild(originLine);

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
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(buildDetailFragment(element));
}

function renderTreeList() {
    const container = document.getElementById("tree");
    if (!container) return;
    container.innerHTML = "";

    [...discovered]
        .filter(el => universe.has(el))
        .sort()
        .forEach(element => {
            const card = document.createElement("div");
            card.className = "tree-card" + (isExhausted(element) ? " dead-end-card" : "");
            card.appendChild(buildDetailFragment(element));
            container.appendChild(card);
        });
}

// ---------- Family tree: node graph ----------

let simulation = null;
let treeDirty = true; // tree is rebuilt lazily, only when the tab is actually opened
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
    });

    return d3LoadPromise;
}

function ensureTreeUpToDate() {
    if (!treeDirty) return;

    const wrap = document.getElementById("tree-graph-wrap");
    if (wrap && !window.d3) wrap.textContent = "Loading graph…";

    loadD3()
        .then(() => {
            renderTree();
            treeDirty = false;
        })
        .catch(err => {
            console.warn(err);
            // Graph library failed to load (offline, blocked CDN, etc).
            // Fall back to the list view content, which needs no library.
            if (wrap) wrap.textContent = "Graph view unavailable right now — try the List view instead.";
            renderTreeList();
            treeDirty = false;
        });
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

    const nodes = discoveredValid.map(el => ({
        id: el,
        deadEnd: isExhausted(el),
        degree: degree[el] || 0
    }));

    return { nodes, links };
}

function renderGraph() {
    const wrap = document.getElementById("tree-graph-wrap");
    if (!wrap || typeof d3 === "undefined") return;

    // The previous simulation was never stopped here, so every rebuild
    // left the old one running in the background on detached nodes,
    // forever. Over a long session that's several simulations all
    // crunching physics on the same main thread at once.
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

    svg.call(d3.zoom().scaleExtent([0.4, 3]).on("zoom", event => g.attr("transform", event.transform)));

    const link = g.append("g")
        .attr("stroke", "#4a4f68")
        .attr("stroke-width", 1.2)
        .selectAll("line")
        .data(links)
        .join("line");

    const radius = d => 8 + Math.min(d.degree, 6) * 1.4;

    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", radius)
        .attr("fill", d => (d.deadEnd ? "#b5453f" : "#c9a227"))
        .attr("stroke", "#14151f")
        .attr("stroke-width", 1.5)
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

    const label = g.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text(d => d.id)
        .attr("font-size", 9)
        .attr("font-family", "IBM Plex Mono, monospace")
        .attr("fill", "#c7cadb")
        .attr("text-anchor", "middle")
        .attr("dy", d => -radius(d) - 4)
        .style("pointer-events", "none");

    const paint = () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => d.x).attr("cy", d => d.y);
        label.attr("x", d => d.x).attr("y", d => d.y);
    };

    const sim = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(46).strength(0.7))
        .force("charge", d3.forceManyBody().strength(-90))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => radius(d) + 6))
        .stop(); // don't let it auto-run on a per-frame timer

    // Compute the settled layout synchronously in one burst instead of
    // animating ~300 frames of DOM writes. For 150+ nodes this was the
    // single biggest cost of opening this tab.
    const ITERATIONS = 200;
    for (let i = 0; i < ITERATIONS; i++) sim.tick();
    paint();

    // Dragging still re-heats the simulation and repaints live — that's a
    // single-node, user-driven cost, not a full-graph one.
    sim.on("tick", paint);

    simulation = sim;
}

function renderTree() {
    renderGraph();
    renderTreeList();
}

function setViewMode(mode) {
    const graphWrap = document.getElementById("tree-graph-wrap");
    const detail = document.getElementById("tree-detail");
    const list = document.getElementById("tree");
    const isGraph = mode === "graph";

    ensureTreeUpToDate();

    if (graphWrap) graphWrap.hidden = !isGraph;
    if (detail) detail.hidden = true;
    if (list) list.hidden = isGraph;

    document.querySelectorAll(".view-toggle").forEach(btn => btn.classList.toggle("active", btn.dataset.view === mode));
}

// ---------- Backup / transfer ----------

function encodeSave() {
    return btoa(JSON.stringify([...discovered]));
}

function decodeAndMerge(code) {
    const parsed = JSON.parse(atob(code.trim()));
    if (!Array.isArray(parsed)) throw new Error("Not a valid backup code");
    let added = 0;
    parsed.forEach(el => {
        if (typeof el === "string" && !discovered.has(el.toLowerCase())) {
            discovered.add(el.toLowerCase());
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
        const code = encodeSave();
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

        confirmBox.hidden = true;
        resetBtn.hidden = false;

        if (status) {
            status.hidden = false;
            status.textContent = "Progress reset. Starting fresh with air, water, earth, fire.";
        }
    });
}

function setupTabs() {
    const tabButtons = document.querySelectorAll(".tab-button");
    const panels = document.querySelectorAll(".tab-panel");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
            if (btn.dataset.tab === "tree") ensureTreeUpToDate();
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

window.addEventListener("load", async () => {
    loadProgress();
    loadSoundPreference();
    loadDeadEndCollapsePreference();
    setupTabs();
    setupSearch();
    setupBackupControls();
    setupResetControl();
    setupSoundToggle();
    setupDeadEndToggle();
    setupRecipeReload();

    await loadRecipes();
    updateRecipesStatusDisplay();

    updateProgressDisplays();
    render();
    // Tree is intentionally NOT built here — it's the hidden tab on load,
    // so building a 150+ node force graph before anyone's asked to see it
    // was pure wasted startup work. It builds lazily on first visit via
    // ensureTreeUpToDate().
});

window.addEventListener("resize", () => {
    const graphWrap = document.getElementById("tree-graph-wrap");
    if (graphWrap && !graphWrap.hidden) renderGraph();
});
