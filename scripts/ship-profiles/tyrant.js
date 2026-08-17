/** Imperial Navy Tyrant-class Cruiser, standard battery and torpedo configuration. */
export function tyrantProfile() {
  return {
    profileId: "imperial-tyrant", faction: "Imperial Navy", shipClass: "Tyrant-class Cruiser",
    tokenSize: { width: 3.2, height: 3.2 }, tokenTexture: { anchorX: 0.5, anchorY: 0.54, scaleX: 1, scaleY: 1, fit: "width" },
    movement: { speedCm: 20, minimumBeforeTurnCm: 10, maximumTurnDegrees: 45, maximumTurns: 1, canComeToNewHeading: true },
    stats: {
      points: 185, hits: 8, shields: 2, armour: { front: "6+", other: "5+" }, targetClass: "capital", rammingSize: "cruiser", turrets: 2,
      famousShips: ["Lord Sylvanus", "Zealous", "Dominion", "Incendrius"],
      notes: ["May upgrade the 30 cm batteries to 45 cm for +10 points.", "May replace prow torpedoes with a nova cannon for +20 points."]
    },
    engine: { enabled: true, separationCm: 0.4, widthCm: 0.9, lengthCm: 2.2, sternOffsetCm: 3.6, outerColour: 0x3399ff, innerColour: 0xccffff, outerOpacity: 0.18, innerOpacity: 0.48 },
    weapons: [
      { id: "port-weapons-battery-45", name: "Port Weapons Battery (45 cm)", type: "battery", rangeCm: 45, strength: 4, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery-45", name: "Starboard Weapons Battery (45 cm)", type: "battery", rangeCm: 45, strength: 4, directionDegrees: 0, arcDegrees: 90 },
      { id: "port-weapons-battery-30", name: "Port Weapons Battery (30 cm)", type: "battery", rangeCm: 30, strength: 6, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery-30", name: "Starboard Weapons Battery (30 cm)", type: "battery", rangeCm: 30, strength: 6, directionDegrees: 0, arcDegrees: 90 }
    ],
    ordnance: [{ id: "prow-torpedoes", name: "Prow Torpedoes", type: "torpedo", speedCm: 30, strength: 6, directionDegrees: -90, arcDegrees: 90 }]
  };
}
