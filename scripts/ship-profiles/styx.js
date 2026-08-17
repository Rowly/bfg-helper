/** Chaos Styx-class Heavy Cruiser. */
export function styxProfile() {
  return {
    profileId: "chaos-styx", faction: "Chaos", shipClass: "Styx-class Heavy Cruiser",
    tokenSize: { width: 3.2, height: 3.2 }, tokenTexture: { anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "width" },
    movement: { speedCm: 25, minimumBeforeTurnCm: 10, maximumTurnDegrees: 45, maximumTurns: 1, canComeToNewHeading: true },
    stats: { points: 260, hits: 8, shields: 2, armour: "5+", targetClass: "capital", rammingSize: "cruiser", turrets: 3, famousShips: ["Horrific", "Heartless Destroyer"] },
    engine: { enabled: true, separationCm: 0.8, widthCm: 0.9, lengthCm: 2.2, sternOffsetCm: 3.3, outerColour: 0xff6633, innerColour: 0xffdd99, outerOpacity: 0.18, innerOpacity: 0.48 },
    weapons: [
      { id: "dorsal-lance-battery", name: "Dorsal Lance Battery", type: "lance", rangeCm: 60, strength: 2, directionDegrees: -90, arcDegrees: 270 },
      { id: "prow-weapons-battery", name: "Prow Weapons Battery", type: "battery", rangeCm: 60, strength: 6, directionDegrees: -90, arcDegrees: 270 }
    ],
    ordnance: [
      { id: "port-launch-bays", name: "Port Launch Bays", capacity: 3 },
      { id: "starboard-launch-bays", name: "Starboard Launch Bays", capacity: 3 }
    ],
    attackCraft: [
      { id: "swiftdeath", name: "Swiftdeath Fighter", role: "fighter", speedCm: 30 },
      { id: "doomfire", name: "Doomfire Bomber", role: "bomber", speedCm: 20 },
      { id: "dreadclaw", name: "Dreadclaw Assault Boat", role: "assault-boat", speedCm: 30 }
    ]
  };
}
