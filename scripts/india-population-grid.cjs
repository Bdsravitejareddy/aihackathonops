'use strict';

// Zonal population statistics over the WorldPop 1 km grid, shared by the state, district and PIN builds.
// Polygons are rasterised with a scanline fill on a sub-pixel grid so areas smaller than one grid cell
// (dense urban PINs) still receive an area-weighted share instead of zero.

const fs = require('node:fs');
const crypto = require('node:crypto');

const EARTH_RADIUS_KM = 6371.0088;

async function readPopulationGrid(file) {
  const { fromArrayBuffer } = require('geotiff');
  const bytes = fs.readFileSync(file);
  const tiff = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth(), height = image.getHeight();
  const [values] = await image.readRasters({ interleave: false });
  const noData = Number(image.getGDALNoData());
  const cleaned = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) { const v = values[i]; cleaned[i] = Number.isFinite(v) && v > 0 && v !== noData ? v : 0; }
  const dx = (east - west) / width, dy = (north - south) / height;
  return { width, height, west, north, dx, dy, values: cleaned, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

// Geodesic area of a grid row's cell in km², used for density.
function cellAreaKm2(grid, row) {
  const lat1 = (grid.north - row * grid.dy) * Math.PI / 180, lat2 = (grid.north - (row + 1) * grid.dy) * Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * (grid.dx * Math.PI / 180) * Math.abs(Math.sin(lat1) - Math.sin(lat2));
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function bboxOf(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygonsOf(geometry)) for (const ring of polygon) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

// Calls visit(row, col, weight) for every sub-cell centre inside the geometry (even-odd rule, so holes work).
function rasterize(grid, geometry, subdivisions, visit) {
  const box = bboxOf(geometry); if (!box) return;
  const step = 1 / subdivisions, weight = step * step;
  const edges = [];
  for (const polygon of polygonsOf(geometry)) for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if (y1 !== y2) edges.push(y1 < y2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1]);
  }
  const firstRow = Math.max(0, Math.floor((grid.north - box[3]) / grid.dy * subdivisions));
  const lastRow = Math.min(grid.height * subdivisions - 1, Math.floor((grid.north - box[1]) / grid.dy * subdivisions));
  const crossings = [];
  for (let subRow = firstRow; subRow <= lastRow; subRow++) {
    const y = grid.north - (subRow + 0.5) * step * grid.dy;
    crossings.length = 0;
    for (const [x1, y1, x2, y2] of edges) if (y >= y1 && y < y2) crossings.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    const row = Math.floor(subRow / subdivisions);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const start = Math.max(0, Math.ceil((crossings[k] - grid.west) / (step * grid.dx) - 0.5));
      const end = Math.min(grid.width * subdivisions - 1, Math.floor((crossings[k + 1] - grid.west) / (step * grid.dx) - 0.5));
      for (let subCol = start; subCol <= end; subCol++) visit(row, Math.floor(subCol / subdivisions), weight);
    }
  }
}

// Assigns each populated pixel to the zone containing its centre (one pass, used for state-level calibration).
function pixelZones(grid, features) {
  const zones = new Int32Array(grid.width * grid.height).fill(-1);
  features.forEach((feature, index) => rasterize(grid, feature.geometry, 1, (row, col) => { zones[row * grid.width + col] = index; }));
  return zones;
}

// Marks the densest pixels in each zone as urban until the zone's urban population share matches its target
// (Census urban share), so the rural/urban split stays consistent with the official state figures.
function calibrateUrban(grid, zones, targetShares) {
  const urban = new Uint8Array(grid.values.length), byZone = new Map();
  for (let i = 0; i < grid.values.length; i++) {
    const zone = zones[i], value = grid.values[i];
    if (zone < 0 || value <= 0 || !Number.isFinite(targetShares[zone])) continue;
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push(i);
  }
  const thresholds = {};
  for (const [zone, pixels] of byZone) {
    const density = i => grid.values[i] / cellAreaKm2(grid, Math.floor(i / grid.width));
    pixels.sort((a, b) => density(b) - density(a));
    const total = pixels.reduce((sum, i) => sum + grid.values[i], 0), target = total * targetShares[zone];
    let cumulative = 0, last = null;
    for (const i of pixels) { if (cumulative >= target) break; urban[i] = 1; cumulative += grid.values[i]; last = i; }
    thresholds[zone] = last === null ? null : Math.round(density(last));
  }
  return { urban, thresholds };
}

// Population, urban population and gridded area for each feature.
function zonalStats(grid, features, { urban = null, subdivisions = 4 } = {}) {
  return features.map(feature => {
    let population = 0, urbanPopulation = 0, cells = 0;
    rasterize(grid, feature.geometry, subdivisions, (row, col, weight) => {
      const index = row * grid.width + col, value = grid.values[index] * weight;
      cells += weight;
      if (value > 0) { population += value; if (urban?.[index]) urbanPopulation += value; }
    });
    return { population, urbanPopulation, gridCells: cells };
  });
}

function gridTotal(grid) { let total = 0; for (const v of grid.values) total += v; return total; }

module.exports = { readPopulationGrid, cellAreaKm2, bboxOf, rasterize, pixelZones, calibrateUrban, zonalStats, gridTotal };
