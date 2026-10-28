/** Display-only hourly windows. Input controls always represent JST, not host time. */
const HOUR=3600000;
export function parseJSTInput(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(value)) throw new Error('JSTの日時を1時間単位で入力してください。');
  const time=Date.parse(value+':00+09:00');
  if(!Number.isFinite(time)||jstInput(time)!==value) throw new Error('実在する日時を入力してください。');
  return time;
}
export function jstInput(time) {
  return new Date(time+9*HOUR).toISOString().slice(0,16);
}
export function presetEnd(start,days) {
  if(!Number.isFinite(start)||![1,3,7].includes(days)) throw new Error('表示幅は1日、3日、7日から選んでください。');
  return start+days*24*HOUR;
}
export function rangeWindow(rows,result,start,end) {
  if(![start,end].every(t=>Number.isFinite(t)&&t%HOUR===0)) throw new Error('開始・終了日時は1時間単位で指定してください。');
  if(start>=end) throw new Error('終了日時は開始日時より後にしてください。');
  if(start<Date.parse(result.period_start)||end>Date.parse(result.period_end)) throw new Error('開始・終了日時を評価期間内に指定してください。');
  const visible=rows.filter(row=>{const t=Date.parse(row.target_time);return row.partition==='test'&&t>=start&&t<end;});
  if(!visible.length) throw new Error('指定した期間に保存データがありません。');
  return {start,end,rows:visible};
}
