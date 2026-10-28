/** Pure display transformations. All times are target times unless stated. */
export function formatJST(timestamp) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) throw new Error('時刻を解釈できません');
  return new Date(time + 9 * 3600000).toISOString().slice(0,16).replaceAll('-','/').replace('T',' ');
}

export function testPrediction(row) {
  return row.partition === 'test' && row.accepted === true && Number.isFinite(row.prediction) ? row.prediction : null;
}

export function visibleRows(rows, result, period='all') {
  const end = Date.parse(result.period_end);
  let start = Date.parse(result.period_start);
  if (period !== 'all') start = Math.max(start, end - Number(period)*24*3600000);
  return rows.filter(row => {const time=Date.parse(row.target_time); return time>=start && time<end;});
}

export function lineSegments(rows, valueOf) {
  const segments = [];
  let active = null, previous = null;
  for (const row of rows) {
    const time = Date.parse(row.target_time), value = valueOf(row);
    if (!Number.isFinite(value)) {active=null;previous=null;continue;}
    if (active === null || time-previous !== 3600000) {active=[];segments.push(active);}
    active.push({time,value}); previous=time;
  }
  return segments;
}

export function selectBasin(bundle, id) {
  const result=bundle.results.results.find(item=>item.basin_id===id);
  const basin=bundle.basins.features.find(feature=>feature.properties.basin_id===id);
  const rows=bundle.series[id];
  if (!result || !basin || !Array.isArray(rows) || rows.length===0) throw new Error(`流域 ${id} の表示データが不足しています`);
  return {result, basin, rows, stations:bundle.stations.features.filter(feature=>feature.properties.basin_id===id)};
}

export function localProjection(coordinates, width=600, height=400, padding=52) {
  const lon=coordinates.map(p=>p[0]),lat=coordinates.map(p=>p[1]);
  const middleLon=(Math.min(...lon)+Math.max(...lon))/2,middleLat=(Math.min(...lat)+Math.max(...lat))/2;
  const metresPerDegree=6371000*Math.PI/180,cosine=Math.cos(middleLat*Math.PI/180);
  const xy=coordinates.map(p=>[(p[0]-middleLon)*metresPerDegree*cosine,(p[1]-middleLat)*metresPerDegree]);
  const extentX=Math.max(...xy.map(p=>Math.abs(p[0])))*2,extentY=Math.max(...xy.map(p=>Math.abs(p[1])))*2;
  const scale=Math.min((width-2*padding)/Math.max(extentX,1),(height-2*padding)/Math.max(extentY,1));
  return {pixelsPerMetre:scale, point:([x,y])=>[width/2+(x-middleLon)*metresPerDegree*cosine*scale,height/2-(y-middleLat)*metresPerDegree*scale]};
}

export function metricLabel(value,reason=null) {
  if (value===null) return reason==='constant_target'?'未定義（目的値が一定）':`未定義${reason?`（${reason}）`:''}`;
  return Number(value).toFixed(3);
}

export function displayPeriod(rows) {
  if(rows.length===0) throw new Error('表示する時刻がありません');
  const end=new Date(Date.parse(rows.at(-1).target_time)+3600000).toISOString();
  return `［${formatJST(rows[0].target_time)}、${formatJST(end)}）JST`;
}

export function requireSixHourDemo(bundle) {
  const unsupported=bundle.results.results.find(result=>result.horizon_h!==6);
  if(unsupported) throw new Error(`この画面は6時間先予測のみ対応しています（流域 ${unsupported.basin_id}、horizon_h=${unsupported.horizon_h}）`);
}

