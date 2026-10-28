import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScene, resolveScene, serializeScene} from '../url-state.mjs';

function fixture() {
  const start=Date.parse('2024-01-01T00:00:00Z');
  const rows=Array.from({length:240},(_,i)=>({target_time:new Date(start+i*3600000).toISOString(),origin_time:new Date(start+(i-6)*3600000).toISOString(),partition:'test',accepted:i!==0,reason:i===0?'origin_before_cutoff':'accepted',q:i,observed:i,prediction:i===0?null:i+1,rain:i%7}));
  const result={basin_id:'a',horizon_h:6,period_start:rows[0].target_time,period_end:new Date(start+240*3600000).toISOString(),extensions:{series:[{id:'x'},{id:'with,comma'}]}};
  return {results:{dataset_version:'test-v1',results:[result,{...structuredClone(result),basin_id:'b',extensions:{series:[{id:'other'}]}}]},series:{a:rows,b:structuredClone(rows)}};
}

test('empty URL preserves current defaults without warnings',()=>{
 const {state,warnings,fallback}=resolveScene('',fixture());
 assert.deepEqual(state,{v:'1',dataset:'test-v1',basin:'a',h:6,view:'timeseries',period:'all',at:'2024-01-01T01:00:00.000Z',series:['x','with,comma'],observed:true,prediction:true,persistence:true});
 assert.deepEqual(warnings,[]);assert.equal(fallback,false);
});
test('canonical serialization round trips including comma-bearing IDs and empty selection',()=>{
 const b=fixture(), state=resolveScene('',b).state;
 state.series=['with,comma'];state.period='7';state.at='2024-01-05T00:00:00.000Z';state.persistence=false;
 const query=serializeScene(state);
 assert.deepEqual(resolveScene(query,b),{state,warnings:[],fallback:false});
 state.series=[];assert.deepEqual(resolveScene(serializeScene(state),b).state.series,[]);
 assert.deepEqual(resolveScene('?series=',b).state.series,[]);
});
test('timezone equivalent targets normalize UTC; target not origin controls inspection',()=>{
 const b=fixture();
 const query=new URLSearchParams({at:'2024-01-05T09:00:00+09:00'}).toString();
 assert.equal(resolveScene(query,b).state.at,'2024-01-05T00:00:00.000Z');
 assert.deepEqual(resolveScene(query,b).warnings,[]);
});
for(const query of ['?unexpected=1','?period=7&period=30','?v=2','?dataset=other','?basin=missing']) {
 test(`global fallback explicitly warns: ${query}`,()=>{
  const actual=resolveScene(query+'&projection=1',fixture()), expected=resolveScene('',fixture());
  assert.deepEqual(actual.state,expected.state);assert.equal(actual.fallback,true);assert.ok(actual.warnings.length);
 });
}
for(const [field,value] of [['h','12'],['h','06'],['period','365'],['persistence','true'],['projection','2'],['series','["missing"]'],['series','["x","x"]'],['series','null'],['series','[1]'],['series','x'],['at','2024-02-30T00:00:00Z'],['at','2024-01-05T00:00:00'],['at','2024-01-05T24:00:00Z'],['at','2024-01-05T00:60:00Z'],['at','2024-01-05T00:00:00+24:00'],['at','2024-01-05T00:30:00Z'],['at','2025-01-01T00:00:00Z']]) {
 test(`field fallback explicitly warns: ${field}=${value}`,()=>{
  const q=new URLSearchParams({[field]:value,basin:'b'}), actual=resolveScene(q.toString(),fixture());
  assert.equal(actual.state.basin,'b');assert.equal(actual.fallback,false);
  assert.ok(actual.warnings.some(w=>w.field===field));
 });
}
test('target must exist inside selected display window',()=>{
 const actual=resolveScene('?period=7&at=2024-01-01T01:00:00Z',fixture());
 assert.equal(actual.state.period,'7');assert.equal(actual.state.at,'2024-01-04T00:00:00.000Z');
 assert.ok(actual.warnings.some(w=>w.field==='at'));
});
test('basin switching resolves only selected basin series',()=>{
 const b=fixture(), actual=resolveScene('?basin=b&series=%5B%22x%22%5D',b);
 assert.deepEqual(actual.state.series,['other']);assert.ok(actual.warnings.some(w=>w.field==='series'));
});
test('unavailable observed-peak window falls back explicitly and never selects predictions',()=>{
 const b=fixture();for(const row of b.series.a) row.rain=null;
 const actual=resolveScene('?period=peak-rain',b);
 assert.equal(actual.state.period,'all');assert.ok(actual.warnings.some(w=>w.field==='period'));
});
test('parsing returns key/value map and rejects duplicate or unknown keys',()=>{
 assert.equal(parseScene('?basin=a').values.basin,'a');
 assert.equal(parseScene('?basin=a').fatal,false);
 assert.equal(parseScene('?basin=a&basin=b').fatal,true);
 assert.equal(parseScene('?unknown=1').fatal,true);
});
test('URL resolution leaves saved rows and scientific parameters unchanged',()=>{
 const b=fixture(), before=structuredClone(b);
 resolveScene('?period=7&projection=1&series=',b);
 resolveScene('?period=center&center=2024-01-05T00:00:00Z',b);
 assert.deepEqual(b,before);
});

