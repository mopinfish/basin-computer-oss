import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneHistory} from '../scene-history.mjs';

function setup(search='') {
 const rows=[0,1,2].map(i=>({target_time:`2024-01-01T0${i}:00:00Z`,origin_time:'2023-12-31T18:00:00Z',partition:'test',accepted:true,observed:i,q:i,rain:0,prediction:i}));
 const result={basin_id:'a',horizon_h:6,period_start:rows[0].target_time,period_end:'2024-01-01T03:00:00Z'};
 const bundle={results:{dataset_version:'v1',results:[result]},series:{a:rows}};
 const calls=[],handlers={},browser={location:{pathname:'/viewer/',search,hash:''},history:{}};
 for(const mode of ['pushState','replaceState']) browser.history[mode]=(_state,_title,url)=>{calls.push({mode,url});browser.location.search=new URL(url,'http://localhost').search;};
 browser.addEventListener=(name,handler)=>{handlers[name]=handler;};
 return {browser,bundle,calls,handlers};
}
test('restore and popstate apply resolved state without adding or replacing history',()=>{
 const f=setup('?period=all&projection=1'),applied=[];
 let history;
 history=createSceneHistory(f.browser,f.bundle,resolution=>{applied.push(resolution);history.commit('push',resolution.state);});
 history.restore();
 assert.equal(Object.hasOwn(applied[0].state,'projection'),false);assert.deepEqual(f.calls,[]);
 f.browser.location.search='?h=12';f.handlers.popstate();
 assert.equal(applied[1].state.h,6);assert.equal(applied[1].warnings[0].field,'h');assert.deepEqual(f.calls,[]);
});
test('committed choices push once; inspection replaces; duplicate state adds no entry',()=>{
 const f=setup(),applied=[];
 const history=createSceneHistory(f.browser,f.bundle,value=>applied.push(value));history.restore();
 const state=applied[0].state;
 assert.equal(history.commit('push',state),true);
 assert.equal(history.commit('push',state),false);
 assert.equal(history.commit('replace',{...state,at:'2024-01-01T01:00:00.000Z'}),true);
 assert.deepEqual(f.calls.map(call=>call.mode),['pushState','replaceState']);
 assert.ok(f.calls[0].url.startsWith('/viewer/?v=1&dataset=v1'));
});

test('view navigation pushes canonical view and popstate restores evaluation without writing history',()=>{
 const f=setup(), applied=[];
 const history=createSceneHistory(f.browser,f.bundle,value=>applied.push(value));history.restore();
 const state={...applied[0].state,view:'evaluation'};
 assert.equal(history.commit('push',state),true);
 assert.equal(new URL(f.calls[0].url,'http://localhost').searchParams.get('view'),'evaluation');
 f.handlers.popstate();assert.equal(applied.at(-1).state.view,'evaluation');assert.equal(f.calls.length,1);
});

test('center survives detail replacement, tab navigation, and popstate without history writes',()=>{
 const f=setup('?period=center&center=2024-01-01T01:00:00Z&at=2024-01-01T02:00:00Z'),applied=[];
 const history=createSceneHistory(f.browser,f.bundle,value=>applied.push(value));history.restore();
 const state=applied[0].state;
 assert.equal(state.center,'2024-01-01T01:00:00.000Z');assert.equal(state.at,'2024-01-01T02:00:00.000Z');assert.deepEqual(f.calls,[]);
 history.commit('replace',{...state,at:'2024-01-01T00:00:00.000Z'});
 history.commit('push',{...state,at:'2024-01-01T00:00:00.000Z',view:'evaluation'});
 for(const call of f.calls)assert.equal(new URL(call.url,'http://localhost').searchParams.get('center'),state.center);
 f.handlers.popstate();assert.equal(applied.at(-1).state.center,state.center);assert.equal(applied.at(-1).state.view,'evaluation');assert.equal(f.calls.length,2);
});
