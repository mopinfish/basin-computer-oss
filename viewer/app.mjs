import {bindPeriodMenu} from './period-menu.mjs';
import {parseJSTInput,jstInput,rangeWindow,presetEnd} from './range.mjs';
import {createOverview} from './overview.mjs';
import {syncReferenceLinks} from './reference-pages.mjs';
import {loadBundle} from './contract.mjs';
import {createSceneHistory} from './scene-history.mjs';
import {buildEvaluationTable} from './evaluation-table.mjs';
import {evaluationTableDOM,updateEvaluationSelection} from './evaluation-table-dom.mjs';
import {bindViewTabs,restoreRemovedPanelFocus} from './view-tabs.mjs';
import {formatJST,selectBasin,lineSegments,testPrediction,localProjection,metricLabel,displayPeriod,requireSixHourDemo,eventWindow,selectView,persistenceReference,initialInspectionIndex,inspectionKeyIndex,niceTicks,savedPersistence,displayError,inspectionScrollLeft,chartSeries,flowChartState,extensionDetails,savedSeries,seriesGroups,seriesReference,valueBounds,bindChartInspection,lineStyleLabel,adoptionReasonLabel,resultReadingState,resetDisplayControls,createInspectionNotice} from './ui.mjs';

const $=id=>document.getElementById(id);
let periodMenu;
const inspectionNotice=createInspectionNotice($('inspection-status'));
let inspectorKeyboard=false;
let customRange=null;
const overview=createOverview(document,time=>{customRange=null;requestedAt=new Date(time).toISOString();render();recordScene();});
const SVG='http://www.w3.org/2000/svg';
let bundle, selected, displayed=[], comparison, extraSeries=[], selectedSeries=new Set(), seriesBasin=null, sceneHistory, requestedAt=null, viewTabs, currentView='timeseries', evaluationRoot;

