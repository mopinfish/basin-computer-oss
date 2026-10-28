import {formatJST,metricLabel} from './ui.mjs';

const selections=new WeakMap();
const blockerLabels={
  'Original source-access dates absent from acquisition manifests':'元の取得記録に源泉参照日がありません。',
  'Exact J-FlwDir version used to generate existing polygons not established':'集水域を生成したJ-FlwDirの使用版が未確認です。',
  'Collaborator selection agreement pending':'候補の選定について共同研究者との合意が必要です。',
  'Station-specific discharge measurement/H-Q conversion provenance pending':'局ごとの流量観測とH-Q換算の来歴が未確認です。',
};
const conditionKey=b=>JSON.stringify([b.periodStart,b.periodEnd,b.horizonH,b.unit]);
const conditions=b=>`全評価期間：［${formatJST(b.periodStart)}、${formatJST(b.periodEnd)}）JST / 先行時間：${b.horizonH}時間 / 流量：${b.unit}`;

/** Render saved scores once; only the selected basin's evidence is expanded. */
export function evaluationTableDOM(document,model,options={}) {
  const node=(tag,text=null)=>{const value=document.createElement(tag);if(text!==null)value.textContent=String(text);return value;};
  const table=(caption,headers,rows,className)=>{
    const region=node('div');region.className='evaluation-table-scroll';
    region.setAttribute('role','region');region.setAttribute('tabindex','0');region.setAttribute('aria-label',caption+'。表は横にスクロールできます');
    const value=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');value.className=className;
    value.append(node('caption',caption));
    for(const label of headers){const th=node('th',label);th.setAttribute('scope','col');tr.append(th);}
    head.append(tr);
    for(const cells of rows){const row=node('tr');cells.forEach((text,index)=>{const cell=node(index===0?'th':'td');if(index===0)cell.setAttribute('scope','row');typeof text==='object'?cell.append(text):cell.textContent=String(text);row.append(cell);});body.append(row);}
    value.append(head,body);region.append(value);return region;
  };
  const root=node('div');root.className='evaluation-table-content';
  root.append(node('h2','全流域の評価一覧'));
  root.append(node('p','全評価期間の保存指標です。図の表示期間や系列選択では変わりません。同じ採用時刻での比較は各流域内の予測と持続予測に限ります。流域間の順位を示す一覧ではありません。'));
  root.append(node('p',`データ版：${model.datasetVersion}`));
  if(model.synthetic||model.basins.some(b=>b.synthetic)){
    const warning=node('p','表示確認用の合成データを含みます。合成の保存値から実際の予測性能は解釈できません。');warning.className='evaluation-table-warning';root.append(warning);
  }
  if(model.publicReleaseBlockers?.length)root.append(node('p','配布・公開に関する未確認事項があります。内容は下部で確認できます。'));
  const common=model.basins.length>0&&model.basins.every(b=>conditionKey(b)===conditionKey(model.basins[0]));
  if(common)root.append(node('p',conditions(model.basins[0])));
  const buttons=[];
  const rows=model.basins.map(b=>{
    const name=node('div'),button=node('button',`${b.basinName}の詳細`);button.type='button';
    button.setAttribute('data-basin-id',b.basinId);button.setAttribute('aria-controls','evaluation-selected-detail');
    button.addEventListener('click',()=>{options.onSelectBasin?.(b.basinId);updateEvaluationSelection(root,b.basinId);});
    buttons.push({id:b.basinId,button});
    name.append(button,node('small',`流域ID ${b.basinId} / ${model.synthetic||b.synthetic?'合成データ':'保存結果'}`));
    const prediction=b.comparable.find(x=>x.id==='model'),baseline=b.comparable.find(x=>x.id==='persistence');
    const cells=[name,metricLabel(prediction.nse,prediction.nseReason),metricLabel(prediction.rmse),metricLabel(baseline.nse,baseline.nseReason),metricLabel(baseline.rmse),prediction.nSamples,prediction.nExcluded];
    if(!common)cells.push(conditions(b));
    return cells;
  });
  const unit=common?model.basins[0].unit:'単位は各行の条件を参照';
  const headers=['流域','6時間先予測 NSE',`6時間先予測 RMSE (${unit})`,'持続予測 NSE',`持続予測 RMSE (${unit})`,'採用時刻数','除外時刻数'];
  if(!common)headers.push('評価条件');
  root.append(table('流域ID順の保存指標。各流域内で同じ採用時刻を使用',headers,rows,'evaluation-overview-table'));
  const detail=node('section');detail.className='evaluation-selected-detail';detail.id='evaluation-selected-detail';detail.setAttribute('aria-label','選択した流域の評価条件');root.append(detail);
  const renderDetail=basin=>{
    const heading=node('h3',`${basin.basinName}の評価条件`),back=node('button',`${basin.basinName}の時系列を見る`);back.type='button';back.addEventListener('click',()=>options.onShowTimeseries?.());
    detail.replaceChildren(heading,back,node('p',conditions(basin)),node('p',basin.sameRowsEvidence));
    const counts=node('dl');counts.className='evaluation-detail-counts';
    for(const item of basin.comparable){counts.append(node('dt',item.label),node('dd',`採用 ${item.nSamples} / 除外 ${item.nExcluded} / 予測履歴の準備 ${item.nContext}。除外理由：欠測 ${item.excludedByReason.missing} / 予測開始時刻の制約 ${item.excludedByReason.origin_before_cutoff}`));}
    detail.append(counts,node('p',`出所：results.json の保存指標 / ${basin.predictionPath} の時刻・採用行との整合を配布物の検査器で確認。`));
    if(basin.nonComparable.length){detail.append(table('比較指標の対象外の追加保存系列',['系列ID / 名前','単位','評価条件','比較の状態','出典'],basin.nonComparable.map(item=>[
      `${item.id} / ${item.label}`,item.unit,item.evaluationConditions,`比較指標なし / 母数未確認。${item.reason}`,item.source??'未記載',
    ]),'extra-series-table'));}
    else detail.append(node('p','比較指標の対象外として登録された追加保存系列はありません。'));
  };
  selections.set(root,{model,buttons,renderDetail});
  updateEvaluationSelection(root,options.selectedBasinId??model.basins[0]?.basinId);
  const technical=node('details');technical.append(node('summary','出所と実装の識別情報'),node('p',`予測ライブラリ：${model.libraryVersion} / データ処理ライブラリ：${model.dataLibraryVersion} / 形式版：${model.schemaVersion}`),node('pre',JSON.stringify(model.implementation,null,2)));root.append(technical);
  if(model.publicReleaseBlockers?.length){const notes=node('details'),list=node('ul');notes.append(node('summary','配布・公開に関する未確認事項'));for(const text of model.publicReleaseBlockers)list.append(node('li',blockerLabels[text]??text));notes.append(list);root.append(notes);}
  return root;
}

/** Keep a single basin selection shared with the chart; overview scores are untouched. */
export function updateEvaluationSelection(root,id) {
  const refs=selections.get(root);if(!refs)return;
  const basin=refs.model.basins.find(b=>b.basinId===id);
  if(!basin)throw new Error('評価条件を表示する流域がありません');
  for(const item of refs.buttons)item.button.setAttribute('aria-pressed',String(item.id===id));
  refs.renderDetail(basin);
}
