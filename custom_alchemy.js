(function () {
"use strict";

// =====================================================================
// Custom Alchemy ("Mods") — a direct port of game.js, stripped to what
// this mode uses (no graph, no sets, no credits, no anti-cheat, no
// save/backup) and generalized ONLY where N-ingredient mixing requires
// it. Wherever a function body matches game.js, it was copied, not
// reconstructed. Custom-game progress is intentionally per-session:
// nothing about discovered elements persists, so loading a different
// ruleset later can never collide with a stale save from this one.
// Sound/music/volume/sort/dead-end prefs DO share the main game's
// localStorage keys on purpose — same person, same preferences.
// =====================================================================

// ---------- Wizard config state ----------

let configuredMinArity = 2;
let configuredMaxArity = 2;
let startingElements = ["air", "water", "fire", "earth"];
const moddedElements = new Set(); // introduced by the uploaded file specifically, not the base game
let loadSummaryText = "";

// ---------- Recipe data (generalized to N ingredients) ----------

const recipes = {};        // lookup: sorted-ingredients key -> result
const recipeList = [];     // full list: { ingredients: [...], result }
const universe = new Set();
const recipesByElement = new Map(); // element -> recipes it appears in as an ingredient
let maxArityFound = 0;
const skippedLines = [];

let orderedComponents = false; // wizard setting: when true, click/registration order matters
let bringOverDiscovered = false; // wizard setting: seed discovered with the main game's own save, requires includeBase

function comboKey(ingredients) {
    const arr = orderedComponents ? [...ingredients] : [...ingredients].sort();
    return arr.map(String).join("|");
}

// Variable-arity: the LAST argument is always the result, everything
// before it is an ingredient. recipe("air","water","water","superMist")
// has 3 ingredients and one result.
function recipe(...args) {
    if (args.length < 3) {
        skippedLines.push({ args, reason: "needs at least 2 ingredients and a result" });
        return;
    }

    const result = String(args[args.length - 1]).trim();
    const ingredients = args.slice(0, -1).map(x => String(x).trim());
    const arity = ingredients.length;

    if (arity < configuredMinArity || arity > configuredMaxArity) {
        skippedLines.push({ args, reason: `uses ${arity} ingredients, outside the configured range of ${configuredMinArity} to ${configuredMaxArity}` });
        return;
    }

    const key = comboKey(ingredients);

    if (parsingCustomFile && !keysOverwrittenByCustom.has(key)) {
        // First time the CUSTOM FILE touches this exact combo — this
        // replaces whatever base game may have defined here (mods
        // override base, as promised in the wizard), rather than adding
        // to it. A SECOND recipe() call for the same combo later in the
        // same custom file still correctly stacks (multi-product).
        delete recipes[key];
        // recipeList feeds hint mode, reachability, and the tree cards'
        // "combines into" list — without this, they'd keep advertising a
        // result combine() no longer actually produces.
        for (let i = recipeList.length - 1; i >= 0; i--) {
            if (comboKey(recipeList[i].ingredients) === key) recipeList.splice(i, 1);
        }
        keysOverwrittenByCustom.add(key);
    }

    if (!recipes[key]) recipes[key] = [];
    if (!recipes[key].includes(result)) recipes[key].push(result); // same combo, multiple recipe() calls with different results -> multi-product
    recipeList.push({ ingredients, result });
    ingredients.forEach(i => universe.add(i));
    universe.add(result);
    maxArityFound = Math.max(maxArityFound, arity);
}

let parsingCustomFile = false;
const keysOverwrittenByCustom = new Set();

function resetRecipeData() {
    Object.keys(recipes).forEach(k => delete recipes[k]);
    recipeList.length = 0;
    universe.clear();
    recipesByElement.clear();
    moddedElements.clear();
    skippedLines.length = 0;
    maxArityFound = 0;
    parsingCustomFile = false;
    keysOverwrittenByCustom.clear();
}

// Returns an array of results (possibly length > 1 for multi-product
// recipes), or null if this exact combo has none.
function combine(ingredients) {
    return recipes[comboKey(ingredients)] || null;
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

function recipesInvolving(el) {
    return recipesByElement.get(el) || [];
}

// Same definition as the main game, generalized: dead end once every
// recipe it appears in already leads to something discovered. An element
// appearing in no recipes at all has nothing left to give by definition.
function isExhausted(el) {
    return recipesInvolving(el).every(r => discovered.has(r.result));
}

function hasActionableCombo(el) {
    return recipesInvolving(el).some(
        r => !discovered.has(r.result) && r.ingredients.every(ing => discovered.has(ing))
    );
}

// Fixpoint reachability from the starting elements — used by the
// "Impossible elements" report in About.
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

// ---------- Discovery state (session-only, on purpose) ----------

let discovered = new Set();
let discoveryOrder = [];
let combineTray = [];    // selection tray for ALL modes now — classic 2-tap is just the fixed-arity=2 case of this
let treeDirty = true;    // tree list rebuilt lazily on tab open, same as main

// ---------- Sound system (copied from game.js) ----------

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

// ---------- Background music (copied from game.js, whole composition) ----------

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

const AMBIENT_LOOP_DURATION_MS = 23500;

let musicVolume = 1.0;

function playAmbientLoop() {
    if (!musicEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.1;
    const v = gain => gain * musicVolume;

    // Drone: open fifth (D-A) under phrase A, shifting to an open fourth
    // (D-G) under phrase B.
    playMusicTone(146.83, now, 10, "sine", v(0.05)); // D3
    playMusicTone(220.0, now, 10, "triangle", v(0.03)); // A3
    playMusicTone(146.83, now + 10, 14, "sine", v(0.05)); // D3
    playMusicTone(196.0, now + 10, 14, "triangle", v(0.03)); // G3

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

    const phraseB = [
        { n: 440.0, t: 10.0, l: 0.8 }, // A4
        { n: 493.88, t: 11.2, l: 0.7 }, // B4 — Dorian 6th
        { n: 523.25, t: 12.3, l: 0.9 }, // C5
        { n: 587.33, t: 13.6, l: 1.0 }, // D5 — peak
        { n: 523.25, t: 15.0, l: 0.8 }, // C5
        { n: 493.88, t: 16.1, l: 0.8 }, // B4
        { n: 440.0, t: 17.2, l: 0.8 }, // A4
        { n: 392.0, t: 18.4, l: 0.8 }, // G4
        { n: 349.23, t: 19.6, l: 0.9 }, // F4
        { n: 293.66, t: 20.9, l: 1.8 } // D4 — resolves home
    ];

    phraseA.forEach(note => playMusicTone(note.n, now + note.t, note.l, "triangle", v(0.045)));
    phraseB.forEach(note => playMusicTone(note.n, now + note.t, note.l, "triangle", v(0.045)));

    playMusicTone(587.33, now + 8.3, 0.5, "sine", v(0.02)); // D5 shimmer
    playMusicTone(880.0, now + 13.8, 0.4, "sine", v(0.018)); // A5 shimmer
}

const MUSIC_STORAGE_KEY = "alchemy_music_enabled";
const MUSIC_VOLUME_KEY = "alchemy_music_volume";
let musicEnabled = true;
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

let musicStartInFlight = false;

async function startMusic() {
    if (musicLoopInterval || musicStartInFlight) return;
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
}

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
    playTone(196, 0.18, 0, 0.12);
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
            playDiscoverySound();
        } else {
            stopMusic();
        }
    });
}

