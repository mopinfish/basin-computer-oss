// Render choices in the page so the open menu uses the same type scale.
// Keep the existing select as the single source of period/URL state.
export function bindPeriodMenu(document) {
  const select=document.getElementById('period-select');
  const menu=document.getElementById('period-menu');
  const summary=menu.querySelector('summary');
  const current=document.getElementById('period-current');
  const options=document.getElementById('period-options');
  function close(focus=false) {
    menu.open=false;
    if(focus) summary.focus();
  }
  function sync() {
    current.textContent=select.selectedOptions[0]?.textContent??'';
    options.replaceChildren(...Array.from(select.options,option=>{
      const button=document.createElement('button');
      button.type='button';
      button.textContent=option.textContent;
      button.disabled=option.disabled;
      button.setAttribute('aria-pressed',String(option.selected));
      button.addEventListener('click',()=>{
        select.value=option.value;
        close(true);
        select.dispatchEvent(new Event('change',{bubbles:true}));
      });
      return button;
    }));
  }
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape') {event.preventDefault();close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    menu.open=true;
    const buttons=Array.from(options.querySelectorAll('button:not(:disabled)'));
    const index=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
      event.key==='ArrowDown'?(index+1)%buttons.length:index<0?buttons.length-1:(index-1+buttons.length)%buttons.length;
    buttons[next]?.focus();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)) close();});
  menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget)) close();});
  sync();
  return {sync};
}
