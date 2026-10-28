import test from 'node:test';
import assert from 'node:assert/strict';
import {formatJST, selectBasin, visibleRows, lineSegments, testPrediction, localProjection, metricLabel, displayPeriod, requireSixHourDemo, eventWindow, persistenceComparison, selectView, persistenceReference} from '../ui.mjs';

const row=(hour,values={})=>({target_time:`2024-01-01T${String(hour).padStart(2,'0')}:00:00+00:00`,origin_time:'2023-12-31T18:00:00+00:00',partition:'test',accepted:true,observed:hour,prediction:hour+1,rain:0,...values});
test('JST crosses UTC midnight with 00, never 24',()=>{
 assert.equal(formatJST('2024-01-01T15:00:00+00:00'),'2024/01/02 00:00');
 assert.equal(formatJST('2024-01-01T14:00:00Z'),'2024/01/01 23:00');
 assert.throws(()=>formatJST('bad'),/時刻/);
});
test('prediction requires test adoption and generated finite value',()=>{
 assert.equal(testPrediction(row(0)),1);
 for(const values of [{partition:'train'},{partition:'valid'},{accepted:false},{prediction:null}]) assert.equal(testPrediction(row(0,values)),null);
});
test('missing or nonhourly grid breaks a line rather than compressing time',()=>{
 const rows=[row(0),row(1),row(2,{observed:null}),row(3),row(5)];
 assert.deepEqual(lineSegments(rows,r=>r.observed).map(segment=>segment.map(p=>p.value)),[[0,1],[3],[5]]);
 assert.deepEqual(lineSegments([row(0),row(1,{accepted:false}),row(2)],testPrediction).map(s=>s.map(p=>p.value)),[[1],[3]]);
});
test('visible test window uses half-open target time and leaves rejected rows',()=>{
 const item={period_start:'2024-01-01T01:00:00Z',period_end:'2024-01-01T04:00:00Z'};
 const rows=[row(0),row(1),row(2,{accepted:false}),row(3),row(4)];
 assert.deepEqual(visibleRows(rows,item,'all').map(r=>r.observed),[1,2,3]);
 const end={period_start:'2023-12-01T00:00:00Z',period_end:'2024-01-09T00:00:00Z'};
 assert.equal(visibleRows(rows,end,'7').length,0);
});
test('basin switching resolves independent geometry stations and series by ID',()=>{
 const bundle={results:{results:[{basin_id:'a'},{basin_id:'b'}]},basins:{features:[{properties:{basin_id:'a',name:'A'}},{properties:{basin_id:'b',name:'B'}}]},stations:{features:[{properties:{basin_id:'a'}},{properties:{basin_id:'b'}}]},series:{a:[row(1)],b:[row(2)]}};
 assert.equal(selectBasin(bundle,'b').basin.properties.name,'B');
 assert.equal(selectBasin(bundle,'b').rows[0].observed,2);
 assert.equal(selectBasin(bundle,'b').stations.length,1);
 assert.throws(()=>selectBasin(bundle,'c'),/流域/);
});
test('local projection points east right and north up with metric scale',()=>{
 const p=localProjection([[135,35],[135.01,35.01]],600,400);
 const south=p.point([135,35]),north=p.point([135.01,35.01]);
 assert.ok(north[0]>south[0]);assert.ok(north[1]<south[1]);
 assert.ok(p.pixelsPerMetre>0);
 const midpoint=p.point([135.005,35.005]);assert.ok(Math.abs(midpoint[0]-300)<1e-7);
});
test('negative NSE remains visible and null explains undefined reason',()=>{
 assert.equal(metricLabel(-.2),'-0.200');
 assert.equal(metricLabel(null,'constant_target'),'未定義（目的値が一定）');
});

test('displayed interval ends one hour after the final retained target timestamp',()=>{
 assert.equal(displayPeriod([row(0),row(1)]),'［2024/01/01 09:00、2024/01/01 11:00）JST');
});

