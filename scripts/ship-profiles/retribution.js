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
      minimumBeforeTurnCm: 10,
      maximumTurnDegrees: 45,
      maximumTurns: 1
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
        rangeCm: 60,
        directionDegrees: 180,
        arcDegrees: 90,
        fillColour: 0x0088ff,
        lineColour: 0x66bbff
      },
      {
        id: "starboard-battery",
        name: "Starboard Weapons Battery",
        rangeCm: 60,
        directionDegrees: 0,
        arcDegrees: 90,
        fillColour: 0x00cc66,
        lineColour: 0x66ff99
      },
      {
        id: "dorsal-weapons",
        name: "Dorsal Weapons",
        rangeCm: 60,
        directionDegrees: -90,
        arcDegrees: 270,
        fillColour: 0xff0000,
        lineColour: 0xff6666
      },
      {
        id: "prow-weapons",
        name: "Prow Weapons",
        rangeCm: 30,
        directionDegrees: -90,
        arcDegrees: 90,
        fillColour: 0xffaa00,
        lineColour: 0xffcc66
      }
    ]
  };
}
