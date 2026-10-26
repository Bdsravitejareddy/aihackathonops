'use strict';
(function () {
  function sync() {
    const active=document.querySelector('#nav [data-tab].active')?.dataset.tab||location.hash.slice(1);
    const full=active==='expansion';
    const changed=document.body.classList.contains('expansion-fullscreen')!==full;
    document.body.classList.toggle('expansion-fullscreen',full);
    if(changed)window.dispatchEvent(new CustomEvent('franchiseos:expansion-resize'));
  }
  const nav=document.getElementById('nav');
  if(nav&&typeof MutationObserver==='function')new MutationObserver(sync).observe(nav,{childList:true,subtree:true});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(!button)return;const full=button.dataset.tab==='expansion';document.body.classList.toggle('expansion-fullscreen',full);window.dispatchEvent(new CustomEvent('franchiseos:expansion-resize'));setTimeout(sync,0);});
  window.addEventListener('hashchange',sync);
  window.addEventListener('franchiseos:navigate',()=>setTimeout(sync,0));
  sync();
})();