test('six-hour screen rejects any legal bundle with a different horizon before display',()=>{
 assert.doesNotThrow(()=>requireSixHourDemo({results:{results:[{basin_id:'a',horizon_h:6},{basin_id:'b',horizon_h:6}]}}));
 assert.throws(()=>requireSixHourDemo({results:{results:[{basin_id:'a',horizon_h:6},{basin_id:'b',horizon_h:1}]}}),/6時間先.*b.*1/);
});

test('observed event window is 168 half-open hours, independent of predictions',()=>{
 const start=Date.parse('2024-01-01T00:00:00Z');
 const rows=Array.from({length:300},(_,i)=>({target_time:new Date(start+i*3600000).toISOString(),q:i===150?99:1,rain:i===180?30:0,prediction:i,partition:'test',accepted:i!==150}));
 const result={period_start:rows[0].target_time,period_end:new Date(start+300*3600000).toISOString()};
 const selected=eventWindow(rows,result,'q');
 assert.equal(selected.peakTime,start+150*3600000);
 assert.equal(selected.rows.length,168);
 assert.equal(selected.rows[0],rows[66]);assert.equal(selected.rows.at(-1),rows[233]);
 const changed=rows.map(row=>({...row,prediction:row.prediction*-1000}));
 assert.equal(eventWindow(changed,result,'q').peakTime,selected.peakTime);
 assert.equal(eventWindow(rows,result,'rain').peakTime,start+180*3600000);
});
test('peak ties use earliest test observation and clip at test boundary',()=>{
 const rows=[row(0,{q:100,partition:'train'}),row(1,{q:7}),row(2,{q:7}),row(3,{q:null})];
 const result={period_start:rows[1].target_time,period_end:row(4).target_time};
 const selected=eventWindow(rows,result,'q');
 assert.equal(selected.peakTime,Date.parse(rows[1].target_time));
 assert.deepEqual(selected.rows,rows.slice(1));
 assert.equal(eventWindow(rows.map(r=>({...r,rain:null})),result,'rain').reason,'no_finite_observation');
 assert.equal(eventWindow(rows.map(r=>({...r,rain:0})),result,'rain').peakValue,0);
});
test('persistence uses full CSV origin observations, including unadopted purge rows',()=>{
 const rows=[row(0,{q:2,observed:2,accepted:false,prediction:null,reason:'origin_before_cutoff'}),row(1,{q:4,observed:4,accepted:false,prediction:null}),row(6,{q:5,observed:5,origin_time:row(0).target_time}),row(7,{q:3,observed:3,origin_time:row(1).target_time})];
 const comparison=persistenceComparison(rows);
 assert.equal(comparison.n_samples,2);
 assert.equal(comparison.values.get(Date.parse(row(6).target_time)),2);
 assert.equal(comparison.values.get(Date.parse(row(7).target_time)),4);
 assert.equal(comparison.values.get(Date.parse(row(0).target_time)),undefined);
 assert.equal(comparison.rmse,Math.sqrt(5));
 assert.equal(comparison.nse,-4);
 assert.equal(comparison.available,true);
});
test('missing origin never silently shrinks the common comparison index',()=>{
 const rows=[row(0,{q:null,accepted:false,prediction:null}),row(6,{q:5,observed:5,origin_time:row(0).target_time}),row(7,{q:3,observed:3,origin_time:row(1).target_time})];
 const comparison=persistenceComparison(rows);
 assert.equal(comparison.n_samples,2);assert.equal(comparison.n_missing,2);
 assert.equal(comparison.available,false);assert.equal(comparison.rmse,null);assert.equal(comparison.nse,null);
 assert.equal(comparison.reason,'missing_origin_observation');
});
test('persistence constant-target NSE is undefined with an explicit reason',()=>{
 const rows=[row(0,{q:2,accepted:false,prediction:null}),row(1,{q:2,accepted:false,prediction:null}),row(6,{q:2,observed:2,origin_time:row(0).target_time}),row(7,{q:2,observed:2,origin_time:row(1).target_time})];
 const comparison=persistenceComparison(rows);
 assert.equal(comparison.rmse,0);assert.equal(comparison.nse,null);assert.equal(comparison.nse_reason,'constant_target');
});

