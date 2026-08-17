/** Chaos Slaughter-class Cruiser. */
export function slaughterProfile() {
  return {
    profileId: "chaos-slaughter", faction: "Chaos", shipClass: "Slaughter-class Cruiser",
    tokenSize: { width: 3.2, height: 3.2 },
    tokenTexture: { anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "width" },
    movement: { speedCm: 30, minimumBeforeTurnCm: 10, maximumTurnDegrees: 45, maximumTurns: 1, canComeToNewHeading: true, allAheadFullFormula: "5d6" },
    stats: { points: 165, hits: 8, shields: 2, armour: "5+", targetClass: "capital", rammingSize: "cruiser", turrets: 2, famousShips: ["Deathskull", "Killfrenzy", "Soulless", "Heathen Promise"], notes: ["Improved thrusters: rolls 5D6 for All Ahead Full movement."] },
    engine: { enabled: true, separationCm: 0.8, widthCm: 0.9, lengthCm: 2.2, sternOffsetCm: 3.3, outerColour: 0xff6633, innerColour: 0xffdd99, outerOpacity: 0.18, innerOpacity: 0.48 },
    weapons: [
      { id: "port-lance-battery", name: "Port Lance Battery", type: "lance", rangeCm: 30, strength: 2, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-lance-battery", name: "Starboard Lance Battery", type: "lance", rangeCm: 30, strength: 2, directionDegrees: 0, arcDegrees: 90 },
      { id: "port-weapons-battery", name: "Port Weapons Battery", type: "battery", rangeCm: 30, strength: 8, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery", name: "Starboard Weapons Battery", type: "battery", rangeCm: 30, strength: 8, directionDegrees: 0, arcDegrees: 90 },
      { id: "prow-weapons-battery", name: "Prow Weapons Battery", type: "battery", rangeCm: 30, strength: 6, directionDegrees: -90, arcDegrees: 270 }
    ], ordnance: []
  };
}
