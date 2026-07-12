(function () {
"use strict";

// ---------- Config state ----------

let configuredMaxArity = 2;
let startingElements = ["air", "water", "fire", "earth"];

// ---------- Recipe data (generalized to N ingredients, unlike the main
// game's fixed 2-ingredient recipe()) ----------

const recipes = {}; // sorted-ingredients-joined -> result
const recipeList = []; // { ingredients: [...], result }
const universe = new Set();
let maxArityFound = 0;
const skippedLines = []; // recipes rejected for arity violations

// Variable-arity: the LAST argument is always the result, everything
// before it is an ingredient. recipe("air","water","water","superMist")
// has 3 ingredients and one result, exactly matching the requested format.
function recipe(...args) {
    if (args.length < 3) {
        skippedLines.push({ args, reason: "needs at least 2 ingredients and a result" });
        return;
    }

    const result = String(args[args.length - 1]).trim();
    const ingredients = args.slice(0, -1).map(x => String(x).trim());
    const arity = ingredients.length;

    if (arity > configuredMaxArity) {
        skippedLines.push({ args, reason: `uses ${arity} ingredients, but the configured max is ${configuredMaxArity}` });
        return;
    }

    const key = [...ingredients].sort().join("|");
    recipes[key] = result;
    recipeList.push({ ingredients, result });
    ingredients.forEach(i => universe.add(i));
    universe.add(result);
    maxArityFound = Math.max(maxArityFound, arity);
}

function resetRecipeData() {
    Object.keys(recipes).forEach(k => delete recipes[k]);
    recipeList.length = 0;
    universe.clear();
    skippedLines.length = 0;
    maxArityFound = 0;
}

// ---------- Starting elements editor ----------

function renderStartingElements() {
    const container = document.getElementById("starting-elements-list");
    if (!container) return;
    container.innerHTML = "";

    startingElements.forEach((el, index) => {
        const chip = document.createElement("span");
        chip.className = "starting-chip";

        const label = document.createElement("span");
        label.textContent = el;
        chip.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "starting-chip-remove";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", `Remove ${el}`);
        removeBtn.title = `Remove ${el}`;
        removeBtn.addEventListener("click", () => {
            startingElements.splice(index, 1);
            renderStartingElements();
        });
        chip.appendChild(removeBtn);

        container.appendChild(chip);
    });
}

function setupStartingElementsEditor() {
    renderStartingElements();

    const addBtn = document.getElementById("add-starting-element-btn");
    const input = document.getElementById("new-starting-element-input");

    const addElement = () => {
        const val = (input?.value || "").trim();
        if (!val) return;
        if (startingElements.includes(val)) {
            showLoadStatus(`"${val}" is already a starting element.`);
            return;
        }
        startingElements.push(val);
        input.value = "";
        renderStartingElements();
    };

    addBtn?.addEventListener("click", addElement);
    input?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            addElement();
        }
    });
}

// ---------- File upload + validation ----------

