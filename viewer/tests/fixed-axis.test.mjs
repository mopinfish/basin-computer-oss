import test from 'node:test';
import assert from 'node:assert/strict';
import {flowAxisBounds} from '../ui.mjs';

test('flow axis uses every comparable saved series within the view',()=>{
 const rows=[{observed:100,prediction:20,partition:'test',accepted:true},{observed:10,prediction:10000,partition:'test',accepted:false}];
 const extras=[{unit:'m³/s',valueOf:()=>200},{unit:'mm',valueOf:()=>9000}];
 assert.deepEqual(flowAxisBounds(rows,()=>50,extras),{min:0,max:210});
 assert.deepEqual(flowAxisBounds(rows,()=>50,[]),{min:0,max:105});
 assert.deepEqual(flowAxisBounds(rows.slice(1),()=>5,[]),{min:0,max:10.5});
 assert.deepEqual(flowAxisBounds([{observed:null}],()=>null,[]),{min:0,max:1.05});
});