test('view selection changes rows while keeping full-test persistence denominator and scores',()=>{
 const start=Date.parse('2024-01-01T00:00:00Z');
 const rows=Array.from({length:300},(_,i)=>({target_time:new Date(start+i*3600000).toISOString(),origin_time:new Date(start+(i-6)*3600000).toISOString(),q:i,observed:i,rain:i===150?50:0,prediction:i,partition:'test',accepted:i>=6}));
 const result={period_start:rows[0].target_time,period_end:new Date(start+300*3600000).toISOString()};
 for(const period of ['all','7','30','peak-rain','peak-q']) {
  const view=selectView(rows,result,period);
  assert.equal(view.comparison.n_samples,294);assert.equal(view.comparison.rmse,6);
  assert.ok(view.comparison.available);
 }
 assert.equal(selectView(rows,result,'peak-rain').rows.length,168);
 assert.equal(selectView(rows,result,'peak-q').rows.length,85);
 const constant=rows.map(r=>({...r,q:0}));
 assert.equal(eventWindow(constant,result,'q').rows.length,84);
});
test('persistence line breaks at a missing origin without inventing a shorter metric set',()=>{
 const rows=[row(0,{q:1,observed:1,accepted:false}),row(1,{q:null,observed:null,accepted:false}),row(2,{q:3,observed:3,accepted:false}),row(6,{q:2,observed:2,origin_time:row(0).target_time}),row(7,{q:3,observed:3,origin_time:row(1).target_time}),row(8,{q:4,observed:4,origin_time:row(2).target_time})];
 const comparison=persistenceComparison(rows);
 assert.equal(comparison.available,false);assert.equal(comparison.n_samples,3);assert.equal(comparison.n_missing,1);
 assert.deepEqual(lineSegments(rows,r=>comparison.values.get(Date.parse(r.target_time))).map(s=>s.map(p=>p.value)),[[1],[3]]);
});

test('persistence inspection distinguishes cutoff exclusion from missing origin',()=>{
 const comparison={values:new Map([[Date.parse(row(6).target_time),2]])};
 assert.equal(persistenceReference(row(0,{accepted:false,reason:'origin_before_cutoff'}),comparison),'不採用（予測開始時刻の制約による除外）');
 assert.equal(persistenceReference(row(7),comparison),'起点の観測が欠測');
 assert.equal(persistenceReference(row(6),comparison),'2.000 m³/s');
 assert.equal(persistenceReference(row(6,{partition:'train'}),comparison),'対象外（評価期間のみ）');
});

test('initial inspection selects first adopted test row, peak view selects observed peak',async()=>{
 const {initialInspectionIndex}=await import('../ui.mjs');
 const rows=[row(0,{accepted:false}),row(1,{partition:'train'}),row(2),row(3)];
 assert.equal(initialInspectionIndex(rows),2);
 assert.equal(initialInspectionIndex(rows,Date.parse(rows[3].target_time)),3);
 assert.equal(initialInspectionIndex(rows.map(r=>({...r,accepted:false}))),0);
});
test('chart keyboard navigation clamps and supports range endpoints',async()=>{
 const {inspectionKeyIndex}=await import('../ui.mjs');
 assert.equal(inspectionKeyIndex('ArrowLeft',0,5),0);
 assert.equal(inspectionKeyIndex('ArrowRight',1,5),2);
 assert.equal(inspectionKeyIndex('Home',3,5),0);
 assert.equal(inspectionKeyIndex('End',1,5),4);
 assert.equal(inspectionKeyIndex('Tab',1,5),null);
});
test('nice ticks enclose nonround maxima with readable steps and include zero',async()=>{
 const {niceTicks}=await import('../ui.mjs');
 assert.deepEqual(niceTicks(0,87),[0,20,40,60,80,100]);
 assert.deepEqual(niceTicks(0,.73),[0,.2,.4,.6,.8]);
 assert.deepEqual(niceTicks(0,0),[0,.2,.4,.6,.8,1]);
 assert.ok(niceTicks(-13,87)[0]<=-13);
});
test('saved persistence metrics are displayed unchanged when viewing a subset',async()=>{
 const {savedPersistence,persistenceFinding}=await import('../ui.mjs');
 const result={rmse:5,nse:.1,n_samples:2,baselines:{persistence:{rmse:3,nse:.6,nse_reason:null,n_samples:2,method:'origin_observation',horizon_h:6}}};
 assert.equal(savedPersistence(result),result.baselines.persistence);
 assert.match(persistenceFinding(result),/持続予測.*RMSE.*小さ/);
 assert.doesNotMatch(persistenceFinding(result),/原因|季節|学習不足/);
 assert.match(persistenceFinding({...result,rmse:1}),/6時間先予測.*RMSE.*小さ/);
});
test('error messages stay Japanese and never render implementation errors',async()=>{
 const {displayError}=await import('../ui.mjs');
 assert.match(displayError(new Error('Failed to fetch')),/取得/);
 assert.match(displayError(new Error('schema_version mismatch private/path')),/形式|検査/);
 assert.doesNotMatch(displayError(new Error('private/path')),/private\/path/);
});

