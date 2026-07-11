(function () {
"use strict";

// ---------- Configuration ----------
//
// This has to live in public, client-side JS for the browser to be able to
// call it directly — there is no way to hide it from someone who reads
// view-source, exactly like the exploit discussion earlier in this
// project. That's an accepted, understood risk (see the "Ghost's Alchemy"
// Discord conversation this page came out of) — if this ever gets abused,
// delete the webhook in Discord's Integrations settings and paste a new
// URL in here. Nothing else needs to change.
const WEBHOOK_URL = "https://discord.com/api/webhooks/1525466532711366806/Ir-iH4jsnu5JoI6dFuHCkiTMuJrrtPF6cJG_FRdKDProp2ngYlK31EFCqI2GzNNxpBFh";

const QUEUE_STORAGE_KEY = "alchemy_suggestion_queue";
const MAX_RESULT_LENGTH = 60;
const DISCORD_CHUNK_LIMIT = 1900; // stays safely under Discord's 2000-char message cap

// ---------- Recipe data (read-only here — just enough to know what
// already exists, not the full game engine) ----------

const recipes = {}; // "a|b" -> result, existing combos only, for repeat-detection
const universe = new Set(["air", "water", "earth", "fire"]);

function recipe(a, b, result) {
    const aT = a.trim();
    const bT = b.trim();
    const resultT = result.trim();
    const key = [aT, bT].sort().join("|");
    recipes[key] = resultT; // last-write-wins is fine — this is only ever used for existence checks
    universe.add(aT);
    universe.add(bT);
    universe.add(resultT);
}

function comboExists(a, b) {
    const key = [a, b].sort().join("|");
    return recipes[key] || null;
}

async function loadRecipeUniverse() {
    const res = await fetch("recipes.js", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    // Same technique as the main game: recipe() passed in as a parameter,
    // not a global, so nothing here needs to be exposed on window either.
    const runRecipes = new Function("recipe", code);
    runRecipes(recipe);
}

// ---------- Element pickers ----------

let selectedA = null;
let selectedB = null;

function renderPicker(slot) {
    const isA = slot === "a";
    const listEl = document.getElementById(isA ? "picker-a-list" : "picker-b-list");
    const searchEl = document.getElementById(isA ? "picker-a-search" : "picker-b-search");
    const selected = isA ? selectedA : selectedB;
    if (!listEl) return;

    const query = (searchEl?.value || "").toLowerCase().trim();
    listEl.innerHTML = "";

    [...universe]
        .sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }))
        .filter(el => el.toLowerCase().includes(query))
        .forEach(el => {
            const tile = document.createElement("button");
            tile.type = "button";
            tile.className = "element-tile";
            tile.textContent = el;
            if (el === selected) tile.classList.add("selected");
            tile.addEventListener("click", () => {
                if (isA) selectedA = el;
                else selectedB = el;
                renderPicker("a");
                renderPicker("b");
                updateSuggestionPreview();
            });
            listEl.appendChild(tile);
        });
}

function updateSuggestionPreview() {
    const preview = document.getElementById("suggestion-preview");
    const resultInput = document.getElementById("suggestion-result");
    const addBtn = document.getElementById("add-to-queue-btn");
    const warning = document.getElementById("suggestion-warning");
    if (!preview || !resultInput || !addBtn || !warning) return;

    if (!selectedA || !selectedB) {
        preview.textContent = "Pick two elements above.";
        resultInput.disabled = true;
        addBtn.disabled = true;
        warning.hidden = true;
        return;
    }

    preview.textContent = `${selectedA} + ${selectedB} = ?`;
    resultInput.disabled = false;

    const existing = comboExists(selectedA, selectedB);
    if (existing) {
        warning.hidden = false;
        warning.textContent = `This combination already exists — it makes "${existing}". Pick a different pair.`;
        addBtn.disabled = true;
    } else {
        warning.hidden = true;
        addBtn.disabled = false;
    }
}

// ---------- Local queue ----------

let queue = [];

function loadQueue() {
    try {
        const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) queue = parsed;
        }
    } catch (e) {
        console.warn("Could not load suggestion queue:", e);
    }
}

function saveQueue() {
    try {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
        console.warn("Could not save suggestion queue:", e);
    }
}

function isDuplicateInQueue(a, b) {
    const key = [a, b].sort().join("|").toLowerCase();
    return queue.some(item => [item.a, item.b].sort().join("|").toLowerCase() === key);
}

function showSuggestStatus(msg) {
    const el = document.getElementById("suggest-status");
    if (el) el.textContent = msg;
}

