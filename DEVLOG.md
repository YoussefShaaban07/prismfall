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
- [x] More enemy variety: Sentry Pods (turrets) and Seeker Mines (kamikaze); readable per-type glow
- [x] Boss attack variety: signature attacks (carpet bombing, acid rain, laser sweep) via a hazard system
- [x] First-run tutorial prompts (adapts to keyboard / gamepad / touch)

### Day 2.5 — more content
- [x] Two new weapons: Wingman Drones (escort ships in V formation) and Gravity Mines (pull then detonate), with evolutions
- [x] Night Shift sector: night HDRI, moonlight, aurora sky, neon-forward grid; unlocked by first win; earlier phantoms/mines, +15% spawns, ×1.5 score, ×1.3 shards
- [x] Mutators (6, stackable score/shard multipliers) + date-seeded Daily Challenge with per-day best
- [x] Boss intro cinematic (camera push, letterbox, slow-mo, name card)
- [x] Local top-10 leaderboard with run details (Hangar → Records)
- [x] Accessibility: reduce-flashing mode, high-contrast enemy bullets
- [x] Unit tests (vitest, 15 tests) for upgrades/meta/progression/spatial grid, run in CI before deploy

### Day 3 — extra depth
- [x] Codex: 3D showroom previews of scanned enemies and bosses, lore, tactics, weapon evolutions
- [x] Music variety: boss theme (D minor, 134 bpm), Night Shift (E minor, 104 bpm), victory sting
- [ ] Arabic language option (RTL-aware UI, Arabic-capable font)
- [x] Run summary share card (frame snapshot + stats, download / native share)
- [ ] Story intro: short animated briefing on first launch
- [ ] Perf pass on mid/low devices: instanced debris colors, particle caps, LOD for decor

### Day 3 — polish & ship
- [x] Menu/controller navigation (D-pad/arrows + A/Enter, B/Esc back), settings from main menu, control reference
- [x] PWA: manifest + offline cache + INSTALL APP button for desktop
- [x] Auto quality based on measured FPS (respects manual choice)
- [ ] Full QA pass (desktop + phone sizes), README with screenshots, GitHub Pages deploy

## Session log
- **S2d (Nov 10 night)**: Night Shift sector, mutators + daily challenge, main menu redesigned as a left column so the 3D showroom stays visible.
- **S2c (Nov 10 night)**: boss intro cinematic, top-10 leaderboard, accessibility options, vitest suite + CI.
- **S2b (Nov 10 night)**: 8-weapon pool, lighter scorch decals, bot now sidesteps bullets/hazards. 6-run sample: deaths at 3:53–10:09, 1 win — good roguelite curve before hangar upgrades.
- **S2 (Nov 10 night)**: boss signatures + hazards; fixed negative frame-delta bug that blew up post-processing after picking upgrades; balance (more repairs, cubic late HP); bloom/bullet readability; README + screenshots.
- **S1c (Nov 10 eve)**: new enemies, material/tone-mapping fixes (ACES was whitening accents), tutorial, PWA, auto quality.
- **S1b (Nov 10 eve)**: sound samples, balance rounds via bot sims, juice pass, hangar/ships/upgrades/achievements/records.
- **S1 (Nov 10 eve)**: built the whole core loop and every system above; tuned bloom/glow so models read clearly; bosses enlarged; early-game spawn/XP rebalanced after bot runs (bot died ~2:30–4:00).
