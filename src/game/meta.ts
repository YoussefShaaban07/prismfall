import type { ModelName } from '../core/Assets';
import { store } from '../core/util';
import type { WeaponId } from './data';

/* ======================= persistent meta progression ======================= */

export type ShipId = 'comet' | 'wasp' | 'viper' | 'bastion' | 'phoenix' | 'prospector';
export type UpgradeId = 'hull' | 'calib' | 'reactor' | 'thrusters' | 'tractor' | 'salvage' | 'rerolls' | 'revive';

export interface ShipDef {
  id: ShipId;
  name: string;
  model: ModelName;
  accent: number;
  cost: number;
  weapon: WeaponId;
  blurb: string;
  perks: string[];
  hp: number;
  speed: number;
  dash: number;
  armor: number;
  area: number;
  magnet: number;
  xp: number;
}

export const SHIPS: ShipDef[] = [
  { id: 'comet', name: 'COMET', model: 'craft_speederA', accent: 0x37e8ff, cost: 0, weapon: 'blaster', blurb: 'Balanced colony interceptor.', perks: ['Starts with Prism Blaster', 'No weaknesses'], hp: 100, speed: 1, dash: 1, armor: 0, area: 1, magnet: 1, xp: 1 },
  { id: 'wasp', name: 'WASP', model: 'craft_speederB', accent: 0xff4fd8, cost: 120, weapon: 'blades', blurb: 'Light and fast. Fights up close.', perks: ['Starts with Halo Blades', '+15% speed', '-20 hull'], hp: 80, speed: 1.15, dash: 0.9, armor: 0, area: 1, magnet: 1, xp: 1 },
  { id: 'viper', name: 'VIPER', model: 'craft_racer', accent: 0xb48bff, cost: 220, weapon: 'arc', blurb: 'Storm racer built around its dash.', perks: ['Starts with Chain Arc', '-35% dash cooldown', '+5% speed'], hp: 95, speed: 1.05, dash: 0.65, armor: 0, area: 1, magnet: 1, xp: 1 },
  { id: 'bastion', name: 'BASTION', model: 'craft_speederD', accent: 0x7dff9b, cost: 320, weapon: 'nova', blurb: 'Armored gunboat. Slow, stubborn.', perks: ['Starts with Pulse Nova', '+50 hull, +2 armor', '-10% speed'], hp: 150, speed: 0.9, dash: 1.1, armor: 2, area: 1, magnet: 1, xp: 1 },
  { id: 'phoenix', name: 'PHOENIX', model: 'craft_speederC', accent: 0xffb347, cost: 450, weapon: 'missiles', blurb: 'Wide-wing missile carrier.', perks: ['Starts with Seeker Swarm', '+15% area', '+10% speed'], hp: 100, speed: 1.1, dash: 1, armor: 0, area: 1.15, magnet: 1, xp: 1 },
  { id: 'prospector', name: 'PROSPECTOR', model: 'craft_miner', accent: 0xffe14f, cost: 600, weapon: 'lance', blurb: 'Mining rig with a cutting lance.', perks: ['Starts with Ion Lance', '+30% pickup range', '+15% XP'], hp: 110, speed: 0.95, dash: 1, armor: 0, area: 1, magnet: 1.3, xp: 1.15 },
];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  desc: (lv: number) => string;
  max: number;
  cost: (lv: number) => number; // cost to buy level lv+1
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'hull', name: 'Hull Plating', icon: '⬢', desc: (l) => `+${l * 10} max hull`, max: 5, cost: (l) => 30 + l * 30 },
  { id: 'calib', name: 'Weapon Calibration', icon: '✦', desc: (l) => `+${l * 5}% damage`, max: 5, cost: (l) => 40 + l * 40 },
  { id: 'reactor', name: 'Reactor Tuning', icon: '⟳', desc: (l) => `-${l * 3}% cooldowns`, max: 5, cost: (l) => 40 + l * 45 },
  { id: 'thrusters', name: 'Thruster Boost', icon: '➤', desc: (l) => `+${l * 4}% speed`, max: 3, cost: (l) => 35 + l * 35 },
  { id: 'tractor', name: 'Tractor Coil', icon: '◎', desc: (l) => `+${l * 12}% pickup range`, max: 3, cost: (l) => 25 + l * 25 },
  { id: 'salvage', name: 'Salvage Drones', icon: '◆', desc: (l) => `+${l * 8}% XP`, max: 5, cost: (l) => 45 + l * 45 },
  { id: 'rerolls', name: 'Reroll Bank', icon: '↻', desc: (l) => `+${l} reroll${l === 1 ? '' : 's'} per run`, max: 3, cost: (l) => 60 + l * 60 },
  { id: 'revive', name: 'Phoenix Protocol', icon: '✚', desc: (l) => (l ? 'Revive once per run at 50% hull' : 'Revive once per run'), max: 1, cost: () => 400 },
];

