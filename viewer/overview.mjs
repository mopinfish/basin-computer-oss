import {formatJST,lineSegments,visibleRows} from './ui.mjs';
const HOUR=3600000;
export function centeredWindow(rows,result,time) {
  const start=Math.max(Date.parse(result.period_start),time-84*HOUR);
  const end=Math.min(Date.parse(result.period_end),time+84*HOUR);
  return {start,end,rows:rows.filter(row=>{const t=Date.parse(row.target_time);return row.partition==='test'&&t>=start&&t<end;}),clipped:end-start<168*HOUR};
}
export function nearestIndex(rows,time) {
  if(!rows.length)return -1;
  let best=0;
  for(let i=1;i<rows.length;i++) if(Math.abs(Date.parse(rows[i].target_time)-time)<Math.abs(Date.parse(rows[best].target_time)-time)) best=i;
  return best;
}
export function createOverview(document,onConfirm) {
  let center=null,test=[],result=null,candidate=0,section=null;
  const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const svgNode=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  let chart,range,caption,status,ends;
  const timestamp=t=>`${formatJST(new Date(t).toISOString())} JST`;
  function candidateLabel(){if(!test.length){caption.textContent='表示の中心：選択できる時刻がありません';range.value=0;range.setAttribute('aria-valuetext','選択できる時刻がありません');return;}const text=timestamp(Date.parse(test[candidate].target_time));caption.textContent=`表示の中心 ${text}`;range.value=candidate;range.setAttribute('aria-valuetext',text);}
  function confirm(){if(range.disabled)return;center=Date.parse(test[candidate].target_time);onConfirm(center);}
  function mount(){
    section=el('details');section.className='overview';
    const title=el('summary');title.className='overview-title';title.append(el('strong','全評価期間の観測流量'));
    const content=el('div');content.className='overview-content';const hint=el('p','m³/s · クリックで表示／タップ後はボタン');hint.className='overview-hint';
    title.title='概観の観測は詳細図の凡例とは独立して表示します。';
    chart=svgNode('svg',{viewBox:'0 0 900 90',role:'img','aria-label':'全評価期間の観測流量。クリックで周辺7日を表示'});
    ends=el('div');ends.className='overview-endpoints';
    const controls=el('div');controls.className='overview-controls';const label=el('label');label.htmlFor='overview-center';caption=el('span');range=el('input');range.id='overview-center';range.type='range';range.min=0;range.step=1;
    label.append(caption,range);const button=el('button','周辺7日を表示');button.type='button';controls.append(label,button);button.title='タッチは概観で候補を選んでこのボタンで確定。キーボードは中心候補スライダーで移動しEnterで確定。';
    status=el('p');status.className='overview-status';status.setAttribute('role','status');
    content.append(hint,chart,ends,controls,status);section.append(title,content);document.querySelector('.flow-panel').before(section);
    range.addEventListener('input',()=>{candidate=Number(range.value);candidateLabel();});range.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();confirm();}});button.addEventListener('click',confirm);
    chart.addEventListener('pointerup',event=>{if(range.disabled)return;const matrix=chart.getScreenCTM();if(!matrix)return;const point=chart.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const fraction=Math.max(0,Math.min(1,point.matrixTransform(matrix.inverse()).x/900));candidate=nearestIndex(test,Date.parse(result.period_start)+fraction*(Date.parse(result.period_end)-Date.parse(result.period_start)));candidateLabel();if(event.pointerType==='mouse')confirm();});
  }
  return {
    get custom(){return center!==null;},
    get center(){return center;},
    restore(time){center=time==null?null:Date.parse(time);if(!Number.isFinite(center))center=null;if(center===null)document.getElementById('period-select').querySelector('[value="center"]')?.remove();},
    reset(){center=null;document.getElementById('period-select').querySelector('[value="center"]')?.remove();},
    window(rows,result){return centeredWindow(rows,result,center);},
    sync(rows,currentResult,displayed){
      if(!section)mount();result=currentResult;test=visibleRows(rows,result).filter(row=>row.partition==='test');
      candidate=nearestIndex(test,center??Date.parse(displayed[Math.floor(displayed.length/2)]?.target_time??result.period_start));range.max=Math.max(0,test.length-1);candidateLabel();
      const start=Date.parse(result.period_start),end=Date.parse(result.period_end),finite=test.map(row=>row.observed).filter(Number.isFinite),max=Math.max(1,...finite);
      range.disabled=test.length===0||finite.length===0;section.querySelector('button').disabled=range.disabled;
      chart.replaceChildren();const x=t=>(t-start)/Math.max(HOUR,end-start)*900,y=v=>77-v/max*67;
      const window=center===null?{start:Date.parse(displayed[0]?.target_time??result.period_start),end:displayed.length?Date.parse(displayed.at(-1).target_time)+HOUR:Date.parse(result.period_end)}:centeredWindow(rows,result,center);
      chart.append(svgNode('rect',{x:x(window.start),y:4,width:Math.max(1,x(window.end)-x(window.start)),height:78,fill:'#286f70','fill-opacity':'.10',stroke:'#286f70','stroke-width':2}));
      // No averaging/downsampling: original finite hourly points and gap boundaries remain intact.
      for(const segment of lineSegments(test,row=>row.observed)){
        if(segment.length===1)chart.append(svgNode('circle',{cx:x(segment[0].time),cy:y(segment[0].value),r:1.5,fill:'#263f69'}));
        else chart.append(svgNode('path',{d:segment.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.value)}`).join(' '),stroke:'#263f69','stroke-width':1,fill:'none'}));
      }
      ends.replaceChildren(el('span',timestamp(start)),el('span',timestamp(end)));
      status.textContent=finite.length===0?'観測がすべて欠測のため概観から選択できません。表示期間メニューをご利用ください。':`詳細窓 ［${timestamp(window.start)}、${timestamp(window.end)}）${window.clipped?'（評価境界で短縮）':''}。観測は凡例と独立。`;
      if(center!==null){const select=document.getElementById('period-select');let option=select.querySelector('[value="center"]');if(!option){option=el('option','選択時刻の周辺7日');option.value='center';select.append(option);}select.value=option.value;}
    }
  };
}
