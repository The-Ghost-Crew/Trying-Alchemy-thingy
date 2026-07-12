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
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", `Remove ${el}`);
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

    configuredMaxArity = Number(document.getElementById("max-arity-select")?.value) || 2;
    resetRecipeData();

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
        showLoadStatus(`That file has a syntax error: ${e.message}`, true);
        return;
    }

    if (recipeList.length === 0) {
        showLoadStatus("No valid recipes were found in that file — check the format and try again.", true);
        return;
    }

    const hintMode = document.querySelector('input[name="hint-mode"]:checked')?.value === "yes";

    let summary = `Loaded ${recipeList.length} recipe${recipeList.length === 1 ? "" : "s"}, ${universe.size} total elements, arities from 2 to ${maxArityFound}. Starting elements: ${startingElements.join(", ")}. Hint Mode: ${hintMode ? "on" : "off"}.`;
    if (skippedLines.length > 0) {
        summary += ` ${skippedLines.length} line${skippedLines.length === 1 ? "" : "s"} ${skippedLines.length === 1 ? "was" : "were"} skipped (exceeded the max combo size, or had fewer than 2 ingredients).`;
    }
    showLoadStatus(summary);

    // Phase 2 takes over from here: launching the actual playable game
    // using this validated recipes/universe/startingElements/hintMode/
    // configuredMaxArity data. Not built yet — this phase stops at
    // "successfully loaded and confirmed," on purpose.
}

// ---------- Init ----------

window.addEventListener("DOMContentLoaded", () => {
    setupStartingElementsEditor();
    document.getElementById("load-custom-btn")?.addEventListener("click", handleLoadCustom);
});

})();
