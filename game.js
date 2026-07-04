const STORAGE_KEY = "alchemy_discovered_elements";

// Base elements every player starts with.
const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

const discovered = new Set(BASE_ELEMENTS);

const recipes = {};       // lookup: "a|b" -> result
const recipeList = [];    // full list: { a, b, result } — used for the tree + hints
const universe = new Set(BASE_ELEMENTS); // every element that exists in recipes.js, discovered or not

function recipe(a, b, result) {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const resultLower = result.toLowerCase();

    const key = [aLower, bLower].sort().join("|");

    if (recipes[key]) {
        throw new Error(`Duplicate combo: ${key}`);
    }

    recipes[key] = resultLower;
    recipeList.push({ a: aLower, b: bLower, result: resultLower });

    universe.add(aLower);
    universe.add(bLower);
    universe.add(resultLower);
}

function combine(a, b) {
    const key = [a, b]
        .map(x => x.toLowerCase())
        .sort()
        .join("|");

    return recipes[key] || null;
}

function saveProgress() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...discovered]));
    } catch (e) {
        // Private browsing, disabled storage, or quota issues. The game
        // still works this session, it just won't remember next time.
        console.warn("Could not save progress:", e);
    }
}

function loadProgress() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;

        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;

        parsed.forEach(element => {
            if (typeof element === "string") {
                discovered.add(element.toLowerCase());
            }
        });
    } catch (e) {
        // Corrupted or unreadable saved data — start fresh instead of crashing.
        console.warn("Could not load saved progress:", e);
    }
}

// Only count discovered elements that still exist in the current recipes.js.
// This keeps the fraction correct even if elements get renamed or removed
// in a future update.
function validDiscoveredCount() {
    let count = 0;
    discovered.forEach(el => {
        if (universe.has(el)) count++;
    });
    return count;
}

let first = null;

function updateProgressDisplays() {
    const count = validDiscoveredCount();
    const total = universe.size;
    const complete = count >= total;

    document.querySelectorAll(".progress-fraction").forEach(node => {
        node.textContent = `${count} / ${total}`;
    });

    const seal = document.getElementById("progress-seal");
    if (seal) seal.classList.toggle("complete", complete);

    const banner = document.getElementById("complete-banner");
    if (banner) {
        banner.hidden = !complete;
    }
}

function render() {
    const box = document.getElementById("elements");
    if (!box) return;

    box.innerHTML = "";

    const query = (document.getElementById("search")?.value || "").toLowerCase().trim();

    [...discovered]
        .filter(el => universe.has(el))
        .sort()
        .filter(el => el.includes(query))
        .forEach(element => {
            const button = document.createElement("button");

            button.textContent = element;
            button.className = "element-tile";
            if (element === first) button.classList.add("selected");

            button.onclick = () => {
                if (first === null) {
                    first = element;
                    render();
                    return;
                }

                const chosenFirst = first;
                const result = combine(chosenFirst, element);

                document.getElementById("result").textContent = result
                    ? `${chosenFirst} + ${element} = ${result}`
                    : `${chosenFirst} + ${element} = nothing happens`;

                if (result && !discovered.has(result)) {
                    discovered.add(result);
                    saveProgress();
                    renderTree();
                }

                first = null;
                updateProgressDisplays();
                render();
            };

            box.appendChild(button);
        });
}

// Builds a spoiler-safe family tree: an element's origin is only shown once
// it's been discovered, and combos leading to undiscovered results are
// hinted at (not named) so the game stays a game.
function renderTree() {
    const container = document.getElementById("tree");
    if (!container) return;

    container.innerHTML = "";

    const discoveredSorted = [...discovered].filter(el => universe.has(el)).sort();

    discoveredSorted.forEach(element => {
        const card = document.createElement("div");
        card.className = "tree-card";

        const heading = document.createElement("h3");
        heading.textContent = element;
        card.appendChild(heading);

        const origin = recipeList.find(r => r.result === element);
        const originLine = document.createElement("p");
        originLine.className = "tree-origin";
        originLine.textContent = origin
            ? `Made from ${origin.a} + ${origin.b}`
            : "Starting element";
        card.appendChild(originLine);

        const usedIn = recipeList.filter(
            r => (r.a === element || r.b === element) && discovered.has(r.result)
        );

        if (usedIn.length > 0) {
            const usedHeading = document.createElement("p");
            usedHeading.className = "tree-used-label";
            usedHeading.textContent = "Combines into:";
            card.appendChild(usedHeading);

            const list = document.createElement("ul");
            usedIn.forEach(r => {
                const partner = r.a === element ? r.b : r.a;
                const li = document.createElement("li");
                li.textContent = `+ ${partner} → ${r.result}`;
                list.appendChild(li);
            });
            card.appendChild(list);
        }

        const hiddenCombos = recipeList.filter(
            r =>
                (r.a === element || r.b === element) &&
                discovered.has(r.a) &&
                discovered.has(r.b) &&
                !discovered.has(r.result)
        );

        if (hiddenCombos.length > 0) {
            const hint = document.createElement("p");
            hint.className = "tree-hint";
            hint.textContent = `${hiddenCombos.length} undiscovered combination${
                hiddenCombos.length > 1 ? "s" : ""
            } waiting among your elements.`;
            card.appendChild(hint);
        }

        container.appendChild(card);
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
        });
    });
}

function setupSearch() {
    const search = document.getElementById("search");
    if (!search) return;
    search.addEventListener("input", render);
}

window.addEventListener("load", () => {
    loadProgress();
    setupTabs();
    setupSearch();
    updateProgressDisplays();
    render();
    renderTree();
});
