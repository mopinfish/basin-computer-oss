import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapRequest,basinDetailHref,mapCatalog,mapStyle,mapReturnHref} from '../map-catalog.mjs';
const bundle=JSON.parse(readFileSync(new URL('../../tests/fixtures/viewer_bundle.json',import.meta.url)));
bundle.results.results[0].horizon_h=6;
test('map query rejects unknown or duplicate outer fields and external scenes',()=>{
 for(const s of ['?next=https://evil.test','?basin=a&basin=b','?scene=https://evil.test','?scene=%3Funknown%3D1']) assert.equal(mapRequest(s).warning.length>0,true);
 assert.deepEqual(mapRequest('?basin=a'),{basin:'a',scene:'',warning:''});
});
test('details retain valid scene only for the same known basin',()=>{
 const scene='?v=1&dataset=test-candidate&basin=a&h=6&view=timeseries&period=all';
 assert.equal(basinDetailHref(bundle,'a',scene),'./'+scene);
 assert.throws(()=>basinDetailHref(bundle,'https://evil.test',scene));
 const changed=structuredClone(bundle);changed.results.results.push({...changed.results.results[0],basin_id:'b'});
 const href=basinDetailHref(changed,'b',scene);const params=new URL(href,'https://local.test/').searchParams;
 assert.equal(params.get('basin'),'b');assert.equal(params.get('period'),null);assert.equal(params.get('at'),null);
});
test('catalog uses station location and saved metadata; synthetic style has no remote sources',()=>{
 const items=mapCatalog(bundle);assert.equal(items.length,1);assert.equal(items[0].id,'a');assert.equal(items[0].horizon,6);
 assert.ok(items[0].coordinates.every(Number.isFinite));
 assert.deepEqual(mapStyle(true).sources,{});
 assert.match(mapStyle(false,'gsi').sources.background.tiles[0],/^https:\/\/cyberjapandata\.gsi\.go\.jp\//);
});

test('return target stays at the original scene independently of selection',()=>{
 const scene='?v=1&dataset=test-candidate&basin=a&h=6&view=timeseries&period=all';
 assert.equal(mapReturnHref(bundle,scene),'./'+scene);
 assert.equal(mapReturnHref(bundle,''),'./');
 assert.equal(mapReturnHref(bundle,'?next=https://evil.test'),'./');
 assert.deepEqual(mapStyle(false).sources,{});
 assert.deepEqual(mapStyle(true,'gsi').sources,{});
});

test('real basemaps have distinct official tiles and attribution; synthetic never requests them',()=>{
 const osm=mapStyle(false,'osm'),gsi=mapStyle(false,'gsi');
 assert.equal(osm.sources.background.tiles[0],'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
 assert.match(osm.sources.background.attribution,/OpenStreetMap.*contributors/);
 assert.equal(gsi.sources.background.tiles[0],'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png');
 assert.match(gsi.sources.background.attribution,/地理院タイル/);
 for(const choice of ['osm','gsi','none','invalid'])assert.deepEqual(mapStyle(true,choice).sources,{});
 assert.deepEqual(mapStyle(false,'invalid').sources,{});
});

test('last real basemap is restored; missing, invalid and blocked storage use OSM',async()=>{
 const module=await import('../map-catalog.mjs');
 assert.equal(typeof module.readMapBackground,'function');
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');const values=new Map();
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
  assert.equal(module.readMapBackground(),'osm');
  module.saveMapBackground('gsi');assert.equal(module.readMapBackground(),'gsi');
  module.saveMapBackground('osm');assert.equal(module.readMapBackground(),'osm');
  module.saveMapBackground('untrusted');assert.equal(module.readMapBackground(),'osm');
  for(const key of values.keys())values.set(key,'untrusted');assert.equal(module.readMapBackground(),'osm');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked storage')}});
  assert.equal(module.readMapBackground(),'osm');assert.doesNotThrow(()=>module.saveMapBackground('gsi'));
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
});

test('popup comparison uses the two saved RMSE values and never creates a ranking',()=>{
 const item=mapCatalog(bundle)[0],saved=bundle.results.results[0];
 assert.deepEqual(item.comparison,{modelRmse:saved.rmse,persistenceRmse:saved.baselines.persistence.rmse});
 assert.equal('rank' in item,false);
});

test('synthetic catalog never presents artificial errors as a prediction comparison',()=>{
 const rootFlag=structuredClone(bundle);rootFlag.results.extensions={synthetic:true};
 assert.equal(mapCatalog(rootFlag)[0].comparison,null);
 const itemFlag=structuredClone(bundle);itemFlag.results.results[0].extensions={synthetic:true};
 assert.equal(mapCatalog(itemFlag)[0].comparison,null);
});

test('another basin retains validated shared scale but resets period and inspection',()=>{
 const b=structuredClone(bundle);b.results.results.push({...b.results.results[0],basin_id:'b'});
 const scene='?v=1&dataset=test-candidate&basin=a&h=6&period=all&axis=shared';
 const params=new URL(basinDetailHref(b,'b',scene),'https://local.test/').searchParams;
 assert.equal(params.get('axis'),'shared');assert.equal(params.get('period'),null);assert.equal(params.get('at'),null);
 assert.equal(basinDetailHref(b,'a',scene),'./'+scene);
 for(const invalid of [scene.replace('axis=shared','axis=bad'),scene.replace('test-candidate','wrong')]) {
  assert.equal(new URL(basinDetailHref(b,'b',invalid),'https://local.test/').searchParams.get('axis'),null);
 }
});
