/** Chaos Hades-class Heavy Cruiser. */
export function hadesProfile() {
  return {
    profileId: "chaos-hades", faction: "Chaos", shipClass: "Hades-class Heavy Cruiser",
    tokenSize: { width: 3.2, height: 3.2 }, tokenTexture: { anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "width" },
    movement: { speedCm: 25, minimumBeforeTurnCm: 10, maximumTurnDegrees: 45, maximumTurns: 1, canComeToNewHeading: true },
    stats: { points: 200, hits: 8, shields: 2, armour: "5+", targetClass: "capital", rammingSize: "cruiser", turrets: 2, famousShips: ["Malignus Maximus", "Injustice", "Warmaker"] },
    engine: { enabled: true, separationCm: 0.8, widthCm: 0.9, lengthCm: 2.2, sternOffsetCm: 3.3, outerColour: 0xff6633, innerColour: 0xffdd99, outerOpacity: 0.18, innerOpacity: 0.48 },
    weapons: [
      { id: "port-weapons-battery", name: "Port Weapons Battery", type: "battery", rangeCm: 45, strength: 10, directionDegrees: 180, arcDegrees: 90 },
      { id: "starboard-weapons-battery", name: "Starboard Weapons Battery", type: "battery", rangeCm: 45, strength: 10, directionDegrees: 0, arcDegrees: 90 },
      { id: "dorsal-lance-battery", name: "Dorsal Lance Battery", type: "lance", rangeCm: 60, strength: 2, directionDegrees: -90, arcDegrees: 270 },
      { id: "prow-lance-battery", name: "Prow Lance Battery", type: "lance", rangeCm: 60, strength: 2, directionDegrees: -90, arcDegrees: 90 }
    ], ordnance: []
  };
}
