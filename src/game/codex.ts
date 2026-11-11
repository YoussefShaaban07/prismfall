import type { EType, WeaponId } from './data';

/** Lore and tips shown in the Codex. */
export const ENEMY_LORE: Record<Exclude<EType, 'boss'>, { lore: string; tip: string }> = {
  drone: { lore: 'Crystal-grown hunter drones. Alone they are nothing; the Prism never sends them alone.', tip: 'Keep moving. Swarmers weave, so circle-strafe instead of running straight.' },
  dart: { lore: 'Lancers lock on, glow, then spear forward at five times their cruising speed.', tip: 'When you see the red line on the ground, step sideways or dash.' },
  spitter: { lore: 'Converted mining gunships that hang back and lob plasma.', tip: 'They retreat when you close in. Chain Arc and Seeker Swarm reach them.' },
  meteor: { lore: 'Rift Meteors are hollow. Crack one and the shards inside wake up.', tip: 'Kill them away from you so the shards scatter outward.' },
  shard: { lore: 'Splinters of a Rift Meteor. Fast, fragile, furious.', tip: 'Halo Blades and Pulse Nova shred shards in groups.' },
  brute: { lore: 'Haulers are cargo frames packed with crystal armor. They do not stop.', tip: 'Knockback barely moves them. Kite them through your Gravity Mines.' },
  wraith: { lore: 'Phantoms fold space and blink toward their target every few seconds.', tip: 'They teleport close; save your dash for right after a blink.' },
  turret: { lore: 'Sentry Pods drop from orbit and dig in. Three-round bursts, endless patience.', tip: 'They never move. Kill them or leave their line of fire.' },
  bomber: { lore: 'Seeker Mines arm on approach, then dive and detonate.', tip: 'A red ring means it armed. Dash through it or bait it into a wall.' },
};

export const BOSS_LORE = [
  { name: 'VANGUARD CARRIER', lore: 'The first mothership to break atmosphere. It carpet-bombs anything that moves.', tip: 'Keep running in curves; the bombs land where you were heading.' },
  { name: 'HIVE DREADNOUGHT', lore: 'A living factory that rains acid and births escorts mid-fight.', tip: 'Never stand still in green. Pools last a few seconds.' },
  { name: 'OBSIDIAN WARDEN', lore: 'A gunship of black glass that sweeps the field with lances of light.', tip: 'The beams rotate one way. Move with them, or dash through.' },
  { name: 'THE PRISM CORE', lore: 'The heart of the swarm. Every attack the motherships knew, all at once.', tip: 'Arrives at 10:00. Bring evolved weapons and a full hull.' },
];

export const WEAPON_TIPS: Record<WeaponId, string> = {
  blaster: 'Leads moving targets. Evolved, it becomes a rainbow stream that pierces whole lines.',
  blades: 'Pure crowd control around your hull. Amplifier widens the orbit.',
  arc: 'Slows everything it hits. Great against fast Shards and Phantoms.',
  missiles: 'Each missile picks a different target. Blasts scale with Amplifier.',
  nova: 'Your panic button on a timer. Evolved, it pulls enemies in before detonating.',
  lance: 'Aims at the nearest enemy and pierces everything behind it.',
  wingmen: 'Escorts fly in formation and pick their own targets.',
  mines: 'Drops behind you. Lead enemies over them; the pull groups them for your other weapons.',
};
