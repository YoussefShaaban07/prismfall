import type { ModelName } from '../core/Assets';

/* ======================= ENEMIES ======================= */

export type EType = 'drone' | 'dart' | 'spitter' | 'meteor' | 'shard' | 'brute' | 'wraith' | 'turret' | 'bomber' | 'boss';

export interface EDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  xp: number;
  score: number;
  color: number;
  model: ModelName;
  size: number;
  hover: number;
  max: number;
}

export const EDEFS: Record<EType, EDef> = {
  drone: { name: 'Swarmer', hp: 14, speed: 3.6, radius: 0.55, damage: 6, xp: 1, score: 10, color: 0xff2fa0, model: 'enemy-flying', size: 1.5, hover: 0.9, max: 400 },
  dart: { name: 'Lancer', hp: 13, speed: 3.2, radius: 0.55, damage: 9, xp: 2, score: 15, color: 0xff7a1a, model: 'craft_racer', size: 1.25, hover: 0.7, max: 160 },
  spitter: { name: 'Gunship', hp: 28, speed: 2.5, radius: 0.7, damage: 8, xp: 3, score: 22, color: 0x26ffb0, model: 'craft_miner', size: 1.5, hover: 0.8, max: 120 },
  meteor: { name: 'Rift Meteor', hp: 36, speed: 2.7, radius: 0.85, damage: 9, xp: 2, score: 18, color: 0xffd23a, model: 'meteor_detailed', size: 1.8, hover: 0.35, max: 120 },
  shard: { name: 'Shard', hp: 9, speed: 4.7, radius: 0.42, damage: 6, xp: 1, score: 6, color: 0xffd23a, model: 'meteor_half', size: 0.95, hover: 0.35, max: 200 },
  brute: { name: 'Hauler', hp: 140, speed: 1.8, radius: 1.25, damage: 22, xp: 9, score: 70, color: 0xff3b3b, model: 'craft_cargoB', size: 2.6, hover: 0.9, max: 60 },
  wraith: { name: 'Phantom', hp: 42, speed: 4.4, radius: 0.65, damage: 13, xp: 4, score: 35, color: 0x6a7bff, model: 'craft_speederC', size: 1.45, hover: 1.0, max: 90 },
  turret: { name: 'Sentry Pod', hp: 110, speed: 0, radius: 0.95, damage: 10, xp: 6, score: 60, color: 0x39d0ff, model: 'turret_single', size: 2.1, hover: 0, max: 14 },
  bomber: { name: 'Seeker Mine', hp: 18, speed: 3.0, radius: 0.55, damage: 20, xp: 2, score: 25, color: 0xff2a2a, model: 'rocket_topA', size: 1.1, hover: 0.9, max: 50 },
  boss: { name: 'Boss', hp: 2000, speed: 2.2, radius: 2.6, damage: 30, xp: 0, score: 3000, color: 0xc86bff, model: 'craft_cargoA', size: 6, hover: 1.4, max: 1 },
};

/* ======================= WEAPONS ======================= */

export type WeaponId = 'blaster' | 'blades' | 'arc' | 'missiles' | 'nova' | 'lance' | 'wingmen' | 'mines';
export type PassiveId = 'vitality' | 'thrust' | 'magnet' | 'power' | 'clock' | 'regen' | 'area' | 'armor';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  evoName: string;
  icon: string;
  color: string;
  blurb: string;
  levels: string[]; // description of what each level grants (index = level-1), index 5 = evolution
  evoNeeds: PassiveId;
}

