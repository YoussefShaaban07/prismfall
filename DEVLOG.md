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

### Graphics push (user asked for a heavy focus on graphics)
- [x] Dissolve deaths + materialize spawns (noise dissolve with glowing edges, shadow-correct)
- [x] Fireball particles with cooling colour ramp, soft lit smoke puffs, missile smoke trails
- [x] Screen-space shockwave distortion on explosions, nova, dash, bombs, boss deaths
- [x] Displaced terrain: dunes, mesas and a ridged mountain range; anti-tiling ground; height tint
- [x] Sky clouds lit by the sun, procedural lens flare, longer aerial-perspective fog
- [x] GTAO ambient occlusion (FX excluded), hangar depth of field, split-tone colour grade
- [x] Ribbon engine trails (player, wingmen), glowing bolt streaks
- [x] Boss engine trails + battle-damage smoke/fire as boss HP drops
- [x] Force-field impact ripples; grazing-angle damping so the wall never blows out
- [x] Glowing prism crystal clusters embedded in the arena
- [x] Weather: dust storms (day) and ion storms with lightning (night)
- [x] Player hull damage sparks + smoke at critical hull
- [x] Shield shimmer shader (fresnel hex + scan sweep)
- [x] Screen-space god rays from the sun in menus
- [x] Ground light pools under glowing objects + pooled explosion point lights
- [x] Faceted, lit crystal pickups
- [x] Night Shift searchlights sweeping the arena
- [x] Prism Core rebuilt: glass/iridescent prism cluster, obsidian base, orbiting shards, energy tendrils
- [x] Boss charge-up glows with energy suction before attacks
- [x] Title-screen flythrough camera; ship nav lights; fading supply beacons
- [x] Boss turrets track the player; instanced ground grit; glowing prism fissures in the arena floor with a travelling energy wave
- [x] QA sweep script (every screen, quality switches, death/share, night) — 0 errors at 1280x720 and 390x844
- [ ] Screen-space reflections or wet sheen on landing pads
- [x] Debris shrapnel that glows hot then cools

### Day 3 — extra depth
- [x] Codex: 3D showroom previews of scanned enemies and bosses, lore, tactics, weapon evolutions
- [x] Music variety: boss theme (D minor, 134 bpm), Night Shift (E minor, 104 bpm), victory sting
- [x] Arabic language option (RTL-aware UI, Cairo font, every screen, codex lore and in-run text)
- [x] Run summary share card (frame snapshot + stats, download / native share)
- [x] Story intro: typewriter mission briefing on first launch (skippable)
- [x] Perf pass: instance colors only uploaded on change (sync ~0.9 ms at 500 enemies, sim ~2.3 ms at 750); particle/smoke soft caps on LOW

### Day 3 — polish & ship
- [x] Menu/controller navigation (D-pad/arrows + A/Enter, B/Esc back), settings from main menu, control reference
- [x] PWA: manifest + offline cache + INSTALL APP button for desktop
- [x] Auto quality based on measured FPS (respects manual choice)
- [x] Dynamic resolution driven by GPU timer queries; F3 performance overlay
- [ ] Full QA pass (desktop + phone sizes), README with screenshots, GitHub Pages deploy

