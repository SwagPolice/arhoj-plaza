# Arhoj Plaza

*A fan project, not affiliated with Studio Arhoj.*

A tiny Mii-Plaza-style toy: make little ceramic characters (inspired by Studio Arhoj's cones, mushrooms and ghosts), then watch them potter around an island.

## Run it

```sh
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

- **✏️ Make**: shape, size, glaze layers (or glass, for mushrooms), eyes and personality. **Save** moves them into the plaza.
- **🏝️ Plaza**: characters wander, hop, chat and show moods. Click one to see it or edit it. Drag to orbit, scroll to zoom.
- **🛠 Decorate** (in the plaza): change the island's size, add trees, ponds, rocks and mushrooms, drag them around, tap one to remove it.
- `?debug=grid` shows a lineup of random characters (one row per shape), which is handy for tuning shapes and colours.

Characters and the island layout are stored in your browser (`localStorage`).

## Sharing characters

In the maker, **↗ Share** gives a code (and a link) for the current character; **Import a code** adds a shared one
as a new, unsaved character. Links look like `…/#import=arhoj1.…` and open straight into the maker.

## Changing characters safely

Saved characters and share codes must keep working as the game grows. Before changing `src/character/recipe.ts`,
read the rules at the top of that file (defaults for new settings, never rename shipped values, map removed ones,
bump `RECIPE_VERSION` with a migration for changed meanings).

The island layout (`src/scene/layout.ts`) follows the same rules, checked by `tests/island.test.ts`.

`npm test` opens every frozen code in `tests/fixtures.ts` and checks it still gives the same character.
When you add a feature, add a code that uses it there. `npm run build` runs the tests too.

## Where things live

| File | What it does |
|---|---|
| `src/character/recipe.ts` | The character data (a small JSON "recipe") and randomiser |
| `src/character/build.ts` | Recipe → 3D model: body shapes and eyes (`glaze.ts` and `glass.ts` paint the materials) |
| `src/character/palette.ts` | Glaze colours |
| `src/editor/editor.ts` | The character maker |
| `src/plaza/behaviour.ts` | How characters walk, idle, chat; personality traits |
| `src/scene/layout.ts` | The island as data: size, decorations, placement rules |
| `src/scene/island.ts` | Builds the island and its decorations from a layout |
| `src/plaza/decorate.ts` | Decorate mode |
| `src/share.ts` | Share codes and links |
| `tests/` | Checks that old share codes and saves still load |

## Publishing

The game is a static site. Every push to `main` runs `.github/workflows/deploy.yml`, which builds it (type-check
and tests included) and publishes `dist/` to GitHub Pages. A failing test stops the deploy.
