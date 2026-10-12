# Arhoj Plaza

A tiny Mii-Plaza-style toy: make little ceramic characters (inspired by Studio Arhoj's cones, mushrooms and ghosts), then watch them potter around an island.

## Run it

```sh
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

- **✏️ Make**: shape, size, glaze, topper, face and personality. **Save** moves them into the plaza.
- **🏝️ Plaza**: characters wander, hop, chat and show moods. Click one to see it or edit it. Drag to orbit, scroll to zoom.
- `?debug=grid` shows a lineup of 25 random characters, which is handy for tuning shapes and colours.

Characters are stored in your browser (`localStorage`).

## Where things live

| File | What it does |
|---|---|
| `src/character/recipe.ts` | The character data (a small JSON "recipe") and randomiser |
| `src/character/build.ts` | Recipe → 3D model: body shapes, glaze, face, toppers |
| `src/character/palette.ts` | Glaze colours |
| `src/editor/editor.ts` | The character maker |
| `src/plaza/behaviour.ts` | How characters walk, idle, chat; personality traits |
| `src/scene/island.ts` | The island, pond, trees |
