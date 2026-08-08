# Battlefleet Gothic Helper

## 0.6.1

Added the first plotted Movement Planner. The existing `Move_Ship.js` wrapper now opens a persistent preview window instead of immediately moving a token. It reads the selected ship profile, current turn/fleet state, movement allowance, minimum distance before turning, and maximum turn angle.

The planner draws a client-side route consisting of the first straight segment, optional port/starboard pivot, remaining segment, final circular base position, and final facing arrow. **It is preview-only in 0.6.1 and never updates the TokenDocument.** Closing the planner or clicking Clear Preview removes the route.

To open it:

```javascript
await game.bfgHelper.movement.open();
```

The existing compatibility call also works:

```javascript
await game.bfgHelper.movement.move();
```

A Gamemaster can preview out-of-phase or unassigned ships for testing and receives an on-screen warning. Players are restricted by the active fleet and phase state.

## 0.5.3

Fleet assignments now resolve to the source Actor even when placed Tokens are unlinked. Older synthetic-token assignments are migrated from tokens on the active canvas when possible.
 0.5.1

Prototype Battlefleet Gothic play aids for Foundry VTT.

## 0.5.1 changes

- Added persistent fleet assignment to configured ship Actors.
- The Turn Manager now lists ships assigned to each configured fleet.
- Added **Assign selected ship** and **Clear assignment** buttons to the Turn Manager.
- Added a Chaos **Despoiler-class Battleship** profile and configuration API/macro.
- Split ship class profiles into separate files under `scripts/ship-profiles/` so the ship catalogue can grow without turning `ship-data.js` into one very large file.
- Reconfiguring a ship now preserves its existing fleet assignment.

## Ship configuration macros

Retribution:

```javascript
await game.bfgHelper.configureRetribution();
```

Despoiler:

```javascript
await game.bfgHelper.configureDespoiler();
```

The equivalent wrapper files are included under `macros/`.

## Fleet assignment

1. Open the Turn Manager and configure the two fleet names.
2. Configure a ship using its class profile.
3. Select the placed ship token.
4. In the Turn Manager click **Assign selected ship**.
5. Choose one of the two fleets.

The assignment is stored on the Actor's BFG Helper ship-data flag, so additional tokens from the same Actor share that fleet membership.

A hotbar wrapper is also included:

```javascript
await game.bfgHelper.fleets.assign();
```

To clear the selected Actor's assignment:

```javascript
await game.bfgHelper.fleets.clearAssignment();
```

## Despoiler profile

The starter Despoiler profile uses the classic Battlefleet Gothic values:

- Battleship, 12 hits
- Speed 20 cm
- 45 degree turn
- 4 shields, 5+ armour, 4 turrets
- Port Weapons Battery: 60 cm, Strength 10, left arc
- Starboard Weapons Battery: 60 cm, Strength 10, right arc
- Dorsal Lance Battery: 60 cm, Strength 3, left/front/right arc
- Prow Launch Bays: 4 squadrons
- Port Launch Bays: 2 squadrons
- Starboard Launch Bays: 2 squadrons
- Cannot use Come to New Heading

Launch bays are stored in an `ordnance` section rather than the direct-fire `weapons` array because they will eventually be handled by the Ordnance phase system.

The Despoiler uses a 6 x 6 logical footprint for its 60 mm tabletop base. Its texture anchor and scale are neutral starter values; tune those to the specific token artwork in Foundry once you have the image positioned correctly.

## Ship profile layout

Class-specific data now lives here:

```text
scripts/ship-profiles/
  index.js
  retribution.js
  despoiler.js
```

Future Imperial, Chaos, Ork, Eldar and other ship profiles can be added as separate files without expanding the generic ship-data service.

## Existing APIs

```javascript
game.bfgHelper.weaponArcs.toggle();
game.bfgHelper.weaponArcs.clearAll();
game.bfgHelper.engines.refresh();
game.bfgHelper.movement.move();
game.bfgHelper.turnManager.open();
```


## 0.5.1

- Fixed Turn Manager fleet roster population by iterating `game.actors.contents` explicitly.
- Added an explicit `hasShips` template flag instead of relying on `ships.length` in Handlebars.

## 0.5.4 fleet membership change

Fleet membership is now stored on each deployed TokenDocument rather than on the reusable Actor profile. This means two or more tokens using the same ship class/Actor are counted as independent ships in the Turn Manager and can later track independent battle state.

When a 0.5.4 world first loads, any legacy Actor-level fleet assignments from 0.5.0-0.5.3 are copied to the currently deployed tokens and then removed from the Actor. Newly deployed tokens must be assigned to a fleet explicitly.


## 0.6.1 movement slider

The Movement Planner now uses a single signed turn slider. Its range is derived from each ship profile: maximum port turn on the left, straight ahead in the centre, and maximum starboard turn on the right. The slider advances in whole-degree steps and movement calculations clamp the supplied value to the ship's legal maximum.
