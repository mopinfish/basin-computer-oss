import test from 'node:test';
import assert from 'node:assert/strict';
import {bindViewTabs} from '../view-tabs.mjs';
function setup(){
  let active=null;const changes=[];
  const element=()=>({attributes:{},listeners:{},hidden:false,tabIndex:0,setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this.listeners[k]=f;},focus(){active=this;},contains(el){return el===this.child;}});
  const tabs={timeseries:element(),evaluation:element()},panels={timeseries:element(),evaluation:element()};
  const controller=bindViewTabs({tabs,panels,onActivate:view=>changes.push(view),getActiveElement:()=>active});
  return {tabs,panels,controller,changes,get active(){return active;},set active(value){active=value;}};
}
test('manual tabs move focus with arrows without activation; Enter and Space activate',()=>{
  const x=setup();x.controller.activate('timeseries');
  const key=key=>({key,preventDefault(){this.prevented=true;}});
  x.tabs.timeseries.listeners.keydown(key('ArrowRight'));
  assert.equal(x.active,x.tabs.evaluation);assert.equal(x.tabs.evaluation.tabIndex,0);assert.equal(x.tabs.timeseries.tabIndex,-1);assert.equal(x.panels.evaluation.hidden,true);assert.deepEqual(x.changes,[]);
  x.tabs.evaluation.listeners.keydown(key('Enter'));
  assert.equal(x.panels.timeseries.hidden,true);assert.equal(x.tabs.evaluation.attributes['aria-selected'],'true');assert.deepEqual(x.changes,['evaluation']);
  x.tabs.evaluation.listeners.keydown(key('Home'));assert.equal(x.active,x.tabs.timeseries);
  x.tabs.timeseries.listeners.keydown(key(' '));assert.deepEqual(x.changes,['evaluation','timeseries']);
  x.tabs.timeseries.listeners.keydown(key('End'));assert.equal(x.active,x.tabs.evaluation);
  x.tabs.evaluation.listeners.keydown(key('ArrowRight'));assert.equal(x.active,x.tabs.timeseries);
});
test('restore activation adds no callback and moves focus out of a hidden panel',()=>{
  const x=setup();x.panels.timeseries.child={};x.active=x.panels.timeseries.child;
  x.controller.activate('evaluation');assert.equal(x.active,x.tabs.evaluation);assert.deepEqual(x.changes,[]);
  assert.equal(x.tabs.evaluation.tabIndex,0);assert.equal(x.tabs.timeseries.tabIndex,-1);
  x.tabs.timeseries.listeners.click();assert.deepEqual(x.changes,['timeseries']);
  x.tabs.timeseries.listeners.click();assert.deepEqual(x.changes,['timeseries']);
});

test('restore returns focus to destination tab when rendering removed a focused panel control',async()=>{
  const {restoreRemovedPanelFocus}=await import('../view-tabs.mjs');
  const x=setup(),removed={isConnected:false},retained={isConnected:true};
  restoreRemovedPanelFocus(removed,'evaluation',x.tabs);assert.equal(x.active,x.tabs.evaluation);
  x.active=retained;restoreRemovedPanelFocus(retained,'timeseries',x.tabs);assert.equal(x.active,retained);
  restoreRemovedPanelFocus(null,'timeseries',x.tabs);assert.equal(x.active,retained);
});