function node(tag,text=null,className=null) {
  const element=document.createElement(tag);
  if(text!==null) element.textContent=text;
  if(className) element.className=className;
  return element;
}
function svgNode(tag,attributes={},text=null) {
  const element=document.createElementNS(SVG,tag);
  for(const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
  if(text!==null) element.textContent=text;
  return element;
}
function details(id,items) {
  const list=$(id);list.replaceChildren();
  for(const [label,value] of items) list.append(node('dt',label),node('dd',String(value)));
}
function fail(error) {
  inspectionNotice.cancel();
  console.error('表示データの読み込みまたは描画に失敗しました',error);
  $('content').hidden=true;$('load-status').hidden=true;
  $('error').hidden=false;$('error').replaceChildren();
  $('error').append(node('p',displayError(error)),node('p','保存データの配置と起動ディレクトリを確認してください。データが欠けている、または検査に失敗する場合は、検証済みの配布物を別の空ディレクトリへ復元してください。'));
  $('error').append(node('p','候補ZIPを展開した場合は、展開先のルートで検査付き起動を実行します。'));
  $('error').append(node('pre','python -I start_demo.py'));
  $('error').append(node('p','ソースのチェックアウトでは、保存データを配置したうえでリポジトリのルートから実行します。'));
  $('error').append(node('pre','python scripts/serve_demo.py'));
  $('error').append(node('p','検査後に表示されるlocalhostのURLを開いてください。復旧のために保存結果を再生成したり上書きしたりしません。詳細はブラウザのコンソールに記録しました。'));
}
function geometryRings(geometry) {
  if(geometry.type==='Polygon') return geometry.coordinates;
  if(geometry.type==='MultiPolygon') return geometry.coordinates.flat();
  throw new Error('集水域のgeometryに対応していません');
}
function drawMap(basin,stations) {
  const map=$('map');map.replaceChildren();
  const rings=geometryRings(basin.geometry);
  const coordinates=rings.flat().concat(stations.map(s=>s.geometry.coordinates));
  const projection=localProjection(coordinates,600,430,65);
  const path=rings.map(ring=>ring.map((coordinate,i)=>`${i?'L':'M'}${projection.point(coordinate).join(',')}`).join(' ')+'Z').join(' ');
  map.append(svgNode('path',{d:path,fill:'#d0e9df',stroke:'#398775','stroke-width':2,'fill-rule':'evenodd'}));
  const markers=stations.map(station=>({station,point:projection.point(station.geometry.coordinates)})).sort((a,b)=>a.point[1]-b.point[1]);
  const labelYs=[];
  markers.forEach(({station,point:[x,y]},i)=>{
    const p=station.properties,streamflow=p.role==='streamflow';
    const label=`${p.name}（${streamflow?'流量':'雨量'}）`;
    const marker=svgNode('circle',{cx:x,cy:y,r:9,fill:streamflow?'#263f69':'#087f8c',stroke:'white','stroke-width':2});
    marker.append(svgNode('title',{},label));
    const link=svgNode('a',{'aria-label':label,tabindex:0});
    if(/^https?:\/\//.test(p.source_url)) {link.setAttribute('href',p.source_url);link.setAttribute('target','_blank');link.setAttribute('rel','noopener noreferrer');}
    link.append(svgNode('title',{},label+'。観測点の出典を開きます。'),marker);
    const right=x<300,labelX=right?570:30,anchor=right?'end':'start';
    const minimumY=right?180:90;
    const candidateYs=[Math.max(minimumY,Math.min(335,y+52)),Math.max(minimumY,Math.min(335,y-52)),180,235,290,335,...(right?[]:[90,145])];
    const labelY=candidateYs.find(value=>markers.every(other=>Math.abs(value-18-other.point[1])>38)&&labelYs.every(previous=>Math.abs(value-previous)>=46))??candidateYs[0];
    labelYs.push(labelY);
    map.append(svgNode('line',{x1:x,y1:y,x2:labelX,y2:labelY-7,stroke:'#72918a','stroke-width':1}));
    link.append(svgNode('text',{x:labelX,y:labelY,'text-anchor':anchor,class:'map-label'},p.name));
    map.append(link);
  });
  map.append(svgNode('path',{d:'M550 125 L550 65 M540 80 L550 65 L560 80',fill:'none',stroke:'#17333b','stroke-width':2}),svgNode('text',{x:550,y:48,'text-anchor':'middle',class:'map-reference'},'N'));
  const maximum=130/projection.pixelsPerMetre;
  const unit=10**Math.floor(Math.log10(maximum));
  const metres=[5,2,1].map(f=>f*unit).find(value=>value<=maximum)??unit/2;
  const length=metres*projection.pixelsPerMetre;
  map.append(svgNode('path',{d:`M35 365 V372 H${35+length} V365`,fill:'none',stroke:'#17333b','stroke-width':2}),svgNode('text',{x:35,y:428,class:'map-reference'},metres>=1000?`${metres/1000} km`:`${metres} m`));
  $('station-list').replaceChildren();
  for(const station of stations) {
    const p=station.properties,li=node('li');
    li.append(node('span',null,`station-dot ${p.role}`));
    const label=`${p.name} / ${p.role==='streamflow'?'流量':'雨量'}`;
    if(/^https?:\/\//.test(p.source_url)) {
      const a=node('a',label);a.href=p.source_url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);
    } else li.append(node('span',label));
    $('station-list').append(li);
  }
}
function axes(svg,rows,height,min,max,{showYAxis=true}={}) {
  const left=65,right=900,top=16,bottom=height-65;
  const ticks=niceTicks(min,max);min=ticks[0];max=ticks.at(-1);
  const first=Date.parse(rows[0].target_time),last=Date.parse(rows.at(-1).target_time);
  const x=time=>left+(time-first)/Math.max(last-first,3600000)*(right-left);
  const y=value=>bottom-(value-min)/Math.max(max-min,1e-9)*(bottom-top);
  for(const value of showYAxis?ticks:[]) {
    const py=y(value);
    svg.append(svgNode('line',{x1:left,y1:py,x2:right,y2:py,stroke:'#e4ebe8'}),svgNode('text',{x:left-10,y:py+4,'text-anchor':'end'},String(value)));
  }
  for(let i=0;i<5;i++) {
    const row=rows[Math.round((rows.length-1)*i/4)],px=x(Date.parse(row.target_time));
    const label=formatJST(row.target_time);
    svg.append(svgNode('text',{x:px,y:height-33,'text-anchor':i===0?'start':i===4?'end':'middle'},label.slice(5,10)),svgNode('text',{x:px,y:height-7,'text-anchor':i===0?'start':i===4?'end':'middle'},label.slice(11)+' JST'));
  }
  return {x,y,left,right,top,bottom};
}
function drawSavedLines(svg,rows,series,chart) {
  for(const {key,valueOf,stroke,width,dash} of series) {
    for(const segment of lineSegments(rows,valueOf)) {
      if(segment.length===1) svg.append(svgNode('circle',{cx:chart.x(segment[0].time),cy:chart.y(segment[0].value),r:2,fill:stroke,'data-series':key}));
      else svg.append(svgNode('path',{d:segment.map((point,i)=>`${i?'L':'M'}${chart.x(point.time)},${chart.y(point.value)}`).join(' '),fill:'none',stroke,'data-series':key,'stroke-width':width,'stroke-dasharray':dash,'stroke-linejoin':'round'}));
    }
  }
}
function setView(view) {
  inspectionNotice.cancel();
  currentView=view;
  viewTabs.activate(view);
}
function changeBasin(id) {
  $('basin-select').value=id;
  overview.reset();customRange=null;$('range-details').open=false;
  if($('period-select').value==='range') $('period-select').value='all';
  render();
  recordScene();
}
function currentScene() {
  const row=displayed[Number($('time-inspector').value)];
  return {v:'1',view:currentView,dataset:bundle.results.dataset_version,basin:selected.result.basin_id,h:6,
    period:$('period-select').value,...(customRange??{}),...(overview.custom?{center:new Date(overview.center).toISOString()}:{}),at:new Date(row.target_time).toISOString(),
    series:extraSeries.filter(item=>selectedSeries.has(item.key)).map(item=>item.key),
    observed:$('observed-toggle').checked,prediction:$('prediction-toggle').checked,persistence:$('persistence-toggle').checked};
}
function recordScene(mode='push') {
  if(!selected || !displayed.length) return;
  sceneHistory?.commit(mode,currentScene());
  syncReferenceLinks(document,window.location.search);
  if(mode==='push') $('url-notice').hidden=true;
}
function restoreScene({state,warnings}) {
  inspectionNotice.cancel();
  const active=document.activeElement;
  const previousPanelFocus=[$('timeseries-panel'),$('evaluation-panel')].some(panel=>panel.contains(active))?active:null;
  const previous=selected&&displayed.length?currentScene():null;
  overview.restore(state.period==='center'?state.center:null);
  customRange=state.period==='range'?{start:state.start,end:state.end}:null;
  const sameDisplay=previous&&['basin','period','center','start','end','at','observed','prediction','persistence'].every(key=>previous[key]===state[key])&&JSON.stringify(previous.series)===JSON.stringify(state.series);
  $('basin-select').value=state.basin;
  $('period-select').value=state.period;
  $('observed-toggle').checked=state.observed;
  $('prediction-toggle').checked=state.prediction;
  $('persistence-toggle').checked=state.persistence;
  seriesBasin=state.basin;selectedSeries=new Set(state.series);requestedAt=sameDisplay?null:state.at;
  if(!sameDisplay) render();
  setView(state.view??'timeseries');
  restoreRemovedPanelFocus(previousPanelFocus,currentView,{timeseries:$('timeseries-tab'),evaluation:$('evaluation-tab')});
  const labels={view:'表示画面',v:'URL形式',dataset:'データ版',basin:'流域',h:'先行時間',period:'表示期間',center:'表示の中心時刻',range:'指定期間',start:'開始日時',end:'終了日時',at:'参照時刻',series:'系列',observed:'観測',prediction:'6時間先予測',persistence:'持続予測',projection:'投影表示'};
  $('url-notice').textContent=warnings.map(item=>`${labels[item.field]??'URL項目'}：${item.message}`).join(' ');
  $('url-notice').hidden=warnings.length===0;
  syncReferenceLinks(document,window.location.search);
}
function renderSeriesChoices(result,rows) {
  extraSeries=savedSeries(result,rows);
  if(seriesBasin!==result.basin_id) {selectedSeries=new Set(extraSeries.map(item=>item.key));seriesBasin=result.basin_id;}
  const list=$('saved-series-list');list.replaceChildren();
  $('saved-series-panel').hidden=extraSeries.length===0;
  $('saved-series-controls').hidden=extraSeries.length===0;
  for(const item of extraSeries) {
    const entry=node('li'),label=node('label'),input=node('input');
    input.type='checkbox';input.checked=selectedSeries.has(item.key);
    input.addEventListener('change',()=>{input.checked?selectedSeries.add(item.key):selectedSeries.delete(item.key);drawCharts(displayed);inspect(Number($('time-inspector').value));recordScene();});
    const swatch=node('span',null,`saved-swatch saved-${item.style}`);swatch.setAttribute('aria-hidden','true');swatch.style.borderColor=item.stroke;
    label.append(input,swatch,node('span',`${item.label} (${item.unit}) / ${lineStyleLabel(item.style)}`));
    const conditions=node('details');
    conditions.append(node('summary','条件・出典'),node('p',`評価条件：${item.evaluation_conditions}。既存指標とは比較しません。`,'muted'));
    if(item.source) conditions.append(node('p',`出典：${item.source}`,'muted'));
    entry.append(label,conditions);
    list.append(entry);
  }
}
function drawCharts(rows) {
  inspectionNotice.cancel();
  const q=$('q-chart'),rain=$('rain-chart');q.replaceChildren();rain.replaceChildren();
  if(rows.length===0) throw new Error('選択した期間に表示できる時系列がありません');
  const showPersistence=$('persistence-toggle').checked;
  const showObserved=$('observed-toggle').checked,showPrediction=$('prediction-toggle').checked;
  const persistence=row=>comparison.values.get(Date.parse(row.target_time));
  const active=extraSeries.filter(item=>selectedSeries.has(item.key));
  const flowSeries=active.filter(item=>item.unit==='m³/s');
  const visibleFlowSeries=[...chartSeries(persistence,showPersistence,{observed:showObserved,prediction:showPrediction}),...flowSeries];
  const flowState=flowChartState(visibleFlowSeries);
  $('flow-empty').hidden=flowState.showYAxis;
  q.setAttribute('aria-label',flowState.ariaLabel);
  const values=rows.flatMap(row=>visibleFlowSeries.map(item=>item.valueOf(row))).filter(Number.isFinite);
  const {min,max}=valueBounds(values);
  const chart=axes(q,rows,235,min,max,flowState);
  const purged=rows.filter(row=>row.reason==='origin_before_cutoff');
  if(purged.length>0) {
    const start=chart.x(Date.parse(purged[0].target_time));
    const end=chart.x(Date.parse(purged.at(-1).target_time)+3600000);
    q.append(svgNode('rect',{x:start,y:chart.top,width:Math.max(1,end-start),height:chart.bottom-chart.top,fill:'#e8ab68',opacity:.14}),svgNode('title',{},'予測開始時刻が学習・検証終了より前なので除外'));
  }
  drawSavedLines(q,rows,visibleFlowSeries,chart);
  const separate=$('saved-series-charts');separate.replaceChildren();
  for(const group of seriesGroups(active.filter(item=>item.unit!=='m³/s'))) {
    const section=node('section',null,'panel chart-panel');
    section.append(node('h2',`追加系列 (${group.unit})`),node('p',group.series.map(item=>item.label).join(' / ')));
    const scroll=node('div',null,'chart-scroll');scroll.tabIndex=0;
    scroll.setAttribute('role','region');scroll.setAttribute('aria-label',`追加系列 ${group.unit}。目的時刻は共通のスライダーで選択できます`);
    const svg=svgNode('svg',{viewBox:'0 0 920 235',role:'img','aria-label':`${group.series.map(item=>item.label).join(' / ')} (${group.unit})`});
    const values=rows.flatMap(row=>group.series.map(item=>item.valueOf(row))).filter(Number.isFinite);
    const bounds=valueBounds(values);
    const chart=axes(svg,rows,235,bounds.min,bounds.max);
    drawSavedLines(svg,rows,group.series,chart);scroll.append(svg);section.append(scroll);
    attachChartInspection(svg,scroll,235);
    section.append(node('p','単位が異なる系列は独立した縦軸に表示します。比較指標は算出しません。','chart-note'));separate.append(section);
  }
  const rainMax=valueBounds(rows.map(row=>row.rain)).max/1.05*1.1;
  const rainAxes=axes(rain,rows,175,0,rainMax);
  const barWidth=Math.max(.3,rainAxes.x(Date.parse(rows[0].target_time)+3600000)-rainAxes.x(Date.parse(rows[0].target_time)));
  rows.forEach(row=>{
    if(Number.isFinite(row.rain)&&row.rain>0) rain.append(svgNode('rect',{x:rainAxes.x(Date.parse(row.target_time))-barWidth,y:rainAxes.y(row.rain),width:barWidth,height:rainAxes.bottom-rainAxes.y(row.rain),fill:'#087f8c',opacity:.8}));
  });
  for(const svg of [q,rain]) attachChartInspection(svg,svg.parentElement,svg===q?235:175);
}
function attachChartInspection(svg,scroll,height) {
  svg.append(svgNode('line',{class:'inspection-cursor',x1:65,x2:65,y1:14,y2:height-65,stroke:'#849b9d','stroke-dasharray':'3 3','pointer-events':'none'}));
  if(scroll.dataset.inspectionBound) return;
  scroll.dataset.inspectionBound='true';
  bindChartInspection(scroll,()=>displayed.length,()=>Number($('time-inspector').value),(index,source)=>{inspect(index);scrollInspection(index);recordScene('replace');inspectionNotice.announce(displayed[index].target_time,source);},svg);
}

const missingValue=value=>Number.isFinite(value)?value.toFixed(3):'欠測';
const reasonLabel=adoptionReasonLabel;
function inspect(index) {
  inspectionNotice.cancel();
  $('display-feedback').textContent='';
  const row=displayed[index];if(!row) return;
  const prediction=testPrediction(row);
  $('time-inspector').value=String(index);
  const timestamp=`${formatJST(row.target_time)} JST`;
  $('time-inspector').setAttribute('aria-valuetext',timestamp);
  $('inspection-time').textContent=timestamp;
  $('origin-time').textContent=`${formatJST(row.origin_time)} JST`;
  $('target-time').textContent=timestamp;
  $('lead-time').textContent=`${selected.result.horizon_h}時間`;
  const list=node('dl');
  for(const [label,value] of [
    ['観測',`${missingValue(row.observed)} m³/s`],
    ['6時間先',prediction===null?'未生成 / 不採用':`${prediction.toFixed(3)} m³/s`],
    ['持続予測',persistenceReference(row,comparison)],
    ['雨量',`${missingValue(row.rain)} mm`],
    ['予測開始時刻',`${formatJST(row.origin_time)} JST`],
    ['予測先行時間',`${selected.result.horizon_h}時間`],
    ['採否',reasonLabel(row.reason)]]) list.append(node('dt',label),node('dd',value));
  for(const item of extraSeries.filter(item=>selectedSeries.has(item.key))) list.append(node('dt',item.label),node('dd',seriesReference(item,row)));
  $('inspection-values').replaceChildren(list);
  const position=65+index/Math.max(displayed.length-1,1)*835;
  for(const cursor of document.querySelectorAll('.inspection-cursor')) {cursor.setAttribute('x1',position);cursor.setAttribute('x2',position);}
}
function scrollInspection(index,center=false) {
  for(const scroll of document.querySelectorAll('.chart-scroll')) {
    scroll.scrollLeft=inspectionScrollLeft(index,displayed.length,scroll.scrollWidth,scroll.clientWidth,scroll.scrollLeft,center);
  }
}
function render() {
  inspectionNotice.cancel();
  try {
    selected=selectBasin(bundle,$('basin-select').value);
    const {basin,result,rows,stations}=selected;
    $('basin-name').textContent=basin.properties.name;
    $('basin-summary').textContent=`流域ID ${result.basin_id} / 集水域 ${Number(basin.properties.area_km2).toFixed(1)} km²`;
    drawMap(basin,stations);
    $('nse').textContent=metricLabel(result.nse,result.nse_reason);
    $('rmse').textContent=metricLabel(result.rmse);
    $('samples').textContent=result.n_samples.toLocaleString('ja-JP');
    $('exclusions').textContent=`除外 ${result.n_excluded}（欠測 ${result.excluded_by_reason.missing} / 予測開始時刻の制約 ${result.excluded_by_reason.origin_before_cutoff}）`;
    details('settings',[['予測に使う観測','流量と雨量'],['予測する量','流量'],['予測先行時間',`${result.horizon_h}時間`],['参照する観測履歴',`${result.tau_h}時間（現在値を含む）`],['リッジ回帰の正則化係数',result.alpha],['標準化',result.standardize?'学習行だけから計算':'なし'],['正則化係数の選択','検証期間のRMSEが最小となる値（候補：0.1 / 1 / 10）']]);
    const period=(start,end)=>`${formatJST(start)} → ${formatJST(end)} JST`;
    details('periods',[['学習',period(result.train_period_start,result.train_period_end)],['検証',period(result.valid_period_start,result.valid_period_end)],['評価',period(result.period_start,result.period_end)],['学習終了時刻',`${formatJST(result.fit_cutoff)} JST`],['検証終了時刻',`${formatJST(result.selection_cutoff)} JST`]]);
    $('partition-counts').textContent=['train','valid','test'].map((name,i)=>{const p=result.partitions[name];return `${['学習','検証','評価'][i]}：採用 ${p.n_samples} / 除外 ${p.n_excluded} / 予測履歴の準備 ${p.n_context}`;}).join('、');
    for(const [value,column] of [['peak-rain','rain'],['peak-q','q']]) {
      const option=$('period-select').querySelector(`option[value="${value}"]`);
      option.disabled=eventWindow(rows,result,column).reason!==null;
      option.textContent=(column==='rain'?'雨量':'流量')+'最大の周辺7日'+(option.disabled?'（観測なし）':'');
    }
    const view=selectView(rows,result,overview.custom||customRange?'all':$('period-select').value);
    if(overview.custom) view.rows=overview.window(rows,result).rows;
    if(customRange) view.rows=rangeWindow(rows,result,Date.parse(customRange.start),Date.parse(customRange.end)).rows;
    // Basin switching may invalidate a previously selected observed-peak window.
    // Keep the existing visible reason, while recording the actual all-period view.
    if(view.event?.reason) $('period-select').value='all';
    displayed=view.rows;comparison=view.comparison;
    overview.sync(rows,result,displayed);
    $('range-start').min=jstInput(Date.parse(result.period_start));$('range-start').max=jstInput(Date.parse(result.period_end)-3600000);
    $('range-end').min=jstInput(Date.parse(result.period_start)+3600000);$('range-end').max=jstInput(Date.parse(result.period_end));
    $('range-start').value=jstInput(Date.parse(displayed[0].target_time));
    $('range-end').value=jstInput(Date.parse(displayed.at(-1).target_time)+3600000);
    $('range-error').hidden=true;
    const baseline=savedPersistence(result);
    $('persistence-rmse').textContent=metricLabel(baseline.rmse);
    $('persistence-score').textContent=`NSE ${metricLabel(baseline.nse,baseline.nse_reason)} / 同一採用 ${baseline.n_samples.toLocaleString('ja-JP')}時刻`;
    const reading=resultReadingState(bundle.results,result);
    $('comparison-finding').textContent=reading.finding;
    $('intro-context').textContent=reading.synthetic?'表示確認用の合成データです。値・流域形状・観測点は人工で、予測性能の評価には使えません。':'既存デモの保存結果です。過去の観測と予測を確認する画面で、リアルタイム予測ではありません。';
    $('target-summary').textContent=`対象：${basin.properties.name} / 流量（m³/s）/ 先行時間 ${result.horizon_h}時間 / 保存間隔 1時間。評価期間：${period(result.period_start,result.period_end)}（終了時刻を含まない）。`;
    $('reading-status').textContent=reading.synthetic?'値・形状・観測点は合成です。表示確認用であり、研究成果や実際の予測性能を示しません。':'過去に保存した結果です。研究系列の採用確認や一般公開の判断とは別に扱います。';
    $('chart-conditions').textContent=`予測対象時刻の${result.horizon_h}時間前が予測開始時刻です。1時間間隔の保存値を表示します。これは情報の更新頻度を表しません。`;
    $('evaluation-scope').textContent=`全評価期間：${period(result.period_start,result.period_end)}（終了時刻を含まない）。予測と持続予測を同じ採用 ${result.n_samples.toLocaleString('ja-JP')}時刻で比較します。図の表示範囲や系列を変えても指標は変わりません。`;
    $('evaluation-status').textContent=reading.synthetic?'以下の数値も合成データの検査値です。性能評価には使えません。':'';
    $('evaluation-status').hidden=!reading.synthetic;
    $('interpretation-status').textContent=reading.synthetic?'この画面から確認できるのは表示と操作の動作です。合成データから予測の実用性や防災上の効果は判断できません。':'この結果の解釈は、ここに示す流域、期間、先行時間、採用時刻に限定します。';
    $('event-note').hidden=view.event===null;
    if(view.event) $('event-note').textContent=view.event.reason?'観測最大を選べないため評価期間全体を表示します。':`評価期間の観測${$('period-select').value==='peak-rain'?'雨量':'流量'}最大：${formatJST(new Date(view.event.peakTime).toISOString())} JST / ${view.event.peakValue} ${$('period-select').value==='peak-rain'?'mm':'m³/s'}。前後84時間の閲覧です（境界では短くなります）。指標は全評価期間のままです。`;

    renderSeriesChoices(result,rows);
    drawCharts(displayed);
    $('window-label').textContent=`表示期間 ${displayPeriod(displayed)}（${displayed.length.toLocaleString('ja-JP')}時間）`;
    $('time-inspector').max=String(displayed.length-1);
    const restored=requestedAt===null?-1:displayed.findIndex(row=>Date.parse(row.target_time)===Date.parse(requestedAt));
    requestedAt=null;
    const initial=restored>=0?restored:initialInspectionIndex(displayed,view.event?.peakTime??null);inspect(initial);
    $('candidate-status').textContent=reading.synthetic?'表示確認用の合成データです。実データの採用・公開条件を示すものではありません。':'未公開の候補データです。以下の確認が必要です。';
    const blockerLabels={
      'Original source-access dates absent from acquisition manifests':'元の取得記録に源泉参照日がありません。',
      'Exact J-FlwDir version used to generate existing polygons not established':'集水域を生成したJ-FlwDirの使用版が未確認です。',
      'Collaborator selection agreement pending':'候補の選定について共同研究者との合意が必要です。',
      'Station-specific discharge measurement/H-Q conversion provenance pending':'局ごとの流量観測とH-Q換算の来歴が未確認です。',
    };
    $('blockers').replaceChildren(...bundle.results.public_release_blockers.map(text=>{const li=node('li',blockerLabels[text]??text);li.title=text;return li;}));
    details('versions',[['データ版',bundle.results.dataset_version],['予測ライブラリの版',bundle.results.library_version],['データ処理ライブラリの版',bundle.results.data_library_version],['形式版',bundle.results.schema_version],['生成日時',`${formatJST(bundle.results.generated_at)} JST`]]);
    $('extension-information')?.remove();
    $('versions').after(extensionDetails(document,bundle.results,result));
    const terms=bundle.basins.provenance?.source_terms;
    $('source-links').replaceChildren();
    if(terms) {
      for(const [key,label] of [['observations','観測値の出典'],['geometry','集水域の出典']]) {
        const source=terms[key];if(!source) continue;
        const li=node('li');
        if(/^https?:\/\//.test(source.url)) {const link=node('a',`${label}（${source.license}）`);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';li.append(link);}
        else li.textContent=`${label}（${source.license}）`;
        $('source-links').append(li);
      }
      $('source-dates').textContent=`源泉参照日：${terms.observations?.reference_date??'未確認'}。J-FlwDir使用版：${terms.geometry?.version??'未確認'}。`;
    }
    const rainMethod=bundle.basins.provenance?.rain_methods?.[result.basin_id];
    $('rain-method').textContent=rainMethod==='single_station_no_aggregation'?'雨量は対応する観測点1局の値です。複数局の空間平均ではありません。':'雨量の集約方法：未確認';
    if(evaluationRoot) updateEvaluationSelection(evaluationRoot,result.basin_id);
    periodMenu.sync();
    $('content').hidden=false;$('load-status').hidden=true;$('error').hidden=true;
    requestAnimationFrame(()=>scrollInspection(initial,true));
  } catch(error) {fail(error);}
}
async function start() {
  try {
    bundle=await loadBundle('data/');
    periodMenu=bindPeriodMenu(document);
    requireSixHourDemo(bundle);
    viewTabs=bindViewTabs({tabs:{timeseries:$('timeseries-tab'),evaluation:$('evaluation-tab')},panels:{timeseries:$('timeseries-panel'),evaluation:$('evaluation-panel')},onActivate:view=>{inspectionNotice.cancel();currentView=view;recordScene();}});
    evaluationRoot=evaluationTableDOM(document,buildEvaluationTable(bundle),{selectedBasinId:bundle.results.results[0].basin_id,onSelectBasin:changeBasin,onShowTimeseries:()=>{setView('timeseries');recordScene();}});
    $('evaluation-content').append(evaluationRoot);
    $('basin-select').replaceChildren(...bundle.results.results.map(item=>{
      const basin=bundle.basins.features.find(feature=>feature.properties.basin_id===item.basin_id);
      const option=node('option',basin.properties.name);option.value=item.basin_id;return option;
    }));
    $('basin-select').addEventListener('change',()=>changeBasin($('basin-select').value));
    $('period-select').addEventListener('change',()=>{overview.reset();customRange=null;$('range-details').open=false;render();recordScene();});
    for(const id of ['observed-toggle','prediction-toggle','persistence-toggle']) $(id).addEventListener('change',()=>{try {const index=Number($('time-inspector').value);drawCharts(displayed);inspect(index);recordScene();} catch(error) {fail(error);}});
    $('reset-display').addEventListener('click',()=>{
      overview.reset();customRange=null;$('range-details').open=false;
      resetDisplayControls({period:$('period-select'),observed:$('observed-toggle'),prediction:$('prediction-toggle'),persistence:$('persistence-toggle')});
      selectedSeries=new Set(extraSeries.map(item=>item.key));
      render();
      recordScene();
      $('display-feedback').textContent='流域を維持し、期間・系列・参照時刻を標準表示へ戻しました。';
    });
    function applyRange(days=null) {
      try {
        const start=parseJSTInput($('range-start').value);
        const end=days===null?parseJSTInput($('range-end').value):presetEnd(start,days);
        rangeWindow(selected.rows,selected.result,start,end);
        customRange={start:new Date(start).toISOString(),end:new Date(end).toISOString()};
        overview.reset();$('period-select').value='range';
        render();recordScene();
        $('range-details').open=false;$('range-details').querySelector('summary').focus();
        $('display-feedback').textContent='指定期間を表示しました。評価指標は全評価期間の値です。';
      } catch(error) {
        $('range-error').textContent=error.message;$('range-error').hidden=false;
        const invalidStart=!$('range-start').value||!$('range-start').validity.valid;
        $(invalidStart?'range-start':'range-end').focus();
      }
    }
    const closeRange=()=>{$('range-details').open=false;$('range-details').querySelector('summary').focus();};
    $('range-close').addEventListener('click',closeRange);
    $('range-details').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeRange();}});
    $('range-form').addEventListener('submit',event=>{event.preventDefault();applyRange();});
    for(const button of document.querySelectorAll('[data-range-days]')) button.addEventListener('click',()=>applyRange(Number(button.dataset.rangeDays)));
    $('time-inspector').addEventListener('input',event=>{const index=Number(event.target.value);inspect(index);scrollInspection(index);recordScene('replace');});
    $('time-inspector').addEventListener('keydown',()=>{inspectorKeyboard=true;});
    $('time-inspector').addEventListener('keyup',()=>{inspectorKeyboard=false;});
    $('time-inspector').addEventListener('pointerdown',()=>{inspectorKeyboard=false;});
    $('time-inspector').addEventListener('change',()=>{const row=displayed[Number($('time-inspector').value)];if(row) inspectionNotice.announce(row.target_time,inspectorKeyboard?'keyboard':'change');});
    sceneHistory=createSceneHistory(window,bundle,restoreScene);
    sceneHistory.restore();
  } catch(error) {fail(error);}
}
if(location.protocol!=='file:') start();