test('keyboard inspection keeps cursors visible in a horizontally scrolled chart',async()=>{
 const {inspectionScrollLeft}=await import('../ui.mjs');
 const first=inspectionScrollLeft(0,168,760,330,430);
 assert.equal(first,0);
 const last=inspectionScrollLeft(167,168,760,330,0);
 assert.ok(last>400);
 assert.ok(last<=430);
 assert.equal(inspectionScrollLeft(80,168,760,330,210),210);
 assert.equal(inspectionScrollLeft(80,168,760,900,0),0);
 const centered=inspectionScrollLeft(84,168,760,330,0,true);
 assert.ok(centered>180&&centered<240);
});

test('series descriptors keep observed model and persistence styles distinct without color inference',async()=>{
 const {chartSeries}=await import('../ui.mjs');
 const persistence=()=>2;
 const series=chartSeries(persistence,true);
 assert.deepEqual(series.map(s=>s.key),['observed','model','persistence']);
 assert.equal(series[0].valueOf(row(2)),2);
 assert.equal(series[1].valueOf(row(2)),3);
 assert.equal(series[2].valueOf(row(2)),2);
 assert.equal(series[0].dash,'none');
 assert.notEqual(series[1].dash,series[0].dash);
 assert.notEqual(series[1].dash,series[2].dash);
 assert.ok(series[1].width>series[0].width);
 assert.deepEqual(chartSeries(persistence,false).map(s=>s.key),['observed','model']);
});
test('specific data errors explain checksum JSON missing data and baseline failures',async()=>{
 const {displayError}=await import('../ui.mjs');
 assert.match(displayError(new Error('SHA-256 mismatch')),/一致/);
 assert.match(displayError(new SyntaxError('Unexpected token in JSON')),/JSON/);
 assert.match(displayError(new Error('HTTP 404 missing file')),/見つかりません/);
 assert.match(displayError(new Error('persistence RMSE mismatch')),/持続予測/);
 assert.match(displayError(new Error('baselines.persistence missing')),/持続予測/);
});

test('missing JSON artifact is reported as missing rather than malformed JSON', async () => {
  const {displayError}=await import('../ui.mjs');
  assert.match(displayError(new Error('Artifact fetch failed (HTTP 404): results.json')), /見つかりません/);
});

test('extension details keep root and result distinct and render HTML as text',async()=>{
 const {extensionDetails}=await import('../ui.mjs');
 const document={createElement(tag){return {tag,children:[],textContent:'',append(...children){this.children.push(...children);}};}};
 const root={extensions:{note:'<img src=x onerror=alert(1)>'}},result={extensions:{note:'result',n_samples:123}};
 const element=extensionDetails(document,root,result);
 assert.equal(element.children.length,2);
 assert.equal(element.children[0].children[0].textContent,'全体の技術情報（元の識別子）');
 assert.equal(element.children[1].children[0].textContent,'選択した結果の技術情報（元の識別子）');
 assert.match(element.children[0].children[1].textContent,/<img src=x onerror=alert\(1\)>/);
 assert.match(element.children[1].children[1].textContent,/123/);
 assert.equal(extensionDetails(document,{},{}).children.length,0);
 assert.equal(extensionDetails(document,{extensions:{}},{}).children.length,1);
});

