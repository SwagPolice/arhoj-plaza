import * as THREE from 'three';
import { IslandView } from '../scene/island-view';
import type { IslandLayout } from '../scene/layout';
import { glaze } from '../scene/stage';
import { disposeObject } from '../character/build';
import { EYES, PERSONALITIES, randomName, type Eyes, type Personality } from '../character/recipe';
import { CLAY } from '../character/palette';
import { loadStudio, saveStudio } from '../storage';
import { button, el } from '../ui/dom';
import { openDialog, row } from '../ui/share-dialogs';
import type { Agent } from '../plaza/behaviour';
import {
  addTo, advance, BOWL_COST, bowlOf, buyBowl, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround, ghostCost,
  nextGoal, startMix, wellCost, type Mixed, type Yield,
} from './economy';
import { colourName, mixResult, recipeFor } from './mixing';
import { bareGhost, MAX_GROUND, PRIMARIES, type Drop, type StudioState } from './state';

const PERSONALITY_ICON: Record<Personality, string> = { calm: '🍵', curious: '🔍', shy: '🌱', bouncy: '🎵' };
const EYE_LABELS: Record<Eyes, string> = { open: 'Open', tired: 'Tired', sleepy: 'Sleeping', happy: 'Happy', crossed: 'Crossed' };
const Name = (hex: string) => colourName(hex).replace(/^./, (c) => c.toUpperCase());
const LAND = 0.45; // seconds for a drop to arc to the ground
const POP = 0.25; // seconds for a collected drop to pop away

type Flying = { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number };

/**
 * Studio Mode: start with one bare clay ghost, collect what everyone drops, build, dip.
 * The rules live in economy.ts; this is the island you see and tap.
 */
