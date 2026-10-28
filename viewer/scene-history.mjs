import {resolveScene,serializeScene} from './url-state.mjs';

/** Separate browser history from rendering; restoration never records an operation. */
export function createSceneHistory(browser,bundle,apply) {
  let restoring=false;
  const restore=()=>{
    restoring=true;
    try {apply(resolveScene(browser.location.search,bundle));}
    finally {restoring=false;}
  };
  browser.addEventListener('popstate',restore);
  return {restore,commit(mode,state) {
    if(restoring) return false;
    const search=serializeScene(state);
    if(search===browser.location.search) return false;
    browser.history[mode==='replace'?'replaceState':'pushState'](null,'',browser.location.pathname+search+browser.location.hash);
    return true;
  }};
}
