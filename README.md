# Battlefleet Gothic Helper

Current version: **0.1.0**

Battlefleet Gothic Helper is an early-development Foundry VTT 13 module containing tabletop aids for private Battlefleet Gothic games. It is not feature complete and should be treated as a development prototype.

The module supports ship profiles, per-token fleet assignment, a persistent Turn Manager, weapon-arc overlays, engine-plume effects, and planned movement preview and execution. It is intended to assist tabletop play rather than automate the entire game.

## Scene and token scale

Development currently uses a scene grid configured as:

- Grid size: 100 pixels
- Grid distance: 1 cm
- Scale: 100 pixels per centimetre

Distances in ship profiles are stored in centimetres and converted using the current scene grid at runtime.

A token's logical Foundry footprint represents the ship's tabletop base rather than the visible length of its artwork. Capital ships currently use a 6 x 6 footprint for a 60 mm base, while their artwork may extend beyond it.

## Ship profiles

Reusable ship-class data is stored on the source Actor. This includes movement characteristics, weapons, base and texture presentation, engine effects, and other class-level rules.

The current profiles are:

- Imperial Navy Retribution-class Battleship
- Chaos Despoiler-class Battleship

Class definitions are kept separately under `scripts/ship-profiles/` so that the catalogue can grow without expanding the generic ship-data service.

To configure the Actor used by exactly one selected token:

```javascript
await game.bfgHelper.configureRetribution();
await game.bfgHelper.configureDespoiler();
```

Equivalent hotbar wrappers are available under `macros/`.

## Fleet assignment

Fleet membership belongs to each deployed **TokenDocument**, not to its reusable Actor. Multiple tokens can therefore use the same Actor/profile while representing independently assigned ships.

To assign a ship:

1. Open the Turn Manager and configure the two fleets.
2. Configure the ship's Actor with a ship profile.
3. Select exactly one deployed ship token.
4. Click **Assign selected ship** in the Turn Manager and choose a fleet.

The corresponding API calls are:

```javascript
await game.bfgHelper.fleets.assign();
await game.bfgHelper.fleets.clearAssignment();
```

The module includes a compatibility migration that copies legacy Actor-level fleet assignments to currently deployed tokens and then removes the old Actor assignment. Newly deployed tokens must be assigned independently.

## Turn Manager

The persistent Turn Manager tracks:

- whether a battle has started;
- the battle round;
- two configurable fleets;
- the active fleet;
- Movement, Shooting, Ordnance, and End phases;
- deployed ships assigned to each fleet.

Gamemasters can configure and advance the battle. Other players receive a read-only view that rerenders when shared turn state changes.

Open it with:

```javascript
await game.bfgHelper.turnManager.open();
```

## Movement Planner

The Movement Planner previews a legal route and can then execute that exact route by updating the token's position and rotation.

It reads movement limits from the selected ship profile and plots:

- the initial straight segment;
- an optional turn after the required minimum distance;
- the remaining movement segment;
- the final logical base position;
- the final facing.

The turn control is a signed slider: negative values turn to port, zero continues straight ahead, and positive values turn to starboard. Calculations also validate movement distance, minimum distance before turning, and the ship's maximum turn angle.

The minimum-before-turn value is profile driven. The current battleships must move 15 cm before turning; a future escort profile can set the value to 0 cm to rotate at its starting point or at any later point in its move.

Players can only plan movement for a ship in the active fleet during its Movement phase while a battle is running. Gamemasters receive a preview override for testing. When no battle is running, preview remains available for setup and testing.

Open the planner with either call:

```javascript
await game.bfgHelper.movement.open();
await game.bfgHelper.movement.move(); // Compatibility alias
```

Closing the planner, clearing the preview, or leaving the canvas removes its temporary PIXI route.

Execution rechecks the current battle permissions and movement rules. It is refused if the ship moved or rotated, the Scene scale changed, the ship profile changed, or the planner inputs changed after the preview. The module's battle-time rotation lock permits this validated movement update while continuing to block manual rotation.

The execution animation follows the plotted route in stages: the ship travels to the turn point on its current bearing, rotates in place, and then completes the remaining movement on its new bearing.

## Weapon arcs and engine effects

Configured direct-fire weapons can display a manually toggled, range-scaled firing arc:

```javascript
await game.bfgHelper.weaponArcs.toggle();
game.bfgHelper.weaponArcs.clearAll();
```

While enabled, a weapon arc remains attached to its ship and follows rendered movement and rotation, including staged Movement Planner animations and GM heading corrections.

All weapon arcs use the same yellow fill and outline so their tabletop range-and-bearing role is visually consistent across ship classes and weapon systems.

Configured ships can also display profile-driven engine plumes. Engine graphics follow token movement and rotation:

```javascript
game.bfgHelper.engines.refresh();
```

These graphics are client-side PIXI overlays and are not persistent scene documents.

## Current development limitations

- Movement execution does not yet track a per-token `movedThisPhase` state or prevent a ship moving more than once.
- Starting a battle prevents manual rotation changes for configured, fleet-assigned ships, keeping token artwork and attached effects on the same heading. Ending or resetting the battle unlocks them, and the Turn Manager provides a GM correction override for a selected ship.
- Normal Foundry drag movement can bypass the planned movement workflow.
- Per-token damage, shields, critical damage, special orders, and moved/fired state are not implemented.
- Token Nameplates data is present only as a future optional integration.
- The ship-profile catalogue is limited to two capital ships.
- Automated tests are not yet configured.

The next movement milestone is per-token movement state and prevention of repeated movement during the same phase.

## Artwork

Private token artwork with uncertain provenance is not part of the public repository. Ship profiles should remain usable with independently supplied artwork and must not require a particular copyrighted image.
