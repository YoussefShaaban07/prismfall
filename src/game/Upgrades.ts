import { pickWeighted } from '../core/util';
import {
  MAX_PASSIVES, MAX_PASSIVE_LV, MAX_WEAPONS, MAX_WEAPON_LV, PASSIVES, WEAPONS,
  type PassiveId, type WeaponId,
} from './data';
import type { Player } from './Player';

export type Choice =
  | { kind: 'weapon'; id: WeaponId; level: number }
  | { kind: 'passive'; id: PassiveId; level: number }
  | { kind: 'evolve'; id: WeaponId }
  | { kind: 'heal' }
  | { kind: 'bounty' };

export interface CardView {
  icon: string;
  color: string;
  name: string;
  tag: string;
  desc: string;
  level: number; // 0 for none
  max: number;
  special?: 'evo' | 'new';
  iconId?: string;
}

export function rollChoices(P: Player, n = 3): Choice[] {
  const pool: [Choice, number][] = [];
  const wCount = P.weapons.size;
  const pCount = P.passives.size;
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const lv = P.weapons.get(id) ?? 0;
    if (lv === 0 && wCount >= MAX_WEAPONS) continue;
    if (lv >= MAX_WEAPON_LV) {
      const need = WEAPONS[id].evoNeeds;
      if (!P.evolved.has(id) && (P.passives.get(need) ?? 0) >= 1) pool.push([{ kind: 'evolve', id }, 12]);
      continue;
    }
    pool.push([{ kind: 'weapon', id, level: lv + 1 }, lv > 0 ? 3.2 : 2.2]);
  }
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    const lv = P.passives.get(id) ?? 0;
    if (lv === 0 && pCount >= MAX_PASSIVES) continue;
    if (lv >= MAX_PASSIVE_LV) continue;
    pool.push([{ kind: 'passive', id, level: lv + 1 }, lv > 0 ? 2.2 : 1.8]);
  }
  const out: Choice[] = [];
  const keyOf = (c: Choice) => c.kind + ('id' in c ? c.id : '');
  // always surface an available evolution first
  const evo = pool.find(([c]) => c.kind === 'evolve');
  if (evo) out.push(evo[0]);
  while (out.length < n && pool.length > 0) {
    const c = pickWeighted(pool);
    const idx = pool.findIndex(([x]) => x === c);
    pool.splice(idx, 1);
    if (!out.some((o) => keyOf(o) === keyOf(c))) out.push(c);
  }
  if (out.length < n) out.push({ kind: 'heal' });
  if (out.length < n) out.push({ kind: 'bounty' });
  return out.slice(0, n);
}

export function describe(c: Choice, P: Player): CardView {
  switch (c.kind) {
    case 'weapon': {
      const w = WEAPONS[c.id];
      return { icon: w.icon, color: w.color, name: w.name, tag: c.level === 1 ? 'NEW WEAPON' : `LEVEL ${c.level}`, desc: w.levels[c.level - 1], level: c.level, max: MAX_WEAPON_LV, special: c.level === 1 ? 'new' : undefined, iconId: c.id };
    }
    case 'passive': {
      const p = PASSIVES[c.id];
      return { icon: p.icon, color: p.color, name: p.name, tag: c.level === 1 ? 'NEW MODULE' : `LEVEL ${c.level}`, desc: p.desc, level: c.level, max: MAX_PASSIVE_LV, special: c.level === 1 ? 'new' : undefined, iconId: c.id };
    }
    case 'evolve': {
      const w = WEAPONS[c.id];
      return { icon: w.icon, color: w.color, name: w.evoName, tag: 'EVOLUTION', desc: w.levels[5], level: 0, max: 0, special: 'evo', iconId: c.id };
    }
    case 'heal':
      return { icon: '✚', color: '#ff5e7e', name: 'Field Repair', tag: 'SUPPLY', desc: `Repair ${Math.round(P.maxHp * 0.5)} hull.`, level: 0, max: 0, iconId: 'heal' };
    case 'bounty':
      return { icon: '★', color: '#ffd84f', name: 'Salvage Bounty', tag: 'SUPPLY', desc: '+2,500 score.', level: 0, max: 0, iconId: 'bounty' };
  }
}

export function applyChoice(c: Choice, P: Player): { score?: number } {
  switch (c.kind) {
    case 'weapon':
      P.weapons.set(c.id, c.level);
      return {};
    case 'evolve':
      P.evolved.add(c.id);
      return {};
    case 'passive': {
      P.passives.set(c.id, c.level);
      switch (c.id) {
        case 'vitality':
          P.maxHp += 25;
          P.hp = Math.min(P.maxHp, P.hp + 25);
          break;
        case 'thrust':
          P.speed *= 1.1;
          P.dashMax *= 0.88;
          break;
        case 'magnet':
          P.magnet *= 1.35;
          break;
        case 'power':
          P.dmg *= 1.12;
          break;
        case 'clock':
          P.cd *= 0.92;
          break;
        case 'regen':
          P.regen += 0.8;
          break;
        case 'area':
          P.area *= 1.12;
          break;
        case 'armor':
          P.armor += 2;
          break;
      }
      return {};
    }
    case 'heal':
      P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.5);
      return {};
    case 'bounty':
      return { score: 2500 };
  }
}
