(function (root) {
  'use strict';

  // Editable partner scoring: criterion weights (sliders totalling 100), hard filters, grade bands.
  // The engine is pure; this panel previews every edit against the saved applicants and saves only on request.

  const LABELS = { investment: 'Investment capacity', space: 'Premises', area: 'Space size', experience: 'Retail experience', business: 'Prior business', launch: 'Launch timing' };
  const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  function mount({ container, engine, settings, evaluate, changes: savedChanges = null, onSave = () => {}, onReset = () => {} }) {
    const scoreKeys = engine.scoreKeys;
    const saved = engine.resolvePolicy(settings);
    let draft = JSON.parse(JSON.stringify({ ...saved, weights: saved.weights, grades: saved.grades }));
    let baseline = evaluate(saved);
    let destroyed = false;

    const candidate = () => ({ ...settings, model: 'industry-v2', minInvestment: draft.minInvestment, minArea: draft.minArea, minLaunch: draft.minLaunch, targetLaunch: draft.targetLaunch,
      weights: { ...draft.weights }, grades: { ...draft.grades }, allowedTiers: [...draft.allowedTiers], pinPrefixes: engine.parsePrefixes(draft.pinPrefixes) });
    const dirty = () => JSON.stringify(engine.resolvePolicy(candidate())) !== JSON.stringify(saved);
    const shortName = a => `${a.id} ${a.name ? '· ' + a.name : ''}`.trim();

    function changesHTML() {
      const errors = engine.policyErrors(candidate());
      if (errors.length) return `<div class="info-row warning" role="alert">${errors.map(esc).join('<br>')}</div>`;
      if (!dirty()) return savedChanges ? summaryHTML(savedChanges, 'Saved.') : '<p class="hint">No unsaved changes. Edit a weight, filter or grade band to see which applicants move.</p>';
      const changes = engine.compareResults(baseline, evaluate(candidate()));
      return changes.length ? summaryHTML(changes, 'Unsaved preview.') : '<div class="sector-changes" role="status"><strong>Unsaved preview: no applicant changes status, grade or score.</strong></div>';
    }
    function summaryHTML(changes, prefix) {
      if (!changes.length) return `<div class="sector-changes" role="status"><strong>${esc(prefix)} No applicant changes status, grade or score.</strong></div>`;
      const statusCount = changes.filter(c => c.status[0] !== c.status[1]).length, gradeCount = changes.filter(c => c.grade[0] !== c.grade[1]).length;
      // Status changes come first: they decide what happens to an applicant; grade and score-only moves follow.
      const rank = c => c.status[0] !== c.status[1] ? 0 : c.grade[0] !== c.grade[1] ? 1 : 2;
      const rows = [...changes].sort((x, y) => rank(x) - rank(y)).slice(0, 12).map(c => {
        const parts = [];
        if (c.status[0] !== c.status[1]) parts.push(`${esc(c.status[0])} → <strong>${esc(c.status[1])}</strong>`);
        if (c.grade[0] !== c.grade[1]) parts.push(`grade ${esc(c.grade[0] ?? '—')} → <strong>${esc(c.grade[1] ?? '—')}</strong>`);
        if (!parts.length) parts.push(`score ${esc(c.score[0])} → ${esc(c.score[1])}`);
        return `<li><strong>${esc(c.id)}</strong>${c.name ? ' ' + esc(c.name) : ''}: ${parts.join('; ')}</li>`;
      }).join('');
      return `<div class="sector-changes" role="status"><strong>${esc(prefix)} ${statusCount} change${statusCount === 1 ? '' : 's'} status · ${gradeCount} change${gradeCount === 1 ? '' : 's'} grade</strong>
        <ul>${rows}</ul>${changes.length > 12 ? `<p class="hint">…and ${changes.length - 12} more.</p>` : ''}</div>`;
    }

    function weightRow(key) {
      return `<label class="sector-weight"><span>${esc(LABELS[key])}</span><input type="range" min="0" max="100" step="1" value="${draft.weights[key]}" data-sp-weight="${key}" aria-label="${esc(LABELS[key])} weight"><strong data-sp-weight-value="${key}">${draft.weights[key]}%</strong></label>`;
    }
    function totalTag() {
      const total = scoreKeys.reduce((t, k) => t + draft.weights[k], 0);
      return `<span class="tag ${total === 100 ? 'green' : 'red'}" data-sp-total>${total}%</span>`;
    }

    function render() {
      if (destroyed) return;
      const tiers = TIERS.map(t => `<label class="sector-hces-item ${draft.allowedTiers.includes(t) ? 'is-on' : ''}"><input type="checkbox" data-sp-tier="${esc(t)}" ${draft.allowedTiers.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('');
      container.innerHTML = `<section class="panel scoring-policy"><div class="panel-top"><div><h2>Scoring logic</h2><div class="panel-subtitle">Weights, hard filters and grade bands for partner screening. Edits preview live; nothing changes until you save.</div></div>
          <div class="actions"><button class="button" data-sp-reset>Reset to default</button><button class="button primary" data-sp-save disabled>Save scoring logic</button></div></div>
        <div class="panel-body">
          <h3>Criterion weights ${totalTag()}</h3>
          <div class="sector-weights" data-sp-sliders>${scoreKeys.map(weightRow).join('')}</div>
          <p class="hint">Each criterion's points are scaled to its weight. Moving one slider spreads the difference over the others; the total stays 100%.</p>
          <h3>Hard filters</h3>
          <div class="form-grid">
            <label>Required investment (₹ lakh)<input class="input" type="number" min="0.01" step="any" data-sp-field="minInvestment" value="${esc(draft.minInvestment)}"></label>
            <label>Minimum space (sq ft)<input class="input" type="number" min="1" step="any" data-sp-field="minArea" value="${esc(draft.minArea)}"></label>
            <label>Minimum feasible launch (months)<input class="input" type="number" min="0.1" step="any" data-sp-field="minLaunch" value="${esc(draft.minLaunch)}"></label>
            <label>Target latest launch (months)<input class="input" type="number" min="0.1" step="any" data-sp-field="targetLaunch" value="${esc(draft.targetLaunch)}"></label>
            <label class="full">PIN prefixes accepted (comma-separated; blank accepts all)<input class="input" data-sp-field="pinPrefixes" value="${esc(engine.parsePrefixes(draft.pinPrefixes).join(', '))}" placeholder="e.g. 560, 572"></label>
          </div>
          <h3>Allowed city tiers</h3>
          <div class="sector-hces">${tiers}</div>
          <h3>Grade bands</h3>
          <div class="form-grid">
            <label>A from score<input class="input" type="number" min="0" max="100" step="any" data-sp-grade="A" value="${esc(draft.grades.A)}"></label>
            <label>B from score<input class="input" type="number" min="0" max="100" step="any" data-sp-grade="B" value="${esc(draft.grades.B)}"></label>
            <label>C from score<input class="input" type="number" min="0" max="100" step="any" data-sp-grade="C" value="${esc(draft.grades.C)}"></label>
          </div>
          <p class="hint">Below C is D. U means a weighted criterion has no data yet; a zero weight never makes a grade U.</p>
          <div data-sp-preview aria-live="polite">${changesHTML()}</div>
        </div></section>`;
      refreshSave();
    }

    function refreshPreview() {
      const box = container.querySelector('[data-sp-preview]');
      if (box) box.innerHTML = changesHTML();
      refreshSave();
    }
    function refreshSave() {
      const button = container.querySelector('[data-sp-save]');
      if (button) button.disabled = !dirty() || engine.policyErrors(candidate()).length > 0;
    }
    function refreshSliders() {
      for (const key of scoreKeys) {
        const slider = container.querySelector(`[data-sp-weight="${key}"]`);
        if (slider && Number(slider.value) !== draft.weights[key]) slider.value = draft.weights[key];
        const label = container.querySelector(`[data-sp-weight-value="${key}"]`);
        if (label) label.textContent = `${draft.weights[key]}%`;
      }
      const total = container.querySelector('[data-sp-total]');
      if (total) { const sum = scoreKeys.reduce((t, k) => t + draft.weights[k], 0); total.textContent = `${sum}%`; total.className = `tag ${sum === 100 ? 'green' : 'red'}`; }
    }

    function onInput(event) {
      const el = event.target;
      if (el.dataset.spWeight) {
        draft.weights = engine.rebalanceWeights(draft.weights, el.dataset.spWeight, Number(el.value));
        refreshSliders(); refreshPreview();
      }
    }
    function onChange(event) {
      const el = event.target;
      if (el.dataset.spField) {
        const field = el.dataset.spField;
        draft[field] = field === 'pinPrefixes' ? el.value : (el.value.trim() === '' ? '' : Number(el.value));
        refreshPreview();
      } else if (el.dataset.spGrade) {
        draft.grades[el.dataset.spGrade] = el.value.trim() === '' ? '' : Number(el.value);
        refreshPreview();
      } else if (el.dataset.spTier) {
        draft.allowedTiers = el.checked ? [...new Set([...draft.allowedTiers, el.dataset.spTier])] : draft.allowedTiers.filter(t => t !== el.dataset.spTier);
        el.closest('label')?.classList.toggle('is-on', el.checked);
        refreshPreview();
      }
    }
    function onClick(event) {
      const el = event.target.closest('button');
      if (!el || !container.contains(el)) return;
      if ('spSave' in el.dataset) {
        const next = candidate();
        const errors = engine.policyErrors(next);
        if (errors.length) return;
        const before = baseline;
        onSave(next, engine.compareResults(before, evaluate(next)));
      } else if ('spReset' in el.dataset) {
        if (root.confirm && !root.confirm('Reset scoring logic to the built-in default? Weights, filters and grade bands return to the apparel defaults.')) return;
        onReset();
      }
    }

    container.addEventListener('input', onInput);
    container.addEventListener('change', onChange);
    container.addEventListener('click', onClick);
    render();
    return {
      destroy() {
        destroyed = true;
        container.removeEventListener('input', onInput); container.removeEventListener('change', onChange); container.removeEventListener('click', onClick);
      },
      // Called by the host after a save or reset so the baseline reflects what is now stored.
      rebase(next) { draft = JSON.parse(JSON.stringify(engine.resolvePolicy(next))); baseline = evaluate(next); render(); }
    };
  }

  const api = { mount };
  if (typeof module !== 'undefined') module.exports = api;
  root.ScoringPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