// Native <input type="file"> can't be restyled directly in any
// cross-browser way — the "Choose File" chrome is OS/browser-rendered
// and resists normal CSS. Standard fix: keep the real input, but hide it
// and trigger it via a button we fully control, then show the picked
// filename in our own themed element instead of the browser's default text.
function setupFileUploadControl() {
    const trigger = document.getElementById("file-upload-trigger");
    const input = document.getElementById("recipe-file-input");
    const filenameEl = document.getElementById("file-upload-filename");

    trigger?.addEventListener("click", () => input?.click());
    input?.addEventListener("change", () => {
        const file = input.files?.[0];
        if (filenameEl) filenameEl.textContent = file ? file.name : "No file selected";
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

function showLoadStatus(msg, isError = false) {
    const el = document.getElementById("load-status");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("load-status-error", isError);
}

const moddedElements = new Set(); // elements introduced specifically by the uploaded file, not the base game

async function handleLoadCustom() {
    const fileInput = document.getElementById("recipe-file-input");
    const file = fileInput?.files?.[0];

    if (startingElements.length === 0) {
        showLoadStatus("You need at least one starting element.", true);
        return;
    }
    if (!file) {
        showLoadStatus("Choose a recipe file first.", true);
        return;
    }
    if (!file.name.toLowerCase().endsWith(".js")) {
        showLoadStatus(`"${file.name}" isn't a .js file. Fix the file and upload it again.`, true);
        return;
    }

    configuredMaxArity = Number(document.getElementById("max-arity-select")?.value) || 2;
    const includeBase = document.querySelector('input[name="include-base"]:checked')?.value === "yes";
    hintModeEnabled = document.querySelector('input[name="hint-mode"]:checked')?.value === "yes";

    resetRecipeData();
    moddedElements.clear();

    // Base game loaded FIRST so the uploaded file's recipe() calls can
    // deliberately override any base combination (last-write-wins on the
    // recipes dict) — a mod replacing base behavior seems like the more
    // useful default than the reverse.
    if (includeBase) {
        try {
            const baseRes = await fetch("recipes.js", { cache: "no-store" });
            if (baseRes.ok) {
                const baseCode = await baseRes.text();
                new Function("recipe", baseCode)(recipe);
            }
        } catch (e) {
            console.warn("Could not load base game recipes:", e);
            // Not fatal — the custom file still loads on its own below
            // rather than blocking the whole thing over an optional merge.
        }
    }

    const preCustomUniverse = new Set(universe);

    let code;
    try {
        code = await readUploadedFile(file);
    } catch (e) {
        showLoadStatus("Could not read that file — try again.", true);
        return;
    }

    try {
        const runRecipes = new Function("recipe", code);
        runRecipes(recipe);
    } catch (e) {
        showLoadStatus(`That file's format is wrong: ${e.message}. Fix it and upload it again.`, true);
        return;
    }

    if (recipeList.length === 0) {
        showLoadStatus("No valid recipes were found in that file — check the format and try again.", true);
        return;
    }

    // Anything new relative to the pre-custom-file snapshot came from the
    // uploaded file specifically — including when base game wasn't loaded
    // at all, in which case everything qualifies correctly by definition.
    universe.forEach(el => {
        if (!preCustomUniverse.has(el)) moddedElements.add(el);
    });

    let summary = `Loaded ${recipeList.length} recipe${recipeList.length === 1 ? "" : "s"}, ${universe.size} total elements, arities from 2 to ${maxArityFound}.`;
    if (skippedLines.length > 0) {
        summary += ` ${skippedLines.length} line${skippedLines.length === 1 ? "" : "s"} ${skippedLines.length === 1 ? "was" : "were"} skipped.`;
    }
    loadSummaryText = summary;

    launchCustomGame();
}

// ---------- Generalized game engine (N-ary, not just 2) ----------

let discovered = new Set();
let first = null; // classic 2-tap selection, used when configuredMaxArity === 2
let combineTray = []; // multi-select tray, used when configuredMaxArity > 2
let hintModeEnabled = false;
let musicEnabled = false;
let loadSummaryText = "";
const recipesByElement = new Map(); // element -> every recipe it participates in, at any position

function comboKey(ingredients) {
    return [...ingredients].map(String).sort().join("|");
}

function buildRecipesByElement() {
    recipesByElement.clear();
    recipeList.forEach(r => {
        new Set(r.ingredients).forEach(ing => {
            if (!recipesByElement.has(ing)) recipesByElement.set(ing, []);
            recipesByElement.get(ing).push(r);
        });
    });
}

// An element is "hintable" if it's part of SOME recipe where every OTHER
// required ingredient is also currently discovered and the result isn't
// yet found — the N-ary generalization of the main game's 2-ingredient
// version of the same check.
function hasActionableCombo(el) {
    const involved = recipesByElement.get(el) || [];
    return involved.some(r => !discovered.has(r.result) && r.ingredients.every(ing => discovered.has(ing)));
}

// Fixpoint reachability from the starting elements — an element is
// reachable if it's a starting element, or some recipe produces it whose
// ingredients are ALL already reachable. Generalizes cleanly to any arity
// since it's just an .every() over the ingredients array either way.
function computeReachable() {
    const reachable = new Set(startingElements);
    let changed = true;
    while (changed) {
        changed = false;
        recipeList.forEach(r => {
            if (reachable.has(r.result)) return;
            if (r.ingredients.every(ing => reachable.has(ing))) {
                reachable.add(r.result);
                changed = true;
            }
        });
    }
    return reachable;
}

function attemptCombine(ingredients) {
    const key = comboKey(ingredients);
    const result = recipes[key] || null;
    const resultEl = document.getElementById("game-result");

    if (result) {
        discovered.add(result);
        if (resultEl) resultEl.textContent = `${ingredients.join(" + ")} = ${result}`;
    } else if (resultEl) {
        resultEl.textContent = `${ingredients.join(" + ")} = nothing happens`;
    }

    renderElements();
    renderFamilyTree();
    return result;
}

function makeElementTile(el) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "element-tile";
    if (moddedElements.has(el)) btn.classList.add("modded");
    if (hintModeEnabled && hasActionableCombo(el)) btn.classList.add("hintable");
    if (configuredMaxArity === 2 && el === first) btn.classList.add("selected");
    btn.textContent = el;

    btn.addEventListener("click", () => {
        if (configuredMaxArity === 2) {
            if (first === null) {
                first = el;
                renderElements();
                return;
            }
            const chosenFirst = first;
            first = null;
            attemptCombine([chosenFirst, el]);
        } else {
            if (combineTray.length >= configuredMaxArity) return;
            combineTray.push(el);
            renderTray();
        }
    });

    return btn;
}

function renderTray() {
    const tray = document.getElementById("combine-tray");
    const btn = document.getElementById("combine-btn");
    if (!tray || !btn) return;

    tray.innerHTML = "";
    combineTray.forEach((el, index) => {
        const chip = document.createElement("span");
        chip.className = "starting-chip"; // reusing the same chip look established for starting elements

        const label = document.createElement("span");
        label.textContent = el;
        chip.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "starting-chip-remove";
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            combineTray.splice(index, 1);
            renderTray();
        });
        chip.appendChild(removeBtn);

        tray.appendChild(chip);
    });

    btn.disabled = combineTray.length < 2;
}

