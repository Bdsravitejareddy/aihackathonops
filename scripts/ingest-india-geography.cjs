'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateRepository, validateManifest, validateFeatures, resolveArtifact } = require('./validate-india-geography.cjs');

function ingest({ rootDir = path.resolve(__dirname,'..'), outputDir = path.join(rootDir,'data/india-geography/ingested') } = {}) {
  const manifestPath = path.join(rootDir,'data/india-geography/manifest.json');
  const bytes = fs.readFileSync(manifestPath), manifest = JSON.parse(bytes.toString('utf8'));
  validateManifest(manifest);
  const repository = validateRepository({ rootDir });
  const geographies = [...(manifest.geographies || [])], relationships = [...(manifest.relationships || [])];
  const datasets = manifest.datasets.map(dataset => {
    if (dataset.status !== 'available') return { id:dataset.id, status:'unavailable', coverage:dataset.coverage, knownGaps:dataset.knownGaps };
    if (dataset.ingest === 'seed-script') return { id:dataset.id, status:'available', ingest:'seed-script', artifact:dataset.artifact, sha256:dataset.sha256, coverage:dataset.coverage };
    const artifactPath = resolveArtifact(rootDir,dataset.artifact), artifactBytes=fs.readFileSync(artifactPath);
    if (dataset.sha256 && crypto.createHash('sha256').update(artifactBytes).digest('hex') !== dataset.sha256) throw new Error(`Checksum mismatch for ${dataset.id}`);
    const collection=JSON.parse(artifactBytes.toString('utf8'));
    validateFeatures(collection,{level:dataset.featureLevel || dataset.level,expectedCount:dataset.coverage.featureCount,expectedPopulationTotal:dataset.coverage.populationTotal});
    for(const feature of collection.features){
      const properties=feature.properties || {}, kind=properties.level || dataset.featureLevel || dataset.level;
      const externalId=String(feature.id ?? properties.code ?? properties.id ?? '');
      if(!externalId || !properties.name || !kind) throw new Error(`Feature in ${dataset.id} must have code, name and level`);
      const evidence={sourceId:dataset.sourceId,title:dataset.title,publisher:dataset.publisher,url:dataset.sourceUrl,downloadUrl:dataset.downloadUrl,referenceYear:dataset.sourceVintage,geographicResolution:kind,evidenceClass:properties.evidenceClass || 'official_observed',uncertainty:properties.uncertainty || 'source-dependent'};
      const geoProperties={...properties,sourceCode:properties.sourceCode || properties.code || externalId,evidence:[...(properties.evidence || []),evidence]};
      geographies.push({kind,externalId,name:properties.name,geometry:feature.geometry,properties:geoProperties});
      if(properties.parentId && properties.parentLevel) relationships.push({parentKind:properties.parentLevel,parentId:String(properties.parentId),childKind:kind,childId:externalId,relationship:'contains',properties:{sourceId:dataset.sourceId,method:properties.mappingMethod || 'source-coded hierarchy'}});
    }
    return { id:dataset.id,status:'available',artifact:dataset.artifact,sha256:crypto.createHash('sha256').update(artifactBytes).digest('hex'),coverage:dataset.coverage };
  });
  const ids=new Set();
  for(const geo of geographies){const key=`${geo.kind}:${geo.externalId}`;if(ids.has(key))throw new Error(`Duplicate geography in ingest: ${key}`);ids.add(key);}
  for(const relation of relationships)if(!ids.has(`${relation.parentKind}:${relation.parentId}`)||!ids.has(`${relation.childKind}:${relation.childId}`))throw new Error('Ingest relationship refers to a missing geography');
  const snapshot = { schemaVersion:1, manifestVersion:manifest.version, manifestSha256:crypto.createHash('sha256').update(bytes).digest('hex'), coverage:{...repository.coverage,features:geographies.length,relationships:relationships.length},
    geographies, relationships, datasets, generatedAt:manifest.retrievedAt };
  fs.mkdirSync(outputDir,{recursive:true});
  const outputPath=path.join(outputDir,`india-geography-snapshot-${manifest.version}.json`), serialized=JSON.stringify(snapshot,null,2)+'\n';
  if (fs.existsSync(outputPath)) {
    if (fs.readFileSync(outputPath,'utf8') !== serialized) throw new Error('Existing geography snapshot differs; immutable output will not be overwritten');
    return { path:outputPath,coverage:snapshot.coverage,idempotent:true };
  }
  fs.writeFileSync(outputPath,serialized,{flag:'wx'});
  return { path:outputPath,coverage:snapshot.coverage,geographies:snapshot.geographies,relationships:snapshot.relationships,idempotent:false };
}
if (require.main === module) {
  try { const result=ingest(); process.stdout.write(`${JSON.stringify({path:result.path,coverage:result.coverage,idempotent:result.idempotent})}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
module.exports={ingest};