export const MAX_WEAPON_LV = 5;
export const MAX_PASSIVE_LV = 5;
export const MAX_WEAPONS = 5;
export const MAX_PASSIVES = 5;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  blaster: {
    id: 'blaster', name: 'Prism Blaster', evoName: 'Prism Storm', icon: '✦', color: '#5ef2ff',
    blurb: 'Auto-targets the nearest enemy.',
    levels: ['Fires a plasma bolt at the nearest enemy.', '+1 bolt per volley.', '+Damage, bolts pierce 1 enemy.', '+1 bolt, faster fire rate.', '+Damage, pierce 2.', 'EVOLVED: relentless stream of piercing prism bolts.'],
    evoNeeds: 'clock',
  },
  blades: {
    id: 'blades', name: 'Halo Blades', evoName: 'Saw Halo', icon: '⟡', color: '#ff4fd8',
    blurb: 'Crystal blades orbit your ship.',
    levels: ['Two crystal blades orbit you.', '+1 blade.', '+Damage, wider orbit.', '+1 blade, faster spin.', '+1 blade, +Damage.', 'EVOLVED: eight saw blades in a double halo.'],
    evoNeeds: 'area',
  },
  arc: {
    id: 'arc', name: 'Chain Arc', evoName: 'Storm Lattice', icon: 'ϟ', color: '#b48bff',
    blurb: 'Lightning that leaps between enemies.',
    levels: ['Lightning jumps between 3 enemies.', '+1 jump.', '+Damage, faster.', '+2 jumps.', '+Damage, faster.', 'EVOLVED: twin storms with 10 jumps each.'],
    evoNeeds: 'power',
  },
  missiles: {
    id: 'missiles', name: 'Seeker Swarm', evoName: 'Hellfire Volley', icon: '➶', color: '#ffb347',
    blurb: 'Homing missiles with a blast radius.',
    levels: ['Launches a homing missile.', '+1 missile.', '+Damage, bigger blast.', '+1 missile.', '+1 missile, faster.', 'EVOLVED: a 7-missile volley with huge blasts.'],
    evoNeeds: 'magnet',
  },
  nova: {
    id: 'nova', name: 'Pulse Nova', evoName: 'Singularity', icon: '◉', color: '#7dff9b',
    blurb: 'Shockwave that blasts enemies away.',
    levels: ['Emits a shockwave that knocks enemies back.', '+Radius.', '+Damage, faster.', '+Radius.', '+Damage, faster.', 'EVOLVED: pulls enemies in, then detonates.'],
    evoNeeds: 'armor',
  },
  lance: {
    id: 'lance', name: 'Ion Lance', evoName: 'Solar Lance', icon: '⟶', color: '#ffe14f',
    blurb: 'Piercing beam that cuts through lines.',
    levels: ['Fires a piercing ion beam.', '+Damage, wider beam.', '+1 beam.', '+Damage, faster.', '+1 beam.', 'EVOLVED: a rotating fan of solar beams.'],
    evoNeeds: 'vitality',
  },
  wingmen: {
    id: 'wingmen', name: 'Wingman Drones', evoName: 'Squadron', icon: '✈', color: '#ff8ad8',
    blurb: 'Escort fighters that fly in formation and shoot.',
    levels: ['A wingman joins your formation.', '+1 wingman.', '+Damage, faster fire.', '+1 wingman.', '+Damage, faster fire.', 'EVOLVED: four wingmen firing twin bolts.'],
    evoNeeds: 'thrust',
  },
  mines: {
    id: 'mines', name: 'Gravity Mines', evoName: 'Event Horizon', icon: '◍', color: '#9a7bff',
    blurb: 'Drops mines that pull enemies in, then detonate.',
    levels: ['Drops a gravity mine behind you.', '+Damage, bigger pull.', '+1 mine per drop.', '+Damage, faster.', '+1 mine per drop.', 'EVOLVED: singularity mines that crush whole swarms.'],
    evoNeeds: 'regen',
  },
};

