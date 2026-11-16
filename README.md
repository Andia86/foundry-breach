# Foundry Breach

[![make.fun threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Andia86/foundry-breach/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Andia86/foundry-breach/reward.svg)](https://make.fun/bounty/threejs-fps-02)

**Foundry Breach** is a round-based tactical first-person shooter for the
browser, built with [three.js](https://threejs.org) for the
[make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02).
It plays in the style Counter-Strike made famous — two teams, short rounds,
money between rounds to buy weapons, accuracy over spray — but everything
here is its own: its own map (the Sable Foundry yard), its own teams (the
Wardens holding the reactor, the Jackals coming to breach it), its own
weapons and names.

The Jackals win a round by wiping out the Wardens or by planting the breach
charge on the reactor pad and letting it blow. The Wardens win by wiping out
the Jackals, running out the clock, or defusing the charge. First team to
six rounds takes the match.

## Play it

```sh
node serve.ts            # then open http://localhost:8080
```

No build step and no network requests: `game/` is plain static files, ES
modules loaded behind one import map, with three.js 0.187.0 vendored under
`game/vendor/three/`.

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Click | Fire |
| R | Reload |
| 1 – 5 | Buy (during the buy phase) / switch weapon |
| F | Hold to plant or defuse the charge |
| Shift | Walk (quieter, steadier) |
| Ctrl / C | Crouch |

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the vendored `buildDossier` helper from
`vendor/makefun-threejs.ts`.

## Layout

- `main.ts` — the hand-in program (Node 22)
- `serve.ts` — a tiny local static server for play-testing
- `game/index.html` — the page, HUD and menus
- `game/src/` — the game: `world.js` (the Sable Foundry), `player.js`,
  `weapon.js` (guns and synthesized sound), `bots.js`, `hud.js`, `main.js`
- `game/vendor/three/` — three.js 0.187.0, byte for byte
- `screenshots/` — renders of this build, taken by its maker

## License

MIT — see `LICENSE`.