test('saved extra series preserve CSV target alignment and missing gaps',async()=>{
 const {savedSeries}=await import('../ui.mjs');
 const rows=[row(0),row(1),row(2)];
 const descriptor={id:'research',label:'研究結果',unit:'m³/s',evaluation_conditions:'合成試験・比較対象外',style:'dotted',values:[10,null,30]};
 const [series]=savedSeries({extensions:{series:[descriptor]}},rows);
 assert.equal(series.valueOf(rows[2]),30);
 assert.equal(series.valueOf(rows[1]),null);
 assert.equal(series.valueOf(row(3)),null);
 assert.equal(series.dash,'2 4');
 assert.deepEqual(lineSegments(rows,series.valueOf).map(s=>s.map(p=>p.value)),[[10],[30]]);
 assert.deepEqual(savedSeries({},rows),[]);
});
test('extra series separate axes by exact unit and retain evaluation labels',async()=>{
 const {savedSeries,seriesGroups,seriesReference}=await import('../ui.mjs');
 const rows=[row(0)];
 const series=savedSeries({extensions:{series:[
  {id:'same',label:'別条件',unit:'m³/s',evaluation_conditions:'別期間・比較対象外',style:'dashed',values:[7]},
  {id:'level',label:'水位',unit:'m',evaluation_conditions:'合成表示のみ',style:'solid',values:[2]},
  {id:'dry',label:'欠測',unit:'m',evaluation_conditions:'合成表示のみ',style:'dotted',values:[null]},
 ]}},rows);
 const groups=seriesGroups(series);
 assert.deepEqual(groups.map(group=>[group.unit,group.series.map(s=>s.key)]),[['m³/s',['same']],['m',['level','dry']]]);
 assert.equal(seriesReference(series[1],rows[0]),'2.000 m');
 assert.equal(seriesReference(series[2],rows[0]),'欠測 / 未保存');
 assert.equal(series[0].evaluation_conditions,'別期間・比較対象外');
});

test('chart bounds handle a saved yearly grid with many selected series without argument spread',async()=>{
 const {valueBounds}=await import('../ui.mjs');
 const values=Array.from({length:35052*5},(_,index)=>index%100-20);
 assert.deepEqual(valueBounds(values),{min:-20,max:82.95});
 assert.deepEqual(valueBounds([null,NaN]),{min:0,max:1.05});
});
test('same-style saved series use distinct fixed palette colors',async()=>{
 const {savedSeries}=await import('../ui.mjs');
 const descriptors=['a','b'].map(id=>({id,label:id,unit:'m',evaluation_conditions:'synthetic',style:'solid',values:[1]}));
 const items=savedSeries({extensions:{series:descriptors}},[row(0)]);
 assert.notEqual(items[0].stroke,items[1].stroke);
});
test('newly created charts select inspection on click and keyboard, never hover',async()=>{
 const {bindChartInspection}=await import('../ui.mjs');
 const handlers={},seen=[];
 const chart={getBoundingClientRect:()=>({left:0,width:920}),addEventListener:(name,fn)=>{handlers[name]=fn;}};
 bindChartInspection(chart,()=>3,()=>0,index=>seen.push(index));
 handlers.keydown({key:'End',preventDefault(){}});
 handlers.pointermove?.({clientX:65});
 assert.deepEqual(seen,[2]);
 handlers.click({clientX:900});
 assert.deepEqual(seen,[2,2]);
});

test('saved line styles and exclusion reasons use standard display terminology',async()=>{
 const {lineStyleLabel,adoptionReasonLabel}=await import('../ui.mjs');
 assert.equal(lineStyleLabel('solid'),'実線');
 assert.equal(lineStyleLabel('dashed'),'破線');
 assert.equal(lineStyleLabel('dotted'),'点線');
 assert.equal(adoptionReasonLabel('context'),'予測履歴の準備');
 assert.equal(adoptionReasonLabel('origin_before_cutoff'),'予測開始時刻の制約による除外');
});