// ---------- "Just found" flash (copied from game.js) ----------

let lastDiscovered = null;
let lastDiscoveredTimer = null;

function markJustDiscovered(element) {
    lastDiscovered = element;
    if (lastDiscoveredTimer) clearTimeout(lastDiscoveredTimer);
    lastDiscoveredTimer = setTimeout(() => {
        lastDiscovered = null;
        lastDiscoveredTimer = null;
        render();
    }, 2000);
}

// ---------- Progress displays (copied from game.js) ----------

function updateProgressDisplays() {
    const count = discovered.size;
    const total = universe.size;
    const deadEnds = [...discovered].filter(isExhausted).length;
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

// ---------- Combine (shared by both interaction modes) ----------

function attemptCombine(ingredients) {
    const results = combine(ingredients); // array of results, or null
    resetHintIdleTimer(); // a combine attempt, success or not, resets the idle nudge

    const resultEl = document.getElementById("result");
    if (resultEl) {
        resultEl.textContent = results
            ? `${ingredients.join(" + ")} = ${results.join(", ")}`
            : `${ingredients.join(" + ")} = nothing happens`;
        resultEl.classList.remove("flash");
        void resultEl.offsetWidth; // restart the animation even for repeat results
        resultEl.classList.add("flash");
    }

    if (results) {
        const newlyDiscovered = results.filter(r => !discovered.has(r));
        newlyDiscovered.forEach(r => {
            discovered.add(r);
            discoveryOrder.push(r);
        });
        if (newlyDiscovered.length > 0) {
            markJustDiscovered(newlyDiscovered[newlyDiscovered.length - 1]);
            treeDirty = true;
            playDiscoverySound();
        }
    } else {
        playNothingSound();
    }

    updateProgressDisplays();
    render();
    return results;
}

// ---------- Elements tab (tile from game.js, click adapted for N-ary) ----------

function makeElementTile(element) {
    const button = document.createElement("button");
    button.className = "element-tile";
    const isSelected = combineTray.includes(element);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    if (isSelected) button.classList.add("selected");
    if (isExhausted(element)) button.classList.add("dead-end");
    if (hintModeEnabled && hasActionableCombo(element)) button.classList.add("hintable");
    if (greenHintPair && greenHintPair.includes(element)) button.classList.add("hint-pair");
    if (element === lastDiscovered) button.classList.add("just-found");
    if (moddedElements.has(element)) button.classList.add("modded");

    button.appendChild(document.createTextNode(element));

    button.onclick = () => {
        // Duplicates allowed on purpose — water + water is a legitimate
        // combo, so the same tile can be added repeatedly up to the cap.
        if (combineTray.length >= configuredMaxArity) return;
        combineTray.push(element);
        renderTray();
        render(); // refresh selected highlighting on tiles

        // Fixed arity (min === max, classic 2-tap included as the N=2
        // case of this) needs no Combine button — the moment the tray
        // reaches exactly that count, there's nothing ambiguous left to
        // wait for, so it fires immediately, same spirit as the original
        // 2-tap auto-combine.
        if (configuredMinArity === configuredMaxArity && combineTray.length === configuredMinArity) {
            const picked = [...combineTray];
            combineTray = [];
            attemptCombine(picked);
            renderTray();
        }
    };

    return button;
}

function renderTray() {
    const tray = document.getElementById("combine-tray");
    const btn = document.getElementById("combine-btn");
    if (!tray || !btn) return;

    tray.innerHTML = "";
    combineTray.forEach((el, index) => {
        const chip = document.createElement("span");
        chip.className = "starting-chip";

        const label = document.createElement("span");
        label.textContent = el;
        chip.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "starting-chip-remove";
        removeBtn.textContent = "\u2715";
        removeBtn.setAttribute("aria-label", `Remove ${el}`);
        removeBtn.addEventListener("click", () => {
            combineTray.splice(index, 1);
            renderTray();
            render();
        });
        chip.appendChild(removeBtn);

        tray.appendChild(chip);
    });

    btn.disabled = combineTray.length < configuredMinArity;
}

function setupCombineUI() {
    const btn = document.getElementById("combine-btn");
    const tray = document.getElementById("combine-tray");
    const isClassicTwo = configuredMinArity === 2 && configuredMaxArity === 2;
    const isRange = configuredMinArity !== configuredMaxArity;

    // Classic 2-in-2-out keeps the original minimal UI: no tray, tiles
    // just highlight as you pick them, exactly as it always has.
    if (!isClassicTwo && tray) tray.hidden = false;

    // Only a genuine range needs an explicit button — a fixed arity
    // (however large) auto-fires the moment enough tiles are picked, so
    // there's nothing for a button to do.
    if (isRange && btn) btn.hidden = false;

    btn?.addEventListener("click", () => {
        if (combineTray.length < configuredMinArity) return;
        attemptCombine([...combineTray]);
        combineTray = [];
        renderTray();
    });
}

// ---------- Dead-end collapse (copied from game.js) ----------

const DEADEND_COLLAPSE_KEY = "alchemy_deadend_collapsed";
// Defaults EXPANDED here, unlike the main game's collapsed default — a
// freshly loaded custom ruleset is much more likely to have starting
// elements with zero recipes referencing them at all (confirmed: this is
// exactly what looked like "A-Z/Recent sort is broken" before — the
// element wasn't misordered, it was correctly a dead end from the
// moment it existed, sitting in a hidden section).
let deadEndCollapsed = false;

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

// ---------- Sort mode (copied from game.js) ----------

const SORT_MODE_KEY = "alchemy_sort_mode";
let sortMode = "alpha";

function loadSortModePreference() {
    try {
        const saved = localStorage.getItem(SORT_MODE_KEY);
        if (saved === "alpha" || saved === "recent") sortMode = saved;
    } catch (e) {
        console.warn("Could not load sort mode preference:", e);
    }
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
        return [...list].sort((a, b) => {
            const aRank = discoveryOrder.indexOf(a);
            const bRank = discoveryOrder.indexOf(b);
            if (aRank !== bRank) return bRank - aRank;
            return a.localeCompare(b, undefined, { sensitivity: "base" });
        });
    }
    return [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// ---------- Hint Mode (from game.js; toggle persistence intentionally
// dropped — the wizard's radio owns the starting value per ruleset) ----------

let hintModeEnabled = false;

function setupHintModeToggle() {
    const btn = document.getElementById("hint-mode-toggle");
    if (!btn) return;

    const updateLabel = () => {
        btn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
        btn.classList.toggle("muted", !hintModeEnabled);
    };
    updateLabel();

    btn.addEventListener("click", () => {
        hintModeEnabled = !hintModeEnabled;
        updateLabel();
        render();
        if (hintModeEnabled) resetHintIdleTimer();
        else stopHintIdleTimer();
    });
}

// Idle "what to make next" nudge — generalized: the green suggestion is
// now the full ingredient set of one actionable recipe (2 elements in
// classic mode, up to N in tray mode), all highlighted together.
const HINT_IDLE_DELAY_MS = 20000;
let hintIdleTimer = null;
let greenHintPair = null;

function findRandomActionablePair() {
    const candidates = recipeList.filter(
        r => !discovered.has(r.result) && r.ingredients.every(ing => discovered.has(ing))
    );
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return [...pick.ingredients];
}

function showGreenHint() {
    if (!hintModeEnabled) return;
    greenHintPair = findRandomActionablePair();
    render();
}

function clearGreenHint() {
    if (greenHintPair !== null) {
        greenHintPair = null;
        render();
    }
}

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

// ---------- render() (copied from game.js) ----------

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
        const isGreenPair = el => greenHintPair && greenHintPair.includes(el);
        const greenPair = active.filter(isGreenPair);
        const hintable = active.filter(el => hasActionableCombo(el) && !isGreenPair(el));
        const rest = active.filter(el => !hasActionableCombo(el) && !isGreenPair(el));
        active = [...greenPair, ...hintable, ...rest];
    }

    active.forEach(el => activeBox.appendChild(makeElementTile(el)));
    dead.forEach(el => deadBox.appendChild(makeElementTile(el)));

    if (deadSection) deadSection.hidden = dead.length === 0;
}

