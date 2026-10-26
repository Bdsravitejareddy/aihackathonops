'use strict';
(function (root) {
  const STORAGE_KEY = 'franchiseos-currency-display';
  let mode = 'millions';
  try { if (root.localStorage?.getItem(STORAGE_KEY) === 'crores') mode = 'crores'; } catch { /* Preference storage is optional. */ }
  const number = (value, digits) => Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  function setMode(value) {
    if (!['millions', 'crores'].includes(value) || value === mode) return mode;
    mode = value;
    try { root.localStorage?.setItem(STORAGE_KEY, mode); } catch { /* Keep the current session preference in memory. */ }
    if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('franchiseos:currency-display-changed', { detail: { mode } }));
    return mode;
  }
  function money(value, unit = '') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
    const scale = Math.abs(value) >= 1_000_000 ? mode === 'crores' ? 10_000_000 : 1_000_000 : 1;
    const suffix = String(unit || '').replace(/^\s*(?:INR|₹)/i, '').trim();
    const magnitude = scale === 1 ? '' : mode === 'crores' ? ' Cr' : 'M';
    const digits = scale === 1 ? 2 : mode === 'crores' ? 2 : 1;
    return `₹${number(value / scale, digits)}${magnitude}${suffix ? ` ${suffix}` : ''}`;
  }
  function count(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  function toggleLabel() { return mode === 'millions' ? '₹ Millions' : '₹ Crores'; }
  const api = { getMode: () => mode, setMode, money, count, toggleLabel };
  root.FranchiseDisplay = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
