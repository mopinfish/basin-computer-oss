import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../ui.mjs';

const timestamp='2024-08-07T11:00:00+00:00';
// A queued keyboard announcement must describe the final target, never the origin.
test('inspection notice coalesces keyboard targets, while click commits immediately',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const status={textContent:''},notice=ui.createInspectionNotice(status);
  notice.announce(timestamp,'keyboard');
  t.mock.timers.tick(200);
  notice.announce('2024-08-07T12:00:00+00:00','keyboard');
  t.mock.timers.tick(299);assert.equal(status.textContent,'');
  t.mock.timers.tick(1);
  assert.equal(status.textContent,'予測対象時刻を2024/08/07 21:00 JSTに変更しました。');
  notice.announce(timestamp,'click');
  assert.equal(status.textContent,'予測対象時刻を2024/08/07 20:00 JSTに変更しました。');
});

test('display cancellation clears old text and prevents a pending target after restoration',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const status={textContent:''},notice=ui.createInspectionNotice(status);
  notice.announce(timestamp,'click');notice.cancel();assert.equal(status.textContent,'');
  notice.announce(timestamp,'keyboard');notice.cancel();
  t.mock.timers.tick(1000);assert.equal(status.textContent,'');
});

test('chart keyboard and pointer commits identify their source without hover announcements',()=>{
  const handlers={},commits=[];
  const chart={addEventListener:(name,fn)=>{handlers[name]=fn;},getBoundingClientRect:()=>({left:0,width:920})};
  ui.bindChartInspection(chart,()=>3,()=>0,(index,source)=>commits.push([index,source]));
  handlers.keydown({key:'End',preventDefault(){}});
  handlers.click({clientX:65});
  assert.deepEqual(commits,[[2,'keyboard'],[0,'click']]);
  assert.equal(handlers.pointermove,undefined);
});