test('synthetic saved scores never become a performance finding',async()=>{
 const {resultReadingState}=await import('../ui.mjs');
 const result={rmse:1,n_samples:2,baselines:{persistence:{rmse:6}}};
 const state=resultReadingState({extensions:{synthetic:true}},result);
 assert.equal(state.synthetic,true);
 assert.match(state.finding,/合成データ.*性能.*解釈できません/);
 assert.doesNotMatch(state.finding,/小さい結果/);
 assert.equal(resultReadingState({}, {...result,extensions:{synthetic:true}}).synthetic,true);
 assert.match(resultReadingState({},result).finding,/6時間先予測.*小さい結果/);
});

test('standard display resets browsing controls and keeps the chosen basin',async()=>{
 const {resetDisplayControls}=await import('../ui.mjs');
 const controls={basin:{value:'b'},period:{value:'peak-rain'},persistence:{checked:false}};
 resetDisplayControls(controls);
 assert.equal(controls.basin.value,'b');
 assert.equal(controls.period.value,'all');
 assert.equal(controls.persistence.checked,true);
});

test('base series can be independently hidden without modifying saved values',async()=>{
 const {chartSeries,valueBounds}=await import('../ui.mjs');
 const row={observed:100,prediction:20,accepted:true,partition:'test'},baseline=()=>5;
 assert.deepEqual(chartSeries(baseline,false,{observed:false,prediction:true}).map(s=>s.key),['model']);
 assert.deepEqual(chartSeries(baseline,true,{observed:false,prediction:false}).map(s=>s.key),['persistence']);
 assert.deepEqual(chartSeries(baseline,false,{observed:false,prediction:false}),[]);
 assert.deepEqual(valueBounds([]),{min:0,max:1.05});
 assert.deepEqual(valueBounds(chartSeries(baseline,false,{observed:false,prediction:true}).map(s=>s.valueOf(row))),{min:0,max:21});
 assert.equal(row.observed,100);assert.equal(row.prediction,20);
});
test('standard display restores observed and prediction visibility',async()=>{
 const {resetDisplayControls}=await import('../ui.mjs');
 const controls={period:{value:'7'},observed:{checked:false},prediction:{checked:false},persistence:{checked:false}};
 resetDisplayControls(controls);assert.equal(controls.observed.checked,true);assert.equal(controls.prediction.checked,true);
});

test('all eight base-series visibility combinations retain identity and line styles',async()=>{
 const {chartSeries}=await import('../ui.mjs');
 for(const observed of [false,true])for(const prediction of [false,true])for(const persistence of [false,true]){
  const visible=chartSeries(()=>5,persistence,{observed,prediction});
  assert.deepEqual(visible.map(s=>s.key),[...(observed?['observed']:[]),...(prediction?['model']:[]),...(persistence?['persistence']:[])]);
  for(const item of visible)assert.equal(item.dash,{observed:'none',model:'4 2',persistence:'10 5'}[item.key]);
 }
});

test('flow chart state follows hide, extension-only and restore transitions without changing rows',async()=>{
 const {chartSeries,flowChartState}=await import('../ui.mjs');
 const row={observed:10,prediction:8,accepted:true,partition:'test'},before=structuredClone(row);
 const baseline=()=>9;
 const all=chartSeries(baseline,true);
 assert.equal(flowChartState(all).showYAxis,true);
 assert.match(flowChartState(all).ariaLabel,/観測.*6時間先予測.*持続予測/);
 const off=chartSeries(baseline,false,{observed:false,prediction:false});
 assert.deepEqual(flowChartState(off),{showYAxis:false,ariaLabel:'流量時系列。すべての系列が非表示です。'});
 const extra={key:'extra',label:'保存系列A',valueOf:()=>7};
 assert.deepEqual(flowChartState([extra]),{showYAxis:true,ariaLabel:'流量時系列（m³/s）。表示中の系列：保存系列A。'});
 const restored=flowChartState(chartSeries(baseline,false,{observed:false,prediction:true}));
 assert.equal(restored.showYAxis,true);
 assert.match(restored.ariaLabel,/6時間先予測/);
 assert.doesNotMatch(restored.ariaLabel,/観測|持続予測|保存系列A/);
 assert.deepEqual(row,before);
});
