'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MarketColorScale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_COLORS = Object.freeze(['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']);
  const DEFAULT_NATIONAL_DOMAIN = Object.freeze([0, 1]);
  const MISSING_COLOR = '#b9c1c5';
  const VALID_MODES = new Set(['linear', 'log', 'percentile', 'quantile']);
  const validNumber = value => typeof value === 'number' && Number.isFinite(value);
  const finiteValues = values => Array.isArray(values) ? values.filter(validNumber).slice().sort((a, b) => a - b) : [];

  function parseHex(color) {
    if (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
      throw new TypeError('Colors must be 3- or 6-digit hex strings.');
    }
    const hex = color.length === 4 ? [...color.slice(1)].map(char => char + char).join('') : color.slice(1);
    return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }
  const linearize = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const delinearize = value => {
    const bounded = Math.max(0, Math.min(1, value));
    return bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055;
  };
  function toOklab(color) {
    const [r, g, b] = parseHex(color).map(linearize);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }
  function fromOklab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
    return '#' + rgb.map(value => Math.round(delinearize(value) * 255).toString(16).padStart(2, '0')).join('');
  }
  function interpolatePair(start, end, position) {
    const t = Math.max(0, Math.min(1, position));
    const first = toOklab(start), last = toOklab(end);
    return fromOklab(first.map((value, index) => value + (last[index] - value) * t));
  }
  function interpolateColor(position, colors = DEFAULT_COLORS) {
    if (!validNumber(position)) throw new TypeError('Interpolation position must be a finite number.');
    if (!Array.isArray(colors) || colors.length < 2) throw new TypeError('A color ramp needs at least two colors.');
    const t = Math.max(0, Math.min(1, position));
    const segment = t * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(segment));
    return interpolatePair(colors[index], colors[index + 1], t === 1 ? 1 : segment - index);
  }

  function normalizeMode(mode) {
    if (!VALID_MODES.has(mode)) throw new RangeError(`Unsupported scale mode: ${mode}`);
    return mode;
  }
  function normalizeDomain(domain, mode) {
    if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(validNumber) || domain[0] > domain[1]) {
      throw new TypeError('Scale domain must be an ordered pair of finite numbers.');
    }
    if (mode === 'log' && domain[0] <= 0) throw new RangeError('Log scale domains must be positive.');
    return domain.slice();
  }
  function getScaleDomain(values = [], options = {}) {
    const mode = normalizeMode(options.mode || 'linear');
    const scope = options.scope || 'national';
    if (scope !== 'national' && scope !== 'local') throw new RangeError('Scale scope must be national or local.');
    const explicit = options.domain || options.nationalDomain;
    if (scope === 'national') return normalizeDomain(explicit || DEFAULT_NATIONAL_DOMAIN, mode);
    if (explicit) return normalizeDomain(explicit, mode);
    let observations = finiteValues(values);
    if (mode === 'log') observations = observations.filter(value => value > 0);
    if (!observations.length) throw new RangeError(`Local ${mode} scale needs finite${mode === 'log' ? ' positive' : ''} observations.`);
    return [observations[0], observations[observations.length - 1]];
  }
  function percentileAt(value, observations) {
    if (observations.length === 1) return 0.5;
    let low = 0, high = observations.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (observations[middle] < value) low = middle + 1;
      else high = middle;
    }
    const first = low;
    low = first; high = observations.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (observations[middle] <= value) low = middle + 1;
      else high = middle;
    }
    const after = low;
    if (after > first) return ((first + after - 1) / 2) / (observations.length - 1);
    const lower = first - 1, upper = first;
    if (lower < 0) return 0;
    if (upper >= observations.length) return 1;
    const fraction = (value - observations[lower]) / (observations[upper] - observations[lower]);
    return (lower + fraction) / (observations.length - 1);
  }
  function quantileValueAt(position, observations) {
    if (observations.length === 1) return observations[0];
    const rank = Math.max(0, Math.min(1, position)) * (observations.length - 1);
    const lower = Math.floor(rank), upper = Math.ceil(rank);
    return observations[lower] + (observations[upper] - observations[lower]) * (rank - lower);
  }
  function createColorScale(options = {}) {
    const mode = normalizeMode(options.mode || 'linear');
    const scope = options.scope || 'national';
    const values = finiteValues(options.values);
    const domain = getScaleDomain(values, { ...options, mode, scope });
    const colors = options.colors || DEFAULT_COLORS;
    if (!Array.isArray(colors) || colors.length < 2) throw new TypeError('A color ramp needs at least two colors.');
    colors.forEach(parseHex);
    if ((mode === 'percentile' || mode === 'quantile') && !values.length) {
      throw new RangeError(`${mode} scale needs finite observations to rank.`);
    }
    const metadata = Object.freeze({
      scope,
      mode,
      label: scope === 'national' ? 'National scale (fixed)' : 'Local scale (varies by selection)',
      domain: Object.freeze(domain.slice())
    });
    return Object.freeze({ domain: metadata.domain, mode, scope, values: Object.freeze(values), colors: Object.freeze(colors.slice()), metadata });
  }
  function colorForValue(value, scale) {
    if (!validNumber(value) || !scale || !Array.isArray(scale.domain)) return MISSING_COLOR;
    const [min, max] = scale.domain;
    let position;
    if (scale.mode === 'percentile' || scale.mode === 'quantile') position = percentileAt(value, scale.values);
    else if (min === max) position = 0.5;
    else if (scale.mode === 'log') position = (Math.log(Math.max(value, min)) - Math.log(min)) / (Math.log(max) - Math.log(min));
    else position = (value - min) / (max - min);
    return interpolateColor(position, scale.colors);
  }
  function formatNumber(value) {
    return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
  }
  function legendLabels(scale, count = 5, options = {}) {
    if (!scale || !Array.isArray(scale.domain)) throw new TypeError('A color scale is required.');
    if (!Number.isInteger(count) || count < 2) throw new RangeError('Legend label count must be an integer of at least two.');
    const unit = options.unit === undefined ? '' : String(options.unit);
    const [min, max] = scale.domain;
    return Array.from({ length: count }, (_, index) => {
      const position = index / (count - 1);
      const ranked = scale.mode === 'percentile' || scale.mode === 'quantile';
      const value = ranked
        ? quantileValueAt(position, scale.values)
        : scale.mode === 'log' && min !== max
          ? Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * position)
          : min + (max - min) * position;
      const label = ranked
        ? `${Math.round(position * 100)}th percentile`
        : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
      return { value, label };
    });
  }

  return Object.freeze({
    DEFAULT_COLORS,
    DEFAULT_NATIONAL_DOMAIN,
    MISSING_COLOR,
    interpolateColor,
    getScaleDomain,
    createColorScale,
    colorForValue,
    legendLabels
  });
});