## Session log
- **S23 (Nov 12 early)**: photo mode upgrade (looks: natural / noir / warm film / neon / frost via the grade pass; focus-pulled depth of field with a blur control; hide-UI; save PNG; on-screen bar for mouse/touch); Night Shift chase lights around the perimeter and red aviation blinkers; share card now has a studio render of your ship; sims sane (died 3:56, died 5:20, won 11:13).
- **S22 (Nov 11 night)**: enemy fire gets a dark hue-tinted rim (readable over explosions); boss entrances no longer collide with surge/elite banners and the entry smoke stays aloft; pause screen redesign (run stats, uniform buttons, vignette backdrop; hints step aside behind menus); verified LOW on phones (pale captures were the hit-flash overlay frozen by headless timing, not the renderer); capture tooling hardened; README gameplay shot refreshed.
- **S21 (Nov 11 late)**: crystals got a shape per value tier (shard / hex prism / cluster / brilliant-cut jewel), twinkling facets and star glints on precious ones; local bloom compression so 600-enemy fights stay readable instead of washing to white; victory pauses the spawn director; shooting stars in the sky; capture fixes.
- **S20 (Nov 11 night)**: player hull cracks below half hull + hit flash on the ship; clamped damage inputs (overkill no longer blows out the glow); engine heat haze over the hangar ship; distortion pass now disabled when no shockwave/haze is live (saves a full-screen pass most frames); Night Shift + boss-death review; sims 3/3 sane (died 2:01, died 4:39, won 11:23 with 4 bosses).
- **S19 (Nov 11 evening)**: molten battle-damage cracks on enemies and bosses that spread as HP drops; procedural blast scars (ragged soot, radial streaks, cooling embers, per-scar variety); elite affix ambience (healing motes, volatile embers/smoke that intensify, shield sparkles); LOW-quality particle/smoke caps for phones; `?fixedres` for captures; README screenshots refreshed.
- **S18b (Nov 11 evening)**: Arabic language (Settings → Language; auto-picked for Arabic browsers): 330+ strings incl. codex lore, number-aware lookup, RTL panels that keep the 3D framing, reading-direction arrows; fixed default-HIGH boot never applying its tier (SMAA and full-res AO were still on).
- **S18 (Nov 11 afternoon)**: GPU audit on a real integrated GPU (Radeon, 1920x889: scene 55 ms, GTAO 56 ms, SMAA 10 ms per frame). Added GPU timer queries, dynamic resolution (50–100%, 60 fps budget), half-res GTAO with fewer taps on HIGH, FXAA instead of SMAA on HIGH, HIGH pixel ratio capped at 1.25, Voronoi fissures skipped outside the arena, frozen frames held behind blurred level-up/pause overlays, F3 perf overlay. Texel-snapped shadow frustum (no shadow crawl), hit-stop lens punch-in, comet streaks on magnetised crystals, idling engine flames on the hangar ship.
- **S17b (Nov 11 afternoon)**: GitHub Pages enabled (source: GitHub Actions); first live deploy.
- **S17 (Nov 11 afternoon)**: minimap radar sweep + pulsing boss ping, 30 fps minimap refresh.
- **S16 (Nov 11 afternoon)**: 3D-rendered icons for all 8 weapons, 8 modules and supplies (offscreen renderer at boot, auto-fit) used on level-up cards and HUD slots.
- **S15b (Nov 11 afternoon)**: Night Shift low-angle review; cooler, softer searchlight cones and pools.
- **S15 (Nov 11 afternoon)**: boss atmospheric entry (falls from 70m with fire/smoke, camera tracks it down, shockwave landing), comet tails on enemy bullets, wingman muzzle flashes.
- **S14 (Nov 11 afternoon)**: low-angle photo-mode review of terrain, mountains, colony and force field (no seams/floating decor found); dust devils confirmed visible; colony beauty shot added to docs.
- **S13 (Nov 11 midday)**: Photo Mode (F2 or Pause → Photo Mode): freezes action, hides HUD, orbit camera via drag/arrows, wheel zoom.
- **S12 (Nov 11 midday)**: game-over screen backed by a blurred shot of your wreck, wandering dust devils in the dunes, per-enemy size variance, achievement toasts moved off the results title.
- **S11 (Nov 11 morning)**: enemy spawn rifts (ground portal glow + rising sparks), death camera orbit around the wreck, per-ship trail widths.
- **S10 (Nov 11 morning)**: hangar black-chrome pad with orbiting cyan/pink rim lights (planar Reflector dropped: breaks under view offset), level-up card light sweep + floating icons.
- **S9 (Nov 11 morning)**: saturated crystals + crowd merging; unique boss deaths (carrier chain explosions, hive swarm burst + acid, warden glass shatter + cracks, Core implosion → prismatic supernova); toned-down generic boss death.
- **S8 (Nov 11 morning)**: rotating colony dishes + sweeping turrets, boss-bar damage trail, blaster muzzle flash, damage numbers tinted per weapon; phone QA clean.
- **S7 (Nov 11 early)**: level-up light column, evolution cutscene (freeze, flash, prismatic rings), rainbow solar lance, sparking saw halo, nova ground-crack ring; elite affixes Shielded/Regenerating/Volatile with distinct shader auras.
- **S6 (Nov 11 early)**: lance scorch + heat shimmer, chain-arc side forks, directional hit sparks, off-screen boss/elite arrows, victory orbit with fireworks.
- **S5 (Nov 11 early)**: tracking turrets, ground grit, floor fissures, automated QA sweep.
- **S4b (Nov 11 early)**: searchlights, Core overhaul, charge glows, flythrough, nav lights, beacon beams, portrait HUD fix, LOW-quality phone check.
- **S4 (Nov 10 late)**: ground glow pools, explosion lights, crystal material, god rays, big brightness rebalance for heavy fights, terrain perf, README screenshots refreshed.
- **S3b (Nov 10 night)**: graphics push: dissolve, fire/smoke, distortion, terrain + mountains, clouds, flare, GTAO, DOF, grade, trails.
- **S3 (Nov 10 night)**: adaptive music themes + victory sting, Codex with 3D previews, share card, first-launch briefing.
- **S2d (Nov 10 night)**: Night Shift sector, mutators + daily challenge, main menu redesigned as a left column so the 3D showroom stays visible.
- **S2c (Nov 10 night)**: boss intro cinematic, top-10 leaderboard, accessibility options, vitest suite + CI.
- **S2b (Nov 10 night)**: 8-weapon pool, lighter scorch decals, bot now sidesteps bullets/hazards. 6-run sample: deaths at 3:53–10:09, 1 win — good roguelite curve before hangar upgrades.
- **S2 (Nov 10 night)**: boss signatures + hazards; fixed negative frame-delta bug that blew up post-processing after picking upgrades; balance (more repairs, cubic late HP); bloom/bullet readability; README + screenshots.
- **S1c (Nov 10 eve)**: new enemies, material/tone-mapping fixes (ACES was whitening accents), tutorial, PWA, auto quality.
- **S1b (Nov 10 eve)**: sound samples, balance rounds via bot sims, juice pass, hangar/ships/upgrades/achievements/records.
- **S1 (Nov 10 eve)**: built the whole core loop and every system above; tuned bloom/glow so models read clearly; bosses enlarged; early-game spawn/XP rebalanced after bot runs (bot died ~2:30–4:00).
