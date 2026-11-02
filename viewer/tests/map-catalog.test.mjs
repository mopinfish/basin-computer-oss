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
