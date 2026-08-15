/** Imperial Navy Sword-class Frigate. */
export function swordProfile() {
  return {
    profileId: "imperial-sword",
    faction: "Imperial Navy",
    shipClass: "Sword-class Frigate",
    tokenSize: { width: 3.2, height: 3.2 },
    tokenTexture: { anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "width" },
    movement: {
      speedCm: 25,
      minimumBeforeTurnCm: 0,
      maximumTurnDegrees: 90,
      maximumTurns: 1,
      canComeToNewHeading: true
    },
    stats: {
      points: 35,
      hits: 1,
      shields: 1,
      armour: "5+",
      targetClass: "escort",
      turrets: 2,
      famousSquadrons: ["Blue Squadron", "Red Squadron", "Omega Squadron"]
    },
    engine: {
      enabled: true,
      separationCm: 0.45,
      widthCm: 0.65,
      lengthCm: 1.5,
      sternOffsetCm: 2.2,
      outerColour: 0x3399ff,
      innerColour: 0xccffff,
      outerOpacity: 0.18,
      innerOpacity: 0.48
    },
    weapons: [{
      id: "weapons-battery",
      name: "Weapons Battery",
      type: "battery",
      rangeCm: 30,
      strength: 4,
      directionDegrees: -90,
      arcDegrees: 270
    }],
    ordnance: []
  };
}
