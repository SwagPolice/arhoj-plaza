import * as THREE from 'three';
import type { BuiltCharacter } from '../character/build';
import type { CharacterRecipe, Personality } from '../character/recipe';
import { between, pick } from '../util/random';

export type Obstacle = { x: number; z: number; r: number };
export type World = { radius: number; obstacles: Obstacle[] };
export type Emit = (agent: Agent, text: string, delay?: number) => void;

type Trait = {
  speed: number;
  idle: [number, number]; // seconds standing still between walks
  hop: number;
  social: number; // >0 seeks others out, <0 keeps away
  chatty: number;
  moods: string[];
};

export const TRAITS: Record<Personality, Trait> = {
  calm: { speed: 0.7, idle: [3, 7], hop: 0.05, social: 0, chatty: 0.5, moods: ['💤', '🍵', '☁️'] },
  curious: { speed: 1.0, idle: [1, 3], hop: 0.09, social: 0.5, chatty: 0.9, moods: ['❓', '👀', '🔍'] },
  shy: { speed: 0.8, idle: [2, 5], hop: 0.06, social: -0.6, chatty: 0.3, moods: ['…', '🌱', '😶'] },
  bouncy: { speed: 1.5, idle: [0.4, 2], hop: 0.2, social: 0.2, chatty: 0.8, moods: ['🎵', '✨', '🎉'] },
};

export class Agent {
  state: 'idle' | 'walk' | 'chat' = 'idle';
  timer = Math.random() * 2;
  walkTime = 0;
  target = new THREE.Vector2();
  heading = Math.random() * Math.PI * 2;
  phase = 0;
  cooldown = 3 + Math.random() * 5;
  partner: Agent | null = null;
  seed = Math.random() * 100;
  pos = new THREE.Vector2();
  gaze = new THREE.Vector2(); // where the pupils point right now (eased)
  glance = new THREE.Vector2(); // a random idle glance
  glanceTimer = Math.random() * 3;
  focus = 0; // seconds left looking up at the player
  awaySide = 1; // which way a shy one looks while chatting

  constructor(public recipe: CharacterRecipe, public built: BuiltCharacter) {}

  get trait() {
    return TRAITS[this.recipe.personality];
  }
  get radius() {
    return this.built.radius * 0.9;
  }

  /** Pause and look at a point (used when the player taps a character). */
  lookAt(x: number, z: number, seconds: number) {
    this.state = 'idle';
    this.partner = null;
    this.timer = seconds;
    this.heading = Math.atan2(x - this.pos.x, z - this.pos.y);
    this.focus = seconds;
  }
}

const isFree = (world: World, p: THREE.Vector2, margin: number) =>
  world.obstacles.every((o) => Math.hypot(p.x - o.x, p.y - o.z) > o.r + margin);

export function randomSpot(world: World, margin: number, others: Agent[] = []): THREE.Vector2 {
  const R = world.radius - margin - 0.6;
  const p = new THREE.Vector2();
  for (let i = 0; i < 30; i++) {
    const r = R * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    p.set(Math.cos(a) * r, Math.sin(a) * r);
    if (isFree(world, p, margin) && others.every((o) => o.pos.distanceTo(p) > o.radius + margin + 0.2)) break;
  }
  return p;
}

export function stepAgents(agents: Agent[], world: World, dt: number, t: number, emit: Emit) {
  for (const a of agents) think(a, agents, world, dt, emit);
  separate(agents, world);
  meet(agents, dt, emit);
  for (const a of agents) {
    animate(a, dt, t);
    lookAround(a, agents, dt);
  }
}

function think(a: Agent, agents: Agent[], world: World, dt: number, emit: Emit) {
  a.cooldown -= dt;
  if (a.state === 'idle') {
    a.timer -= dt;
    if (a.timer <= 0) {
      pickTarget(a, agents, world);
      a.state = 'walk';
      a.walkTime = 0;
    }
  } else if (a.state === 'walk') {
    const dx = a.target.x - a.pos.x;
    const dz = a.target.y - a.pos.y;
    const d = Math.hypot(dx, dz);
    a.walkTime += dt;
    if (d < 0.15 || a.walkTime > 10) {
      a.state = 'idle';
      a.timer = between(...a.trait.idle);
      if (Math.random() < 0.25) emit(a, pick(a.trait.moods));
      return;
    }
    const step = Math.min(d, a.trait.speed * dt);
    a.pos.x += (dx / d) * step;
    a.pos.y += (dz / d) * step;
    a.heading = turnTowards(a.heading, Math.atan2(dx, dz), dt * 6);
    a.phase += dt * a.trait.speed * 8;
  } else {
    a.timer -= dt;
    const p = a.partner;
    if (p) a.heading = turnTowards(a.heading, Math.atan2(p.pos.x - a.pos.x, p.pos.y - a.pos.y), dt * 8);
    if (a.timer <= 0) {
      a.state = 'idle';
      a.partner = null;
      a.timer = between(...a.trait.idle);
      a.cooldown = 8 + Math.random() * 10;
    }
  }
}

function pickTarget(a: Agent, agents: Agent[], world: World) {
  const others = agents.filter((o) => o !== a);
  const R = world.radius - a.radius - 0.6;
  const candidate = new THREE.Vector2();
  const social = a.trait.social;
  if (social > 0 && others.length && Math.random() < social) {
    // Go say hello to someone.
    const o = pick(others);
    const ang = Math.random() * Math.PI * 2;
    candidate.set(o.pos.x + Math.cos(ang) * 1.3, o.pos.y + Math.sin(ang) * 1.3);
  } else if (social < 0 && others.length) {
    // Shuffle away from whoever is closest.
    const near = others.reduce((m, o) => (o.pos.distanceTo(a.pos) < m.pos.distanceTo(a.pos) ? o : m));
    const away = a.pos.clone().sub(near.pos);
    if (away.lengthSq() < 1e-4) away.set(1, 0);
    candidate.copy(a.pos).add(away.normalize().multiplyScalar(2.5)).add(new THREE.Vector2(between(-1, 1), between(-1, 1)));
  }
  const ok = candidate.lengthSq() > 0 && candidate.length() < R && isFree(world, candidate, a.radius);
  a.target.copy(ok ? candidate : randomSpot(world, a.radius));
}

