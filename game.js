const discovered = new Set(["air", "water", "earth", "fire"]);

const recipes = {};

function recipe(a, b, result) {
    const key = [a, b]
        .map(x => x.toLowerCase())
        .sort()
        .join("|");

    if (recipes[key]) {
        throw new Error(`Duplicate combo: ${key}`);
    }

    recipes[key] = result.toLowerCase();
}

function combine(a, b) {
    const key = [a, b]
        .map(x => x.toLowerCase())
        .sort()
        .join("|");

    return recipes[key] || null;
}

let first = null;

function render() {
    const box = document.getElementById("elements");
    box.innerHTML = "";

    [...discovered]
        .sort()
        .forEach(element => {
            const button = document.createElement("button");

            button.textContent = element;

            button.onclick = () => {
                if (first === null) {
                    first = element;
                    return;
                }

                const result = combine(first, element);

                document.getElementById("result").textContent =
                    result
                        ? `${first} + ${element} = ${result}`
                        : "No recipe";

                if (result) {
                    discovered.add(result);
                }

                first = null;
                render();
            };

            box.appendChild(button);
        });
}

window.addEventListener("load", render);