export interface MetaState {
  shards: number;
  ship: ShipId;
  owned: ShipId[];
  upgrades: Partial<Record<UpgradeId, number>>;
  stats: { runs: number; kills: number; wins: number; bosses: number; bestTime: number; bestScore: number; shardsEarned: number };
  achievements: string[];
  seenTutorial: boolean;
}

const KEY = 'prismfall.meta.v1';

export function loadMeta(): MetaState {
  const d: MetaState = {
    shards: 0,
    ship: 'comet',
    owned: ['comet'],
    upgrades: {},
    stats: { runs: 0, kills: 0, wins: 0, bosses: 0, bestTime: 0, bestScore: 0, shardsEarned: 0 },
    achievements: [],
    seenTutorial: false,
  };
  const m = store.get<Partial<MetaState>>(KEY, {});
  return { ...d, ...m, stats: { ...d.stats, ...(m.stats ?? {}) }, upgrades: { ...(m.upgrades ?? {}) } };
}

export function saveMeta(m: MetaState) {
  store.set(KEY, m);
}

export const upLv = (m: MetaState, id: UpgradeId) => m.upgrades[id] ?? 0;

export function shardsForRun(r: { kills: number; bosses: number; time: number; victory: boolean; level: number }) {
  return Math.floor(r.kills / 30 + r.bosses * 25 + r.time / 20 + r.level * 0.6 + (r.victory ? 120 : 0));
}

/* ======================= achievements ======================= */

export interface AchDef {
  id: string;
  name: string;
  desc: string;
  reward: number;
}

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first_blood', name: 'First Contact', desc: 'Destroy 100 enemies in one run', reward: 20 },
  { id: 'survivor3', name: 'Holding the Line', desc: 'Survive 3 minutes', reward: 30 },
  { id: 'boss1', name: 'Carrier Down', desc: 'Defeat a mothership', reward: 40 },
  { id: 'evolve', name: 'Metamorphosis', desc: 'Evolve a weapon', reward: 40 },
  { id: 'combo100', name: 'Unstoppable', desc: 'Reach a 100 combo', reward: 40 },
  { id: 'kills1000', name: 'Swarm Breaker', desc: 'Destroy 1,000 enemies in one run', reward: 60 },
  { id: 'level30', name: 'Ascendant', desc: 'Reach level 30', reward: 60 },
  { id: 'full_build', name: 'Full Arsenal', desc: 'Hold 5 weapons at once', reward: 50 },
  { id: 'untouchable', name: 'Untouchable', desc: 'Reach 2:00 without taking damage', reward: 80 },
  { id: 'win', name: 'Colony Saved', desc: 'Destroy the Prism Core', reward: 150 },
  { id: 'endless15', name: 'Long Night', desc: 'Survive 15:00 in endless mode', reward: 150 },
  { id: 'all_ships', name: 'Fleet Admiral', desc: 'Own every ship', reward: 200 },
];