test('calendar-invalid dates are rejected even when Date.parse normalization hits a saved row',()=>{
 const b=fixture(), shift=Date.parse('2024-03-01T00:00:00Z')-Date.parse('2024-01-01T00:00:00Z');
 for(const rows of Object.values(b.series)) for(const row of rows) {
  row.target_time=new Date(Date.parse(row.target_time)+shift).toISOString();
  row.origin_time=new Date(Date.parse(row.origin_time)+shift).toISOString();
 }
 for(const r of b.results.results) {r.period_start=b.series[r.basin_id][0].target_time;r.period_end='2024-03-11T00:00:00Z';}
 assert.equal(new Date('2024-02-30T00:00:00Z').toISOString(),b.series.a[0].target_time);
 assert.ok(resolveScene('?at=2024-02-30T00:00:00Z',b).warnings.some(w=>w.field==='at'));
 assert.deepEqual(resolveScene('?at=2024-03-01T00:00:00Z',b).warnings,[]);
});
test('negative timezone offsets resolve the same saved target',()=>{
 const b=fixture(), query=new URLSearchParams({at:'2024-01-04T19:00:00-05:00'});
 assert.equal(resolveScene(query.toString(),b).state.at,'2024-01-05T00:00:00.000Z');
 assert.deepEqual(resolveScene(query.toString(),b).warnings,[]);
});
test('half-open evaluation end is not a selectable target',()=>{
 assert.ok(resolveScene('?at=2024-01-11T00:00:00Z',fixture()).warnings.some(w=>w.field==='at'));
});

test('evaluation view round trips while old URLs and hand-built states default to timeseries',()=>{
 const bundle=fixture();
 const resolution=resolveScene('?view=evaluation&basin=b',bundle);
 assert.equal(resolution.state.view,'evaluation');assert.equal(resolution.state.basin,'b');assert.deepEqual(resolution.warnings,[]);
 assert.deepEqual(resolveScene(serializeScene(resolution.state),bundle),resolution);
 const old={...resolution.state};delete old.view;
 assert.equal(resolveScene(serializeScene(old),bundle).state.view,'timeseries');
 assert.equal(new URLSearchParams(serializeScene(old)).get('view'),'timeseries');
 assert.equal(resolveScene('?period=7',bundle).state.view,'timeseries');
});
test('bad view falls back individually and duplicate view resets the whole scene',()=>{
 const bundle=fixture(), bad=resolveScene('?view=other&basin=b',bundle);
 assert.equal(bad.state.view,'timeseries');assert.equal(bad.state.basin,'b');assert.equal(bad.fallback,false);assert.deepEqual(bad.warnings.map(w=>w.field),['view']);
 const duplicate=resolveScene('?view=timeseries&view=evaluation&basin=b',bundle);
 assert.equal(duplicate.fallback,true);assert.equal(duplicate.state.basin,'a');assert.equal(duplicate.state.view,'timeseries');
});

test('observed and prediction default on for old URLs and round trip independently',()=>{
 const b=fixture(),old=resolveScene('?persistence=0',b);
 assert.equal(old.state.observed,true);assert.equal(old.state.prediction,true);
 const state={...old.state,observed:false,prediction:false};assert.deepEqual(resolveScene(serializeScene(state),b).state,state);
 for(const field of ['observed','prediction']){
  const invalid=resolveScene(`?${field}=true`,b);assert.equal(invalid.state[field],true);assert.ok(invalid.warnings.some(w=>w.field===field));assert.equal(invalid.fallback,false);
  assert.equal(resolveScene(`?${field}=0&${field}=1`,b).fallback,true);
 }
});

test('legacy projection URLs validate but cannot change view state or canonical output',()=>{
 const b=fixture(),normal=resolveScene('',b);
 for(const value of ['0','1']){
  const actual=resolveScene(`?projection=${value}`,b);assert.deepEqual(actual.state,normal.state);assert.equal(Object.hasOwn(actual.state,'projection'),false);assert.deepEqual(actual.warnings,[]);
 }
 assert.equal(new URLSearchParams(serializeScene({...normal.state,projection:true})).has('projection'),false);
 const invalid=resolveScene('?projection=2',b);assert.ok(invalid.warnings.some(w=>w.field==='projection'));assert.equal(Object.hasOwn(invalid.state,'projection'),false);
 assert.equal(resolveScene('?projection=0&projection=1',b).fallback,true);
});