function updateProgress() {
    const progressEl = document.getElementById("game-progress");
    if (progressEl) progressEl.textContent = `${discovered.size} / ${universe.size} discovered`;

    const banner = document.getElementById("game-complete-banner");
    if (banner) {
        const complete = discovered.size >= universe.size;
        banner.hidden = !complete;
        if (complete) {
            // Deliberately no "suggest an element" link here, unlike the
            // main game — this is a personal custom ruleset, not the
            // shared game, so there's nowhere meaningful to send a
            // suggestion to.
            banner.textContent = "All elements discovered for this ruleset.";
        }
    }
}

function renderElements() {
    const container = document.getElementById("game-elements");
    if (!container) return;

    const query = (document.getElementById("game-search")?.value || "").toLowerCase().trim();
    let list = [...discovered].filter(el => el.toLowerCase().includes(query));
    list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    if (hintModeEnabled) {
        const hintable = list.filter(hasActionableCombo);
        const rest = list.filter(el => !hasActionableCombo(el));
        list = [...hintable, ...rest];
    }

    container.innerHTML = "";
    list.forEach(el => container.appendChild(makeElementTile(el)));

    updateProgress();
}

function renderFamilyTree() {
    const container = document.getElementById("tree-list");
    if (!container) return;

    const query = (document.getElementById("tree-search")?.value || "").toLowerCase().trim();
    container.innerHTML = "";

    [...discovered]
        .filter(el => el.toLowerCase().includes(query))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .forEach(el => {
            const card = document.createElement("div");
            card.className = "tree-card";

            const h4 = document.createElement("h4");
            h4.textContent = el;
            if (moddedElements.has(el)) h4.style.color = "#b9a3ef";
            card.appendChild(h4);

            const madeFrom = recipeList.filter(r => r.result === el);
            if (madeFrom.length > 0) {
                madeFrom.forEach(r => {
                    const p = document.createElement("p");
                    p.textContent = `Made from: ${r.ingredients.join(" + ")}`;
                    card.appendChild(p);
                });
            } else if (startingElements.includes(el)) {
                const p = document.createElement("p");
                p.textContent = "Starting element";
                card.appendChild(p);
            }

            container.appendChild(card);
        });
}

