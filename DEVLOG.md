# PRISMFALL dev log

Three-day build. Each session picks up the next unchecked items, playtests with the headless bot
(`debugSim`) and screenshots, and logs what changed.

## Tooling (outside the repo, in /home/claude/tools)
- `shot.py URL W H script` — headless Chrome screenshots (scripts: basic, late, boss, bossview, lvl)
- `sim.py N` — N bot runs through `prismfall.debugSim(30)` chunks, prints survival curve
- `perf.py` — draw calls / triangles / sim ms under late-game load
- Preview server: `npx vite preview --port 4173` from the repo

## Roadmap

### Day 1 — core game
- [x] Vite + TypeScript + Three.js project, bloom/SMAA/grade post stack, shadows, HDRI lighting
- [x] Kenney Space Kit models baked into instanced meshes, alien recolor + rim/flash shader
- [x] Mars colony arena: procedural ground, force-field wall, pylons, base buildings, rockets, sky, moons, dust
- [x] Player ship, dash, i-frames, keyboard / gamepad / touch joystick
- [x] 7 enemy types with behaviours, elites, swarm surges
- [x] 6 weapons + evolutions, 8 passive modules, level-up cards with reroll
- [x] 3 bosses + final Prism Core, victory + endless mode
- [x] HUD, minimap, banners, damage numbers, pause + settings, game-over stats
- [x] Procedural SFX + adaptive synthwave music
- [x] Bot playtest harness
- [ ] Balance pass: bot should reach boss 1 reliably; good human run ~ 10 min
- [ ] Juice pass: hit-stop on elites, kill streak announcer, dash afterimages, crystal trails
- [ ] Open-source CC0 sound effects layered with synth

### Day 2 — depth & replay value
- [ ] Hangar meta-progression: earn Prism Shards per run, spend on permanent upgrades
- [ ] Selectable ships (Kenney speeders) with unique stats + starting weapon, unlocks
- [ ] Achievements / challenges
- [ ] More enemy variety late game (turret bunkers, kamikaze swarms), boss attack variety
- [ ] First-run tutorial prompts

### Day 3 — polish & ship
- [ ] Menu/controller navigation, key hints per device
- [ ] PWA: manifest + offline cache so it installs as a desktop app
- [ ] Auto quality based on measured FPS
- [ ] Full QA pass (desktop + phone sizes), README with screenshots, GitHub Pages deploy

## Session log
- **S1 (Nov 10 eve)**: built the whole core loop and every system above; tuned bloom/glow so models read clearly; bosses enlarged; early-game spawn/XP rebalanced after bot runs (bot died ~2:30–4:00).
