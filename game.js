const STORAGE_KEY = "alchemy_discovered_elements";

// Base elements every player starts with.
const BASE_ELEMENTS = ["air", "water", "earth", "fire"];

const discovered = new Set(BASE_ELEMENTS);

const recipes = {};        // lookup: "a|b" -> result
const recipeList = [];     // full list: { a, b, result } — used for tree + hints + dead-end check
const universe = new Set(BASE_ELEMENTS);     // every element that exists in recipes.js
const combinableSet = new Set();             // elements that appear as an ingredient somewhere

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

    combinableSet.add(aLower);
    combinableSet.add(bLower);
}

function combine(a, b) {
    const key = [a, b]
        .map(x => x.toLowerCase())
        .sort()
        .join("|");

    return recipes[key] || null;
}

// A "dead end" is permanent: it never appears as an ingredient in ANY
// recipe in recipes.js, so no future pairing with it will ever produce
// anything new. This is deliberately NOT based on what you currently
// have discovered — that would flag elements as dead just because you
// haven't found their partner yet, which would be actively misleading.
function isDeadEnd(el) {
    return universe.has(el) && !combinableSet.has(el);
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

        parsed.forEach(element => {
            if (typeof element === "string") {
                discovered.add(element.toLowerCase());
            }
        });
    } catch (e) {
        console.warn("Could not load saved progress:", e);
    }
}

function validDiscoveredCount() {
    let count = 0;
    discovered.forEach(el => {
        if (universe.has(el)) count++;
    });
    return count;
}

function deadEndDiscoveredCount() {
    let count = 0;
    discovered.forEach(el => {
        if (isDeadEnd(el)) count++;
    });
    return count;
}

let first = null;
let lastDiscovered = null; // most recent new element, for the "new" highlight

function updateProgressDisplays() {
    const count = validDiscoveredCount();
    const total = universe.size;
    const deadEnds = deadEndDiscoveredCount();
    const complete = count >= total && total > 0;

    document.querySelectorAll(".progress-fraction").forEach(node => {
        node.textContent = `${count} / ${total}`;
    });

    document.querySelectorAll(".dead-end-count").forEach(node => {
        node.textContent = `${deadEnds} dead end${deadEnds === 1 ? "" : "s"} found`;
    });

    const seal = document.getElementById("progress-seal");
    if (seal) seal.classList.toggle("complete", complete);

    const banner = document.getElementById("complete-banner");
    if (banner) banner.hidden = !complete;
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
            if (isDeadEnd(element)) button.classList.add("dead-end");
            if (element === lastDiscovered) button.classList.add("just-found");

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
                    lastDiscovered = result;
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

// ---------- Family tree: node graph ----------

let simulation = null;

function buildGraphData() {
    const discoveredValid = [...discovered].filter(el => universe.has(el));
    const discoveredSet = new Set(discoveredValid);

    const degree = {};
    discoveredValid.forEach(el => (degree[el] = 0));

    const links = [];
    recipeList.forEach(r => {
        if (!discoveredSet.has(r.result)) return; // spoiler-safe: only show found results
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
        deadEnd: isDeadEnd(el),
        degree: degree[el] || 0
    }));

    return { nodes, links };
}

function showTreeDetail(element) {
    const panel = document.getElementById("tree-detail");
    if (!panel) return;

    panel.hidden = false;
    panel.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = element;
    panel.appendChild(heading);

    const origin = recipeList.find(r => r.result === element);
    const originLine = document.createElement("p");
    originLine.className = "tree-origin";
    originLine.textContent = origin ? `Made from ${origin.a} + ${origin.b}` : "Starting element";
    panel.appendChild(originLine);

    const usedIn = recipeList.filter(
        r => (r.a === element || r.b === element) && discovered.has(r.result)
    );

    if (usedIn.length > 0) {
        const usedHeading = document.createElement("p");
        usedHeading.className = "tree-used-label";
        usedHeading.textContent = "Combines into:";
        panel.appendChild(usedHeading);

        const list = document.createElement("ul");
        usedIn.forEach(r => {
            const partner = r.a === element ? r.b : r.a;
            const li = document.createElement("li");
            li.textContent = `+ ${partner} → ${r.result}`;
            list.appendChild(li);
        });
        panel.appendChild(list);
    }

    if (isDeadEnd(element)) {
        const deadNote = document.createElement("p");
        deadNote.className = "tree-dead-note";
        deadNote.textContent = "Dead end — this element never leads to anything new.";
        panel.appendChild(deadNote);
    } else {
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
            panel.appendChild(hint);
        }
    }
}

function renderGraph() {
    const wrap = document.getElementById("tree-graph-wrap");
    if (!wrap || typeof d3 === "undefined") return;

    wrap.innerHTML = "";

    const width = wrap.clientWidth || 320;
    const height = 420;

    const { nodes, links } = buildGraphData();

    const svg = d3
        .select(wrap)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", height);

    const g = svg.append("g");

    svg.call(
        d3.zoom()
            .scaleExtent([0.4, 3])
            .on("zoom", event => g.attr("transform", event.transform))
    );

    const link = g
        .append("g")
        .attr("stroke", "#4a4f68")
        .attr("stroke-width", 1.2)
        .selectAll("line")
        .data(links)
        .join("line");

    const radius = d => 8 + Math.min(d.degree, 6) * 1.4;

    const node = g
        .append("g")
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

    const label = g
        .append("g")
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

    simulation = d3
        .forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(46).strength(0.7))
        .force("charge", d3.forceManyBody().strength(-90))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => radius(d) + 6))
        .on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node.attr("cx", d => d.x).attr("cy", d => d.y);
            label.attr("x", d => d.x).attr("y", d => d.y);
        });
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
            card.className = "tree-card" + (isDeadEnd(element) ? " dead-end-card" : "");

            const heading = document.createElement("h3");
            heading.textContent = element;
            card.appendChild(heading);

            const origin = recipeList.find(r => r.result === element);
            const originLine = document.createElement("p");
            originLine.className = "tree-origin";
            originLine.textContent = origin ? `Made from ${origin.a} + ${origin.b}` : "Starting element";
            card.appendChild(originLine);

            if (isDeadEnd(element)) {
                const deadNote = document.createElement("p");
                deadNote.className = "tree-dead-note";
                deadNote.textContent = "Dead end";
                card.appendChild(deadNote);
            }

            container.appendChild(card);
        });
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

    if (graphWrap) graphWrap.hidden = !isGraph;
    if (detail) detail.hidden = true;
    if (list) list.hidden = isGraph;

    document.querySelectorAll(".view-toggle").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === mode);
    });

    if (isGraph) renderGraph();
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
            renderTree();
            showStatus(added > 0 ? `Added ${added} element(s) from the backup code.` : "Nothing new in that code — you already had it all.");
        } catch {
            showStatus("That code couldn't be read. Double-check you copied it in full.");
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

            if (btn.dataset.tab === "tree") renderGraph();
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

window.addEventListener("load", () => {
    loadProgress();
    setupTabs();
    setupSearch();
    setupBackupControls();
    updateProgressDisplays();
    render();
    renderTree();
});

window.addEventListener("resize", () => {
    const graphWrap = document.getElementById("tree-graph-wrap");
    if (graphWrap && !graphWrap.hidden) renderGraph();
});