/** Observation-based browsing; prediction errors never select the window. */
export function eventWindow(rows,result,column) {
  const start=Date.parse(result.period_start),end=Date.parse(result.period_end);
  const test=rows.filter(row=>row.partition==='test' && Date.parse(row.target_time)>=start && Date.parse(row.target_time)<end);
  let peak=null;
  for(const row of test) {
    if(!Number.isFinite(row[column])) continue;
    if(peak===null || row[column]>peak[column]) peak=row;
  }
  if(peak===null) return {rows:[],reason:'no_finite_observation',peakTime:null,peakValue:null};
  const peakTime=Date.parse(peak.target_time),windowStart=Math.max(start,peakTime-84*3600000),windowEnd=Math.min(end,peakTime+84*3600000);
  return {rows:test.filter(row=>{const time=Date.parse(row.target_time);return time>=windowStart&&time<windowEnd;}),
          reason:null,peakTime,peakValue:peak[column],start:windowStart,end:windowEnd};
}

/** q(origin) persistence on exactly the model's full-test adopted target index. */
export function persistenceComparison(rows) {
  const originValues=new Map(rows.map(row=>[Date.parse(row.target_time),row.q]));
  const adopted=rows.filter(row=>row.partition==='test'&&row.accepted===true);
  const values=new Map();
  let missing=0;
  for(const row of adopted) {
    const value=originValues.get(Date.parse(row.origin_time));
    values.set(Date.parse(row.target_time),Number.isFinite(value)?value:null);
    if(!Number.isFinite(value)) missing++;
  }
  const base={values,n_samples:adopted.length,n_missing:missing,rmse:null,nse:null,nse_reason:null};
  if(missing>0) return {...base,available:false,reason:'missing_origin_observation'};
  if(adopted.length===0) return {...base,available:false,reason:'empty_test'};
  if(adopted.some(row=>!Number.isFinite(row.observed))) return {...base,available:false,reason:'missing_target_observation'};
  const mean=adopted.reduce((sum,row)=>sum+row.observed,0)/adopted.length;
  const numerator=adopted.reduce((sum,row)=>sum+(values.get(Date.parse(row.target_time))-row.observed)**2,0);
  const denominator=adopted.reduce((sum,row)=>sum+(row.observed-mean)**2,0);
  const rmse=Math.sqrt(numerator/adopted.length),nse=denominator===0?null:1-numerator/denominator;
  if(!Number.isFinite(rmse)||(nse!==null&&!Number.isFinite(nse))) return {...base,available:false,reason:'numeric_overflow'};
  return {...base,available:true,reason:null,rmse,nse,nse_reason:denominator===0?'constant_target':null};
}

export function selectView(rows,result,period='all') {
  const comparison=persistenceComparison(rows);
  if(period==='peak-rain'||period==='peak-q') {
    const event=eventWindow(rows,result,period==='peak-rain'?'rain':'q');
    return {rows:event.reason?visibleRows(rows,result,'all'):event.rows,comparison,event};
  }
  return {rows:visibleRows(rows,result,period),comparison,event:null};
}

export function persistenceReference(row,comparison) {
  if(row.partition!=='test') return '対象外（評価期間のみ）';
  if(row.accepted!==true) {
    const reason=adoptionReasonLabel(row.reason);
    return `不採用（${reason}）`;
  }
  const value=comparison.values.get(Date.parse(row.target_time));
  return Number.isFinite(value)?`${value.toFixed(3)} m³/s`:'起点の観測が欠測';
}

/** Use an adopted prediction initially; event browsing focuses the observed peak. */
export function initialInspectionIndex(rows,peakTime=null) {
  if(peakTime!==null) {
    const peak=rows.findIndex(row=>Date.parse(row.target_time)===peakTime);
    if(peak>=0) return peak;
  }
  return Math.max(0,rows.findIndex(row=>row.partition==='test'&&row.accepted===true));
}

export function inspectionKeyIndex(key,index,length) {
  if(key==='Home') return 0;
  if(key==='End') return Math.max(0,length-1);
  if(key==='ArrowLeft'||key==='ArrowRight') return Math.max(0,Math.min(length-1,index+(key==='ArrowRight'?1:-1)));
  return null;
}

export function niceTicks(min,max) {
  const low=Math.min(0,min),high=max>low?max:low+1;
  const raw=(high-low)/5,power=10**Math.floor(Math.log10(raw));
  const step=([1,2,5,10].find(value=>value*power>=raw)??10)*power;
  const first=Math.floor(low/step),last=Math.ceil(high/step);
  return Array.from({length:last-first+1},(_,index)=>Number(((first+index)*step).toPrecision(12)));
}

