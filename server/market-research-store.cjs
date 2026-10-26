'use strict';

const { createHash } = require('node:crypto');

const contextHash = context => createHash('sha256').update(JSON.stringify(context)).digest('hex');

function createMarketResearchStore(pool) {
  return {
    async getCached({ geographyId, segment, assessmentKey, modelVersion, contextHash: hash, recordType = 'cards', promptHash = '', maxAgeHours = 24 }) {
      const result = await pool.query(`SELECT r.id, r.result, r.retrieved_at, r.model_version, r.assessment_version,
        COALESCE(jsonb_agg(jsonb_build_object('url',e.url,'title',e.title,'publicationDate',e.publication_date,'retrievedAt',e.retrieved_at)) FILTER (WHERE e.url IS NOT NULL),'[]'::jsonb) AS citations
        FROM market_research_records r LEFT JOIN market_research_evidence e ON e.research_id=r.id
        WHERE r.geography_external_id=$1 AND r.apparel_segment=$2 AND r.assessment_key=$3 AND r.model_version=$4 AND r.context_hash=$5
          AND r.record_type=$6 AND r.prompt_hash=$7 AND r.stale=FALSE AND r.retrieved_at > now() - ($8::text || ' hours')::interval
        GROUP BY r.id LIMIT 1`, [geographyId, segment, assessmentKey, modelVersion, hash, recordType, promptHash, maxAgeHours]);
      const row = result.rows[0];
      return row ? { id:row.id, result:row.result, citations:row.citations || [], retrievedAt:row.retrieved_at, modelVersion:row.model_version, assessmentVersion:row.assessment_version } : null;
    },

    async save({ geographyId, segment, assessmentId = null, assessmentVersion = null, assessmentKey = 'none', modelVersion, contextHash: hash, recordType, promptHash = '', result, citations = [] }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE market_research_records SET stale=TRUE WHERE geography_external_id=$1 AND apparel_segment=$2 AND record_type=$3 AND context_hash<>$4 AND stale=FALSE`, [geographyId, segment, recordType, hash]);
        const row = await client.query(`INSERT INTO market_research_records
          (geography_id,geography_external_id,apparel_segment,assessment_id,assessment_version,assessment_key,model_version,context_hash,record_type,prompt_hash,result,retrieved_at,stale)
          SELECT g.id,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),FALSE FROM market_geographies g WHERE g.external_id=$1
          RETURNING id,retrieved_at`, [geographyId, segment, assessmentId, assessmentVersion, assessmentKey, modelVersion, hash, recordType, promptHash, JSON.stringify(result)]);
        if (!row.rows.length) throw new Error('Research geography does not exist');
        for (const citation of citations) {
          if (!citation || !/^https?:\/\//i.test(citation.url || '')) continue;
          await client.query(`INSERT INTO market_research_evidence (research_id,url,title,publication_date,retrieved_at)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (research_id,url) DO NOTHING`, [row.rows[0].id, citation.url, citation.title || null, citation.publicationDate || null, citation.retrievedAt || row.rows[0].retrieved_at]);
        }
        await client.query('COMMIT');
        return { id:row.rows[0].id, retrievedAt:row.rows[0].retrieved_at };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },

    async markStale({ geographyId, segment }) {
      const result = await pool.query(`UPDATE market_research_records SET stale=TRUE WHERE geography_external_id=$1 AND apparel_segment=$2 AND stale=FALSE RETURNING id`, [geographyId, segment]);
      return result.rowCount;
    }
  };
}

module.exports = { createMarketResearchStore, contextHash };
