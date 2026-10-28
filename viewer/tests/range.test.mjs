import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJSTInput, jstInput, rangeWindow, presetEnd} from '../range.mjs';
const hour=3600000, start=Date.parse('2024-01-01T00:00:00Z');
const result={period_start:new Date(start).toISOString(),period_end:new Date(start+240*hour).toISOString()};
const rows=Array.from({length:240},(_,i)=>({target_time:new Date(start+i*hour).toISOString(),partition:'test',q:i}));
test('JST hourly input is independent of host timezone and calendar-valid',()=>{
 assert.equal(parseJSTInput('2024-01-01T09:00'),start);
 assert.equal(jstInput(start),'2024-01-01T09:00');
 for(const value of ['', '2024-02-30T09:00','2024-01-01T24:00','2024-01-01T09:30','2024-01-01T09:00:01']) assert.throws(()=>parseJSTInput(value));
 assert.equal(jstInput(parseJSTInput('2024-02-29T23:00')),'2024-02-29T23:00');
});
test('explicit half-open range keeps saved rows and includes the final data hour',()=>{
 const before=structuredClone(rows);
 const window=rangeWindow(rows,result,start+216*hour,start+240*hour);
 assert.equal(window.rows.length,24);assert.equal(window.rows[0],rows[216]);assert.equal(window.rows.at(-1),rows[239]);
 assert.deepEqual(rows,before);
});
test('invalid or out-of-bounds ranges fail rather than clipping',()=>{
 for(const [a,b] of [[start,start],[start+hour,start],[start-hour,start+hour],[start,start+241*hour],[start+.5*hour,start+hour],[NaN,start+hour]]) assert.throws(()=>rangeWindow(rows,result,a,b));
 assert.throws(()=>rangeWindow([],result,start,start+hour));
});
test('1/3/7-day presets start at the supplied hour and validate against the same boundaries',()=>{
 for(const days of [1,3,7]) assert.equal(presetEnd(start,days),start+days*24*hour);
 assert.throws(()=>presetEnd(start,2));assert.throws(()=>rangeWindow(rows,result,start+239*hour,presetEnd(start+239*hour,1)));
});
