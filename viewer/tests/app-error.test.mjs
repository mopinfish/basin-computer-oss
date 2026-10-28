import test from 'node:test';
import assert from 'node:assert/strict';

// A missing saved bundle must lead to validated recovery, never regeneration.
test('failed bundle load hides results and offers saved-data recovery for ZIP and checkout', async () => {
  const ids=new Map();
  const element=()=>({hidden:false,children:[],textContent:'',append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];}});
  const previous={document:globalThis.document,location:globalThis.location,fetch:globalThis.fetch,error:console.error};
  const requests=[];
  try {
    globalThis.document={querySelector(){return null;},getElementById(id){if(!ids.has(id)) ids.set(id,element());return ids.get(id);},createElement(tag){return {...element(),tag};}};
    globalThis.location={protocol:'http:',href:'http://127.0.0.1:8765/'};
    globalThis.fetch=async url=>{requests.push(url);return {ok:false,status:404};};
    console.error=()=>{};
    await import('../app.mjs');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ids.get('content').hidden,true);
    assert.equal(ids.get('load-status').hidden,true);
    assert.equal(ids.get('error').hidden,false);
    assert.deepEqual(requests,['http://127.0.0.1:8765/data/results.json']);
    const children=ids.get('error').children;
    const commands=children.filter(n=>n.tag==='pre').map(n=>n.textContent);
    assert.deepEqual(commands,['python -I start_demo.py','python scripts/serve_demo.py']);
    const message=children.map(n=>n.textContent).join('\n');
    assert.match(message,/復元/);
    assert.match(message,/ディレクトリ/);
    assert.match(message,/表示データが見つかりません/);
    assert.doesNotMatch(message,/build_viewer_data|http\.server/);
  } finally {
    for(const key of ['document','location','fetch']) {
      if(previous[key]===undefined) delete globalThis[key];else globalThis[key]=previous[key];
    }
    console.error=previous.error;
  }
});
