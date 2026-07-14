#!/usr/bin/env node
"use strict";

// Sorts recipes.js alphabetically, one recipe() call per line, and
// removes exact duplicate recipes along the way.
//
// Sorted CASE-INSENSITIVELY on purpose, even though the game itself
// treats "Earth" and "earth" as genuinely different elements — this is
// purely about making the file easy for a human to scan, and putting
// "Earth" and "earth" recipes near each other actually helps a
// maintainer visually spot an accidental case-typo while editing, the
// same problem the in-game case-collision checker exists to catch.
//
// Only lines that look like a real recipe() call get reordered or
// deduplicated. Any other line (a comment, a blank line) is left alone
// and kept at the top, so this can't accidentally scramble something
// that isn't actually a recipe.
//
// Deduplication is intentionally narrow: it only removes lines that are
// EXACT duplicates of each other (ingredients AND result all match).
// Two recipes with the same ingredients but a DIFFERENT result are left
// completely untouched — that's a conflicting-recipe situation, not a
// duplicate one, and picking a winner silently isn't this script's job.

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "recipes.js");
const original = fs.readFileSync(filePath, "utf8");

const RECIPE_LINE = /^\s*recipe\(/;

const lines = original.split("\n");
const recipeLines = lines.filter(l => RECIPE_LINE.test(l));
const otherLines = lines.filter(l => !RECIPE_LINE.test(l) && l.trim() !== "");

const seen = new Set();
const dedupedRecipeLines = [];
let duplicateCount = 0;

function extractArgs(line) {
    // Matches everything between recipe( and the closing );  — the
    // arguments are then split on commas and unquoted. This assumes
    // element names never contain a literal comma themselves, which
    // holds for every recipe in this project so far.
    const match = line.match(/recipe\((.*)\)\s*;?\s*$/);
    if (!match) return null;
    return match[1].split(",").map(arg => arg.trim().replace(/^["']|["']$/g, ""));
}

recipeLines.forEach(line => {
    const args = extractArgs(line);
    // Comparing the PARSED arguments, not the raw text — so
    // recipe("a","b","c"); and recipe( "a", "b", "c" ); are correctly
    // caught as the same duplicate despite not being byte-identical.
    // The ORIGINAL line (with its original formatting) is what's kept.
    const key = args ? args.join("|") : line.trim();
    if (seen.has(key)) {
        duplicateCount++;
        return;
    }
    seen.add(key);
    dedupedRecipeLines.push(line);
});

dedupedRecipeLines.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

const sorted = [...otherLines, ...dedupedRecipeLines].join("\n") + "\n";

if (sorted !== original) {
    fs.writeFileSync(filePath, sorted, "utf8");
    console.log(`Sorted ${dedupedRecipeLines.length} recipes. Removed ${duplicateCount} exact duplicate${duplicateCount === 1 ? "" : "s"}.`);
} else {
    console.log("Already sorted with no duplicates — no changes needed.");
}