function renderImpossibleNotice() {
    const container = document.getElementById("impossible-notice");
    if (!container) return;

    const reachable = computeReachable();
    const impossible = [...universe].filter(el => !reachable.has(el)).sort();

    container.innerHTML = "";

    const h2 = document.createElement("h2");
    h2.textContent = "Impossible elements";
    container.appendChild(h2);

    const summaryP = document.createElement("p");
    summaryP.className = "help";
    summaryP.textContent = loadSummaryText;
    container.appendChild(summaryP);

    const p = document.createElement("p");
    if (impossible.length === 0) {
        p.textContent = "None — every element in this ruleset can be reached from the starting elements.";
        container.appendChild(p);
        return;
    }

    p.textContent = `${impossible.length} element${impossible.length === 1 ? "" : "s"} can never actually be made with this ruleset:`;
    container.appendChild(p);

    const ul = document.createElement("ul");
    impossible.forEach(el => {
        const li = document.createElement("li");
        li.textContent = el;
        ul.appendChild(li);
    });
    container.appendChild(ul);
}

function setupGameTabs() {
    const buttons = document.querySelectorAll("#game-view button.tab-button");
    const panels = document.querySelectorAll("#game-view .tab-panel");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            buttons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
            if (btn.dataset.tab === "game-tree") renderFamilyTree();
        });
    });
}

function setupCombineUI() {
    const btn = document.getElementById("combine-btn");
    const tray = document.getElementById("combine-tray");
    if (configuredMaxArity > 2) {
        if (btn) btn.hidden = false;
        if (tray) tray.hidden = false;
    }
    btn?.addEventListener("click", () => {
        if (combineTray.length < 2) return;
        attemptCombine([...combineTray]);
        combineTray = [];
        renderTray();
    });
}

function setupGameSearch() {
    document.getElementById("game-search")?.addEventListener("input", renderElements);
    document.getElementById("tree-search")?.addEventListener("input", renderFamilyTree);
}

function setupGameAboutToggles() {
    const hintBtn = document.getElementById("game-hint-toggle");
    const musicBtn = document.getElementById("game-music-toggle");

    if (hintBtn) {
        hintBtn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
        hintBtn.classList.toggle("on", hintModeEnabled);
        hintBtn.addEventListener("click", () => {
            hintModeEnabled = !hintModeEnabled;
            hintBtn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
            hintBtn.classList.toggle("on", hintModeEnabled);
            renderElements();
        });
    }

    if (musicBtn) {
        // Simplified stub for this build, as flagged before starting —
        // no audio engine wired up yet, just the toggle state itself.
        musicBtn.textContent = musicEnabled ? "Music: On" : "Music: Off";
        musicBtn.addEventListener("click", () => {
            musicEnabled = !musicEnabled;
            musicBtn.textContent = musicEnabled ? "Music: On" : "Music: Off";
            musicBtn.classList.toggle("on", musicEnabled);
        });
    }
}

function launchCustomGame() {
    discovered = new Set(startingElements);
    first = null;
    combineTray = [];
    buildRecipesByElement();

    const wizard = document.getElementById("wizard-view");
    const game = document.getElementById("game-view");
    if (wizard) wizard.hidden = true;
    if (game) game.hidden = false;

    setupGameTabs();
    setupCombineUI();
    setupGameSearch();
    setupGameAboutToggles();

    renderElements();
    renderFamilyTree();
    renderImpossibleNotice();
}



// ---------- Init ----------

// A plain window.addEventListener("DOMContentLoaded", ...) silently does
// nothing if that event already fired before this script got to this
// line — which can happen depending on load/caching timing. readyState
// covers both cases correctly instead of assuming the event is still
// pending.
function onReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn);
    } else {
        fn();
    }
}

onReady(() => {
    setupStartingElementsEditor();
    setupFileUploadControl();
    document.getElementById("load-custom-btn")?.addEventListener("click", handleLoadCustom);
});

})();
