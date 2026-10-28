import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvaluationTable} from '../evaluation-table.mjs';

function fixture() {
 const counts={n_samples:234,n_excluded:6,n_context:0,excluded_by_reason:{missing:0,origin_before_cutoff:6}};
 const r={basin_id:'synthetic-b',period_start:'2024-01-21T00:00:00+00:00',period_end:'2024-01-31T00:00:00+00:00',horizon_h:6,nse:-0.02,rmse:1.4,nse_reason:null,...counts,baselines:{persistence:{method:'origin_observation',horizon_h:6,nse:0.7,rmse:0.75,nse_reason:null,...structuredClone(counts)}}};
 return {results:{dataset_version:'saved-test-fixture',implementation:{source_commit:'saved-sha'},public_release_blockers:['unconfirmed'],results:[r]},series:{[r.basin_id]:[{accepted:true,observed:99,prediction:999}]}};
}
test('preserves saved synthetic metrics and full evaluation conditions without computing from rows',()=>{
 const out=buildEvaluationTable(fixture()), b=out.basins[0];
 assert.equal(out.datasetVersion,'saved-test-fixture');assert.equal(out.synthetic,false);
 assert.deepEqual(out.implementation,{source_commit:'saved-sha'});assert.deepEqual(out.publicReleaseBlockers,['unconfirmed']);
 assert.equal(b.basinId,'synthetic-b');assert.equal(b.horizonH,6);assert.equal(b.unit,'m³/s');
 assert.equal(b.periodStart,'2024-01-21T00:00:00+00:00');assert.equal(b.periodEnd,'2024-01-31T00:00:00+00:00');
 assert.deepEqual(b.comparable.map(r=>[r.id,r.nse,r.rmse,r.nSamples,r.nExcluded]),[['model',-0.02,1.4,234,6],['persistence',0.7,0.75,234,6]]);
 assert.deepEqual(b.comparable[1].excludedByReason,{missing:0,origin_before_cutoff:6});assert.match(b.sameRowsEvidence,/評価に採用した時刻が同一/);assert.equal(b.comparable[0].label,'6時間先予測');
});
test('additional descriptors never inherit metrics or denominators even with equal units',()=>{
 const bundle=fixture();bundle.results.results[0].extensions={series:[{id:'z',label:'same',unit:'m³/s',evaluation_conditions:'unknown',values:[1]},{id:'a',label:'other',unit:'mm',evaluation_conditions:'other condition',source:'saved source',values:[2]}]};
 const b=buildEvaluationTable(bundle).basins[0];
 assert.deepEqual(b.nonComparable.map(r=>r.id),['a','z']);
 for(const r of b.nonComparable){assert.equal(r.status,'not_comparable');assert.equal(r.nse,null);assert.equal(r.rmse,null);assert.equal(r.nSamples,null);assert.equal(r.nExcluded,null);assert.match(r.reason,/採用/);assert.equal('values' in r,false);}
 assert.equal(b.nonComparable[0].source,'saved source');assert.equal(b.nonComparable[0].evaluationConditions,'other condition');
});
test('basin order is ID order; synthetic is explicit and input/output metadata are independent',()=>{
 const b=fixture();b.results.extensions={synthetic:true};b.results.results.push({...structuredClone(b.results.results[0]),basin_id:'001'});
 const before=structuredClone(b), out=buildEvaluationTable(b);assert.equal(out.synthetic,true);assert.deepEqual(out.basins.map(r=>r.basinId),['001','synthetic-b']);assert.deepEqual(b,before);
 out.basins[0].comparable[0].excludedByReason.missing=9;out.implementation.source_commit='changed';assert.deepEqual(b,before);
});
test('undefined NSE reason is preserved and viewing-only rows cannot change saved table',()=>{
 const b=fixture();b.results.results[0].nse=null;b.results.results[0].nse_reason='constant_target';
 const before=buildEvaluationTable(b);b.series={};const after=buildEvaluationTable(b);assert.deepEqual(after,before);assert.equal(after.basins[0].comparable[0].nse,null);assert.equal(after.basins[0].comparable[0].nseReason,'constant_target');
});
test('includes source path, names, package versions and per-result synthetic identity',()=>{
 const b=fixture();Object.assign(b.results,{schema_version:'0.3',library_version:'0.1.0a2',data_library_version:'0.1.0a2'});
 b.basins={features:[{properties:{basin_id:'synthetic-b',name:'合成流域B'}}]};
 Object.assign(b.results.results[0],{prediction_path:'predictions/saved.csv',extensions:{synthetic:true}});
 const out=buildEvaluationTable(b);assert.equal(out.schemaVersion,'0.3');assert.equal(out.libraryVersion,'0.1.0a2');assert.equal(out.dataLibraryVersion,'0.1.0a2');assert.equal(out.basins[0].basinName,'合成流域B');assert.equal(out.basins[0].synthetic,true);assert.equal(out.basins[0].predictionPath,'predictions/saved.csv');
});