export class Studio extends IslandView {
  private state: StudioState;
  private drops = new THREE.Group();
  private flying: Flying[] = [];
  private popping: { obj: THREE.Object3D; t: number }[] = [];
  private hud = el('div', 'studio-hud');
  private bar = el('div', 'studio-bar');
  private ghostBtn = button('', 'btn primary', () => this.openNewGhost());
  private wellBtn = button('', 'btn', () => this.buildWell());
  private bowlBtn = button('', 'btn', () => this.buildBowl());
  private card = el('div', 'card studio-card');
  private cardFor: string | null = null;
  private shown = ''; // what the HUD last showed, to bump only what changed
  private saveClock = 0;
  private speed = 1;
  private booting = false;

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture, uiRoot: HTMLElement) {
    const state = loadStudio();
    super(renderer, env, uiRoot, state.island);
    this.state = state;
    // Build the island again now that the wells' colours are known, without saving: saving stamps
    // "last seen = now", which must wait until the time away has been counted.
    this.booting = true;
    this.applyLayout(state.island);
    this.booting = false;
    // Development only: ?fast makes time run 20 times faster, to test the loop quickly.
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('fast')) this.speed = 20;

    this.scene.add(this.drops);
    this.bar.append(this.ghostBtn, this.wellBtn, this.bowlBtn);
    this.card.style.display = 'none';
    this.addUI(this.hud, this.card, this.bar);

    // Only while you're in the Studio: time spent elsewhere (or in Creative) counts as time away.
    window.addEventListener('pagehide', () => this.active && this.persist());
    document.addEventListener('visibilitychange', () => {
      if (!this.active) return;
      if (document.hidden) this.persist();
      else this.welcomeBack();
    });
  }

  enter() {
    super.enter();
    this.welcomeBack();
    this.syncAgents(this.state.characters);
    this.showDrops();
    this.render();
  }

  leave() {
    this.persist();
    super.leave();
    this.card.style.display = 'none';
  }

  // ---------- IslandView hooks ----------

  protected saveLayout(layout: IslandLayout) {
    if (!this.state || this.booting) return; // the first builds, before the time away is counted
    this.state = { ...this.state, island: layout };
    this.persist();
  }

  protected get withFlowers() {
    return false; // they'd look like paint drops
  }

  protected wellTints() {
    return this.state?.wellTints ?? {};
  }

  protected onUpdate(dt: number, t: number) {
    const known = this.state.discovered;
    const { state, yields, mixed } = advance(this.state, dt * this.speed);
    this.state = state;
    // Paints the bowl gives back go straight into your purse, and so does a new colour when the ground
    // is too full for it to land (it shouldn't vanish into the held pile); everything else lands on the ground.
    const bowl = bowlOf(this.state)?.id;
    const fromBowl = yields.filter((y) => y.from === bowl);
    const direct = fromBowl.some((y) => y.back) || this.state.ground.length + fromBowl.length > MAX_GROUND ? fromBowl : [];
    for (const y of direct) this.state = { ...this.state, purse: addTo(this.state.purse, y.what, y.amount) };
    const fresh = yields.filter((y) => !direct.includes(y));
    if (fresh.length) this.place(fresh);
    if (mixed) this.afterMix(mixed, !!mixed.made && !known.includes(mixed.made));
    this.animateDrops(dt);
    this.stirBowl(t);
    if ((this.saveClock += dt) > 5) this.persist();
  }

  protected onTap(e: PointerEvent) {
    // Drops first: they're small and usually what you meant to tap.
    this.aim(e);
    const hit = this.raycaster.intersectObjects(this.drops.children, true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && !obj.userData.dropId) obj = obj.parent;
    if (obj) return this.collectDrop(obj.userData.dropId);
    const bowl = bowlOf(this.state);
    const bowlObj = bowl && this.island.decor.get(bowl.id);
    if (bowlObj && this.raycaster.intersectObject(bowlObj, true).length) return this.openMixer();
    const agent = this.pickAgent(e);
    if (!agent) {
      this.card.style.display = 'none';
      this.cardFor = null;
      return;
    }
    agent.lookAt(this.camera.position.x, this.camera.position.z, 3);
    this.say(agent, '😊');
    this.showCard(agent.recipe.id);
  }

  // ---------- time away ----------

  /** Coming back: what was made meanwhile lands on the "While you were away" card. */
  private welcomeBack() {
    const { state } = comeBack(this.state, Date.now());
    this.state = state;
    this.refreshTints();
    this.persist();
    if (this.state.away) this.showAwayCard();
  }

  private showAwayCard() {
    const away = this.state.away!;
    const lines = [el('li', '', `${away.clay} clay`)];
    for (const [colour, n] of Object.entries(away.paint)) {
      const li = el('li');
      const dot = el('span', 'swatch-dot');
      dot.style.background = colour;
      li.append(dot, `${n} ${colourName(colour)} paint`);
      lines.push(li);
    }
    const list = el('ul', 'away-list');
    list.append(...lines);
    const dialog = openDialog('While you were away', [
      el('p', 'muted', `Your studio kept working for ${duration(away.seconds)}. Everyone made:`),
      list,
      row(
        button('Collect', 'btn primary', () => {
          this.state = collectAway(this.state);
          this.persist();
          this.render();
          dialog.close();
        }),
      ),
    ]);
  }

  // ---------- drops ----------

  /** Fresh yields land near whoever made them; anything past the limit is held for later. */
  private place(yields: Yield[]) {
    const from = (y: Yield) => {
      const agent = this.agents.find((a) => a.recipe.id === y.from);
      if (agent) return new THREE.Vector3(agent.pos.x, agent.built.height * 0.6, agent.pos.y);
      const well = this.state.island.items.find((d) => d.id === y.from);
      if (well) return new THREE.Vector3(well.x, 0.5, well.z);
      const anyone = this.agents.at(Math.floor(Math.random() * this.agents.length));
      return anyone ? new THREE.Vector3(anyone.pos.x, 0.6, anyone.pos.y) : new THREE.Vector3();
    };
    const starts = yields.map(from);
    const r = dropOnGround(this.state, yields, (_y, i) => this.landingSpot(starts[i]));
    this.state = r.state;
    for (const { drop, index } of r.dropped) this.addDrop(drop, starts[index]);
    if (yields.some((y) => this.state.island.items.some((w) => w.id === y.from))) this.refreshTints();
  }

  /** A spot on the island a little way from where something was made. */
  private landingSpot(from: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.5 + Math.random() * 0.5;
    let x = from.x + Math.cos(a) * d;
    let z = from.z + Math.sin(a) * d;
    const max = this.state.island.radius - 0.45;
    const len = Math.hypot(x, z);
    if (len > max) [x, z] = [(x / len) * max, (z / len) * max];
    return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }

  private addDrop(d: Drop, from: THREE.Vector3 | null) {
    const obj = makeDrop(d);
    obj.userData.dropId = d.id;
    const to = new THREE.Vector3(d.x, 0.08, d.z);
    obj.position.copy(from ?? to);
    if (from) this.flying.push({ obj, from, to, t: 0 });
    this.drops.add(obj);
  }

  /** Show what's lying on the ground (after loading or coming back). */
  private showDrops() {
    const here = new Set(this.state.ground.map((d) => d.id));
    for (const obj of [...this.drops.children]) if (!here.has(obj.userData.dropId)) this.removeDrop(obj);
    const shown = new Set(this.drops.children.map((o) => o.userData.dropId));
    for (const d of this.state.ground) if (!shown.has(d.id)) this.addDrop(d, null);
  }

  private collectDrop(id: string) {
    const r = collect(this.state, id);
    if (!r.got) return;
    this.state = r.state;
    const obj = this.drops.children.find((o) => o.userData.dropId === id);
    if (obj) this.popping.push({ obj, t: 0 });
    if (r.release) this.place([r.release]);
    if (r.got.what !== 'clay') this.firstTime('paint', '🎨');
    this.render();
  }

  private removeDrop(obj: THREE.Object3D) {
    this.drops.remove(obj);
    disposeObject(obj);
  }

  private animateDrops(dt: number) {
    const t = performance.now() / 1000;
    this.flying = this.flying.filter((f) => {
      f.t = Math.min(1, f.t + dt / LAND);
      f.obj.position.lerpVectors(f.from, f.to, f.t);
      f.obj.position.y += Math.sin(f.t * Math.PI) * 0.6; // a little arc
      return f.t < 1;
    });
    for (const obj of this.drops.children) {
      if (this.flying.some((f) => f.obj === obj) || this.popping.some((p) => p.obj === obj)) continue;
      obj.position.y = 0.08 + Math.sin(t * 3 + obj.id) * 0.025; // a gentle bob
    }
    this.popping = this.popping.filter((p) => {
      p.t += dt / POP;
      p.obj.scale.setScalar(1 + p.t * 0.8);
      p.obj.position.y += dt * 1.2;
      p.obj.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material.visible !== false) {
          o.material.transparent = true;
          o.material.opacity = Math.max(0, 1 - p.t);
        }
      });
      if (p.t >= 1) this.removeDrop(p.obj);
      return p.t < 1;
    });
  }

  // ---------- building and dipping ----------

  private openNewGhost() {
    const cost = ghostCost(this.state);
    if (this.state.purse.clay < cost) return this.toast(`A new ghost needs ${cost} clay. Keep collecting!`);
    let eyes: Eyes = 'open';
    let personality: Personality = 'curious';
    const name = el('input', 'name-input');
    name.value = randomName();
    name.maxLength = 18;
    const nameRow = el('div', 'name-row');
    nameRow.append(name, button('🎲', 'icon-btn', () => (name.value = randomName())));
    const choices = <T extends string>(options: readonly T[], label: (v: T) => string, current: () => T, set: (v: T) => void) => {
      const wrap = el('div', 'chips');
      const draw = () =>
        wrap.replaceChildren(...options.map((v) => button(label(v), 'chip' + (v === current() ? ' on' : ''), () => (set(v), draw()))));
      draw();
      return wrap;
    };
    const dialog = openDialog('A new ghost', [
      el('p', 'muted', 'Fresh from the clay: no glaze yet. Choose a name, eyes and personality.'),
      nameRow,
      el('div', 'sub', 'Eyes'),
      choices(EYES, (v) => EYE_LABELS[v], () => eyes, (v) => (eyes = v)),
      el('div', 'sub', 'Personality'),
      choices(PERSONALITIES, (v) => `${PERSONALITY_ICON[v]} ${v[0].toUpperCase()}${v.slice(1)}`, () => personality, (v) => (personality = v)),
      row(
        button(`Make it (${cost} clay)`, 'btn primary', () => {
          const ghost = bareGhost({ name: name.value.trim() || randomName(), eyes, personality });
          const next = buyGhost(this.state, ghost);
          if (!next) return;
          this.state = next;
          this.syncAgents(this.state.characters);
          const agent = this.agents.find((a) => a.recipe.id === ghost.id);
          if (agent) this.say(agent, '✨');
          this.persist();
          this.render();
          dialog.close();
        }),
      ),
    ]);
  }

  private buildWell() {
    const cost = wellCost(this.state);
    if (this.state.purse.clay < cost) return this.toast(`A glaze well needs ${cost} clay. Keep collecting!`);
    const next = buyWell(this.state);
    if (!next) return this.toast('No room left on the island for another well.');
    this.state = next;
    this.applyLayout(next.island);
    this.returnToIsland(); // anyone standing where the well went steps aside
    this.firstTime('well', '🎉');
    this.render();
  }

  private buildBowl() {
    if (this.state.purse.clay < BOWL_COST) return this.toast(`The mixing bowl needs ${BOWL_COST} clay. Keep collecting!`);
    const next = buyBowl(this.state);
    if (!next) return this.toast('No room left on the island for the bowl.');
    this.state = next;
    this.applyLayout(next.island);
    this.returnToIsland();
    this.firstTime('bowl', '🎉');
    this.toast('Tap the bowl to mix two paints.');
    this.render();
  }

  // ---------- mixing ----------

  /** The mixing bowl: pick two paints, see what they make if you've made it before, and mix. */
  private openMixer() {
    if (this.state.bowl) return this.toast('Still stirring…');
    const picked: string[] = [];
    const dotOf = (colour: string) => {
      const dot = el('span', 'swatch-dot');
      dot.style.background = colour;
      return dot;
    };
    const slots = el('div', 'mix-slots');
    const makes = el('div', 'mix-makes');
    const chips = el('div', 'chips');
    const mixBtn = button('Mix', 'btn primary', () => {
      if (picked.length < 2) return;
      const next = startMix(this.state, picked[0], picked[1]);
      if (!next) return;
      this.state = next;
      this.persist();
      this.render();
      dialog.close();
    });
    const draw = () => {
      slots.replaceChildren(
        ...[0, 1].map((i) => {
          const c = picked[i];
          const slot = button('', 'mix-slot' + (c ? ' full' : ''), () => c && (picked.splice(i, 1), draw()));
          if (c) slot.style.background = c;
          slot.title = c ? `${Name(c)} (tap to take it out)` : 'Pick a paint below';
          return slot;
        }),
      );
      slots.insertBefore(el('span', 'mix-plus', '+'), slots.children[1]);
      const result = picked.length === 2 ? mixResult(picked[0], picked[1]) : null;
      const known = result && this.state.discovered.includes(result);
      makes.replaceChildren(picked.length < 2 ? 'Pick two paints' : known ? 'Makes ' : 'Makes: ?');
      if (picked.length === 2 && known) makes.append(dotOf(result), Name(result));
      const owned = Object.entries(this.state.purse.paint).filter(([c, n]) => n - picked.filter((p) => p === c).length > 0);
      chips.replaceChildren(
        ...owned.map(([c, n]) => {
          const b = button('', 'chip', () => picked.length < 2 && (picked.push(c), draw()));
          b.append(dotOf(c), `${Name(c)} (${n - picked.filter((p) => p === c).length})`);
          return b;
        }),
      );
      if (!owned.length && picked.length < 2) chips.append(el('span', 'muted', 'No more paint to pick.'));
      mixBtn.classList.toggle('off', picked.length < 2);
    };
    draw();
    const found = el('div', 'mix-found');
    for (const c of this.state.discovered) {
      const r = recipeFor(c);
      if (!r) continue;
      const line = el('div', 'mix-recipe');
      line.append(dotOf(r[0]), dotOf(r[1]), ' → ', dotOf(c), Name(c));
      found.append(line);
    }
    const dialog = openDialog('Mixing bowl', [
      el('p', 'muted', 'Two paints in, a new colour out. Not every pair makes something; if not, you get your paints back.'),
      slots,
      makes,
      chips,
      row(mixBtn),
      ...(found.children.length ? [el('div', 'sub mix-found-title', "Colours you've mixed"), found] : []),
    ]);
  }

  /** The bowl finished: celebrate a colour, or say it made nothing (the paints are already back). */
  private afterMix(m: Mixed, isNew: boolean) {
    if (m.made) {
      if (isNew) {
        this.toast(`New colour: ${Name(m.made)}!`);
        const agent = this.nearestTo(bowlOf(this.state));
        if (agent) this.say(agent, '✨');
      } else this.toast(`${Name(m.a)} and ${colourName(m.b)} made ${colourName(m.made)}.`);
      this.firstTime('mix', '🎨');
    } else {
      this.toast(`${Name(m.a)} and ${colourName(m.b)}… nothing new. Your paints are back.`);
    }
    this.persist();
    this.render();
  }

  private nearestTo(p: { x: number; z: number } | null): Agent | undefined {
    if (!p) return this.agents.at(0);
    return [...this.agents].sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.y - p.z) - Math.hypot(b.pos.x - p.x, b.pos.y - p.z))[0];
  }

  /** While the bowl stirs, its two paints turn around each other. */
  private stirBowl(t: number) {
    const bowl = bowlOf(this.state);
    const obj = bowl && this.island.decor.get(bowl.id);
    if (!obj) return;
    const mix = this.state.bowl;
    for (const [i, half] of obj.children.slice(1).entries()) {
      if (!(half instanceof THREE.Mesh)) continue;
      half.visible = !!mix;
      if (!mix) continue;
      (half.material as THREE.MeshPhysicalMaterial).color.set(i ? mix.b : mix.a);
      half.rotation.z = t * 3;
    }
  }

  private showCard(id: string) {
    const r = this.state.characters.find((c) => c.id === id);
    if (!r) return;
    this.cardFor = id;
    const parts: HTMLElement[] = [
      el('div', 'card-name', r.name || 'Unnamed'),
      el('div', 'muted', `${PERSONALITY_ICON[r.personality]} ${r.personality}`),
    ];
    if (r.layers.length) {
      parts.push(el('p', 'card-line', `Dipped in ${colourName(r.layers[0].colour)}. It sometimes drops that paint.`));
    } else {
      const owned = Object.entries(this.state.purse.paint).filter(([, n]) => n > 0);
      if (!owned.length) {
        parts.push(el('p', 'card-line', this.state.wellsBuilt ? 'Bare clay. Collect paint from the glaze well to dip it.' : 'Bare clay. Build a glaze well to make paint.'));
      } else {
        parts.push(el('p', 'card-line', 'Bare clay. Dip it in:'));
        const swatches = el('div', 'chips');
        for (const [colour, n] of owned) {
          const b = button('', 'chip', () => this.dipCharacter(id, colour));
          const dot = el('span', 'swatch-dot');
          dot.style.background = colour;
          b.append(dot, `${colourName(colour)} (${n})`);
          swatches.append(b);
        }
        parts.push(swatches);
      }
    }
    const close = el('div', 'card-actions');
    close.append(button('Close', 'btn', () => ((this.card.style.display = 'none'), (this.cardFor = null))));
    this.card.replaceChildren(...parts, close);
    this.card.style.display = '';
  }

  private dipCharacter(id: string, colour: string) {
    const next = dip(this.state, id, colour);
    if (!next) return;
    this.state = next;
    this.syncAgents(this.state.characters);
    const agent = this.agents.find((a) => a.recipe.id === id);
    if (agent) this.say(agent, '✨');
    this.firstTime('dip', '💖', agent);
    this.persist();
    this.render();
    this.showCard(id);
  }

  /** The first time of something gets a happy bubble from someone nearby. */
  private firstTime(what: string, emoji: string, who?: Agent) {
    if (this.state.firsts.includes(what)) return;
    this.state = { ...this.state, firsts: [...this.state.firsts, what] };
    const agent = who ?? this.agents.at(0);
    if (agent) this.say(agent, emoji, 0.3);
  }

  // ---------- HUD ----------

  private render() {
    const s = this.state;
    const chip = (colour: string, text: string, key: string) => {
      const c = el('span', 'hud-chip');
      const dot = el('span', 'swatch-dot');
      dot.style.background = colour;
      c.append(dot, text);
      c.dataset.key = key;
      return c;
    };
    const chips = [chip(CLAY, `${s.purse.clay} clay`, `clay:${s.purse.clay}`)];
    for (const colour of [...Object.values(PRIMARIES), ...Object.keys(s.purse.paint)]) {
      const n = s.purse.paint[colour] ?? 0;
      if (n > 0 && !chips.some((c) => c.dataset.key?.startsWith(colour))) chips.push(chip(colour, `${n}`, `${colour}:${n}`));
    }
    // Bump whatever changed since last time.
    const before = new Set(this.shown.split('|'));
    for (const c of chips) if (this.shown && !before.has(c.dataset.key!)) c.classList.add('bump');
    this.shown = chips.map((c) => c.dataset.key).join('|');
    const purse = el('div', 'hud-purse');
    purse.append(...chips);
    this.hud.replaceChildren(purse, el('div', 'hud-goal', nextGoal(s)));

    const gc = ghostCost(s);
    const wc = wellCost(s);
    priced(this.ghostBtn, '＋ Ghost', gc);
    priced(this.wellBtn, 'Glaze well', wc);
    this.ghostBtn.classList.toggle('off', s.purse.clay < gc);
    this.wellBtn.classList.toggle('off', s.purse.clay < wc);
    // The bowl joins the bar once there's paint to mix, and leaves it once built (there's only one).
    priced(this.bowlBtn, 'Mixing bowl', BOWL_COST);
    this.bowlBtn.style.display = s.wellsBuilt && !bowlOf(s) ? '' : 'none';
    this.bowlBtn.classList.toggle('off', s.purse.clay < BOWL_COST);
    if (this.cardFor) this.showCard(this.cardFor);
  }

  private refreshTints() {
    for (const [id, colour] of Object.entries(this.state.wellTints)) {
      const water = this.island.decor.get(id)?.children.at(1);
      if (water instanceof THREE.Mesh) (water.material as THREE.MeshPhysicalMaterial).color.set(colour);
    }
  }

  private persist() {
    this.saveClock = 0;
    this.state = { ...this.state, lastSeen: Date.now() };
    saveStudio(this.state);
  }
}

/** A clay blob or a paint drop, with a bigger invisible target so it's easy to tap on a phone. */
function makeDrop(d: Drop): THREE.Object3D {
  const g = new THREE.Group();
  const clay = d.what === 'clay';
  const blob = new THREE.Mesh(
    new THREE.SphereGeometry(clay ? 0.11 : 0.09, 16, 12),
    clay ? glaze(CLAY, { roughness: 0.85, clearcoat: 0 }) : glaze(d.what, { roughness: 0.08 }),
  );
  blob.scale.set(1.15, clay ? 0.7 : 0.9, 1.1);
  if (d.amount > 1) blob.scale.multiplyScalar(1.3);
  blob.castShadow = true;
  const target = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  g.add(blob, target);
  return g;
}

/** A build button: what it is, then its price (on its own line on phones, where the bar is narrow). */
function priced(b: HTMLButtonElement, what: string, clay: number) {
  b.replaceChildren(what, el('span', 'price', `${clay} clay`));
}

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
