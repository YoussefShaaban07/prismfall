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
- [x] Balance pass (first round): build choices now decide runs; strong builds reach 9-10 min
- [x] Juice pass: hit-stop on elites, combo tier announcer, dash afterimages, crystal trails, low-hull heartbeat
- [x] Open-source sound effects (Kenney MIT kits) layered with synth

### Day 2 — depth & replay value
- [x] Hangar meta-progression: Prism Shards per run, 8 permanent upgrades, revive
- [x] 6 selectable ships with unique stats + starting weapon, 3D showroom
- [x] 12 achievements with shard rewards + in-run toasts
- [ ] More enemy variety late game (turret bunkers, kamikaze swarms), boss attack variety
- [ ] First-run tutorial prompts

### Day 3 — polish & ship
- [ ] Menu/controller navigation, key hints per device
- [ ] PWA: manifest + offline cache so it installs as a desktop app
- [ ] Auto quality based on measured FPS
- [ ] Full QA pass (desktop + phone sizes), README with screenshots, GitHub Pages deploy

## Session log
- **S1b (Nov 10 eve)**: sound samples, balance rounds via bot sims, juice pass, hangar/ships/upgrades/achievements/records.
- **S1 (Nov 10 eve)**: built the whole core loop and every system above; tuned bloom/glow so models read clearly; bosses enlarged; early-game spawn/XP rebalanced after bot runs (bot died ~2:30–4:00).
