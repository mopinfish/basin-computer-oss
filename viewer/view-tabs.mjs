/** Manual activation: arrow keys move focus; Enter, Space or click select a view. */
export function bindViewTabs({tabs,panels,onActivate,getActiveElement=()=>document.activeElement}) {
  const views=Object.keys(tabs);let selected;
  function activate(view) {
    const active=getActiveElement();
    const hidingFocusedPanel=views.some(key=>key!==view&&panels[key].contains(active));
    selected=view;
    for(const key of views){tabs[key].setAttribute('aria-selected',String(key===view));tabs[key].tabIndex=key===view?0:-1;panels[key].hidden=key!==view;}
    if(hidingFocusedPanel) tabs[view].focus();
  }
  const choose=view=>{if(selected===view)return;activate(view);onActivate(view);};
  for(const [index,view] of views.entries()) {
    tabs[view].addEventListener('click',()=>choose(view));
    tabs[view].addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%views.length;
      if(event.key==='ArrowLeft')next=(index+views.length-1)%views.length;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=views.length-1;
      if(next!==undefined){event.preventDefault();for(const key of views)tabs[key].tabIndex=key===views[next]?0:-1;tabs[views[next]].focus();}
      if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(view);}
    });
  }
  return {activate};
}

/** A render may remove the focused detail control before the tab can hide it. */
export function restoreRemovedPanelFocus(previous,view,tabs) {
  if(previous&&!previous.isConnected) tabs[view].focus();
}
