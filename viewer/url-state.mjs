import {rangeWindow} from './range.mjs';
/** URL state controls viewing only; loaded bundle contracts remain authoritative. */
import {initialInspectionIndex, selectView} from './ui.mjs';
import {centeredWindow} from './overview.mjs';

const KEYS = ['v', 'dataset', 'basin', 'h', 'view', 'period', 'center', 'start', 'end', 'at', 'series', 'observed', 'prediction', 'persistence', 'projection'];
const PERIODS = ['all', '7', '30', 'peak-rain', 'peak-q', 'center', 'range'];
const warning = (field, message) => ({field, message});

/** Parse a query without fetching anything or changing browser history. */
export function parseScene(search) {
  const params = new URLSearchParams(search);
  const values = {}, warnings = [];
  for (const [key, value] of params) {
    if (!KEYS.includes(key)) {
      warnings.push(warning(key, '対応していないURL項目です。表示を初期化しました。'));
    } else if (Object.hasOwn(values, key)) {
      warnings.push(warning(key, 'URL項目が重複しています。表示を初期化しました。'));
    } else {
      values[key] = value;
    }
  }
  return {values, warnings, fatal: warnings.length > 0};
}

/** Validate calendar components explicitly: Date.parse alone normalizes February 30. */
function targetInstant(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone, sign, offsetHour = '0', offsetMinute = '0'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, min, sec] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  date.setUTCHours(h, min, sec, Number(fraction.padEnd(3, '0')));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const offset = zone === 'Z' ? 0 : (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '+' ? 1 : -1);
  const instant = date.getTime() - offset * 60000;
  return Number.isFinite(instant) ? instant : null;
}

function defaultState(bundle) {
  const result = bundle.results.results.find(item => item.horizon_h === 6);
  if (!result) throw new Error('URLで表示できる6時間先の保存結果がありません');
  const view = selectView(bundle.series[result.basin_id], result, 'all');
  const initial = initialInspectionIndex(view.rows);
  if (!view.rows[initial]) throw new Error('URLで参照できる評価期間の保存値がありません');
  return {v: '1', dataset: bundle.results.dataset_version, basin: result.basin_id,
    h: 6, view: 'timeseries', period: 'all', at: new Date(view.rows[initial].target_time).toISOString(),
    series: (result.extensions?.series ?? []).map(item => item.id), observed: true, prediction: true, persistence: true};
}