function showQueueStatus(msg) {
    const el = document.getElementById("queue-status");
    if (el) el.textContent = msg;
}

function addToQueue() {
    if (!selectedA || !selectedB) return;
    const resultInput = document.getElementById("suggestion-result");
    const creditInput = document.getElementById("suggestion-credit");
    const result = (resultInput?.value || "").trim();

    if (!result) {
        showSuggestStatus("Type what this should combine into first.");
        return;
    }
    if (result.length > MAX_RESULT_LENGTH) {
        showSuggestStatus(`That's a bit long — keep it under ${MAX_RESULT_LENGTH} characters.`);
        return;
    }
    if (comboExists(selectedA, selectedB)) {
        showSuggestStatus("This combination already exists.");
        return;
    }
    if (isDuplicateInQueue(selectedA, selectedB)) {
        showSuggestStatus("You've already queued a suggestion for this exact pair.");
        return;
    }

    queue.push({
        a: selectedA,
        b: selectedB,
        result,
        credit: (creditInput?.value || "").trim()
    });
    saveQueue();

    selectedA = null;
    selectedB = null;
    if (resultInput) resultInput.value = "";
    renderPicker("a");
    renderPicker("b");
    updateSuggestionPreview();
    renderQueueTab();
    showSuggestStatus(`Added! ${queue.length} suggestion${queue.length === 1 ? "" : "s"} queued so far.`);
}

function renderQueueTab() {
    const container = document.getElementById("queue-list");
    const countEl = document.getElementById("queue-count");
    const submitBtn = document.getElementById("submit-queue-btn");
    if (!container) return;

    container.innerHTML = "";
    if (countEl) countEl.textContent = String(queue.length);
    if (submitBtn) submitBtn.disabled = queue.length === 0;

    queue.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "queue-row";

        const text = document.createElement("span");
        text.textContent = `${item.a} + ${item.b} = ${item.result}`;
        row.appendChild(text);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "queue-remove-btn";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
            queue.splice(index, 1);
            saveQueue();
            renderQueueTab();
        });
        row.appendChild(removeBtn);

        container.appendChild(row);
    });
}

// ---------- Webhook submission ----------

function buildSuggestionLine(item) {
    const creditPart = item.credit ? ` (suggested by ${item.credit})` : "";
    return `${item.a} + ${item.b} = ${item.result}${creditPart}`;
}

// Groups lines into chunks that each stay under the given length, so a
// large queue doesn't produce one message Discord rejects for being too
// long — splits into multiple messages instead.
function chunkLines(lines, maxLength) {
    const chunks = [];
    let current = "";
    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > maxLength) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

async function submitQueue() {
    if (queue.length === 0) return;
    if (!WEBHOOK_URL || WEBHOOK_URL.includes("PASTE_YOUR")) {
        showQueueStatus("The webhook hasn't been set up yet — a real Discord webhook URL needs to replace the placeholder in suggest.js before this can send anything.");
        return;
    }

    const lines = queue.map(buildSuggestionLine);
    const chunks = chunkLines(lines, DISCORD_CHUNK_LIMIT);

    showQueueStatus("Sending…");

    try {
        for (const chunk of chunks) {
            const res = await fetch(WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: chunk })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }
        queue = [];
        saveQueue();
        renderQueueTab();
        showQueueStatus(`Sent ${lines.length} suggestion${lines.length === 1 ? "" : "s"}! Thank you.`);
    } catch (e) {
        console.error("Webhook submission failed:", e);
        showQueueStatus("Something went wrong sending this — your queue is untouched, nothing was lost. Try again in a moment.");
    }
}

// ---------- Tabs (same pattern as the main game) ----------

function setupTabs() {
    const buttons = document.querySelectorAll(".tab-button");
    const panels = document.querySelectorAll(".tab-panel");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            buttons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
        });
    });
}

// ---------- Init ----------

window.addEventListener("DOMContentLoaded", async () => {
    loadQueue();
    setupTabs();
    renderQueueTab();
    updateSuggestionPreview();

    document.getElementById("picker-a-search")?.addEventListener("input", () => renderPicker("a"));
    document.getElementById("picker-b-search")?.addEventListener("input", () => renderPicker("b"));
    document.getElementById("add-to-queue-btn")?.addEventListener("click", addToQueue);
    document.getElementById("submit-queue-btn")?.addEventListener("click", submitQueue);

    try {
        await loadRecipeUniverse();
    } catch (e) {
        console.error("Could not load recipes.js:", e);
        showSuggestStatus("Could not load the current element list — try refreshing.");
        return;
    }

    renderPicker("a");
    renderPicker("b");
});

})();
