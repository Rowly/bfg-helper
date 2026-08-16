/** Chaos Idolator-class Raider. */
export function idolatorProfile() {
  return {
    profileId: "chaos-idolator",
    faction: "Chaos",
    shipClass: "Idolator-class Raider",
    tokenSize: { width: 3.2, height: 3.2 },
    tokenTexture: { anchorX: 0.5, anchorY: 0.6, scaleX: 1, scaleY: 1, fit: "width" },
    movement: {
      speedCm: 30,
      minimumBeforeTurnCm: 0,
      maximumTurnDegrees: 90,
      maximumTurns: 1,
      canComeToNewHeading: true
    },
    stats: {
      points: 45,
      hits: 1,
      shields: 1,
      armour: "5+",
      targetClass: "escort",
      rammingSize: "escort",
      turrets: 2,
      famousSquadrons: ["Retaliators", "Purgators", "Unclean Ravagers", "Khorne's Disciples"]
    },
    engine: {
      enabled: true,
      separationCm: 0.45,
      widthCm: 0.65,
      lengthCm: 1.5,
      sternOffsetCm: 2.2,
      outerColour: 0xff6633,
      innerColour: 0xffdd99,
      outerOpacity: 0.18,
      innerOpacity: 0.48
    },
    weapons: [
      {
        id: "weapons-battery",
        name: "Weapons Battery",
        type: "battery",
        rangeCm: 45,
        strength: 2,
        directionDegrees: -90,
        arcDegrees: 270,
        ignoreLongRangeShift: true
      },
      {
        id: "prow-lance-battery",
        name: "Prow Lance Battery",
        type: "lance",
        rangeCm: 30,
        strength: 1,
        directionDegrees: -90,
        arcDegrees: 90
      }
    ],
    ordnance: []
  };
}