/** Cards use the saved, contract-validated score; CSV lookups supply the line. */
export function savedPersistence(result) {
  const saved=result.baselines?.persistence;
  if(!saved) throw new Error('持続予測の保存指標がありません');
  return saved;
}

export function persistenceFinding(result) {
  const baseline=savedPersistence(result);
  if(!Number.isFinite(result.rmse)||!Number.isFinite(baseline.rmse)) return '保存指標を比較できません。';
  const prefix=`同じテスト採用 ${result.n_samples.toLocaleString('ja-JP')}行で比較：`;
  if(result.rmse===baseline.rmse) return prefix+'RMSEは同じです。';
  return prefix+(baseline.rmse<result.rmse?'持続予測':'6時間先予測')+'のRMSEが小さい結果です。';
}

export function displayError(error) {
  const message=String(error?.message??'');
  if(/sha-?256|checksum/i.test(message)) return '表示データの確認値が一致しません。配布ファイルの組み合わせを確認してください。';
  if(/404|ENOENT|not found|missing file/i.test(message)) return '必要な表示データが見つかりません。';
  if(error instanceof SyntaxError||/JSON/i.test(message)) return '表示データのJSONを読み取れませんでした。';
  if(/persistence|baseline|持続予測/i.test(message)) return '持続予測の保存値と表示データの整合性を確認できませんでした。';
  if(/fetch|network|HTTP|取得/i.test(message)) return '表示データを取得できませんでした。';
  if(/horizon_h|6時間先/.test(message)) return 'この画面で扱える6時間先予測の結果ではありません。';
  return '表示データの形式や整合性の検査、または描画に失敗しました。';
}

/** Keep the inspected cursor inside the viewport, centering only on view change. */
export function inspectionScrollLeft(index,length,scrollWidth,clientWidth,currentLeft,center=false) {
  if(index===0) return 0;
  if(index===length-1) return Math.max(0,scrollWidth-clientWidth);
  const position=(65+index/Math.max(length-1,1)*835)/920*scrollWidth;
  let next=currentLeft;
  if(center) next=position-clientWidth/2;
  else if(position<currentLeft+24) next=position-24;
  else if(position>currentLeft+clientWidth-24) next=position-clientWidth+24;
  return Math.max(0,Math.min(Math.max(0,scrollWidth-clientWidth),next));
}


/** Style belongs to series identity, independent of its color. */
export function chartSeries(persistence,showPersistence=true,{observed=true,prediction=true}={}) {
  const series=[
    {key:'observed',valueOf:row=>row.observed,stroke:'#263f69',width:1.9,dash:'none'},
    {key:'model',valueOf:testPrediction,stroke:'#ad4216',width:3,dash:'4 2'},
  ];
  const visible=series.filter(item=>item.key==='observed'?observed:prediction);
  if(showPersistence) visible.push({key:'persistence',valueOf:persistence,stroke:'#737b86',width:2,dash:'10 5'});
  return visible;
}

/** Describe only the flow series currently drawn, including saved extensions. */
export function flowChartState(series) {
  const labels={observed:'観測',model:'6時間先予測',persistence:'持続予測'};
  return {showYAxis:series.length>0,ariaLabel:series.length
    ? `流量時系列（m³/s）。表示中の系列：${series.map(item=>item.label??labels[item.key]??item.key).join('、')}。`
    : '流量時系列。すべての系列が非表示です。'};
}

/** Display arbitrary metadata as inert text, separately for each scope. */
export function extensionDetails(document,root,result) {
  const container=document.createElement('div');
  container.id='extension-information';
  for(const [label,value] of [['全体の技術情報（元の識別子）',root],['選択した結果の技術情報（元の識別子）',result]]) {
    if(!Object.hasOwn(value,'extensions')) continue;
    const details=document.createElement('details');
    const summary=document.createElement('summary');summary.textContent=label;
    const text=document.createElement('pre');text.textContent=JSON.stringify(value.extensions,null,2);
    // Bound the panel rather than allowing a long metadata string to widen the page.
    text.style && (text.style.whiteSpace='pre-wrap');
    text.style && (text.style.overflowWrap='anywhere');
    details.append(summary,text);container.append(details);
  }
  return container;
}

