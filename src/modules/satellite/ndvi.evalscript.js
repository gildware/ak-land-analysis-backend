// ndvi.evalscript.js
export const NDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(s) {
  if (s.dataMask === 0) {
    return [0, 0, 0, 0]; // transparent outside polygon
  }

  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);

  return colorBlend(
    ndvi,
    [-1, 0, 0.2, 0.4, 0.6, 0.8, 1],
    [
      [0.2, 0.1, 0.1, 1],
      [0.4, 0.2, 0.0, 1],
      [0.6, 0.4, 0.1, 1],
      [0.1, 0.6, 0.2, 1],
      [0.1, 0.8, 0.3, 1],
      [0.0, 0.5, 0.2, 1],
      [0.0, 0.4, 0.1, 1]
    ]
  );
}


`;
// // ndvi.evalscript.js
// export const NDVI_EVALSCRIPT = `
// //VERSION=3
// function setup() {
//   return {
//     input: ["B04", "B08"],
//     output: { bands: 4 }
//   };
// }

// function evaluatePixel(s) {
//   let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);

//   return colorBlend(
//     ndvi,
//     [-1, 0, 0.2, 0.4, 0.6, 0.8, 1],
//     [
//       [0.2, 0.1, 0.1, 1],
//       [0.4, 0.2, 0.0, 1],
//       [0.6, 0.4, 0.1, 1],
//       [0.1, 0.6, 0.2, 1],
//       [0.1, 0.8, 0.3, 1],
//       [0.0, 0.5, 0.2, 1],
//       [0.0, 0.4, 0.1, 1]
//     ]
//   );
// }

// `;
