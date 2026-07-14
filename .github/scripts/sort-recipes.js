#!/usr/bin/env node
"use strict";

// Sorts recipes.js alphabetically, one recipe() call per line.
//
// Sorted CASE-INSENSITIVELY on purpose, even though the game itself
// treats "Earth" and "earth" as genuinely different elements — this is
// purely about making the file easy for a human to scan, and putting
// "Earth" and "earth" recipes near each other actually helps a
// maintainer visually spot an accidental case-typo while editing, the
// same problem the in-game case-collision checker exists to catch.
//
// Only lines that look like a real recipe() call get reordered. Any
// other line (a comment, a blank line) is left alone and kept at the
// top, so this can't accidentally scramble something that isn't
// actually a recipe.

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "recipes.js");
const original = fs.readFileSync(filePath, "utf8");

const RECIPE_LINE = /^\s*recipe\(/;

const lines = original.split("\n");
const recipeLines = lines.filter(l => RECIPE_LINE.test(l));
const otherLines = lines.filter(l => !RECIPE_LINE.test(l) && l.trim() !== "");

recipeLines.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

const sorted = [...otherLines, ...recipeLines].join("\n") + "\n";

if (sorted !== original) {
    fs.writeFileSync(filePath, sorted, "utf8");
    console.log(`Sorted ${recipeLines.length} recipes.`);
} else {
    console.log("Already sorted — no changes needed.");
}