// ---------- Family Tree list (copied from game.js, N-ary adapted) ----------

function computeDisplayDepths(discoveredSet) {
    const depth = new Map();
    startingElements.forEach(el => {
        if (discoveredSet.has(el)) depth.set(el, 0);
    });

    let changed = true;
    while (changed) {
        changed = false;
        for (const r of recipeList) {
            if (!discoveredSet.has(r.result)) continue;
            if (r.ingredients.every(ing => depth.has(ing))) {
                const candidate = Math.max(...r.ingredients.map(ing => depth.get(ing))) + 1;
                if (!depth.has(r.result) || candidate < depth.get(r.result)) {
                    depth.set(r.result, candidate);
                    changed = true;
                }
            }
        }
    }

    return depth;
}

function buildDetailFragment(element, depths) {
    const frag = document.createDocumentFragment();

    const heading = document.createElement("h3");
    if (moddedElements.has(element)) heading.className = "modded-name";
    heading.appendChild(document.createTextNode(element));
    frag.appendChild(heading);

    const origin = recipeList.find(r => r.result === element);
    const originLine = document.createElement("p");
    originLine.className = "tree-origin";
    originLine.textContent = origin ? `Made from ${origin.ingredients.join(" + ")}` : "Starting element";
    frag.appendChild(originLine);

    if (depths && depths.has(element)) {
        const depthLine = document.createElement("p");
        depthLine.className = "tree-origin";
        const d = depths.get(element);
        depthLine.textContent = `${d} step${d === 1 ? "" : "s"} from the base elements`;
        frag.appendChild(depthLine);
    }

    const usedIn = recipeList.filter(r => r.ingredients.includes(element) && discovered.has(r.result));
    if (usedIn.length > 0) {
        const usedHeading = document.createElement("p");
        usedHeading.className = "tree-used-label";
        usedHeading.textContent = "Combines into:";
        frag.appendChild(usedHeading);

        const list = document.createElement("ul");
        usedIn.forEach(r => {
            // "The other ingredients": remove exactly ONE instance of this
            // element, so water in water+water correctly shows "+ water".
            const others = [...r.ingredients];
            others.splice(others.indexOf(element), 1);
            const li = document.createElement("li");
            li.textContent = `+ ${others.join(" + ")} \u2192 ${r.result}`;
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
        const pending = recipesInvolving(element).filter(r => !discovered.has(r.result));
        const actionable = pending.filter(r => r.ingredients.every(ing => discovered.has(ing)));

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

function renderTreeList() {
    const container = document.getElementById("tree");
    const deadContainer = document.getElementById("tree-dead-list");
    const deadSection = document.getElementById("tree-dead-section");
    if (!container) return;

    container.innerHTML = "";
    if (deadContainer) deadContainer.innerHTML = "";

    const allValid = [...discovered].filter(el => universe.has(el));
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

function setupTreeSearch() {
    const input = document.getElementById("tree-search");
    if (!input) return;
    input.addEventListener("input", () => {
        renderTreeList();
    });
}

// ---------- Impossible elements (About > Information) ----------

function renderImpossibleNotice() {
    const container = document.getElementById("impossible-notice");
    if (!container) return;
    container.innerHTML = "";

    const h2 = document.createElement("h2");
    h2.textContent = "Impossible elements";
    container.appendChild(h2);

    const summaryP = document.createElement("p");
    summaryP.textContent = loadSummaryText;
    container.appendChild(summaryP);

    const reachable = computeReachable();
    const impossible = [...universe].filter(el => !reachable.has(el)).sort();

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

// ---------- Tabs (main game pattern, scoped to the game view) ----------

function setupGameTabs() {
    const tabButtons = document.querySelectorAll("#game-view button.tab-button");
    const panels = document.querySelectorAll("#game-view .tab-panel");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
            if (btn.dataset.tab === "tree" && treeDirty) {
                renderTreeList();
                treeDirty = false;
            }
        });
    });
}

// ---------- Wizard: starting elements editor ----------

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
        removeBtn.textContent = "\u2715";
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

function setupIncludeBaseToggle() {
    const radios = document.querySelectorAll('input[name="include-base"]');
    const checkbox = document.getElementById("bring-over-discovered");
    const label = document.getElementById("bring-over-label");
    if (!checkbox || !label) return;

    const sync = () => {
        const yes = document.querySelector('input[name="include-base"]:checked')?.value === "yes";
        checkbox.disabled = !yes;
        label.classList.toggle("disabled-label", !yes);
        if (!yes) checkbox.checked = false; // can't stay checked once its prerequisite is off
    };

    radios.forEach(r => r.addEventListener("change", sync));
    sync();
}

// Reads the SAME key the main game saves discovered elements under.
function loadMainGameDiscovered() {
    try {
        const saved = localStorage.getItem("alchemy_discovered_elements");
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed.filter(el => typeof el === "string");
        }
    } catch (e) {
        console.warn("Could not load main game discovered elements:", e);
    }
    return [];
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

// ---------- Wizard: file upload + load ----------

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

    const minRaw = document.getElementById("min-arity-select")?.value;
    const maxRaw = document.getElementById("max-arity-select")?.value;
    const minParsed = Number(minRaw);
    const maxParsed = Number(maxRaw);

    if (!Number.isInteger(minParsed) || minParsed < 2 || minParsed > 100) {
        showLoadStatus(`Minimum combo size has to be a whole number between 2 and 100 — got "${minRaw}".`, true);
        return;
    }
    if (!Number.isInteger(maxParsed) || maxParsed < 2 || maxParsed > 100) {
        showLoadStatus(`Maximum combo size has to be a whole number between 2 and 100 — got "${maxRaw}".`, true);
        return;
    }

    configuredMinArity = minParsed;
    configuredMaxArity = maxParsed;
    if (configuredMinArity > configuredMaxArity) {
        showLoadStatus(`Minimum combo size (${configuredMinArity}) can't be greater than maximum (${configuredMaxArity}).`, true);
        return;
    }
    const includeBase = document.querySelector('input[name="include-base"]:checked')?.value === "yes";
    hintModeEnabled = document.querySelector('input[name="hint-mode"]:checked')?.value === "yes";
    orderedComponents = document.querySelector('input[name="ordered-components"]:checked')?.value === "yes";
    bringOverDiscovered = includeBase && document.getElementById("bring-over-discovered")?.checked === true;

    resetRecipeData();

    // Base game loads FIRST so the uploaded file can deliberately override
    // any base combination (last-write-wins on the recipes dict).
    if (includeBase) {
        try {
            const baseRes = await fetch("recipes.js", { cache: "no-store" });
            if (baseRes.ok) {
                const baseCode = await baseRes.text();
                new Function("recipe", baseCode)(recipe);
            }
        } catch (e) {
            console.warn("Could not load base game recipes:", e);
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

    parsingCustomFile = true; // from here on, recipe() calls override base rather than merging with it

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

    // Anything new relative to the pre-custom snapshot came from the
    // uploaded file specifically. When base game wasn't loaded at all,
    // everything qualifies — correctly, by definition.
    universe.forEach(el => {
        if (!preCustomUniverse.has(el)) moddedElements.add(el);
    });

    let summary = `Loaded ${recipeList.length} recipe${recipeList.length === 1 ? "" : "s"}, ${universe.size} total elements, arities from 2 to ${maxArityFound}.`;
    if (skippedLines.length > 0) {
        summary += ` ${skippedLines.length} line${skippedLines.length === 1 ? "" : "s"} ${skippedLines.length === 1 ? "was" : "were"} skipped (exceeded the max combo size, or had fewer than 2 ingredients).`;
    }
    loadSummaryText = summary;

    launchCustomGame();
}

function launchCustomGame() {
    // The uploaded file might never actually mention one of the starting
    // elements — without this, universe.size could undercount and produce
    // a nonsensical "4 / 3 discovered."
    startingElements.forEach(el => universe.add(el));

    discovered = new Set(startingElements);
    discoveryOrder = [...startingElements];

    if (bringOverDiscovered) {
        // Filtered against THIS ruleset's universe as a safety net — the
        // main game's save could reference an element that no longer
        // exists if recipes.js changed since they last played.
        loadMainGameDiscovered().forEach(el => {
            if (universe.has(el) && !discovered.has(el)) {
                discovered.add(el);
                discoveryOrder.push(el);
            }
        });
    }

    combineTray = [];
    treeDirty = true;
    buildRecipesByElement();

    const wizard = document.getElementById("wizard-view");
    const game = document.getElementById("game-view");
    if (wizard) wizard.hidden = true;
    if (game) game.hidden = false;

    setupCombineUI();

    updateProgressDisplays();
    render();
    renderImpossibleNotice();

    // "Load custom" IS a user gesture, so music can start right here —
    // plus the same first-interaction fallback the main game uses.
    if (musicEnabled && soundEnabled) startMusic();
    armFirstInteractionMusicStart();

    if (hintModeEnabled) resetHintIdleTimer();

    // Sync the About toggle label with the wizard's choice.
    const hintBtn = document.getElementById("hint-mode-toggle");
    if (hintBtn) {
        hintBtn.textContent = hintModeEnabled ? "Hint Mode: On" : "Hint Mode: Off";
        hintBtn.classList.toggle("muted", !hintModeEnabled);
    }
}

// ---------- Init ----------

function onReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn);
    } else {
        fn();
    }
}

