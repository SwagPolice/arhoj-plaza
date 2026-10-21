import * as THREE from 'three';
import { IslandView } from '../scene/island-view';
import { footprint, type IslandLayout } from '../scene/layout';
import { glaze } from '../scene/stage';
import { disposeObject } from '../character/build';
import { EYES, PERSONALITIES, randomName, type Eyes, type Personality } from '../character/recipe';
import { CLAY } from '../character/palette';
import { loadStudio, saveStudio } from '../storage';
import { button, el } from '../ui/dom';
import { openDialog, row } from '../ui/share-dialogs';
import { walkTo, type Agent } from '../plaza/behaviour';
import { Decorator } from '../plaza/decorate';
import {
  addTo, advance, BOWL_COST, bowlOf, buyBowl, growIsland, islandCost, ownsBowl, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround, ghostCost,
  nextGoal, startMix, wellCost, type Mixed, type Yield,
} from './economy';
import { colourName, mixResult, recipeFor } from './mixing';
import { bareGhost, MAX_GROUND, PRIMARIES, type Drop, type StudioState } from './state';
import { buyItem, canAfford, giveClay, hasTrait, nextStep, soldOut, stepOf, STEPS, stock, tidyPickups, type Item } from './merchant';
import { MerchantBalloon } from './merchant-view';
import { putAway, stored, takeOut } from './storage';
import {
  atSea, BIG_BOAT_COST, buyBigBoat, buyHarbour, collectHaul, crewLimit, destination, DESTINATIONS, findsFor, HARBOUR_COST, harbourOf,
  harbourUnlocked, isOpen, setSail,
} from './harbour';
import { HarbourView } from './harbour-view';
import { bestFriend, chatted, comfortHere, happiness, hearts, petted, settleComfort } from './happiness';
import type { Find } from './state';

const PERSONALITY_ICON: Record<Personality, string> = { calm: '🍵', curious: '🔍', shy: '🌱', bouncy: '🎵' };
const EYE_LABELS: Record<Eyes, string> = { open: 'Open', tired: 'Tired', sleepy: 'Sleeping', happy: 'Happy', crossed: 'Crossed' };
const Name = (hex: string) => colourName(hex).replace(/^./, (c) => c.toUpperCase());
const LAND = 0.45; // seconds for a drop to arc to the ground
const POP = 0.25; // seconds for a collected drop to pop away
const TIDY_PAUSE = 0.8; // seconds between a Tidy character's pickups

