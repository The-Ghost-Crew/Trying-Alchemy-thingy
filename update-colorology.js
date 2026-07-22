#!/usr/bin/env node
// Regenerates colorology-data.json from the "bestOf" subset of the
// color-name-list package (github.com/meodai/color-names) — the same
// open-source, community-maintained dataset behind the Color Parrot bot,
// which adds roughly 20 new names a day.
//
// Critically, this does NOT just dump the whole "bestOf" subset into the
// output file — it cross-references every color name against the
// elements actually defined in recipes.js and keeps ONLY the ones that
// match. colorology-data.json is fetched fresh (cache: "no-store") on
// every single page load, so shipping thousands of entries that could
// never match anything in THIS specific game would just be wasted
// bandwidth for every visitor, forever. A small, relevant file is the
// whole point of doing the cross-reference here instead of at runtime.
//
// .mjs on purpose, not .js — color-name-list is published as an ES
// module, and this repo's other scripts (sort-recipes.js) are
// CommonJS. Forcing this one file to be treated as a module regardless
// of any package.json setting avoids the two conventions colliding.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const RECIPES_PATH = path.join(REPO_ROOT, "recipes.js");
const OUT_PATH = path.join(REPO_ROOT, "colorology-data.json");

// These two thresholds check that each INPUT STAGE looks healthy — not
// the final cross-referenced count, which can legitimately be small
// (even zero, in principle) depending on how many of this specific
// game's element names happen to also be real color names. A low
// threshold here would incorrectly reject a perfectly valid, just-small
// result; these instead catch "recipes.js parsing broke" or "the
// package's export shape changed" separately from that.
const MIN_RECIPE_NAMES = 10; // sanity check that recipes.js parsing actually found real content
const MIN_BESTOF_COLORS = 100; // sanity check that the color-name-list import actually returned real content

function extractElementNames(recipesSource) {
    // Same approach already established elsewhere in this project for
    // reading recipes.js: every recipe(...) call, every quoted string
    // inside it — ingredients and results alike, since either could
    // coincidentally be a color name.
    const names = new Set();
    for (const call of recipesSource.matchAll(/recipe\(([^)]*)\)/g)) {
        for (const quoted of call[1].matchAll(/"([^"]*)"/g)) {
            const name = quoted[1].trim();
            if (name) names.add(name.toLowerCase());
        }
    }
    return names;
}

async function loadBestOf() {
    // The exact export shape has some variance across versions (the
    // color-mixing script this project already has needed the same kind
    // of fallback chain for the base package), so this tries the
    // reasonable possibilities rather than assuming just one.
    let mod;
    try {
        mod = await import("color-name-list/bestof");
    } catch (e) {
        throw new Error(`Could not import color-name-list/bestof — is it installed? (${e.message})`);
    }
    const candidates = [mod.default, mod.colornames, mod.colorNameList, mod.bestOf, mod];
    const list = candidates.find(c => Array.isArray(c));
    if (!list) {
        throw new Error("color-name-list/bestof did not export a recognizable array — check the package's actual export shape and update the candidates list above.");
    }
    return list;
}

function isValidHex(hex) {
    return typeof hex === "string" && /^#?[0-9a-fA-F]{6}$/.test(hex);
}

function normalizeHex(hex) {
    const stripped = hex.startsWith("#") ? hex.slice(1) : hex;
    return `#${stripped.toLowerCase()}`;
}

async function main() {
    if (!fs.existsSync(RECIPES_PATH)) {
        throw new Error(`recipes.js not found at ${RECIPES_PATH} — expected it at the repo root.`);
    }
    const recipesSource = fs.readFileSync(RECIPES_PATH, "utf8");
    const elementNames = extractElementNames(recipesSource);
    if (elementNames.size < MIN_RECIPE_NAMES) {
        throw new Error(`Only found ${elementNames.size} element names in recipes.js (expected far more) — recipes.js parsing likely broke, refusing to proceed.`);
    }

    const rawColorList = await loadBestOf();

    const table = {};
    let skippedMalformed = 0;
    for (const entry of rawColorList) {
        const name = entry && (entry.name || entry.title);
        const hex = entry && entry.hex;
        if (!name || !isValidHex(hex)) {
            skippedMalformed++;
            continue;
        }
        const key = String(name).trim().toLowerCase();
        if (!key) {
            skippedMalformed++;
            continue;
        }
        if (!(key in table)) table[key] = normalizeHex(hex); // case-insensitive collisions keep whichever came first — simple, deterministic, not worth a more elaborate tie-break rule here
    }

    const bestOfCount = Object.keys(table).length;
    if (bestOfCount < MIN_BESTOF_COLORS) {
        throw new Error(`Only extracted ${bestOfCount} valid color entries from color-name-list (expected hundreds+) — the package's export shape likely changed, refusing to proceed. ${skippedMalformed} entries were skipped as malformed.`);
    }

    // The actual cross-reference: keep only color names that match a
    // real element somewhere in recipes.js.
    const matched = {};
    Object.keys(table).forEach(key => {
        if (elementNames.has(key)) matched[key] = table[key];
    });

    // Sorted keys — same reasoning as sorting recipes.js: clean, minimal,
    // reviewable diffs on every future run, not a scrambled reordering.
    const sorted = {};
    Object.keys(matched).sort((a, b) => a.localeCompare(b)).forEach(k => { sorted[k] = matched[k]; });

    fs.writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`recipes.js: ${elementNames.size} element names found.`);
    console.log(`color-name-list "bestOf": ${bestOfCount} valid colors found (${skippedMalformed} malformed entries skipped).`);
    console.log(`Wrote ${Object.keys(sorted).length} colorology matches to ${OUT_PATH}.`);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
