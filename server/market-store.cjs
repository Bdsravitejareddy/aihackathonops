'use strict';

const { createHash } = require('node:crypto');

function decode(row) {
  if (!row) return null;
  return { id: row.id, workspaceId: row.workspace_id, version: row.version, snapshot: row.snapshot };
}

function createMarketStore(pool) {
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async seedCatalog(sources, benchmarks) {
      return transaction(async client => {
        const sourceVersions = new Map();
        for (const source of sources.sources || []) {
          sourceVersions.set(source.id, sources.version);
          await client.query(
            'INSERT INTO market_source_versions (id, version, manifest) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id, version) DO NOTHING',
            [source.id, sources.version, JSON.stringify(source)]
          );
        }
        let inserted = 0;
        for (const observation of benchmarks.observations || []) {
          const sourceVersion = sourceVersions.get(observation.sourceId);
          if (!sourceVersion) continue;
          const observationKey = createHash('sha256').update(JSON.stringify({ benchmarkVersion: benchmarks.version, sourceVersion, observation })).digest('hex');
          const provenance = { ...observation, benchmarkCatalogVersion: benchmarks.version };
          const result = await client.query(
            'INSERT INTO market_observations (observation_key, source_id, source_version, metric, value, unit, reference_period, evidence_class, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) ON CONFLICT (observation_key) DO NOTHING RETURNING id',
            [observationKey, observation.sourceId, sourceVersion, observation.metric, observation.value, observation.unit, observation.referencePeriod || null, observation.evidenceClass, JSON.stringify(provenance)]
          );
          inserted += result.rows.length;
        }
        return { sourceVersions: sourceVersions.size, observationsInserted: inserted };
      });
    },

    async listSources() {
      const result = await pool.query('SELECT id, version, manifest FROM market_source_versions ORDER BY version, id');
      const versions = [...new Set(result.rows.map(row => row.version))];
      return { version: versions.at(-1) || null, versions, sources: result.rows.map(row => ({ ...row.manifest, version: row.version })) };
    },

    async listBenchmarks() {
      const result = await pool.query('SELECT provenance FROM market_observations ORDER BY source_id, metric, reference_period, observation_key');
      const observations = result.rows.map(row => row.provenance);
      const versions = [...new Set(observations.map(item => item.benchmarkCatalogVersion).filter(Boolean))];
      return { version: versions.at(-1) || null, versions, observations };
    },

    async listAssessments(workspaceId) {
      const result = await pool.query(
        'SELECT id, workspace_id, version, snapshot FROM market_assessments WHERE workspace_id = $1 ORDER BY updated_at DESC, id',
        [workspaceId]
      );
      return result.rows.map(decode);
    },

    async getAssessment(workspaceId, id) {
      const result = await pool.query(
        'SELECT id, workspace_id, version, snapshot FROM market_assessments WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id]
      );
      return decode(result.rows[0]);
    },

    async saveAssessment(workspaceId, id, expectedVersion, snapshot) {
      return transaction(async client => {
        const result = expectedVersion === 0
          ? await client.query(
            'INSERT INTO market_assessments (id, workspace_id, version, snapshot) VALUES ($1, $2, 1, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING version',
            [id, workspaceId, JSON.stringify(snapshot)]
          )
          : await client.query(
            'UPDATE market_assessments SET version = version + 1, snapshot = $4::jsonb, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND version = $3 RETURNING version',
            [workspaceId, id, expectedVersion, JSON.stringify(snapshot)]
          );
        if (!result.rows.length) throw Object.assign(new Error('Market assessment version conflict'), { status: 409 });
        const version = result.rows[0].version;
        await client.query(
          'INSERT INTO market_assessment_versions (assessment_id, version, snapshot) VALUES ($1, $2, $3::jsonb)',
          [id, version, JSON.stringify(snapshot)]
        );
        return version;
      });
    },

    async listCompetitors(workspaceId, assessmentId) {
      const result = await pool.query(
        'SELECT c.id, c.record FROM market_competitors c JOIN market_assessments a ON a.id = c.assessment_id WHERE a.workspace_id = $1 AND a.id = $2 ORDER BY c.created_at, c.id',
        [workspaceId, assessmentId]
      );
      return result.rows.map(row => ({ id: row.id, ...row.record }));
    },

    async replaceCompetitors(workspaceId, assessmentId, competitors) {
      return transaction(async client => {
        await client.query(
          'DELETE FROM market_competitors WHERE assessment_id = (SELECT id FROM market_assessments WHERE workspace_id = $1 AND id = $2)',
          [workspaceId, assessmentId]
        );
        for (const competitor of competitors) {
          await client.query(
            'INSERT INTO market_competitors (assessment_id, name, record) SELECT id, $3, $4::jsonb FROM market_assessments WHERE workspace_id = $1 AND id = $2',
            [workspaceId, assessmentId, competitor.name || null, JSON.stringify(competitor)]
          );
        }
        return competitors;
      });
    }
  };
}

module.exports = { createMarketStore };
