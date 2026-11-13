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
- **S34 (Nov 13)**: online co-op for up to 5 pilots. The host's browser runs the world and talks to each friend over WebRTC (PeerJS; its free public broker only introduces players, with a TURN relay for strict networks). Lobby with a 5-letter room code and invite link; friends can drop into a run already in progress. Enemies stream to guests as 14-byte records ~15x/s and glide between packets; explosions, enemy bullets, hazards, loot, banners and boss attacks are recorded on the host and replayed on guests; each pilot flies their own ship with zero lag and their weapon damage is batched to the host. Teammates show with name tags, crew hull bars and minimap dots; a downed ship can be revived by a teammate hovering over it, and the run ends when everyone is down. Enemy health and boss hull scale with crew size. Tested with 5 headless browsers against a local broker (join, shared kills/score, boss, revive, wipe, relaunch). Lobby translated to Arabic; join row fixed on narrow screens.
- **S33 (Nov 12 evening)**: the run's payoff. The Prism Core's death now adds a slow white-out that swells, holds and lets the scene bleed back, crystal shards in every prism hue flying out and tumbling down, hard white glints popping across the blast like light off turning facets, and a slower prismatic second wave after the flash; the supernova rings were thinned so they read as light, not painted bands. Core time-to-kill measured with five maxed weapons parked beside it: 100-135 s, so Core hull is down ~15% (2600 -> 2200 base). Win screen on phone: very long scores now shrink to fit their card instead of spilling off-screen.
- **S32 (Nov 12 evening)**: death and level-up, the two most-seen moments. Death: the opening blast is finer, faster sparks instead of soft blobs that filled the low death-cam lens, and the wreck now keeps burning while the camera circles (embers streaming up, a sooty column, a flickering ground fire that dies with the timer, two late cook-off blasts with debris), and power capsules parked in the camera's orbit hide so they can't block the shot. Level-up: the unchosen cards drop away, a burst + ring in the card's colour blooms from the chosen one and fades over the resuming game, and ordinary picks land on the ship as a ring and a column of motes. 3-run bot sim after the S30 boss speed-up: deaths at ~3 min to regular swarm, one run beat all three motherships taking only 50 boss damage, so the 12%/stage speed-up stays.
- **S31 (Nov 12 afternoon)**: motherships now visibly break apart as they escalate: each stage tears two breaches in the hull (found by raycasting onto the model) that glow like embers, pour dark smoke, spit falling sparks and lick flame at the last stage; the Core's breaches are cyan fractures that shed crystal sparks instead; orbiting blades and their motion arcs are now two instanced draws instead of up to 16; Night Shift review: the lens flare follows a cold moon instead of reusing the warm sun ghosts, searchlights land as crisp lit discs instead of a pale fog smear.
- **S30 (Nov 12 afternoon)**: motherships now escalate at 2/3 and 1/3 hull: shockwave + banner (HULL BREACHED / CRITICAL), attacks speed up 12% per stage; the boss bar shows the two thresholds as ticks that burn off when crossed, and pulses red-hot in the last third; getting hit flashes a red crescent on the screen edge facing the source (bullets, hazards, lasers, rams); GPU audit with all 8 weapons maxed + evolved: 156 draws, fine.
- **S29 (Nov 12 midday)**: hazard fills are now shaders: acid pools churn with caustic cells and bubbles, blast warnings pulse inward; carpet bombs visibly fall in trailing smoke and land as the warning ends; Prism Core crystals get flowing energy veins that beat faster as it weakens, and its glass transmission (an extra scene render) is now ULTRA-only; menu logo glint sweep.
- **S28 (Nov 12 morning)**: boss signature attacks reviewed for all four (carpet bombing, acid rain, laser sweep, the Core's mix) - all read clearly; storms now add wind-driven grit streaks across the lens tinted per map; dust devils fine; full regression clean (qa both sizes, Arabic, perf 88 draws / 1.5 ms sim at 180 enemies, sims died 7:58 and 5:01).
- **S27 (Nov 12 morning)**: charge warnings restyled (thin rails, chevrons streaming toward the target, racing charge head; fixed a GLSL reserved-word bug found on the way); species-specific death flourishes for all 8 regular enemies; supply drops carry holographic badges; arena wall reviewed (proximity reveal already reads well).
- **S26 (Nov 12 morning)**: weapon VFX review of all 8 weapons + evolutions; halo blades leave motion arcs; wingmen switched to the player's team colour (they read as the magenta swarm before) with engine glows and ground chevrons; gravity mines show a spiralling well that tightens before detonation; star muzzle flash at the gun port for blaster/lance; dash afterimages are holographic fresnel silhouettes; sims sane (died 2:54, died 8:29 with 2 bosses).
- **S25 (Nov 12 early morning)**: codex/showroom measures each model so it rests just above the pad and the camera backs off to fit (bosses no longer clip out of frame); menu flythrough reviewed (12 points, all clean); results screen rebuilt: slow orbit over the live battlefield instead of a blurred snapshot (also drops a full-screen blur that hurt laptop GPUs), staggered stat tiles, score count-up, title reveal, toasts moved off the buttons; README hangar shot refreshed.
- **S24 (Nov 12 night)**: hangar showroom rebuilt around the ship (hovers low over the pad in a flying pose; rim lights, rings and under-glow take the ship's or creature's accent; closer hero camera, phone framing fixed); level-up cards flip in with a longer stagger and a glint sweep; evolutions drain the world to monochrome and flood it with the weapon's colour plus a slow wide ring.
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
