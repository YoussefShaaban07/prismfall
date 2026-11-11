import { describe, expect, it } from 'vitest';
import { xpForLevel, hpScale, WEAPONS, WSTATS, PASSIVES, EDEFS, MAX_WEAPONS } from '../src/game/data';
import { rollChoices, applyChoice, describe as describeChoice, type Choice } from '../src/game/Upgrades';
import { SHIPS, UPGRADES, ACHIEVEMENTS, shardsForRun, loadMeta } from '../src/game/meta';
import { SpatialGrid } from '../src/game/SpatialGrid';
import type { Player } from '../src/game/Player';
import type { PassiveId, WeaponId } from '../src/game/data';

function fakePlayer(weapons: [WeaponId, number][] = [['blaster', 1]], passives: [PassiveId, number][] = []): Player {
  return {
    weapons: new Map(weapons),
    passives: new Map(passives),
    evolved: new Set<WeaponId>(),
    hp: 100, maxHp: 100, speed: 9, magnet: 4, dmg: 1, cd: 1, regen: 0, area: 1, armor: 0, dashMax: 2.4,
  } as unknown as Player;
}

describe('progression curves', () => {
  it('xp needed per level strictly increases', () => {
    for (let l = 1; l < 120; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  });
  it('enemy hp scaling starts at 1 and grows', () => {
    expect(hpScale(0)).toBe(1);
    expect(hpScale(600)).toBeGreaterThan(hpScale(300));
  });
});

describe('data tables', () => {
  it('every weapon has 6 levels of stats and text', () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      expect(WEAPONS[id].levels).toHaveLength(6);
      const st = WSTATS[id] as Record<string, number[] | number>;
      for (const v of Object.values(st)) if (Array.isArray(v)) expect(v).toHaveLength(6);
      expect(PASSIVES[WEAPONS[id].evoNeeds]).toBeDefined();
    }
  });
  it('enemy definitions are sane', () => {
    for (const d of Object.values(EDEFS)) {
      expect(d.hp).toBeGreaterThan(0);
      expect(d.radius).toBeGreaterThan(0);
      expect(d.max).toBeGreaterThan(0);
    }
  });
  it('ships start with a real weapon and the first is free', () => {
    expect(SHIPS[0].cost).toBe(0);
    for (const s of SHIPS) expect(WEAPONS[s.weapon]).toBeDefined();
  });
  it('upgrade costs rise per level', () => {
    for (const u of UPGRADES) for (let l = 0; l < u.max - 1; l++) expect(u.cost(l + 1)).toBeGreaterThanOrEqual(u.cost(l));
  });
  it('achievement ids are unique', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('level-up choices', () => {
  it('offers 3 distinct choices', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollChoices(fakePlayer());
      expect(c).toHaveLength(3);
      const keys = c.map((x) => x.kind + ('id' in x ? x.id : ''));
      expect(new Set(keys).size).toBe(3);
    }
  });
  it('never offers a new weapon when slots are full', () => {
    const full = (Object.keys(WEAPONS) as WeaponId[]).slice(0, MAX_WEAPONS).map((id) => [id, 2] as [WeaponId, number]);
    for (let i = 0; i < 200; i++) {
      for (const c of rollChoices(fakePlayer(full))) {
        if (c.kind === 'weapon') expect(c.level).toBeGreaterThan(1);
      }
    }
  });
  it('surfaces an evolution when a maxed weapon has its module', () => {
    const P = fakePlayer([['blaster', 5]], [['clock', 1]]);
    const c = rollChoices(P);
    expect(c[0]).toEqual({ kind: 'evolve', id: 'blaster' });
    applyChoice(c[0], P);
    expect(P.evolved.has('blaster')).toBe(true);
    expect(rollChoices(P).some((x) => x.kind === 'evolve')).toBe(false);
  });
  it('falls back to supplies when everything is maxed', () => {
    const ws = (Object.keys(WEAPONS) as WeaponId[]).slice(0, MAX_WEAPONS).map((id) => [id, 5] as [WeaponId, number]);
    const ps = (Object.keys(PASSIVES) as PassiveId[]).slice(0, 5).map((id) => [id, 5] as [PassiveId, number]);
    const P = fakePlayer(ws, ps);
    for (const id of ws.map((w) => w[0])) P.evolved.add(id);
    const kinds = rollChoices(P).map((c) => c.kind);
    expect(kinds).toContain('heal');
  });
  it('passives modify stats', () => {
    const P = fakePlayer();
    applyChoice({ kind: 'passive', id: 'vitality', level: 1 } as Choice, P);
    expect(P.maxHp).toBe(125);
    applyChoice({ kind: 'passive', id: 'armor', level: 1 } as Choice, P);
    expect(P.armor).toBe(2);
    expect(describeChoice({ kind: 'passive', id: 'armor', level: 1 }, P).name).toBe('Hex Plating');
  });
});

describe('meta progression', () => {
  it('rewards longer, better runs with more shards', () => {
    const a = shardsForRun({ kills: 300, bosses: 0, time: 120, victory: false, level: 10 });
    const b = shardsForRun({ kills: 3000, bosses: 4, time: 620, victory: true, level: 50 });
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(0);
  });
  it('loads defaults without storage', () => {
    const m = loadMeta();
    expect(m.owned).toContain('comet');
    expect(m.shards).toBe(0);
    expect(m.top).toEqual([]);
  });
});

describe('spatial grid', () => {
  it('finds every object within range', () => {
    const g = new SpatialGrid<{ x: number; z: number; id: number }>(3);
    const pts = Array.from({ length: 500 }, (_, id) => ({ x: Math.random() * 100 - 50, z: Math.random() * 100 - 50, id }));
    pts.forEach((p) => g.insert(p));
    const out: typeof pts = [];
    for (let k = 0; k < 50; k++) {
      const qx = Math.random() * 100 - 50, qz = Math.random() * 100 - 50, r = 6;
      const found = new Set(g.query(qx, qz, r, out).map((p) => p.id));
      for (const p of pts) if (Math.hypot(p.x - qx, p.z - qz) <= r) expect(found.has(p.id)).toBe(true);
    }
  });
});

import { dailySetup, modMult, MODS } from '../src/game/meta';
describe('daily challenge', () => {
  it('is deterministic per date and picks 2 distinct mods', () => {
    const a = dailySetup(new Date('2026-11-11T12:00:00Z'));
    const b = dailySetup(new Date('2026-11-11T12:00:00Z'));
    expect(a).toEqual(b);
    expect(new Set(a.mods).size).toBe(2);
    expect(modMult(a.mods)).toBeGreaterThan(1);
    expect(MODS.length).toBeGreaterThanOrEqual(6);
  });
});