test('centered window round trips JST center and independent inspection',()=>{
 const b=fixture(), q=new URLSearchParams({period:'center',center:'2024-01-05T09:00:00+09:00',at:'2024-01-06T00:00:00Z',view:'evaluation'});
 const actual=resolveScene(q.toString(),b);
 assert.equal(actual.state.period,'center');assert.equal(actual.state.center,'2024-01-05T00:00:00.000Z');assert.equal(actual.state.at,'2024-01-06T00:00:00.000Z');assert.deepEqual(actual.warnings,[]);
 assert.deepEqual(resolveScene(serializeScene(actual.state),b),actual);
});
for(const center of [undefined,'2024-02-30T00:00:00Z','2024-01-05T00:00:00','2024-01-05T00:30:00Z','2024-01-05T00:00:00.001Z','2024-01-11T00:00:00Z','2023-12-31T23:00:00Z']) {
 test(`invalid center falls back to all with warning: ${center}`,()=>{
  const q=new URLSearchParams({period:'center',basin:'b'});if(center!==undefined)q.set('center',center);
  const actual=resolveScene(q.toString(),fixture());assert.equal(actual.state.period,'all');assert.equal(actual.state.basin,'b');assert.equal(actual.fallback,false);assert.equal(Object.hasOwn(actual.state,'center'),false);assert.ok(actual.warnings.some(w=>w.field==='center'));
 });
}
test('center requires saved test partition and clips inspection at first and last grid',()=>{
 const b=fixture();
 for(const center of ['2024-01-01T00:00:00Z','2024-01-10T23:00:00Z']) {
  const actual=resolveScene(new URLSearchParams({period:'center',center}).toString(),b);
  assert.equal(actual.state.period,'center');assert.equal(actual.state.at,new Date(center).toISOString());assert.deepEqual(actual.warnings,[]);
 }
 b.series.a[0].partition='train';assert.equal(resolveScene('?period=center&center=2024-01-01T00:00:00Z',b).state.period,'all');
});
test('inspection outside centered window warns without shifting the center',()=>{
 const actual=resolveScene('?period=center&center=2024-01-01T00:00:00Z&at=2024-01-10T00:00:00Z',fixture());
 assert.equal(actual.state.center,'2024-01-01T00:00:00.000Z');assert.equal(actual.state.at,actual.state.center);assert.ok(actual.warnings.some(w=>w.field==='at'));
});
test('unexpected center is ignored with warning and duplicate center is fatal',()=>{
 const actual=resolveScene('?period=7&center=2024-01-05T00:00:00Z',fixture());
 assert.equal(actual.state.period,'7');assert.equal(Object.hasOwn(actual.state,'center'),false);assert.ok(actual.warnings.some(w=>w.field==='center'));assert.equal(actual.fallback,false);
 assert.equal(resolveScene('?period=center&center=a&center=b',fixture()).fallback,true);
});
test('serialization validates center only for centered period and normalizes UTC',()=>{
 const state=resolveScene('',fixture()).state;
 assert.equal(new URLSearchParams(serializeScene({...state,center:'bad'})).has('center'),false);
 assert.throws(()=>serializeScene({...state,period:'center'}),/中心時刻/);
 assert.throws(()=>serializeScene({...state,period:'center',center:'2024-02-30T00:00:00Z'}),/中心時刻/);
 const query=serializeScene({...state,period:'center',center:'2024-01-05T09:00:00+09:00'});
 assert.equal(new URLSearchParams(query).get('center'),'2024-01-05T00:00:00.000Z');
});

test('explicit display range round trips with end-exclusive boundary and target inspection',()=>{
 const b=fixture(),query=new URLSearchParams({period:'range',start:'2024-01-02T09:00:00+09:00',end:'2024-01-03T09:00:00+09:00',at:'2024-01-02T12:00:00Z'});
 const resolved=resolveScene(query.toString(),b);
 assert.equal(resolved.state.period,'range');assert.equal(resolved.state.start,'2024-01-02T00:00:00.000Z');assert.equal(resolved.state.end,'2024-01-03T00:00:00.000Z');
 assert.deepEqual(resolved.warnings,[]);assert.deepEqual(resolveScene(serializeScene(resolved.state),b).state,resolved.state);
 const ending=resolveScene('?period=range&start=2024-01-10T00:00:00Z&end=2024-01-11T00:00:00Z',b);
 assert.equal(ending.state.period,'range');
});
test('invalid display ranges warn and restore the full period without mutating saved data',()=>{
 const b=fixture(),before=structuredClone(b);
 for(const [start,end] of [['2024-01-03T00:00:00Z','2024-01-02T00:00:00Z'],['2024-01-02T00:00:00Z',''],['2024-01-01T00:30:00Z','2024-01-02T00:00:00Z'],['2023-12-31T00:00:00Z','2024-01-02T00:00:00Z'],['2024-02-30T00:00:00Z','2024-03-02T00:00:00Z']]) {
  const resolved=resolveScene(new URLSearchParams({period:'range',start,end}).toString(),b);
  assert.equal(resolved.state.period,'all');assert.ok(resolved.warnings.some(w=>w.field==='range'));assert.equal(resolved.state.start,undefined);
 }
 assert.deepEqual(b,before);
});
