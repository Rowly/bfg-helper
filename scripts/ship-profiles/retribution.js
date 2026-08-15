/**
 * Imperial Navy Retribution-class Battleship.
 *
 * Token presentation values are tuned to the current Retribution artwork used
 * by the project. The 6 x 6 footprint represents the 60 mm tabletop base; the
 * miniature artwork is allowed to overhang that logical footprint.
 */
export function retributionProfile() {
  return {
    profileId: "imperial-retribution",
    faction: "Imperial Navy",
    shipClass: "Retribution-class Battleship",

    tokenSize: {
      width: 6,
      height: 6
    },

    tokenTexture: {
      anchorX: 0.5,
      anchorY: 0.52,
      scaleX: 1.05,
      scaleY: 1.05,
      fit: "width"
    },

    movement: {
      speedCm: 20,
      minimumBeforeTurnCm: 15,
      maximumTurnDegrees: 45,
      maximumTurns: 1,
      canComeToNewHeading: false
    },

    stats: {
      points: 345,
      hits: 12,
      shields: 4,
      armour: { front: "6+", other: "5+" },
      targetClass: "capital",
      turrets: 4,
      notes: ["Cannot use Come to New Heading special orders."],
      famousShips: ["Bloodhawk", "Cardinal Boras"]
    },

    engine: {
      enabled: true,
      separationCm: 1.2,
      widthCm: 1.3,
      lengthCm: 3,
      sternOffsetCm: 4.8,
      outerColour: 0x3399ff,
      innerColour: 0xccffff,
      outerOpacity: 0.18,
      innerOpacity: 0.48
    },

    weapons: [
      {
        id: "port-battery",
        name: "Port Weapons Battery",
        type: "battery",
        rangeCm: 60,
        strength: 12,
        directionDegrees: 180,
        arcDegrees: 90
      },
      {
        id: "starboard-battery",
        name: "Starboard Weapons Battery",
        type: "battery",
        rangeCm: 60,
        strength: 12,
        directionDegrees: 0,
        arcDegrees: 90
      },
      {
        id: "dorsal-lance-battery",
        name: "Dorsal Lance Battery",
        type: "lance",
        rangeCm: 60,
        strength: 3,
        directionDegrees: -90,
        arcDegrees: 270
      }
    ],

    ordnance: [
      {
        id: "prow-torpedoes",
        name: "Prow Torpedoes",
        type: "torpedo",
        speedCm: 30,
        strength: 9,
        directionDegrees: -90,
        arcDegrees: 90
      }
    ]
  };
}
