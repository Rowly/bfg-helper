/** Imperial Navy Dominator-class Cruiser. */
export function dominatorProfile() {
  return {
    profileId: "imperial-dominator",
    faction: "Imperial Navy",
    shipClass: "Dominator-class Cruiser",

    tokenSize: {
      width: 3.2,
      height: 3.2
    },

    tokenTexture: {
      anchorX: 0.5,
      anchorY: 0.54,
      scaleX: 1,
      scaleY: 1,
      fit: "width"
    },

    movement: {
      speedCm: 20,
      minimumBeforeTurnCm: 10,
      maximumTurnDegrees: 45,
      maximumTurns: 1,
      canComeToNewHeading: true
    },

    stats: {
      points: 190,
      hits: 8,
      shields: 2,
      armour: { front: "6+", other: "5+" },
      targetClass: "capital",
      rammingSize: "cruiser",
      turrets: 2,
      famousShips: ["Hammer of Justice"]
    },

    engine: {
      enabled: true,
      separationCm: 0.4,
      widthCm: 0.9,
      lengthCm: 2.2,
      sternOffsetCm: 3.6,
      outerColour: 0x3399ff,
      innerColour: 0xccffff,
      outerOpacity: 0.18,
      innerOpacity: 0.48
    },

    weapons: [
      {
        id: "port-weapons-battery",
        name: "Port Weapons Battery",
        type: "battery",
        rangeCm: 30,
        strength: 12,
        directionDegrees: 180,
        arcDegrees: 90
      },
      {
        id: "starboard-weapons-battery",
        name: "Starboard Weapons Battery",
        type: "battery",
        rangeCm: 30,
        strength: 12,
        directionDegrees: 0,
        arcDegrees: 90
      },
      {
        id: "prow-nova-cannon",
        name: "Prow Nova Cannon",
        type: "nova-cannon",
        minimumRangeCm: 30,
        rangeCm: 150,
        strength: 1,
        directionDegrees: -90,
        arcDegrees: 90
      }
    ],

    ordnance: []
  };
}