/** Values come from the validated saved full CSV grid, never a recomputation. */
export function savedSeries(result,rows) {
  const dashes={solid:'none',dashed:'8 4',dotted:'2 4'};
  const colors=['#8052a1','#007f73','#b65c00','#b02d69','#466d14','#455bb0'];
  return (result.extensions?.series??[]).map((item,index)=>{
    const values=new Map(rows.map((row,index)=>[Date.parse(row.target_time),item.values[index]]));
    return {...item,key:item.id,stroke:colors[index%colors.length],width:2.4,dash:dashes[item.style],
      valueOf:row=>values.get(Date.parse(row.target_time))??null};
  });
}

export function seriesGroups(series) {
  const groups=new Map();
  for(const item of series) {
    if(!groups.has(item.unit)) groups.set(item.unit,{unit:item.unit,series:[]});
    groups.get(item.unit).series.push(item);
  }
  return [...groups.values()];
}

export function seriesReference(series,row) {
  const value=series.valueOf(row);
  return Number.isFinite(value)?`${value.toFixed(3)} ${series.unit}`:'欠測 / 未保存';
}

/** Iterate instead of spreading potentially many years and series into arguments. */
export function valueBounds(values) {
  let min=0,max=1;
  for(const value of values) if(Number.isFinite(value)) {min=Math.min(min,value);max=Math.max(max,value);}
  return {min,max:max*1.05};
}

/** Bind each chart when created, including dynamic charts. */
export function bindChartInspection(chart,lengthOf,indexOf,select,pointerChart=chart) {
  chart.addEventListener('keydown',event=>{
    const index=inspectionKeyIndex(event.key,indexOf(),lengthOf());
    if(index!==null) {event.preventDefault();select(index,'keyboard');}
  });
  pointerChart.addEventListener('click',event=>{
    const box=pointerChart.getBoundingClientRect();
    const px=(event.clientX-box.left)/box.width*920;
    select(Math.max(0,Math.min(lengthOf()-1,Math.round((px-65)/835*(lengthOf()-1)))),'click');
  });
}

/** Announce committed target times without reading the whole value list. */
export function createInspectionNotice(status) {
  let timer;
  const cancel=()=>{clearTimeout(timer);timer=null;status.textContent='';};
  return {cancel,announce(targetTime,source) {
    cancel();
    const publish=()=>{timer=null;status.textContent=`予測対象時刻を${formatJST(targetTime)} JSTに変更しました。`;};
    if(source==='keyboard') timer=setTimeout(publish,300);
    else publish();
  }};
}

export function lineStyleLabel(style) {
  return {solid:'実線',dashed:'破線',dotted:'点線'}[style]??'線種未確認';
}

export function adoptionReasonLabel(reason) {
  return {accepted:'採用',missing:'欠測による除外',origin_before_cutoff:'予測開始時刻の制約による除外',context:'予測履歴の準備'}[reason]??'採否の理由未確認';
}

/** Display provenance affects interpretation, never the saved score or adoption. */
export function resultReadingState(root,result) {
  const synthetic=root.extensions?.synthetic===true || result.extensions?.synthetic===true;
  return {synthetic,
    label:synthetic?'表示確認用の合成データ':'保存済みの既存デモ結果',
    finding:synthetic?'合成データの表示確認用の値です。実際の予測性能は解釈できません。':persistenceFinding(result)};
}

/** Reset browsing controls only; callers keep basin, result and evaluation unchanged. */
export function resetDisplayControls(controls) {
  controls.period.value='all';
  if(controls.observed) controls.observed.checked=true;
  if(controls.prediction) controls.prediction.checked=true;
  controls.persistence.checked=true;
}