onReady(() => {
    const steps = [
        ["loadSoundPreference", loadSoundPreference],
        ["loadMusicPreference", loadMusicPreference],
        ["loadSortModePreference", loadSortModePreference],
        ["loadDeadEndCollapsePreference", loadDeadEndCollapsePreference],
        ["setupStartingElementsEditor", setupStartingElementsEditor],
        ["setupIncludeBaseToggle", setupIncludeBaseToggle],
        ["setupFileUploadControl", setupFileUploadControl],
        ["load-custom-btn listener", () => document.getElementById("load-custom-btn")?.addEventListener("click", handleLoadCustom)],
        // Game-view controls exist in the DOM (hidden) from the start, so
        // all of this wires up once here, exactly like the main game's init.
        ["setupGameTabs", setupGameTabs],
        ["setupSoundToggle", setupSoundToggle],
        ["setupMusicToggle", setupMusicToggle],
        ["setupMusicVolumeSlider", setupMusicVolumeSlider],
        ["setupHintModeToggle", setupHintModeToggle],
        ["setupSortToggle", setupSortToggle],
        ["setupDeadEndToggle", setupDeadEndToggle],
        ["setupTreeSearch", setupTreeSearch],
        ["search listener", () => document.getElementById("search")?.addEventListener("input", render)],
    ];

    steps.forEach(([name, fn]) => {
        try {
            fn();
        } catch (e) {
            // A failure in any ONE of these must not be able to silently
            // take out every step after it — that's exactly the failure
            // pattern this wrapping exists to close off.
            console.error(`Custom Alchemy init step "${name}" failed:`, e);
        }
    });
});

})();
