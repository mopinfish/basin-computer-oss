import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationTableDOM,updateEvaluationSelection} from '../evaluation-table-dom.mjs';

function documentStub() {
 return {createElement(tag){return {tag,children:[],attributes:{},handlers:{},textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(name,fn){this.handlers[name]=fn;},setAttribute(name,value){this.attributes[name]=String(value);}};}};
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const texts=node=>descendants(node).map(item=>item.textContent).join(' ');
function model() {
 return {datasetVersion:'v1',libraryVersion:'rc1',dataLibraryVersion:'data1',schemaVersion:'0.3',synthetic:true,implementation:{source_commit:null},publicReleaseBlockers:['来歴未確認'],basins:[{
 basinId:'a',basinName:'<img src=x onerror=bad()>',synthetic:true,periodStart:'2024-01-01T00:00:00Z',periodEnd:'2024-01-02T00:00:00Z',horizonH:6,unit:'m³/s',sameRowsEvidence:'同じ採用時刻を確認',predictionPath:'predictions/a.csv',
 comparable:[{id:'model',label:'6時間先予測',nse:-.25,rmse:2,nseReason:null,nSamples:10,nExcluded:2,nContext:0,excludedByReason:{missing:1,origin_before_cutoff:1}},{id:'persistence',label:'持続予測',nse:null,rmse:3,nseReason:'constant_target',nSamples:10,nExcluded:2,nContext:0,excludedByReason:{missing:1,origin_before_cutoff:1}}],
 nonComparable:[{id:'extra',label:'<script>bad()</script>',unit:'mm',evaluationConditions:'別条件',source:'synthetic',reason:'同一採用行が未確認',nse:null,rmse:null,nSamples:null,nExcluded:null}]
 }]};
}
test('evaluation DOM exposes semantic headers, target conditions and saved negative or undefined scores',()=>{
 const root=evaluationTableDOM(documentStub(),model()),nodes=descendants(root);
 assert.equal(nodes.filter(n=>n.tag==='table').length,2);
 assert.equal(nodes.filter(n=>n.tag==='caption').length,2);
 assert.equal(nodes.filter(n=>n.tag==='table')[0].className,'evaluation-overview-table');
 assert.equal(nodes.filter(n=>n.tag==='table')[1].className,'extra-series-table');
 assert.ok(nodes.filter(n=>n.tag==='th').every(n=>['row','col'].includes(n.attributes.scope)));
 const regions=nodes.filter(n=>n.attributes.role==='region');
 assert.equal(regions.length,2);assert.ok(regions.every(n=>n.attributes.tabindex==='0'&&n.attributes['aria-label']));
 const text=texts(root);
 assert.match(text,/-0.250/);assert.match(text,/未定義（目的値が一定）/);
 assert.match(text,/全評価期間/);assert.match(text,/予測開始時刻の制約/);
 assert.match(text,/表示確認用.*性能/);assert.match(text,/predictions\/a.csv/);
});
test('unverified extra series have no copied denominator or comparison scores; metadata remains inert text',()=>{
 const root=evaluationTableDOM(documentStub(),model()),nodes=descendants(root);
 const tables=nodes.filter(n=>n.tag==='table'),extra=texts(tables[1]);
 assert.match(extra,/比較指標なし/);assert.match(extra,/母数未確認/);
 assert.doesNotMatch(extra,/10|2\.000|3\.000/);
 assert.match(extra,/<script>bad\(\)<\/script>/);
 assert.equal(nodes.filter(n=>n.tag==='script'||n.tag==='img').length,0);
 assert.match(texts(root),/<img src=x onerror=bad\(\)>/);
});

test('known public-release caveats use Japanese while unknown evidence text is preserved',()=>{
 const value=model();value.publicReleaseBlockers=['Original source-access dates absent from acquisition manifests','unknown evidence'];
 const text=texts(evaluationTableDOM(documentStub(),value));
 assert.match(text,/源泉参照日/);assert.doesNotMatch(text,/Original source-access dates/);
 assert.match(text,/unknown evidence/);
});

test('overview has one row per basin and only the selected basin details',()=>{
 const m=model(), b=structuredClone(m.basins[0]);b.basinId='b';b.basinName='second basin';b.predictionPath='predictions/b.csv';m.basins.push(b);
 const picked=[],root=evaluationTableDOM(documentStub(),m,{selectedBasinId:'a',onSelectBasin:id=>picked.push(id)});
 const nodes=descendants(root),overview=nodes.find(n=>n.className==='evaluation-overview-table');
 assert.equal(overview.children.find(n=>n.tag==='tbody').children.length,2);
 assert.equal(nodes.filter(n=>n.className==='evaluation-selected-detail').length,1);
 const detail=nodes.find(n=>n.className==='evaluation-selected-detail');
 assert.match(texts(detail),/predictions\/a.csv/);assert.doesNotMatch(texts(detail),/predictions\/b.csv/);
 nodes.find(n=>n.tag==='button'&&n.attributes['data-basin-id']==='b').handlers.click();assert.deepEqual(picked,['b']);
 updateEvaluationSelection(root,'b');
 assert.match(texts(detail),/predictions\/b.csv/);assert.doesNotMatch(texts(detail),/predictions\/a.csv/);
});
test('different basin conditions remain visible in each overview row',()=>{
 const m=model(), b=structuredClone(m.basins[0]);b.basinId='b';b.basinName='other';b.periodStart='2024-02-01T00:00:00Z';b.periodEnd='2024-02-02T00:00:00Z';b.synthetic=false;m.synthetic=false;m.basins.push(b);
 const root=evaluationTableDOM(documentStub(),m),overview=descendants(root).find(n=>n.className==='evaluation-overview-table');
 assert.match(texts(overview),/2024\/01\/01/);assert.match(texts(overview),/2024\/02\/01/);
 assert.match(texts(overview),/合成/);assert.match(texts(overview),/保存結果/);
});