/** numeric stats per level (index 0..5, 5 = evolved) */
export const WSTATS = {
  blaster: { cd: [0.42, 0.4, 0.37, 0.33, 0.3, 0.11], shots: [1, 2, 2, 3, 3, 2], dmg: [12, 13, 16, 18, 22, 24], pierce: [0, 0, 1, 1, 2, 3], speed: 30 },
  blades: { count: [2, 3, 3, 4, 5, 8], dmg: [9, 11, 14, 16, 20, 26], radius: [2.6, 2.8, 3.3, 3.4, 3.7, 4.4], spin: [3.0, 3.2, 3.4, 3.9, 4.1, 5.0] },
  arc: { cd: [1.5, 1.4, 1.15, 1.05, 0.85, 0.75], jumps: [3, 4, 4, 6, 6, 10], dmg: [16, 18, 24, 26, 34, 40], chains: [1, 1, 1, 1, 1, 2] },
  missiles: { cd: [2.1, 2.0, 1.8, 1.7, 1.45, 1.2], count: [1, 2, 2, 3, 4, 7], dmg: [26, 28, 36, 40, 44, 55], blast: [2.3, 2.4, 2.9, 3.0, 3.1, 4.0] },
  nova: { cd: [3.4, 3.2, 2.7, 2.6, 2.1, 2.2], radius: [5, 6, 6.2, 7.3, 7.6, 9.5], dmg: [14, 16, 22, 24, 32, 48], knock: [11, 11, 12, 12, 13, 16] },
  wingmen: { cd: [0.75, 0.7, 0.6, 0.58, 0.48, 0.3], count: [1, 2, 2, 3, 3, 4], dmg: [9, 10, 13, 14, 18, 20], shots: [1, 1, 1, 1, 1, 2] },
  mines: { cd: [2.6, 2.4, 2.3, 2.0, 1.9, 1.5], count: [1, 1, 2, 2, 3, 4], dmg: [32, 40, 42, 52, 56, 75], radius: [3.0, 3.5, 3.6, 4.0, 4.2, 5.5], pull: [10, 13, 13, 15, 16, 24] },
  lance: { cd: [2.4, 2.3, 2.1, 1.85, 1.7, 1.0], dmg: [30, 38, 40, 50, 54, 70], width: [0.6, 0.8, 0.8, 0.9, 0.95, 1.3], beams: [1, 1, 2, 2, 3, 5], length: 26 },
};

/* ======================= PASSIVES ======================= */

export interface PassiveDef {
  id: PassiveId;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  vitality: { id: 'vitality', name: 'Vitality Core', icon: '♥', color: '#ff5e7e', desc: '+25 max hull and repair 25.' },
  thrust: { id: 'thrust', name: 'Ion Thrusters', icon: '➤', color: '#5ef2ff', desc: '+10% move speed, -12% dash cooldown.' },
  magnet: { id: 'magnet', name: 'Tractor Field', icon: '◎', color: '#62ffda', desc: '+35% pickup range.' },
  power: { id: 'power', name: 'Overcharge', icon: 'Ϟ', color: '#ffd84f', desc: '+12% damage.' },
  clock: { id: 'clock', name: 'Overclock', icon: '⟳', color: '#ff9a3c', desc: '-8% weapon cooldowns.' },
  regen: { id: 'regen', name: 'Nanobots', icon: '✚', color: '#7dff9b', desc: '+0.8 hull per second.' },
  area: { id: 'area', name: 'Amplifier', icon: '◈', color: '#c86bff', desc: '+12% area and blast size.' },
  armor: { id: 'armor', name: 'Hex Plating', icon: '⬢', color: '#9fb8ff', desc: '-2 damage taken per hit.' },
};

/* ======================= PROGRESSION ======================= */

export const ARENA_RADIUS = 62;
export const FINAL_TIME = 600;
export const BOSS_TIMES = [150, 300, 450];
export const BOSS_NAMES = ['VANGUARD CARRIER', 'HIVE DREADNOUGHT', 'OBSIDIAN WARDEN'];

export const xpForLevel = (l: number) => Math.floor(4 + (l - 1) * 3 + Math.pow(l - 1, 1.6) * 0.8 + Math.pow(Math.max(0, l - 20), 2) * 0.6);
export const hpScale = (t: number) => 1 + (t / 60) * 0.3 + Math.pow(t / 60, 2) * 0.065 + Math.pow(t / 60, 3) * 0.006;
