import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerReturnHref,referencePageHref,syncReferenceLinks,setupReferencePage} from '../reference-pages.mjs';
const scene='?v=1&dataset=saved&basin=synthetic-b&view=evaluation&period=7&at=2024-12-26T06%3A00%3A00Z&series=%5B%5D&observed=0&prediction=1&persistence=0';
const encoded=query=>`?${new URLSearchParams({scene:query})}`;
function link(page) {return {attrs:page?{'data-reference-page':page}:{},getAttribute(key){return this.attrs[key];},setAttribute(key,value){this.attrs[key]=value;}};}
test('FAQ, quality and viewer round trip retains exact viewing conditions',()=>{
 const faq=referencePageHref('faq.html',scene);
 assert.equal(viewerReturnHref(new URL(faq,'https://local.test/demo/').search),`./${scene}`);
 const back=link(), quality=link('quality.html');
 const root={querySelectorAll(selector){return selector==='[data-viewer-link]'?[back]:[quality];}};
 setupReferencePage(root,encoded(scene));
 assert.equal(back.attrs.href,`./${scene}`);
 assert.equal(viewerReturnHref(new URL(quality.attrs.href,'https://local.test/demo/').search),`./${scene}`);
});
for(const value of ['https://evil.test/path','//evil.test/path','javascript:alert(1)','?unknown=1','?basin=a&basin=b']) {
 test(`unsafe or invalid scene returns fixed local default: ${value}`,()=>{
  assert.equal(viewerReturnHref(encoded(value)),'./');
  assert.equal(referencePageHref('faq.html',value),'faq.html');
 });
}
test('missing, duplicate and unknown outer parameters fall back',()=>{
 for(const search of ['', '?scene=&scene=',`${encoded(scene)}&next=https://evil.test`]) assert.equal(viewerReturnHref(search),'./');
 assert.equal(referencePageHref('https://evil.test/',scene),'./');
});
test('reference links resync from current location after state changes',()=>{
 const faq=link('faq.html'),quality=link('quality.html');
 const root={querySelectorAll(){return [faq,quality];}};
 syncReferenceLinks(root,scene);
 assert.equal(faq.attrs.href,referencePageHref('faq.html',scene));
 syncReferenceLinks(root,'?basin=other&view=timeseries');
 assert.equal(quality.attrs.href,referencePageHref('quality.html','?basin=other&view=timeseries'));
});

test('evaluation policy round trip preserves scene through FAQ and quality',()=>{
 const policy=referencePageHref('evaluation-policy.html',scene);
 assert.equal(new URL(policy,'https://local.test/demo/').pathname,'/demo/evaluation-policy.html');
 assert.equal(viewerReturnHref(new URL(policy,'https://local.test/demo/').search),`./${scene}`);
 const back=link(),faq=link('faq.html'),quality=link('quality.html');
 setupReferencePage({querySelectorAll(selector){return selector==='[data-viewer-link]'?[back]:[faq,quality];}},new URL(policy,'https://local.test/demo/').search);
 assert.equal(back.attrs.href,`./${scene}`);
 for(const item of [faq,quality]) assert.equal(viewerReturnHref(new URL(item.attrs.href,'https://local.test/demo/').search),`./${scene}`);
});
test('evaluation policy rejects invalid scenes and outer destinations',()=>{
 assert.equal(referencePageHref('evaluation-policy.html','?unknown=1'),'evaluation-policy.html');
 for(const search of [encoded('//evil.test'),`${encoded(scene)}&next=https://evil.test`,`${encoded(scene)}&scene=x`]) {
  const back=link(),policy=link('evaluation-policy.html');
  setupReferencePage({querySelectorAll(selector){return selector==='[data-viewer-link]'?[back]:[policy];}},search);
  assert.equal(back.attrs.href,'./');
  assert.equal(policy.attrs.href,'evaluation-policy.html');
 }
});

test('centered window query round trips through reference pages independently of inspection time',()=>{
 const params=new URLSearchParams(scene);params.set('period','center');params.set('center','2024-12-25T06:00:00.000Z');
 const centered=`?${params.toString()}`;
 for(const page of ['faq.html','quality.html','evaluation-policy.html']) {
  const target=referencePageHref(page,centered);
  assert.equal(viewerReturnHref(new URL(target,'https://local.test/demo/').search),`./${centered}`);
 }
});
