'use strict';

function validateWorkspacePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  if (!Array.isArray(value.apps) || !Array.isArray(value.territories)) return { ok: false };
  if (value.settings !== undefined && (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))) return { ok: false };
  if (value.audit !== undefined && !Array.isArray(value.audit)) return { ok: false };
  if (value.messages !== undefined && !Array.isArray(value.messages)) return { ok: false };
  return { ok: true };
}

module.exports = { validateWorkspacePayload };
