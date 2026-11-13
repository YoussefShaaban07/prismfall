import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Enemy } from '../game/Enemies';
import { Player } from '../game/Player';
import { WeaponSystem } from '../game/Weapons';
import { EDEFS, hpScale, type EType, type WeaponId } from '../game/data';
import { SHIPS } from '../game/meta';
import { Net, type Msg } from './Net';

/**
 * Co-op replication.
 *
 * The host's world is the real one: it runs the director, every enemy's AI, the bosses and their
 * attacks. Guests mirror it:
 *  - enemies arrive ~15x a second as a compact binary snapshot (14 bytes each) and glide between packets;
 *  - anything the host's world *does* that a guest should see or dodge (explosions, banners, enemy
 *    bullets, hazard zones, loot drops, boss deaths) is recorded as a method call while the host runs
 *    its world code and replayed on each guest, so the guest's own bullets, hazards and pickups then
 *    simulate locally;
 *  - each pilot flies their own ship with zero latency and is the sole judge of what hits *them*; their
 *    weapons' damage is batched to the host, which owns enemy health.
 * Teammates appear as puppets whose guns fire for real visually but deal no damage (their own machine
 * already reported it).
 */

const ETYPES = Object.keys(EDEFS) as EType[];
const AFFIX = ['', 'shielded', 'regen', 'volatile'] as const;
const REC = 14;
const SNAP_HZ = 15;
const VIEW_R = 64;

export interface Remote {
  id: string;
  name: string;
  p: Player;
  w: WeaponSystem;
  tag: THREE.Sprite;
  reviveK: number;
  level: number;
  ship: string;
}

type Wire = number | string | boolean | null | Wire[] | { [k: string]: Wire };

export class Sync {
  net = new Net();
  remotes = new Map<string, Remote>();
  /** host: >0 while world code runs, so its visible side effects are recorded */
  private depth = 0;
  private inner = 0;
  private events: Wire[] = [];
  private snapT = 0;
  private stT = 0;
  private dmgT = 0;
  private dmg = new Map<number, [number, number, number]>();
  private mirror = new Map<number, Enemy>();
  private lastLoadout = '';
  /** guest: header values from the host */
  hostStorm = 0;
  hostBossHp = 0;
  hostBossMax = 1;
  private installed = false;

  constructor(private g: Game) {}

  get role() { return this.net.role; }
  get mp() { return this.net.role !== 'solo'; }
  get host() { return this.net.role === 'host'; }
  get guest() { return this.net.role === 'client'; }
  /** pilots in the room, including this one */
  get crew() { return this.mp ? Math.max(1, this.net.lobby.length) : 1; }

  /* ------------------------------------------------------------------ recording */

  private targets(): Record<string, [object, string[]]> {
    const g = this.g;
    return {
      p: [g.particles, ['burst', 'fireball', 'ring']],
      d: [g.debris, ['spawn']],
      s: [g.smoke, ['puff']],
      x: [g.fx, ['ring', 'shock', 'lightning', 'scorch', 'beam', 'telegraph']],
      l: [g.lighting, ['flash']],
      a: [g.audio, ['sfx']],
      u: [g.ui, ['banner', 'bossCard', 'flash', 'bossStage']],
      h: [g.hazards, ['blast', 'pool', 'sweep', 'clear']],
      r: [g.proj, ['enemyShot', 'clearEnemyShots']],
      e: [g.enemies, ['addCorpse']],
      k: [g.pickups, ['dropGem', 'dropPower']],
      b: [g.boss, ['addBreaches', 'clear']],
      g: [g, ['bossEscalate', 'bossSignatureDeath', 'deathFlourish', 'areaHurt']],
    };
  }