function separate(agents: Agent[], world: World) {
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dz);
      const min = a.radius + b.radius;
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / 2 / d;
      a.pos.x -= dx * push;
      a.pos.y -= dz * push;
      b.pos.x += dx * push;
      b.pos.y += dz * push;
    }
  }
  for (const a of agents) {
    for (const o of world.obstacles) {
      const dx = a.pos.x - o.x;
      const dz = a.pos.y - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + a.radius;
      if (d < min && d > 1e-4) {
        a.pos.x = o.x + (dx / d) * min;
        a.pos.y = o.z + (dz / d) * min;
      }
    }
    const max = world.radius - a.radius - 0.15;
    if (a.pos.length() > max) a.pos.setLength(max);
  }
}

function meet(agents: Agent[], dt: number, emit: Emit) {
  const free = (a: Agent) => a.state !== 'chat' && a.cooldown <= 0;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (!free(a) || !free(b)) continue;
      if (a.pos.distanceTo(b.pos) > a.radius + b.radius + 0.7) continue;
      if (Math.random() > dt * 2 * (a.trait.chatty + b.trait.chatty) / 2) continue;
      const time = 2.6 + Math.random();
      for (const [x, y] of [[a, b], [b, a]]) {
        x.state = 'chat';
        x.partner = y;
        x.timer = time;
        x.awaySide = Math.random() < 0.5 ? -1 : 1;
      }
      const [sa, sb] = greeting(a, b);
      emit(a, sa);
      emit(b, sb, 0.5);
    }
  }
}

function greeting(a: Agent, b: Agent): [string, string] {
  const pa = a.recipe.personality;
  const pb = b.recipe.personality;
  if (pa === 'shy' && pb === 'shy') return ['😳', '😳'];
  if (pa === 'shy') return ['😳', pick(['👋', '😊'])];
  if (pb === 'shy') return [pick(['👋', '😊']), '😳'];
  if (pa === 'bouncy' && pb === 'bouncy') return ['🎉', '✨'];
  const lines = ['👋', '💬', '😊', '❤️', '🌸', '😄', '🍰', '☕'];
  return [pick(lines), pick(lines)];
}

function turnTowards(from: number, to: number, maxStep: number) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, diff));
}

/** Squash-and-stretch hopping, idle swaying and chat bouncing. */
function animate(a: Agent, dt: number, t: number) {
  const p = a.built.pose;
  let hop = 0;
  let squash = 0;
  let lean = 0;
  let sway = 0;
  if (a.state === 'walk') {
    const s = Math.abs(Math.sin(a.phase));
    hop = s * a.trait.hop;
    squash = (1 - s) * Math.min(0.12, a.trait.hop * 0.8);
    lean = 0.08;
  } else if (a.state === 'chat') {
    hop = Math.abs(Math.sin(t * 9 + a.seed)) * 0.04;
    sway = Math.sin(t * 3 + a.seed) * 0.05;
  } else {
    sway = Math.sin(t * 1.6 + a.seed) * 0.035;
    squash = Math.sin(t * 2 + a.seed) * 0.015;
  }
  const k = Math.min(1, dt * 25);
  p.position.y += (hop - p.position.y) * k;
  p.rotation.x += (lean - p.rotation.x) * k;
  p.rotation.z += (sway - p.rotation.z) * k;
  p.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
  a.built.root.position.set(a.pos.x, 0, a.pos.y);
  a.built.root.rotation.y = a.heading;
}

/** Eye expressions: side glances at passers-by, shy looks away, bouncy looks up. */
function lookAround(a: Agent, agents: Agent[], dt: number) {
  const target = new THREE.Vector2();
  const p = a.recipe.personality;
  if (a.focus > 0) {
    a.focus -= dt;
    target.set(0, 0.5); // the camera is above them
  } else if (a.state === 'chat') {
    if (p === 'shy') target.set(a.awaySide, -0.5);
    else if (p === 'bouncy') target.set(0, 0.7);
  } else if (a.state === 'idle') {
    // Watch whoever is close by, without turning around.
    let nearest: Agent | null = null;
    let best = 3.5;
    for (const o of agents) {
      const d = o === a ? Infinity : o.pos.distanceTo(a.pos);
      if (d < best) [nearest, best] = [o, d];
    }
    const rel = nearest ? Math.atan2(nearest.pos.x - a.pos.x, nearest.pos.y - a.pos.y) - a.heading : 0;
    if (nearest && Math.cos(rel) > -0.2) {
      target.set(Math.max(-1, Math.min(1, Math.sin(rel) * 1.5)), 0);
      if (p === 'shy') target.y = -0.4;
    } else {
      a.glanceTimer -= dt;
      if (a.glanceTimer <= 0) {
        const curious = p === 'curious' ? 0.7 : 0.35;
        if (Math.random() < curious) a.glance.set(Math.random() < 0.5 ? -1 : 1, between(-0.3, 0.5));
        else a.glance.set(0, 0);
        a.glanceTimer = between(1.5, 4);
      }
      target.copy(a.glance);
    }
  }
  a.gaze.lerp(target, Math.min(1, dt * 8));
  a.built.look(a.gaze.x, a.gaze.y);
}
