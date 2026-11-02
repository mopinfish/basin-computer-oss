/** Shared navigation for the viewer and all standalone reference pages. */
export function mountSiteChrome(root) {
  const header=root.querySelector('[data-site-chrome="header"]');
  const footer=root.querySelector('[data-site-chrome="footer"]');
  if(!header||!footer) return;
  const edition=root.body.dataset.siteEdition;
  const brand='<a class="brand" href="./" data-viewer-link aria-label="basin computer ホーム">basin<span>computer</span></a>';
  const link=(page,label)=>`<a href="${page}" data-reference-page="${page}" target="_blank" rel="noopener">${label}（別タブ）</a>`;
  header.innerHTML=`<header class="topbar site-header"><div class="site-header-inner">${brand}<span class="tag"></span><nav class="site-nav" aria-label="サイトの補助情報"><a href="maps.html" data-reference-page="maps.html">流域地図</a>${link('quality.html','品質と検証範囲')}${link('faq.html','使い方・FAQ')}</nav></div></header>`;
  header.querySelector('.tag').textContent=edition;
  const provenance=root.getElementById('data-provenance');
  footer.innerHTML=`<footer class="site-footer"><div class="site-footer-inner"><div>${brand}<p>流域の保存結果を比較する</p></div><nav aria-label="サイトの詳細情報">${link('faq.html','使い方・FAQ')}${link('quality.html','品質と検証範囲')}${link('evaluation-policy.html','評価方針')}${provenance?'<a href="#data-provenance" data-provenance-link>出典・版・利用条件</a>':link('quality.html','出典・版・利用条件')}</nav></div></footer>`;
  footer.querySelector('[data-provenance-link]')?.addEventListener('click',event=>{
    event.preventDefault();
    provenance.open=true;
    provenance.scrollIntoView({block:'start'});
    provenance.querySelector('summary').focus({preventScroll:true});
  });
}
if(typeof document!=='undefined') mountSiteChrome(document);