/** Resolve defaults and warnings against the already validated, local saved data. */
export function resolveScene(search, bundle) {
  const parsed = parseScene(search), warnings = [...parsed.warnings], values = parsed.values;
  const state = defaultState(bundle);
  let fallback = parsed.fatal;
  for (const [field, valid, message] of [
    ['v', values.v === '1', 'URLの形式版に対応していません。表示を初期化しました。'],
    ['dataset', values.dataset === state.dataset, 'URLと読み込んだデータの版が異なります。表示を初期化しました。'],
    ['basin', bundle.results.results.some(item => item.basin_id === values.basin && item.horizon_h === 6), 'URLの流域を表示できません。表示を初期化しました。'],
  ]) {
    if (Object.hasOwn(values, field) && !valid) {warnings.push(warning(field, message)); fallback = true;}
  }
  if (fallback) return {state, warnings, fallback};

  if (Object.hasOwn(values, 'basin')) state.basin = values.basin;
  const result = bundle.results.results.find(item => item.basin_id === state.basin && item.horizon_h === 6);
  const rows = bundle.series[state.basin];
  const allowedSeries = (result.extensions?.series ?? []).map(item => item.id);
  state.series = [...allowedSeries];
  if (Object.hasOwn(values, 'h') && values.h !== '6') warnings.push(warning('h', '対応する先行時間は6時間です。6時間先を表示しました。'));
  if (Object.hasOwn(values, 'view')) {
    if (['timeseries', 'evaluation'].includes(values.view)) state.view = values.view;
    else warnings.push(warning('view', '表示画面が不正です。時系列を表示しました。'));
  }
  if (Object.hasOwn(values, 'period')) {
    if (PERIODS.includes(values.period)) state.period = values.period;
    else warnings.push(warning('period', '表示期間が不正です。評価期間全体を表示しました。'));
  }
  if (state.period === 'center') {
    const instant = targetInstant(values.center);
    const start = Date.parse(result.period_start), end = Date.parse(result.period_end);
    const row = instant === null || instant < start || instant >= end ? undefined
      : rows.find(item => item.partition === 'test' && Date.parse(item.target_time) === instant);
    if (row) state.center = new Date(instant).toISOString();
    else {
      warnings.push(warning('center', '中心時刻が不正、または評価期間の保存格子にありません。評価期間全体を表示しました。'));
      state.period = 'all';
    }
  } else if (Object.hasOwn(values, 'center')) {
    warnings.push(warning('center', 'この表示期間では中心時刻を使いません。中心時刻を無視しました。'));
  }
  let explicitWindow=null;
  if(state.period==='range') {
    try {
      explicitWindow=rangeWindow(rows,result,targetInstant(values.start),targetInstant(values.end));
      state.start=new Date(explicitWindow.start).toISOString();state.end=new Date(explicitWindow.end).toISOString();
    } catch {
      warnings.push(warning('range','開始・終了日時が不正、または評価期間外です。評価期間全体を表示しました。'));
      state.period='all';
    }
  } else if(Object.hasOwn(values,'start')||Object.hasOwn(values,'end')) {
    warnings.push(warning('range','この表示期間では開始・終了日時を使いません。指定を無視しました。'));
  }
  let view = selectView(rows, result, ['center','range'].includes(state.period) ? 'all' : state.period);
  if(explicitWindow) view={...view,rows:explicitWindow.rows};
  if (state.period === 'center') view = {...view, rows: centeredWindow(rows, result, Date.parse(state.center)).rows};
  if (view.event?.reason) {
    warnings.push(warning('period', '観測最大を選べません。評価期間全体を表示しました。'));
    state.period = 'all'; view = selectView(rows, result, 'all');
  }
  const initial = initialInspectionIndex(view.rows, state.center ? Date.parse(state.center) : view.event?.peakTime ?? null);
  if (!view.rows[initial]) throw new Error('表示期間に参照できる保存値がありません');
  state.at = new Date(view.rows[initial].target_time).toISOString();
  if (Object.hasOwn(values, 'at')) {
    const instant = targetInstant(values.at);
    const row = instant === null ? undefined : view.rows.find(item => Date.parse(item.target_time) === instant);
    if (row) state.at = new Date(instant).toISOString();
    else warnings.push(warning('at', '参照時刻が不正、または表示期間の保存格子にありません。初期参照時刻を表示しました。'));
  }
  if (Object.hasOwn(values, 'series')) {
    let ids;
    try {ids = values.series === '' ? [] : JSON.parse(values.series);} catch {ids = null;}
    if (Array.isArray(ids) && ids.every(id => typeof id === 'string' && allowedSeries.includes(id)) && new Set(ids).size === ids.length) {
      state.series = allowedSeries.filter(id => ids.includes(id));
    } else warnings.push(warning('series', '系列の指定が不正です。この流域の追加系列をすべて表示しました。'));
  }
  for (const field of ['observed', 'prediction', 'persistence']) {
    if (!Object.hasOwn(values, field)) continue;
    if (values[field] === '1' || values[field] === '0') state[field] = values[field] === '1';
    else warnings.push(warning(field, '表示設定が不正です。既定の表示に戻しました。'));
  }
  // Retired display mode remains a validated, inert legacy URL field.
  if(Object.hasOwn(values,'projection')&&!['0','1'].includes(values.projection)) warnings.push(warning('projection','旧表示設定が不正です。通常表示で開きました。'));
  return {state, warnings, fallback: false};
}

/** Canonical JSON series lists preserve arbitrary IDs, including commas.
 * v1 adds optional view; older URLs default to timeseries. Older viewers correctly
 * reject this newly recognized key under their unknown-key fallback policy.
 */
export function serializeScene(state) {
  const instant = targetInstant(state.at);
  if (instant === null) throw new Error('参照時刻にはタイムゾーン付きの実在する日時が必要です');
  const params = new URLSearchParams({v: '1', dataset: state.dataset, basin: state.basin,
    h: String(state.h), view: state.view ?? 'timeseries', period: state.period, at: new Date(instant).toISOString(),
    series: JSON.stringify(state.series), observed: state.observed === false ? '0' : '1', prediction: state.prediction === false ? '0' : '1', persistence: state.persistence ? '1' : '0'});
  if (state.period === 'center') {
    const center = targetInstant(state.center);
    if (center === null) throw new Error('中心時刻にはタイムゾーン付きの実在する日時が必要です');
    params.set('center', new Date(center).toISOString());
  }
  if(state.period==='range') {
    const start=targetInstant(state.start),end=targetInstant(state.end);
    if(start===null||end===null||start>=end||start%3600000||end%3600000) throw new Error('開始・終了日時が不正です');
    params.set('start',new Date(start).toISOString());params.set('end',new Date(end).toISOString());
  }
  return `?${params.toString()}`;
}
