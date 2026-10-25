'use strict';

function createStore(pool) {
  return {
    async load(id) {
      const result = await pool.query('SELECT state, revision FROM workspaces WHERE id = $1', [id]);
      return result.rows[0] ? { state: result.rows[0].state, revision: result.rows[0].revision } : null;
    },
    async save(id, state, expectedRevision) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let result;
        if (expectedRevision === 0) {
          result = await client.query('INSERT INTO workspaces (id, state, revision, updated_at) VALUES ($1, $2::jsonb, 1, now()) ON CONFLICT (id) DO NOTHING RETURNING revision', [id, JSON.stringify(state)]);
        } else {
          result = await client.query('UPDATE workspaces SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $3 RETURNING revision', [id, JSON.stringify(state), expectedRevision]);
        }
        if (!result.rows.length) throw Object.assign(new Error('Workspace revision conflict'), { status: 409 });
        const revision = result.rows[0].revision;
        for (const table of ['applications', 'territories', 'workspace_settings', 'audit_events', 'bot_messages']) await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [id]);
        for (const [position, value] of state.apps.entries()) await client.query('INSERT INTO applications (workspace_id, position, record) VALUES ($1, $2, $3::jsonb)', [id, position, JSON.stringify(value)]);
        for (const [position, value] of state.territories.entries()) await client.query('INSERT INTO territories (workspace_id, position, record) VALUES ($1, $2, $3::jsonb)', [id, position, JSON.stringify(value)]);
        await client.query('INSERT INTO workspace_settings (workspace_id, settings) VALUES ($1, $2::jsonb)', [id, JSON.stringify(state.settings || {})]);
        for (const [position, value] of (state.audit || []).entries()) await client.query('INSERT INTO audit_events (workspace_id, position, event) VALUES ($1, $2, $3::jsonb)', [id, position, JSON.stringify(value)]);
        for (const [position, value] of (state.messages || []).entries()) await client.query('INSERT INTO bot_messages (workspace_id, position, message) VALUES ($1, $2, $3::jsonb)', [id, position, JSON.stringify(value)]);
        await client.query('COMMIT');
        return revision;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  };
}

module.exports = { createStore };
