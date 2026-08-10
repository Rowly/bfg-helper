/**
 * Chaos Despoiler-class Battleship.
 *
 * Rules data follows the classic Battlefleet Gothic profile: 20 cm speed,
 * 45-degree turn, 60 cm broadside weapons batteries, 60 cm dorsal lances and
 * extensive launch-bay capacity. Launch bays are stored separately from the
 * direct-fire weapon list because they do not use a conventional firing arc.
 *
 * The token uses a 60 mm logical base. Texture presentation is deliberately a
 * neutral starting point because each extracted token image may need its own
 * anchor/scale tuning in Foundry.
 */
export function despoilerProfile() {
  return {
    profileId: "chaos-despoiler",
    faction: "Chaos",
    shipClass: "Despoiler-class Battleship",

    tokenSize: {
      width: 6,
      height: 6
    },

    tokenTexture: {
      anchorX: 0.5,
      anchorY: 0.5,
      scaleX: 1.0,
      scaleY: 1.0,
      fit: "width"
    },

    movement: {
      speedCm: 20,
      minimumBeforeTurnCm: 15,
      maximumTurnDegrees: 45,
      maximumTurns: 1
    },

    stats: {
      points: 400,
      hits: 12,
      shields: 4,
      armour: "5+",
      turrets: 4,
      notes: ["Cannot use Come to New Heading special orders."]
    },

    engine: {
      enabled: true,
      separationCm: 1.2,
      widthCm: 1.3,
      lengthCm: 3,
      sternOffsetCm: 4.8,
      outerColour: 0xff6633,
      innerColour: 0xffdd99,
      outerOpacity: 0.18,
      innerOpacity: 0.48
    },

    weapons: [
      {
        id: "port-weapons-battery",
        name: "Port Weapons Battery",
        rangeCm: 60,
        strength: 10,
        directionDegrees: 180,
        arcDegrees: 90
      },
      {
        id: "starboard-weapons-battery",
        name: "Starboard Weapons Battery",
        rangeCm: 60,
        strength: 10,
        directionDegrees: 0,
        arcDegrees: 90
      },
      {
        id: "dorsal-lance-battery",
        name: "Dorsal Lance Battery",
        rangeCm: 60,
        strength: 3,
        directionDegrees: -90,
        arcDegrees: 270
      }
    ],

    ordnance: [
      {
        id: "prow-launch-bays",
        name: "Prow Launch Bays",
        capacity: 4
      },
      {
        id: "port-launch-bays",
        name: "Port Launch Bays",
        capacity: 2
      },
      {
        id: "starboard-launch-bays",
        name: "Starboard Launch Bays",
        capacity: 2
      }
    ]
  };
}
