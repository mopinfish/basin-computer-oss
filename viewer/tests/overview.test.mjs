import test from 'node:test';
import assert from 'node:assert/strict';
import {centeredWindow,nearestIndex} from '../overview.mjs';
import {lineSegments} from '../ui.mjs';
const hour=3600000,base=Date.parse('2020-01-01T00:00:00Z');
const result={period_start:new Date(base).toISOString(),period_end:new Date(base+400*hour).toISOString()};
const rows=Array.from({length:400},(_,i)=>({target_time:new Date(base+i*hour).toISOString(),partition:'test',observed:i}));
test('centered half-open 168 hours; end excluded',()=>{const w=centeredWindow(rows,result,base+200*hour);assert.equal(w.rows.length,168);assert.equal(w.start,base+116*hour);assert.equal(w.rows.at(-1),rows[283]);assert.equal(w.clipped,false);});
test('both test boundaries clip without shifting center',()=>{assert.equal(centeredWindow(rows,result,base).rows.length,84);assert.equal(centeredWindow(rows,result,base+399*hour).rows.length,85);});
test('nearest saved target tie selects earlier target',()=>assert.equal(nearestIndex(rows,base+1.5*hour),1));
test('missing observations and missing target rows break paths',()=>{const input=[rows[0],{...rows[1],observed:null},rows[2],rows[4]];assert.deepEqual(lineSegments(input,r=>r.observed).map(s=>s.length),[1,1,1]);});

import {createOverview} from '../overview.mjs';
function overviewDocument() {
  const nodes=[];
  function element(tag){const e={tag,children:[],attributes:{},handlers:{},textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(name,fn){this.handlers[name]=fn;},setAttribute(name,value){this.attributes[name]=String(value);},querySelector(selector){return descendants(this).find(n=>selector==='button'?n.tag==='button':n.tag==='option'&&n.value==='center')??null;},remove(){for(const parent of nodes)parent.children=parent.children.filter(child=>child!==this);}};nodes.push(e);return e;}
  const select=element('select'),flow=element('section');flow.before=e=>{flow.overview=e;};
  return {nodes,select,flow,createElement:element,createElementNS:(_,tag)=>element(tag),querySelector:()=>flow,getElementById:()=>select};
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
test('runtime native details starts collapsed, keyboard confirms candidate and restoration preserves center',()=>{
  const doc=overviewDocument(),confirmed=[],overview=createOverview(doc,time=>confirmed.push(time));
  overview.sync(rows,result,rows);
  assert.equal(doc.flow.overview.tag,'details');assert.equal(doc.flow.overview.open,undefined);
  assert.equal(doc.flow.overview.attributes['aria-label'],undefined);
  assert.equal(descendants(doc.flow.overview).find(n=>n.tag==='strong').textContent,'全評価期間の観測流量');
  const slider=doc.nodes.find(n=>n.tag==='input');slider.value='200';slider.handlers.input();
  let prevented=false;slider.handlers.keydown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(confirmed,[base+200*hour]);assert.equal(overview.custom,true);
  overview.sync(rows,result,overview.window(rows,result).rows);
  assert.equal(doc.select.value,'center');assert.equal(overview.center,base+200*hour);
  overview.restore(new Date(base+100*hour).toISOString());overview.sync(rows,result,overview.window(rows,result).rows);
  assert.equal(overview.center,base+100*hour);overview.reset();assert.equal(overview.custom,false);assert.equal(doc.select.children.length,0);
});
test('empty and all-missing overview disable selection without throwing',()=>{
  for(const input of [[],rows.map(row=>({...row,observed:null}))]) {
    const doc=overviewDocument(),confirmed=[],overview=createOverview(doc,time=>confirmed.push(time));
    overview.sync(input,result,[]);
    const slider=doc.nodes.find(n=>n.tag==='input'),button=doc.nodes.find(n=>n.tag==='button');
    assert.equal(slider.disabled,true);assert.equal(button.disabled,true);button.handlers.click();assert.deepEqual(confirmed,[]);
    assert.match(doc.nodes.find(n=>n.className==='overview-status').textContent,/欠測/);
  }
  assert.equal(nearestIndex([],base),-1);
});