type Flying = { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; time: number; arc: number };

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
  private clayChip = el('span', 'hud-chip');
  private paintChip = el('button', 'hud-chip hud-paint');
  private paintList = el('div', 'hud-paint-list');
  private paintOpen = false;
  private goal = el('div', 'hud-goal');
  private bar = el('div', 'studio-bar');
  private ghostBtn = button('', 'btn primary', () => this.openNewGhost());
  private wellBtn = button('', 'btn', () => this.buildWell());
  private bowlBtn = button('', 'btn', () => this.buildBowl());
  private harbourBtn = button('', 'btn', () => this.buildHarbour());
  private islandBtn = button('', 'btn', () => this.biggerIsland());
  private cameraEase: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private streaks: { obj: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  private arrangeBtn = button('Arrange', 'btn', () => this.setArranging(true));
  private harbourView = new HarbourView();
  private harbourDialog: HTMLDialogElement | null = null;
  private decorator: Decorator;
  private merchant: MerchantBalloon;
  private shop: HTMLDialogElement | null = null;
  private tidyRest = new Map<string, number>(); // seconds before a Tidy character goes after the next drop
  private tidyPick = new Map<string, number>(); // seconds before it can pick up another
  private comfortClock = 0; // seconds since comfort was last updated
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
    this.merchant = new MerchantBalloon(this.scene);
    this.harbourView.onDocked = () => this.crewAshore();
    // Arranging what you bought: Creative's Decorate tools, without adding, removing or resizing the island.
    this.decorator = new Decorator(
      {
        canvas: renderer.domElement,
        camera: this.camera,
        controls: this.controls,
        ui: this.layer,
        layout: () => this.layout,
        island: () => this.island,
        commit: (layout) => this.applyLayout(layout),
        done: () => this.setArranging(false),
      },
      {
        full: false,
        tip: 'Drag things to move them · tap one to turn, resize or put it away',
        storage: {
          list: () => stored(this.state),
          take: (kind) => {
            const r = takeOut(this.state, kind);
            if (!r) return null;
            this.state = { ...this.state, storage: r.state.storage };
            this.applyLayout(r.state.island); // saves the island, and the storage with it
            this.render();
            return r.item.id;
          },
          put: (id) => {
            const next = putAway(this.state, id);
            if (!next) return false;
            this.state = { ...this.state, storage: next.storage };
            this.applyLayout(next.island);
            this.render();
            return true;
          },
        },
      },
    );
    this.bar.append(this.ghostBtn, this.wellBtn, this.bowlBtn, this.harbourBtn, this.islandBtn, this.arrangeBtn);
    this.card.style.display = 'none';
    const purse = el('div', 'hud-purse');
    const paintWrap = el('div', 'hud-paint-wrap');
    paintWrap.append(this.paintChip, this.paintList);
    purse.append(this.clayChip, paintWrap);
    this.hud.append(purse, this.goal);
    // The paint list opens on hover with a mouse, and on tap on touch screens.
    this.paintChip.type = 'button';
    const openPaints = (open: boolean) => {
      this.paintOpen = open;
      this.render();
    };
    paintWrap.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && openPaints(true));
    paintWrap.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && openPaints(false));
    this.paintChip.addEventListener('click', () => openPaints(!this.paintOpen));
    this.addUI(this.hud, this.card, this.bar);

    // Only while you're in the Studio: time spent elsewhere (or in Creative) counts as time away.
    // With a mouse, passing over a drop collects it (even while turning the camera).
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerType !== 'mouse' || this.decorator.active) return;
      this.aim(e);
      const id = this.dropUnderPointer();
      if (id) this.collectDrop(id);
    });
    window.addEventListener('pagehide', () => this.active && this.persist());
    document.addEventListener('visibilitychange', () => {
      if (!this.active) return;
      if (document.hidden) this.persist();
      else this.welcomeBack();
    });
  }

  enter() {
    super.enter();
    this.syncHome();
    this.welcomeBack();
    this.showDrops();
    this.render();
  }

  leave() {
    if (this.decorator.active) this.setArranging(false);
    this.shop?.close();
    this.persist();
    super.leave();
    this.card.style.display = 'none';
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    this.merchant?.setSpot(this.layout.radius, this.camera);
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

  // While arranging, everyone holds still and the camera may zoom out further.
  protected get frozen() {
    return !!this.decorator?.active;
  }
  protected get wideView() {
    return !!this.decorator?.active;
  }

  protected onLayoutApplied() {
    this.decorator?.refresh();
    if (this.state) this.uncoverDrops();
  }

  protected onUpdate(dt: number, t: number) {
    this.decorator.update(dt, this.w, this.h);
    if (this.cameraEase) {
      const e = this.cameraEase;
      e.t = Math.min(1, e.t + dt / 1.2);
      this.camera.position.lerpVectors(e.from, e.to, e.t * e.t * (3 - 2 * e.t));
      if (e.t >= 1) this.cameraEase = null;
    }
    this.merchant.update(dt, t, this.camera);
    const harbour = harbourOf(this.state);
    const trip = this.state.harbour.trip;
    const crew = trip ? this.state.characters.filter((c) => trip.crew.includes(c.id)) : null;
    const wasSailingHome = this.harbourView.sailingHome;
    this.harbourView.update(dt, t, harbour ? this.island.decor.get(harbour.id) : undefined, crew, !!this.state.harbour.haul);
    if (this.harbourView.sailingHome !== wasSailingHome) this.render();
    if (this.decorator.active) return; // time stands still while you arrange
    const known = this.state.discovered;
    const sold = soldOut(this.state.merchant);
    const { state, yields, mixed, visit, boatHome, stars } = advance(this.state, dt * this.speed);
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
    if (stars) this.shootingStar();
    if (boatHome) this.onBoatHome();
    if (visit) this.onVisit(visit, sold);
    // The scene follows the save: he's shown if he's here (after loading or coming back), gone if he left meanwhile.
    else if (this.state.merchant.here && !this.merchant.root.visible) this.merchant.show(STEPS[stepOf(this.state)].scale);
    else if (!this.state.merchant.here && this.merchant.ready) {
      this.merchant.hide();
      this.shop?.close();
    }
    this.tidyUp(dt);
    this.feelAround(dt);
    this.animateDrops(dt);
    this.animateStreaks(dt);
    this.stirBowl(t);
    if ((this.saveClock += dt) > 5) this.persist();
  }

  protected onTap(e: PointerEvent) {
    if (this.decorator.active) return; // taps belong to the decorations
    this.aim(e);
    // With a mouse, drops are collected by hovering (see the constructor), so clicks go to what's behind them.
    // Touch screens can't hover: there a tap on a drop collects it, first, since drops are small.
    if (e.pointerType !== 'mouse') {
      const id = this.dropUnderPointer();
      if (id) return this.collectDrop(id);
    }
    const bowl = bowlOf(this.state);
    const bowlObj = bowl && this.island.decor.get(bowl.id);
    if (bowlObj && this.raycaster.intersectObject(bowlObj, true).length) return this.openMixer();
    if (this.merchant.hit(this.raycaster)) return this.openShop();
    const harbour = harbourOf(this.state);
    const harbourObj = harbour && this.island.decor.get(harbour.id);
    if (harbourObj && this.raycaster.intersectObject(harbourObj, true).length) return this.openHarbour();
    const agent = this.pickAgent(e);
    if (!agent) {
      this.card.style.display = 'none';
      this.cardFor = null;
      return;
    }
    agent.lookAt(this.camera.position.x, this.camera.position.z, 3);
    // A little hop, and hearts for how happy it is (a tap is a little attention, too).
    this.state = petted(this.state, agent.recipe.id, Date.now());
    agent.built.pose.position.y = 0.3;
    this.say(agent, '❤️'.repeat(hearts(happiness(this.state, agent.recipe.id))));
    this.showCard(agent.recipe.id);
  }

  // ---------- time away ----------

  /** Coming back: what was made meanwhile lands on the "While you were away" card. */
  private welcomeBack() {
    const hadCard = !!this.state.away;
    const wasAtSea = !!this.state.harbour.trip;
    const { state, seconds, ground } = comeBack(this.state, Date.now());
    this.state = state;
    if (ground.length) this.place(ground, true);
    this.refreshTints();
    this.persist();
    this.render();
    if (wasAtSea && !this.state.harbour.trip) {
      this.syncHome(); // the crew is back on the island
      this.toast('The boat came back while you were away! Tap the harbour to see what they found.');
    }
    if (this.state.away) this.showAwayCard();
    else if (seconds && ground.some((y) => y.star)) this.toast('Welcome back! A shooting star fell while you were away: its shards are waiting.');
    else if (seconds && ground.length) this.toast('Welcome back! A few things were made while you were away.');
    else if (!hadCard && seconds && this.state.merchant.here) this.toast('The merchant is visiting right now!');
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
      el('p', 'muted', `While you were away (${duration(away.seconds)}), ${this.tidyNames()} tidied up:`),
      list,
      ...(this.state.merchant.here ? [el('p', 'muted', '🎈 The merchant is visiting right now. He won\'t stay long!')] : []),
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

  /** The drop the raycaster points at (call `aim` first), if any. */
  private dropUnderPointer(): string | null {
    const hit = this.raycaster.intersectObjects(this.drops.children, true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && !obj.userData.dropId) obj = obj.parent;
    return obj?.userData.dropId ?? null;
  }

  /**
   * Fresh yields land near whoever made them, with a little arc; past the 30-drop limit, nothing more is made.
   * `quietly` (things made while you were away): they're already lying about, anywhere on the island.
   */
  private place(yields: Yield[], quietly = false) {
    const anywhere = () => {
      const r = (this.state.island.radius - 0.8) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r);
    };
    const from = (y: Yield) => {
      if (quietly) return anywhere();
      if (y.star) return anywhere().setY(9); // a shard falls from high above, anywhere on the island
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
    for (const { drop, index } of r.dropped) this.addDrop(drop, quietly ? null : starts[index]);
    if (yields.some((y) => this.state.island.items.some((w) => w.id === y.from))) this.refreshTints();
  }

  /** A spot on the island a little way from where something was made. */
  private landingSpot(from: { x: number; z: number }) {
    const max = this.state.island.radius - 0.45;
    let fallback: { x: number; z: number } | null = null;
    // Somewhere close by, in the open, so it's easy to spot: never under a decoration or a building.
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.5 + Math.random() * (0.5 + i * 0.08); // look a little further out each try
      let x = from.x + Math.cos(a) * d;
      let z = from.z + Math.sin(a) * d;
      const len = Math.hypot(x, z);
      if (len > max) [x, z] = [(x / len) * max, (z / len) * max];
      const spot = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
      fallback ??= spot;
      if (this.inTheOpen(spot.x, spot.z)) return spot;
    }
    return fallback!;
  }

  /** True if nothing on the island covers this spot (with a little room around, so a drop isn't half hidden). */
  private inTheOpen(x: number, z: number) {
    return this.state.island.items.every((d) => Math.hypot(x - d.x, z - d.z) > footprint(d) + 0.3);
  }

  /** Drops something now stands on (a decoration placed over them) roll out into the open. */
  private uncoverDrops() {
    let moved = false;
    const ground = this.state.ground.map((d) => {
      if (this.inTheOpen(d.x, d.z)) return d;
      moved = true;
      const spot = this.landingSpot(d);
      const obj = this.drops.children.find((o) => o.userData.dropId === d.id);
      obj?.position.set(spot.x, obj.position.y, spot.z);
      return { ...d, ...spot };
    });
    if (moved) this.state = { ...this.state, ground };
  }

  private addDrop(d: Drop, from: THREE.Vector3 | null) {
    const obj = makeDrop(d);
    obj.userData.dropId = d.id;
    obj.userData.star = !!d.star;
    const to = new THREE.Vector3(d.x, 0.08, d.z);
    obj.position.copy(from ?? to);
    if (from) this.flying.push({ obj, from, to, t: 0, time: d.star ? 1.1 + Math.random() * 0.5 : LAND, arc: d.star ? 0 : 0.6 });
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
      f.t = Math.min(1, f.t + dt / f.time);
      f.obj.position.lerpVectors(f.from, f.to, f.arc ? f.t : f.t * f.t); // a shard speeds up as it falls
      f.obj.position.y += Math.sin(f.t * Math.PI) * f.arc; // a little arc
      return f.t < 1;
    });
    for (const obj of this.drops.children) {
      if (obj.userData.star) {
        // Star shards turn slowly and twinkle.
        obj.rotation.y = t * 1.4 + obj.id;
        const glint = obj.children[0];
        if (glint instanceof THREE.Mesh) (glint.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.35 + 0.3 * Math.max(0, Math.sin(t * 4 + obj.id * 1.7));
      }
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
          this.syncHome();
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

  private dot(colour: string) {
    const d = el('span', 'swatch-dot');
    d.style.background = colour;
    return d;
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

  // ---------- the merchant ----------

  private onVisit(visit: 'arrived' | 'left', sold = false) {
    if (visit === 'arrived') {
      this.merchant.arrive(STEPS[stepOf(this.state)].scale);
      this.toast(this.state.merchant.visits === 1 ? 'A balloon is coming! The merchant has arrived: tap him to see what he brought.' : 'The merchant is back! Tap him to see what he brought.');
    } else {
      this.shop?.close();
      this.merchant.leave();
      this.toast(sold ? 'Sold out! The merchant floated off to find more.' : "The merchant floated off. He'll be back.");
    }
    this.persist();
    this.render();
  }

  /** His shop: what he brought, what it costs, and how far he can travel. */
  private openShop() {
    const body = el('div', 'shop');
    const draw = () => {
      const s = this.state;
      const rows = stock(s).map((item) => {
        const r = el('div', 'shop-row');
        const text = el('div', 'shop-text');
        const name = el('div', 'shop-name', `${item.icon} ${item.name} `);
        name.append(el('span', 'muted shop-left', item.left ? `×${item.left}` : ''));
        text.append(name, el('div', 'muted shop-blurb', item.blurb));
        const price = el('div', 'shop-price', `${item.clay} clay`);
        if (item.paint) {
          const dot = el('span', 'swatch-dot');
          dot.style.background = item.paint.colour;
          price.append(' + ', dot, `${item.paint.n}`);
        }
        const soldOut = item.left < 1;
        const buy = button(soldOut ? 'Sold out' : 'Buy', 'btn' + (soldOut || !canAfford(s, item) ? ' off' : ' primary'), () => this.buy(item, draw));
        if (soldOut) {
          buy.disabled = true;
          r.classList.add('sold-out');
        }
        r.append(text, price, buy);
        return r;
      });
      const next = nextStep(s);
      const trip = el(
        'p',
        'muted shop-trip',
        next
          ? `You've paid him ${s.merchant.paid} clay. ${next.paid - s.merchant.paid} more and he can reach ${next.name.toLowerCase()} (new: ${next.news}, and more in his basket).`
          : `You've paid him ${s.merchant.paid} clay. He can reach ${STEPS[stepOf(s)].name.toLowerCase()} now.`,
      );
      const give = button('Give 10 clay', 'btn' + (s.purse.clay >= 10 ? '' : ' off'), () => {
        const given = giveClay(this.state, 10);
        if (!given) return this.toast('You need 10 clay to give.');
        this.paid(given);
        draw();
      });
      give.title = 'Help him travel further';
      const empty = rows.length && rows.every((r) => r.classList.contains('sold-out'));
      if (empty) rows.push(el('p', 'muted', "You've bought everything he brought this time!"));
      body.replaceChildren(...rows, trip, ...(next ? [row(give)] : []));
    };
    draw();
    this.shop = openDialog('The balloon merchant', [
      el('p', 'muted', 'He only brings a few things each visit. Everything you pay him helps him go further, and find more.'),
      body,
    ]);
    this.shop.addEventListener('close', () => (this.shop = null));
  }

  private buy(item: Item, redraw: () => void) {
    if (!canAfford(this.state, item)) {
      return this.toast(item.paint ? `${item.name} costs ${item.clay} clay and ${item.paint.n} ${colourName(item.paint.colour)} paint.` : `${item.name} costs ${item.clay} clay.`);
    }
    if (item.trait) return this.chooseOwner(item, redraw);
    const r = buyItem(this.state, item.id);
    if (!('state' in r)) {
      return this.toast(r.why === 'soldout' ? "He's sold out of that." : "You can't buy that right now.");
    }
    this.paid(r.state);
    this.toast(`${item.name} added to your storage. Place it with Arrange.`);
    redraw();
  }

  /** The broom (or any trait item) goes to someone: pick who. */
  private chooseOwner(item: Item, redraw: () => void) {
    const trait = item.trait!;
    const who = this.state.characters.filter((c) => !hasTrait(this.state, c.id, trait));
    if (!who.length) return this.toast('Everyone already has one!');
    const chips = el('div', 'chips');
    const dialog = openDialog(`Who gets the ${item.name.toLowerCase()}?`, [
      el('p', 'muted', 'They become Tidy: they pick up drops near them by themselves.'),
      chips,
    ]);
    for (const c of who)
      chips.append(
        button(`${PERSONALITY_ICON[c.personality]} ${c.name || 'Unnamed'}`, 'chip', () => {
          const r = buyItem(this.state, item.id, c.id);
          if (!('state' in r)) return this.toast("You can't buy that right now.");
          this.paid(r.state);
          const agent = this.agents.find((a) => a.recipe.id === c.id);
          if (agent) this.say(agent, '🧹');
          this.toast(`${c.name || 'They'} became Tidy!`);
          dialog.close();
          redraw();
        }),
      );
  }

  /** After paying him: save, and if he can now travel further, he grows and says so. */
  private paid(next: StudioState) {
    const before = stepOf(this.state);
    this.state = next;
    const after = stepOf(next);
    if (after > before) {
      const step = STEPS[after];
      this.merchant.grow(step.scale);
      this.bubbles.show(this.merchant.root, this.merchant.top, `I can reach ${step.name.toLowerCase()} now!`, 0.3, 3.5);
      this.toast(`He can reach ${step.name.toLowerCase()} now! Next visit he'll bring more, and things from there.`);
    }
    this.persist();
    this.render();
  }

  // ---------- the harbour ----------

  /** The characters on the island: everyone except the crew away at sea. */
  private syncHome() {
    const away = atSea(this.state);
    const arriving = this.harbourView.arriving; // still on the boat, sailing home
    const before = this.agents.length;
    this.syncAgents(this.state.characters.filter((c) => !away.has(c.id) && !arriving.has(c.id)));
    if (this.agents.length < before) this.bubbles.clear(); // no bubbles left floating where the crew stood
  }

  /** The boat is back at the pier: the crew step ashore beside it and stroll off. */
  private crewAshore() {
    const before = new Set(this.agents.map((a) => a.recipe.id));
    this.syncHome();
    if (this.state.harbour.haul) this.toast('The boat is back! Tap the harbour to see what they found.');
    this.render();
    const harbour = harbourOf(this.state);
    if (!harbour) return;
    const len = Math.hypot(harbour.x, harbour.z) || 1;
    const inward = new THREE.Vector2(-harbour.x / len, -harbour.z / len);
    const side = new THREE.Vector2(-inward.y, inward.x);
    this.agents
      .filter((a) => !before.has(a.recipe.id))
      .forEach((a, i) => {
        a.pos.set(harbour.x, harbour.z).addScaledVector(inward, 0.9).addScaledVector(side, (i - 1) * 0.5);
        a.target.copy(a.pos);
        a.path = [];
        a.state = 'idle';
        a.timer = 0.5 + i * 0.4;
        if (i === 0) this.say(a, '👋', 0.2);
      });
  }

  /** A size bigger: everything stays put (the harbour moves out to the new edge), and the camera eases back. */
  private biggerIsland() {
    const cost = islandCost(this.state);
    if (cost === null) return;
    if (this.state.purse.clay < cost) return this.toast(`A bigger island needs ${cost} clay. Keep collecting!`);
    const next = growIsland(this.state);
    if (!next) return;
    this.state = next;
    this.applyLayout(next.island);
    const from = this.camera.position.clone();
    this.resize(this.w, this.h); // frames the new size (and finds the merchant a new spot)
    this.cameraEase = { from, to: this.camera.position.clone(), t: 0 };
    this.camera.position.copy(from);
    this.returnToIsland();
    const agent = this.agents.at(0);
    if (agent) this.say(agent, '🎉', 0.3);
    this.toast('The island grew! More room to wander.');
    this.persist();
    this.render();
  }

  private buildHarbour() {
    if (this.state.purse.clay < HARBOUR_COST) return this.toast(`The harbour needs ${HARBOUR_COST} clay. Keep collecting!`);
    const next = buyHarbour(this.state);
    if (!next) return this.toast('No room on the edge of the island for a harbour.');
    this.state = next;
    this.applyLayout(next.island);
    this.returnToIsland();
    this.firstTime('harbour', '⚓');
    this.toast('The harbour is built! Tap it to send a crew on an expedition.');
    this.persist();
    this.render();
  }

  /** Tap the harbour: send a crew, see how long until they're back, or open what they brought. */
  private openHarbour() {
    this.harbourDialog?.close();
    if (this.harbourView.sailingHome) return this.toast('The boat is almost back…');
    const h = this.state.harbour;
    if (h.trip) {
      const where = destination(h.trip.to)?.name.toLowerCase() ?? 'sea';
      const left = h.trip.left < 60 ? 'any moment now' : `in ${duration(h.trip.left)}`;
      this.harbourDialog = openDialog('The harbour', [
        el('p', '', `${this.names(h.trip.crew)} ${h.trip.crew.length > 1 ? 'are' : 'is'} at ${where}. Back ${left}.`),
      ]);
      return;
    }
    if (h.haul) return this.openHaul();
    this.openSend();
  }

  private openSend() {
    const s = this.state;
    let to = DESTINATIONS.find((d) => isOpen(s, d))?.id ?? '';
    const crew: string[] = [];
    const places = el('div', 'chips');
    const people = el('div', 'chips');
    const hint = el('p', 'muted harbour-hint');
    const sail = button('Set sail', 'btn primary', () => {
      const r = setSail(this.state, to, crew);
      if (!('state' in r)) return this.toast(r.why === 'crew' ? 'Pick who goes first.' : "The boat can't sail right now.");
      this.state = r.state;
      this.syncHome();
      this.toast(`The boat set sail for ${destination(to)!.name.toLowerCase()}.`);
      this.persist();
      this.render();
      dialog.close();
    });
    const draw = () => {
      const limit = crewLimit(this.state);
      places.replaceChildren(
        ...DESTINATIONS.map((d) => {
          const open = isOpen(this.state, d);
          const b = button(`${d.name} · ${duration(d.seconds)}`, 'chip' + (d.id === to ? ' on' : '') + (open ? '' : ' off'), () => {
            if (!open) return this.toast("The merchant hasn't found the way there yet.");
            to = d.id;
            draw();
          });
          if (!open) b.title = "The merchant hasn't found the way yet";
          return b;
        }),
      );
      people.replaceChildren(
        ...this.state.characters.map((c) => {
          const on = crew.includes(c.id);
          const label = `${PERSONALITY_ICON[c.personality]} ${c.name || 'Unnamed'}${hasTrait(this.state, c.id, 'seafarer') ? ' ⚓' : ''}`;
          return button(label, 'chip' + (on ? ' on' : ''), () => {
            if (on) crew.splice(crew.indexOf(c.id), 1);
            else if (crew.length < limit) crew.push(c.id);
            else return this.toast(`The boat takes ${limit} at most.`);
            draw();
          });
        }),
      );
      const d = destination(to);
      const finds = d ? crew.reduce((n, id) => n + findsFor(this.state, d, id), 0) : 0;
      const shy = crew.some((id) => this.state.characters.find((c) => c.id === id)?.personality === 'shy');
      hint.textContent = crew.length
        ? `About ${finds} finds${shy ? ' · a shy one aboard: rarer finds' : ''}. They won't make anything on the island while they're away.`
        : `Pick up to ${limit} to go. Curious ones find more, shy ones find rarer things.`;
      sail.classList.toggle('off', !crew.length || !to);
    };
    draw();
    const extra: HTMLElement[] = [];
    if (s.harbour.level < 1) {
      const big = button(`Bigger boat (takes 5) · ${BIG_BOAT_COST} clay`, 'btn' + (s.purse.clay >= BIG_BOAT_COST ? '' : ' off'), () => {
        const next = buyBigBoat(this.state);
        if (!next) return this.toast(`A bigger boat costs ${BIG_BOAT_COST} clay.`);
        this.state = next;
        this.persist();
        this.render();
        big.remove();
        this.toast('A bigger boat! Now 5 can go.');
        draw();
      });
      extra.push(row(big));
    }
    const dialog = openDialog('Send an expedition', [
      el('div', 'sub', 'Where to?'),
      places,
      el('div', 'sub', 'Who goes?'),
      people,
      hint,
      row(sail),
      ...extra,
    ]);
    this.harbourDialog = dialog;
  }

  /** What the crew brought back, by who found it, and a Collect button. */
  private openHaul() {
    const haul = this.state.harbour.haul!;
    const byWho = new Map<string, Find[]>();
    for (const f of haul.finds) byWho.set(f.who, [...(byWho.get(f.who) ?? []), f]);
    const list = el('ul', 'away-list');
    for (const [who, finds] of byWho) list.append(el('li', '', `${this.names([who])}: ${finds.map(describeFind).join(', ')}`));
    const dialog = openDialog('The boat is back!', [
      el('p', 'muted', `From ${destination(haul.to)?.name.toLowerCase() ?? 'the sea'}, they brought:`),
      list,
      row(
        button('Collect', 'btn primary', () => {
          const r = collectHaul(this.state);
          this.state = r.state;
          this.toast(r.stored ? 'All collected! The decorations are in your storage: place them with Arrange.' : 'All collected!');
          this.persist();
          this.render();
          dialog.close();
        }),
      ),
    ]);
    this.harbourDialog = dialog;
  }

  /** The trip is over: the boat starts gliding home (the crew step ashore, and the haul is unloaded, when it docks). */
  private onBoatHome() {
    this.syncHome();
    this.harbourDialog?.close();
    this.persist();
    this.render();
  }

  /** "Pip", "Pip and Mochi", "Pip, Mochi and Bo" (by character id). */
  private names(ids: string[]) {
    const names = ids.map((id) => this.state.characters.find((c) => c.id === id)?.name || 'someone');
    return names.length < 2 ? (names[0] ?? 'nobody') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  }

  // ---------- shooting stars ----------

  /** A star streaks across the sky (its shards are already on their way down). */
  private shootingStar() {
    const r = this.state.island.radius;
    // Across the top of the view (from the upper left towards the middle), just behind the island, whatever
    // the screen's shape; warm gold, so it shows against the pale sky.
    this.camera.updateMatrixWorld();
    const depth = new THREE.Vector3(0, 0, -r * 1.3).project(this.camera).z;
    const from = new THREE.Vector3(-0.9, 0.82, depth).unproject(this.camera);
    const to = new THREE.Vector3(0.3, 0.5, depth).unproject(this.camera);
    const streak = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.02, 4.5, 10), // a wide, bright head (pointing the way it goes) and a thin tail
      new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.95, depthWrite: false, fog: false }), // no haze: it's far off, but bright
    );
    streak.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.scene.add(streak);
    this.streaks.push({ obj: streak, from, to, t: 0 });
    this.toast(this.state.stars.seen === 1 ? 'A shooting star! Its shards are white paint: collect them.' : 'A shooting star!');
    this.firstTime('star', '✨');
    this.render();
  }

  private animateStreaks(dt: number) {
    this.streaks = this.streaks.filter((s) => {
      s.t = Math.min(1, s.t + dt / 1.3);
      s.obj.position.lerpVectors(s.from, s.to, s.t);
      (s.obj.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - s.t * s.t); // fades out as it falls
      if (s.t < 1) return true;
      this.scene.remove(s.obj);
      disposeObject(s.obj);
      return false;
    });
  }

  // ---------- happiness ----------

  protected onChat(a: Agent, b: Agent) {
    this.state = chatted(this.state, a.recipe.id, b.recipe.id);
  }

  /** Every couple of seconds, each character's comfort eases towards how comfortable its spot is. */
  private feelAround(dt: number) {
    if ((this.comfortClock += dt) < 2) return;
    const elapsed = this.comfortClock * this.speed;
    this.comfortClock = 0;
    const n = this.state.characters.length;
    for (const a of this.agents) {
      const target = comfortHere(this.state.island, { x: a.pos.x, z: a.pos.y }, n);
      this.state = settleComfort(this.state, a.recipe.id, target, elapsed);
    }
  }

  // ---------- traits ----------

  /** Tidy characters pick up drops near them, and now and then stroll over to the nearest one. */
  private tidyUp(dt: number) {
    const tidy = this.agents.filter((a) => hasTrait(this.state, a.recipe.id, 'tidy'));
    if (!tidy.length) return;
    const busy = new Set([...this.flying, ...this.popping].map((f) => f.obj.userData.dropId));
    const ground = this.state.ground.filter((d) => !busy.has(d.id));
    // Each picks up one drop at a time, with a little pause between (so they tidy, rather than hoover).
    for (const a of tidy) {
      const wait = (this.tidyPick.get(a.recipe.id) ?? 0) - dt;
      this.tidyPick.set(a.recipe.id, wait);
      if (wait > 0) continue;
      const id = tidyPickups(ground, [{ x: a.pos.x, z: a.pos.y }])[0];
      if (!id) continue;
      this.collectDrop(id);
      ground.splice(ground.findIndex((d) => d.id === id), 1);
      this.tidyPick.set(a.recipe.id, TIDY_PAUSE);
    }
    for (const a of tidy) {
      const rest = (this.tidyRest.get(a.recipe.id) ?? 2) - dt;
      this.tidyRest.set(a.recipe.id, rest);
      if (rest > 0 || a.state !== 'idle' || !ground.length) continue;
      const near = ground.reduce((m, d) => (Math.hypot(d.x - a.pos.x, d.z - a.pos.y) < Math.hypot(m.x - a.pos.x, m.z - a.pos.y) ? d : m));
      walkTo(a, this.world, new THREE.Vector2(near.x, near.z));
      this.tidyRest.set(a.recipe.id, 3 + Math.random() * 3);
    }
  }

  // ---------- arranging ----------

  private setArranging(on: boolean) {
    if (on === this.decorator.active) return;
    this.bar.style.display = this.hud.style.display = on ? 'none' : '';
    this.card.style.display = 'none';
    this.cardFor = null;
    this.bubbles.clear();
    this.drops.visible = !on;
    // Characters step off the island while arranging, so anything can go anywhere.
    for (const a of this.agents) a.built.root.visible = !on;
    if (on) this.decorator.enter();
    else {
      this.decorator.leave();
      this.returnToIsland();
    }
    this.fitToIsland();
  }

  private showCard(id: string) {
    const r = this.state.characters.find((c) => c.id === id);
    if (!r) return;
    this.cardFor = id;
    const parts: HTMLElement[] = [
      el('div', 'card-name', r.name || 'Unnamed'),
      el('div', 'muted', `${PERSONALITY_ICON[r.personality]} ${r.personality}`),
    ];
    if (hasTrait(this.state, id, 'tidy')) parts.push(el('div', 'card-trait', '✨ Tidy: picks up drops nearby'));
    if (hasTrait(this.state, id, 'seafarer')) parts.push(el('div', 'card-trait', '⚓ Seafarer: finds a little more on expeditions'));
    const friend = bestFriend(this.state, id);
    const friendName = friend && this.state.characters.find((c) => c.id === friend)?.name;
    if (friendName) parts.push(el('div', 'card-trait', `🤝 Best friend: ${friendName}`));
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
    this.syncHome();
    const agent = this.agents.find((a) => a.recipe.id === id);
    if (agent) this.say(agent, '✨');
    this.firstTime('dip', '💖', agent);
    this.persist();
    this.render();
    this.showCard(id);
  }

  /** "Pip", "Pip and Mochi", "Pip, Mochi and Bo": who is Tidy, for sentences. */
  private tidyNames() {
    const names = this.state.characters.filter((c) => hasTrait(this.state, c.id, 'tidy')).map((c) => c.name || 'someone');
    if (names.length < 2) return names[0] ?? 'your tidy ones';
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
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
    // Two quiet counters: clay, and all your paint together (hover or tap it for each colour).
    const paints = [...Object.values(PRIMARIES), ...Object.keys(s.purse.paint)]
      .filter((c, i, all) => all.indexOf(c) === i && (s.purse.paint[c] ?? 0) > 0);
    const totalPaint = paints.reduce((n, c) => n + s.purse.paint[c], 0);
    const shown = `${s.purse.clay}|${totalPaint}`;
    const [clayWas, paintWas] = this.shown.split('|');
    this.clayChip.replaceChildren(this.dot(CLAY), `${s.purse.clay} clay`);
    this.paintChip.replaceChildren(el('span', '', '🎨'), `${totalPaint} paint`);
    this.paintChip.style.display = totalPaint ? '' : 'none';
    if (this.shown && clayWas !== String(s.purse.clay)) bump(this.clayChip);
    if (this.shown && paintWas !== String(totalPaint)) bump(this.paintChip);
    this.shown = shown;
    this.paintList.replaceChildren(
      ...paints.map((c) => {
        const line = el('div', 'hud-paint-line');
        line.append(this.dot(c), `${Name(c)}`, el('span', 'hud-paint-n', String(s.purse.paint[c])));
        return line;
      }),
    );
    this.paintList.style.display = this.paintOpen && totalPaint ? '' : 'none';
    const goal = nextGoal(s);
    // The boat's haul only counts once it has docked.
    this.goal.textContent = this.harbourView.sailingHome && goal.startsWith('The boat is back') ? 'The boat is coming home…' : goal;

    const gc = ghostCost(s);
    const wc = wellCost(s);
    priced(this.ghostBtn, '＋ Ghost', gc);
    priced(this.wellBtn, 'Glaze well', wc);
    this.ghostBtn.classList.toggle('off', s.purse.clay < gc);
    this.wellBtn.classList.toggle('off', s.purse.clay < wc);
    // The bowl joins the bar once there's paint to mix, and leaves it once built (there's only one).
    priced(this.bowlBtn, 'Mixing bowl', BOWL_COST);
    this.bowlBtn.style.display = s.wellsBuilt && !ownsBowl(s) ? '' : 'none';
    this.bowlBtn.classList.toggle('off', s.purse.clay < BOWL_COST);
    this.arrangeBtn.style.display = s.island.items.length || s.storage.length ? '' : 'none';
    this.arrangeBtn.textContent = s.storage.length ? `Arrange · ${s.storage.length} stored` : 'Arrange';
    const grow = islandCost(s);
    if (grow !== null) priced(this.islandBtn, 'Bigger island', grow);
    this.islandBtn.style.display = s.wellsBuilt && grow !== null ? '' : 'none';
    this.islandBtn.classList.toggle('off', grow === null || s.purse.clay < grow);
    priced(this.harbourBtn, 'Harbour', HARBOUR_COST);
    this.harbourBtn.style.display = harbourUnlocked(s) && !harbourOf(s) ? '' : 'none';
    this.harbourBtn.classList.toggle('off', s.purse.clay < HARBOUR_COST);
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
  if (d.star) {
    // A shard of a shooting star: a small faceted white glint that glows a little.
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 0.5, roughness: 0.1, clearcoat: 1, flatShading: true }),
    );
    shard.scale.set(0.9, 1.35, 0.9);
    shard.position.y = 0.06;
    shard.castShadow = true;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    return g.add(shard, hit);
  }
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

/** Replay the little bump of a counter that just changed. */
function bump(chip: HTMLElement) {
  chip.classList.remove('bump');
  void chip.offsetWidth; // restart the animation
  chip.classList.add('bump');
}

/** A build button: what it is, then its price (on its own line on phones, where the bar is narrow). */
function priced(b: HTMLButtonElement, what: string, clay: number) {
  b.replaceChildren(what, el('span', 'price', `${clay} clay`));
}

/** "6 clay", "2 cobalt paint", "a shell", "2 driftwood". */
function describeFind(f: Find) {
  if (f.what === 'clay') return `${f.amount} clay`;
  if (f.what.startsWith('#')) return `${f.amount} ${colourName(f.what)} paint`;
  const name = ({ shell: 'shell', seaglass: 'sea glass', driftwood: 'driftwood', coral: 'coral' } as Record<string, string>)[f.what] ?? f.what;
  return f.amount > 1 ? `${f.amount} ${name}` : name === 'sea glass' || name === 'driftwood' ? name : `a ${name}`;
}

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
