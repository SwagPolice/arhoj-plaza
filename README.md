# Arhoj Plaza

*A fan project, not affiliated with Studio Arhoj.*

A tiny Mii-Plaza-style toy: make little ceramic characters (inspired by Studio Arhoj's cones, mushrooms and ghosts), then watch them potter around an island.

Two ways to play, chosen on the start screen (⇄ switches any time):

- **Creative**: everything unlocked. Make characters, decorate the island freely.
- **Studio** (v0.1): start with one bare clay ghost on a tiny island. Collect the clay it drops (hover over it with a mouse, or tap it), make more ghosts,
  build a glaze well for paint, and dip your ghosts. A mixing bowl turns two paints into a new colour (7 to discover).
  Then a balloon merchant starts visiting with decorations and a broom (it makes a character Tidy: they pick up drops),
  and a harbour sends crews on expeditions (30 min to 2 h) that come back with finds, including driftwood and coral.
  Decorations you buy or find go into storage first; Arrange puts them out (and away again, wells and the bowl too).
  The island grows in four steps (150, 400, 900 and 2000 clay), from radius 5 to 11.
  Shooting stars (the first about 20 minutes after the mixing bowl, then every 3 to 8 hours) bring white paint,
  which opens the pastel mixes.
  Decorations start as white bisque and can be dyed with any paint (in Arrange). The palette book (📖) collects
  every glaze colour you find, with a special decoration every 6 colours.
  The pace is calm: at most 30 drops lie around, and while you're away (up to 8 hours) the studio works at a third
  of its speed and only Tidy characters collect; the rest waits on the island for you.

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

Islands work the same way from **🛠 Decorate**: **↗ Share island** and **Import island**. Island links look like
`…/#island=arhojisle1.…`; opening one asks before replacing your island. Characters are never part of an island code.

## Studio Mode

The rules are pure functions in `src/studio/economy.ts` (rates, costs, time away), so live play and time away
can't disagree; `tests/studio-economy.test.ts` checks the pacing (first well within about 8 minutes, first dip
within about 11, first mixed colour within about 30, and an hour of eager play keeps the counters low). Mixing recipes are fixed, in `src/studio/mixing.ts`; the merchant's stock, prices, steps and visits are in
`src/studio/merchant.ts` (`?debug=merchant` shows his model); destinations and finds in `src/studio/harbour.ts`. The Studio save (`src/studio/state.ts`) follows the same safety rules as everything else.
In development, `?fast` makes Studio time run 20 times faster.

## Backup & move

**💾** (next to the tabs) saves everything (Creative's characters and island, and the Studio) as a file or a code, and restores one.
Restoring asks whether to **Replace everything** (an exact copy) or **Add to mine** (only characters that aren't
already here; the island only if ticked). Backups are versioned and tested like share codes (`tests/backup.test.ts`).

## Changing characters safely

Saved characters and share codes must keep working as the game grows. Before changing `src/character/recipe.ts`,
read the rules at the top of that file (defaults for new settings, never rename shipped values, map removed ones,
bump `RECIPE_VERSION` with a migration for changed meanings).

The island layout (`src/scene/layout.ts`) follows the same rules, checked by `tests/island.test.ts`.

`npm test` opens every frozen code in `tests/fixtures.ts` (characters and islands) and checks it still gives the same result.
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
| `src/share.ts` | Share codes and links (characters and islands) |
| `src/backup.ts` | Backups: everything in one file or code |
| `src/scene/island-view.ts` | What the Creative plaza and the Studio share: island, camera, characters |
| `src/studio/` | Studio Mode: save (`state.ts`), rules (`economy.ts`), mixing recipes (`mixing.ts`), merchant (`merchant.ts`, `merchant-model.ts`, `merchant-view.ts`), harbour (`harbour.ts`, `harbour-view.ts`), storage (`storage.ts`), screen (`studio.ts`) |
| `tests/` | Checks that old share codes and saves still load |

## Publishing

The game is a static site. Every push to `main` runs `.github/workflows/deploy.yml`, which builds it (type-check
and tests included) and publishes `dist/` to GitHub Pages. A failing test stops the deploy.
