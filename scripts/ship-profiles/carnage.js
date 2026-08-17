/** Chaos Carnage-class Cruiser. */
export function carnageProfile() {
  return {
    profileId: "chaos-carnage",
    faction: "Chaos",
    shipClass: "Carnage-class Cruiser",
    tokenSize: { width: 3.2, height: 3.2 },
    tokenTexture: { anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "width" },
    movement: { speedCm: 25, minimumBeforeTurnCm: 10, maximumTurnDegrees: 45, maximumTurns: 1, canComeToNewHeading: true },
    stats: {
      points: 180, hits: 8, shields: 2, armour: "5+", targetClass: "capital",
      rammingSize: "cruiser", turrets: 2,
      famousShips: ["Initiate of Skalathrax", "Wanton Desecration", "Excessive", "Anarchic Vendetta"]
    },
    engine: { enabled: true, separationCm: 0.8, widthCm: 0.9, lengthCm: 2.2, sternOffsetCm: 3.3, outerColour: 0xff6633, innerColour: 0xffdd99, outerOpacity: 0.18, innerOpacity: 0.48 },
    weapons: [
      { id: "port-weapons-battery-45", name: "Port Weapons Battery (45 cm)", type: "battery", rangeCm: 45, strength: 6, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery-45", name: "Starboard Weapons Battery (45 cm)", type: "battery", rangeCm: 45, strength: 6, directionDegrees: 0, arcDegrees: 90 },
      { id: "port-weapons-battery-60", name: "Port Weapons Battery (60 cm)", type: "battery", rangeCm: 60, strength: 4, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery-60", name: "Starboard Weapons Battery (60 cm)", type: "battery", rangeCm: 60, strength: 4, directionDegrees: 0, arcDegrees: 90 },
      { id: "prow-weapons-battery", name: "Prow Weapons Battery", type: "battery", rangeCm: 60, strength: 6, directionDegrees: -90, arcDegrees: 270 }
    ],
    ordnance: []
  };
}
