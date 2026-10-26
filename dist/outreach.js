'use strict';
// Outreach pipeline for applicants the team has contacted. Stages are set by the team; "Disengaged" is also applied
// automatically when a reached-out applicant has had no recorded activity for DISENGAGE_DAYS. Pure: callers pass `now`.
(function (root) {
  const STAGES = ['Reach out', 'Disengaged', 'Failed', 'Won'];
  const DISENGAGE_DAYS = 5;
  const DAY = 864e5;

  function daysSince(iso, now) {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY)) : null;
  }

  /** The stage to show: a reached-out record with no activity for DISENGAGE_DAYS reads as Disengaged (auto). */
  function effectiveStage(record, now = Date.now()) {
    if (!record || !STAGES.includes(record.stage)) return null;
    const idle = daysSince(record.lastActivity, now);
    if (record.stage === 'Reach out' && idle !== null && idle >= DISENGAGE_DAYS) return { stage: 'Disengaged', auto: true, idleDays: idle };
    return { stage: record.stage, auto: false, idleDays: idle };
  }

  /** Moves the given applications to a stage; every move counts as activity. Returns a new outreach map. */
  function setStage(outreach = {}, keys = [], stage, now = Date.now()) {
    if (!STAGES.includes(stage)) throw new Error(`Unknown outreach stage: ${stage}`);
    const at = new Date(now).toISOString(), next = { ...outreach };
    for (const key of keys) {
      const previous = next[key] || { history: [] };
      next[key] = { stage, lastActivity: at, history: [...(previous.history || []), { stage, at }].slice(-50) };
    }
    return next;
  }

  /** Records a contact without changing the stage, which restarts the disengagement clock. */
  function logActivity(outreach = {}, key, note = 'Contacted', now = Date.now()) {
    const record = outreach[key];
    if (!record) return outreach;
    const at = new Date(now).toISOString();
    return { ...outreach, [key]: { ...record, stage: record.stage === 'Disengaged' ? 'Reach out' : record.stage, lastActivity: at, history: [...(record.history || []), { note: String(note).slice(0, 200), at }].slice(-50) } };
  }

  /** Removes outreach records for deleted applications. */
  function forget(outreach = {}, keys = []) {
    const next = { ...outreach };
    for (const key of keys) delete next[key];
    return next;
  }

  /** Applications grouped by effective stage, for the pipeline board. */
  function board(apps = [], outreach = {}, now = Date.now()) {
    const columns = Object.fromEntries(STAGES.map(stage => [stage, []]));
    for (const app of apps) {
      const view = effectiveStage(outreach[app.key], now);
      if (view) columns[view.stage].push({ app, ...view });
    }
    for (const stage of STAGES) columns[stage].sort((a, b) => (b.app.score ?? 0) - (a.app.score ?? 0));
    return columns;
  }

  const api = { STAGES, DISENGAGE_DAYS, effectiveStage, setStage, logActivity, forget, board, daysSince };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Outreach = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
