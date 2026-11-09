import test from 'node:test';
import assert from 'node:assert/strict';
import {flowAxisBounds,sharedAxisBounds,resetDisplayControls} from '../ui.mjs';

test('flow axis uses every comparable saved series within the view',()=>{
 const rows=[{observed:100,prediction:20,partition:'test',accepted:true},{observed:10,prediction:10000,partition:'test',accepted:false}];
 const extras=[{unit:'m³/s',valueOf:()=>200},{unit:'mm',valueOf:()=>9000}];
 assert.deepEqual(flowAxisBounds(rows,()=>50,extras),{min:0,max:210});
 assert.deepEqual(flowAxisBounds(rows,()=>50,[]),{min:0,max:105});
 assert.deepEqual(flowAxisBounds(rows.slice(1),()=>5,[]),{min:0,max:10.5});
 assert.deepEqual(flowAxisBounds([{observed:null}],()=>null,[]),{min:0,max:1.05});
});

function bundleFixture() {
 const row=(time,values)=>({target_time:time,origin_time:'2024-01-01T00:00:00Z',partition:'test',accepted:true,q:1,...values});
 const result=id=>({basin_id:id,period_start:'2024-01-01T06:00:00Z',period_end:'2024-01-01T08:00:00Z'});
 return {results:{results:[result('a'),result('b')]},series:{
 a:[row('2024-01-01T00:00:00Z',{q:9000,rain:9000,observed:9000}),row('2024-01-01T06:00:00Z',{observed:2,prediction:-4,rain:1}),row('2024-01-01T07:00:00Z',{observed:3,prediction:4,rain:null})],
 b:[row('2024-01-01T00:00:00Z',{q:80}),row('2024-01-01T06:00:00Z',{observed:20,prediction:30,rain:40}),row('2024-01-01T07:00:00Z',{observed:999,prediction:999,accepted:false,rain:2})]}};
}
test('shared scales include all basins full evaluation grid, adopted predictions and origin persistence',()=>{
 const b=bundleFixture(),before=JSON.stringify(b);
 // Unadopted observations still appear; pre-evaluation observations do not.
 assert.deepEqual(sharedAxisBounds(b),{flow:{min:-4,max:9450},rainMax:44});
 assert.equal(JSON.stringify(b),before);
 b.series.a[0].q=5;
 assert.deepEqual(sharedAxisBounds(b).flow,{min:-4,max:1048.95});
});
test('shared scales include saved same-unit extras and reject partial bundles',()=>{
 const b=bundleFixture();b.results.results[0].extensions={series:[{id:'extra',unit:'m³/s',values:[99999,12000,null],style:'solid'}]};
 assert.equal(sharedAxisBounds(b).flow.max,12600);
 delete b.series.b;
 assert.throws(()=>sharedAxisBounds(b),/不足/);
});
test('standard display resets the axis mode along with existing controls',()=>{
 const controls={period:{value:'7'},axis:{value:'shared'},persistence:{checked:false}};
 resetDisplayControls(controls);assert.equal(controls.axis.value,'individual');
});