  /** Wrap every replicated method once. Outside a host's world scope the wrappers are pass-through. */
  install() {
    if (this.installed) return;
    this.installed = true;
    for (const [key, [obj, methods]] of Object.entries(this.targets())) {
      const o = obj as Record<string, (...a: unknown[]) => unknown>;
      for (const m of methods) {
        const orig = o[m];
        if (typeof orig !== 'function') { console.warn('[sync] missing', key, m); continue; }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        o[m] = function (this: unknown, ...a: unknown[]) {
          if (self.depth > 0 && self.inner === 0 && self.net.role === 'host') self.events.push([key, m, self.enc(a)]);
          self.inner++;
          try { return orig.apply(this, a); } finally { self.inner--; }
        };
      }
    }
    // the host's own hurts and pickups are personal: never broadcast what happens inside them
    const g = this.g as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ['hurtPlayer', 'gainXp', 'collectPower']) {
      const orig = g[m];
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      g[m] = function (this: unknown, ...a: unknown[]) {
        const d = self.depth;
        self.depth = 0;
        try { return orig.apply(this, a); } finally { self.depth = d; }
      };
    }
  }

  /** Run host world code with recording on. */
  world<T>(fn: () => T): T {
    if (this.net.role !== 'host') return fn();
    this.depth++;
    try { return fn(); } finally { this.depth--; }
  }

  /** Push a custom event (handled by `custom` on guests). */
  push(kind: string, data: Wire) {
    if (this.net.role === 'host') this.events.push(['!', kind, data]);
  }

  private enc(v: unknown): Wire {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'function') return { F: 1 };
    if (Array.isArray(v)) return v.map((x) => this.enc(x));
    if (v instanceof THREE.Color) return { C: [v.r, v.g, v.b] };
    if (v instanceof THREE.Vector3) return { V: [v.x, v.y, v.z] };
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'number' && o.def) return { E: o.id };
    const out: Record<string, Wire> = {};
    for (const k of Object.keys(o)) if (typeof o[k] !== 'object' || o[k] === null) out[k] = this.enc(o[k]);
    return out;
  }

  private dec(v: Wire): unknown {
    if (v === null) return undefined;
    if (Array.isArray(v)) return v.map((x) => this.dec(x));
    if (typeof v === 'object') {
      if ('C' in v) { const c = v.C as number[]; return new THREE.Color(c[0], c[1], c[2]); }
      if ('V' in v) { const c = v.V as number[]; return new THREE.Vector3(c[0], c[1], c[2]); }
      if ('E' in v) {
        const e = this.mirror.get(v.E as number);
        if (!e) throw new Error('unknown enemy');
        return e;
      }
      if ('F' in v) {
        const b = this.g.boss;
        return () => (b.e && !b.e.dead ? { x: b.e.x, z: b.e.z } : null);
      }
      return v;
    }
    return v;
  }

  private replay(ev: Wire[]) {
    const t = this.targets();
    for (const item of ev) {
      const [key, m, a] = item as [string, string, Wire];
      if (key === '!') { this.custom(m, a); continue; }
      const tg = t[key];
      if (!tg) continue;
      const o = tg[0] as Record<string, (...x: unknown[]) => unknown>;
      try {
        const args = this.dec(a) as unknown[];
        // a dissolve already played locally when this guest's own shot predicted the kill
        if (key === 'e' && m === 'addCorpse' && (args[0] as Enemy).ghostDead) continue;
        o[m](...args);
      } catch {
        /* the enemy it referred to is outside this guest's view: nothing to show */
      }
    }
  }

  /* ------------------------------------------------------------------ lifecycle */

  /** Host: spawn a puppet for a guest; guest: for the host and other guests. */
  addRemote(id: string, name: string, ship: string): Remote {
    const old = this.remotes.get(id);
    if (old) return old;
    const g = this.g;
    const p = new Player(g.r.scene, g.assets);
    p.setShip(SHIPS.find((s) => s.id === ship) ?? SHIPS[0]);
    p.makePuppet();
    p.root.visible = true;
    const w = new WeaponSystem(g.r.scene, g, p);
    const tag = nameTag(name, SHIPS.find((s) => s.id === ship)?.accent ?? 0x5ef2ff);
    g.r.scene.add(tag);
    const r: Remote = { id, name, p, w, tag, reviveK: 0, level: 1, ship };
    this.remotes.set(id, r);
    return r;
  }

  removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.w.reset();
    r.p.root.removeFromParent();
    r.p.magnetRing.removeFromParent();
    for (const t of r.p.trails) t.visible = false;
    r.tag.removeFromParent();
    this.remotes.delete(id);
  }

  clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.mirror.clear();
    this.events.length = 0;
    this.dmg.clear();
    this.lastLoadout = '';
  }

  /** puppets reset to the start of a run */
  resetRemotes() {
    for (const r of this.remotes.values()) {
      r.w.reset();
      r.p.dead = false;
      r.p.root.visible = true;
      r.p.weapons.clear();
      r.p.evolved.clear();
    }
    this.mirror.clear();
    this.lastLoadout = '';
  }

  /* ------------------------------------------------------------------ per frame */

  /** Called every frame while a co-op run is in progress (after the local world updated). */
  tick(dt: number) {
    const g = this.g;
    for (const r of this.remotes.values()) {
      r.p.updatePuppet(dt, g.time);
      r.p.setDowned(r.p.dead, r.reviveK);
      if (!r.p.dead) r.w.update(dt);
      r.tag.position.set(r.p.x, 3.3, r.p.z);
      r.tag.visible = true;
    }
    // own state out
    this.stT -= dt;
    if (this.stT <= 0) {
      this.stT = 1 / SNAP_HZ;
      const st = this.myState();
      if (this.guest) this.net.send('host', { t: 'st', s: st });
      const lo = this.loadout();
      const key = JSON.stringify(lo);
      if (key !== this.lastLoadout) {
        this.lastLoadout = key;
        if (this.guest) this.net.send('host', { t: 'lo', lo });
        else this.net.broadcast({ t: 'lo', id: 'host', lo });
      }
    }
    if (this.guest) {
      this.dmgT -= dt;
      if (this.dmgT <= 0 && this.dmg.size) {
        this.dmgT = 0.05;
        const flat: number[] = [];
        for (const [id, [a, kx, kz]] of this.dmg) flat.push(id, Math.round(a * 10) / 10, Math.round(kx * 10) / 10, Math.round(kz * 10) / 10);
        this.dmg.clear();
        this.net.send('host', { t: 'dmg', d: flat });
      }
    }
    if (this.host) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / SNAP_HZ;
        this.sendSnapshots();
      }
    }
  }

  private myState(): number[] {
    const P = this.g.player;
    const flags = (P.dead ? 1 : 0) | (P.dashing ? 2 : 0) | (P.inv > 0 ? 4 : 0);
    return [r2(P.x), r2(P.z), r2(P.vx), r2(P.vz), r2(P.ang), Math.round(P.hp), Math.round(P.maxHp), flags, r2(this.g.reviveK), P.level];
  }

  private loadout() {
    const P = this.g.player;
    return { w: [...P.weapons.entries()], ev: [...P.evolved], area: r2(P.area), cd: r2(P.cd), ship: P.shipDef.id };
  }

  private applyState(r: Remote, s: number[]) {
    const p = r.p;
    const n = p.net;
    n.x = s[0]; n.z = s[1]; n.vx = s[2]; n.vz = s[3]; n.ang = s[4]; n.t = 0;
    p.hp = s[5];
    p.maxHp = s[6];
    const dead = (s[7] & 1) !== 0;
    if (dead && !p.dead) this.g.fx.ring(p.x, p.z, 6, p.shipDef.accent, 0.8, 3);
    if (!dead && p.dead) { p.x = n.x; p.z = n.z; this.g.fx.ring(p.x, p.z, 5, 0x7dff9b, 0.7, 3); }
    p.dead = dead;
    n.dash = (s[7] & 2) !== 0;
    if (s[7] & 4) p.inv = Math.max(p.inv, 0.1);
    r.reviveK = s[8];
    r.level = s[9];
  }

  private applyLoadout(r: Remote, lo: { w: [WeaponId, number][]; ev: WeaponId[]; area: number; cd: number; ship: string }) {
    const p = r.p;
    p.weapons.clear();
    for (const [id, lv] of lo.w) p.weapons.set(id, lv);
    p.evolved = new Set(lo.ev);
    p.area = lo.area;
    p.cd = lo.cd;
    if (lo.ship !== r.ship) {
      r.ship = lo.ship;
      p.setShip(SHIPS.find((s) => s.id === lo.ship) ?? SHIPS[0]);
    }
  }

  /* ------------------------------------------------------------------ guest → host damage */

  /** Guest: a local weapon hit a host-owned enemy. Returns false if the hit should be ignored. */
  reportHit(e: Enemy, amt: number, kx: number, kz: number) {
    const cur = this.dmg.get(e.id);
    if (cur) { cur[0] += amt; cur[1] += kx; cur[2] += kz; } else this.dmg.set(e.id, [amt, kx, kz]);
  }

  /* ------------------------------------------------------------------ host snapshots */

  private sendSnapshots() {
    const g = this.g;
    const ev = this.events;
    this.events = [];
    const b = g.boss.e;
    const h = [
      r2(g.T), Math.round(g.score), g.kills, r2(g.storm.dur > 0 && g.storm.t < g.storm.dur - 4 ? 1 : 0),
      (g.won ? 1 : 0) | (g.endless ? 2 : 0), b ? b.id : 0, b ? Math.round(b.hp) : 0, b ? Math.round(b.maxHp) : 1, g.combo,
    ];
    const players: Record<string, number[]> = { host: this.myState() };
    for (const r of this.remotes.values()) players[r.id] = this.stateOf(r);
    for (const id of this.net.guestIds()) {
      const r = this.remotes.get(id);
      const vx = r ? r.p.x : g.player.x, vz = r ? r.p.z : g.player.z;
      const p: Record<string, number[]> = {};
      for (const k of Object.keys(players)) if (k !== id) p[k] = players[k];
      // a guest on a slow link gets positions less often, but always gets the events
      if (this.net.backlog(id) > 192 * 1024) { if (ev.length) this.net.send(id, { t: 's', ev }); continue; }
      this.net.send(id, { t: 's', h, e: this.packEnemies(vx, vz), p, ev });
    }
  }

  private stateOf(r: Remote): number[] {
    const p = r.p;
    const flags = (p.dead ? 1 : 0) | (p.dashT > 0 ? 2 : 0) | (p.inv > 0 ? 4 : 0);
    return [r2(p.net.x), r2(p.net.z), r2(p.net.vx), r2(p.net.vz), r2(p.net.ang), Math.round(p.hp), Math.round(p.maxHp), flags, r2(r.reviveK), r.level];
  }

  private packEnemies(cx: number, cz: number): ArrayBuffer {
    const list = this.g.enemies.list;
    const buf = new ArrayBuffer(list.length * REC);
    const dv = new DataView(buf);
    let o = 0;
    for (const e of list) {
      if (e.dead) continue;
      if (e.type !== 'boss' && Math.abs(e.x - cx) > VIEW_R && Math.abs(e.z - cz) > VIEW_R) continue;
      dv.setUint32(o, e.id); o += 4;
      dv.setUint8(o++, ETYPES.indexOf(e.type));
      dv.setInt16(o, Math.round(e.x * 50)); o += 2;
      dv.setInt16(o, Math.round(e.z * 50)); o += 2;
      dv.setInt8(o++, clampI8((e.vx + e.kx) * 4));
      dv.setInt8(o++, clampI8((e.vz + e.kz) * 4));
      dv.setUint8(o++, Math.round((((e.yaw % TAU) + TAU) % TAU) / TAU * 255));
      dv.setUint8(o++, Math.round(Math.max(0, Math.min(1, e.hp / e.maxHp)) * 255));
      const flags = (e.elite ? 1 : 0) | (AFFIX.indexOf(e.affix) << 1) | (e.spawnT > 0 ? 8 : 0) | (e.flash > 0.02 ? 16 : 0) | (e.shield > 0 ? 32 : 0);
      dv.setUint8(o++, flags);
    }
    return buf.slice(0, o);
  }

  /* ------------------------------------------------------------------ guest: applying the host's world */

  private applySnapshot(m: Msg) {
    const g = this.g;
    if (m.ev) this.replay(m.ev as Wire[]);
    if (!m.h) return;
    const h = m.h as number[];
    g.T = h[0];
    g.score = h[1];
    g.kills = h[2];
    this.hostStorm = h[3];
    const won = (h[4] & 1) !== 0;
    g.endless = (h[4] & 2) !== 0;
    if (won && !g.won) { g.won = true; g.victoryT = 5; }
    const bossId = h[5];
    this.hostBossHp = h[6];
    this.hostBossMax = h[7];
    g.combo = h[8];
    if (g.boss.e && g.boss.e.id !== bossId) {
      g.boss.e.dead = true;
      this.mirror.delete(g.boss.e.id);
      g.boss.clear();
    }
    if (g.boss.e) { g.boss.e.hp = this.hostBossHp; g.boss.e.maxHp = this.hostBossMax; }

    // enemies
    const seen = new Set<number>();
    const dv = new DataView(m.e as ArrayBuffer);
    for (let o = 0; o + REC <= dv.byteLength; o += REC) {
      const id = dv.getUint32(o);
      const type = ETYPES[dv.getUint8(o + 4)];
      const x = dv.getInt16(o + 5) / 50, z = dv.getInt16(o + 7) / 50;
      const vx = dv.getInt8(o + 9) / 4, vz = dv.getInt8(o + 10) / 4;
      const yaw = (dv.getUint8(o + 11) / 255) * TAU;
      const hp = dv.getUint8(o + 12) / 255;
      const fl = dv.getUint8(o + 13);
      seen.add(id);
      let e = this.mirror.get(id);
      if (!e) {
        if (type === 'boss') continue; // bosses arrive by their own event
        e = g.enemies.ghost(id, type, x, z, (fl & 1) !== 0, AFFIX[(fl >> 1) & 3]);
        // the host's exact numbers aren't sent; this estimate only drives local kill prediction
        e.maxHp = EDEFS[type].hp * hpScale(g.T) * (e.elite ? 6 : 1) * (1 + (g.crewK - 1) * 0.3);
        e.hp = e.maxHp * hp;
        e.spawnT = fl & 8 ? 0.5 : 0;
        e.yaw = yaw;
        this.mirror.set(id, e);
      }
      if (e.dead && e.type !== 'boss') {
        // our shot predicted a kill the host hasn't confirmed; after a grace period it clearly survived
        if (performance.now() - (e.ghostT ?? 0) < 700) continue;
        e.dead = false;
        e.ghostDead = false;
        g.enemies.list.push(e);
      }
      const n = e.net!;
      n.x = x; n.z = z; n.vx = vx; n.vz = vz; n.yaw = yaw; n.t = 0;
      if (e.type !== 'boss') {
        const hostHp = hp * e.maxHp;
        e.hp = hostHp > e.hp + e.maxHp * 0.05 ? hostHp : Math.min(e.hp, hostHp);
      }
      if (fl & 16) e.flash = Math.max(e.flash, 0.05);
      e.shield = fl & 32 ? 1 : 0;
    }
    for (const [id, e] of this.mirror) {
      if (seen.has(id)) continue;
      if (e.type === 'boss' && g.boss.e === e) continue;
      e.dead = true;
      this.mirror.delete(id);
    }

    // teammates
    const players = (m.p ?? {}) as Record<string, number[]>;
    for (const [id, s] of Object.entries(players)) {
      const r = this.remotes.get(id) ?? this.addRemote(id, this.net.nameOf(id), this.net.lobby.find((p) => p.id === id)?.ship ?? 'comet');
      this.applyState(r, s);
    }
  }

  private custom(kind: string, a: Wire) {
    const g = this.g;
    if (kind === 'boss') {
      const d = a as { final: boolean; idx: number; id: number; x: number; z: number; hp: number };
      const e = g.boss.spawnMirror(d.final, d.idx, d.id, d.x, d.z, d.hp);
      this.mirror.set(d.id, e);
    } else if (kind === 'kill') {
      const e = this.mirror.get(a as number);
      if (e) { e.dead = true; this.mirror.delete(e.id); }
    }
  }

  /* ------------------------------------------------------------------ messages */

  onMsg(from: string, m: Msg) {
    const g = this.g;
    if (this.host) {
      const r = this.remotes.get(from);
      if (m.t === 'st' && r) this.applyState(r, m.s as number[]);
      else if (m.t === 'lo' && r) { this.applyLoadout(r, m.lo); this.net.broadcast({ t: 'lo', id: from, lo: m.lo }, from); }
      else if (m.t === 'dmg') {
        const d = m.d as number[];
        this.world(() => {
          for (let i = 0; i + 3 < d.length; i += 4) {
            const e = g.enemies.list.find((q) => q.id === d[i]);
            if (e && !e.dead) g.damage(e, d[i + 1], d[i + 2], d[i + 3], 'net');
          }
        });
      }
      return;
    }
    // guest
    if (m.t === 's') this.applySnapshot(m);
    else if (m.t === 'lo') {
      const r = this.remotes.get(m.id) ?? this.addRemote(m.id, this.net.nameOf(m.id), m.lo.ship);
      this.applyLoadout(r, m.lo);
    } else if (m.t === 'start') g.startCoopRun(m);
    else if (m.t === 'over') g.coopOver(!!m.victory);
    else if (m.t === 'menu') g.coopToLobby();
  }
}

const TAU = Math.PI * 2;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clampI8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v)));

function nameTag(name: string, accent: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.font = '700 30px Orbitron, Rajdhani, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const col = '#' + new THREE.Color(accent).getHexString();
  x.shadowColor = col;
  x.shadowBlur = 12;
  x.fillStyle = '#fff';
  x.fillText(name.toUpperCase(), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 8;
  return s;
}
