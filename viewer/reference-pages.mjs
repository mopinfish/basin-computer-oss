import {parseScene} from './url-state.mjs';

/** Carry a query only, never a user-controlled destination. Bundle checks stay in the viewer. */
export function validSceneSearch(search) {
  if (typeof search !== 'string' || (search !== '' && !search.startsWith('?'))) return '';
  return parseScene(search).fatal ? '' : search;
}

export function viewerReturnHref(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => key !== 'scene') || params.getAll('scene').length !== 1) return './';
  return `./${validSceneSearch(params.get('scene'))}`;
}

export function referencePageHref(page, sceneSearch) {
  if (!['faq.html', 'quality.html', 'evaluation-policy.html'].includes(page)) return './';
  const scene = validSceneSearch(sceneSearch);
  return scene ? `${page}?${new URLSearchParams({scene})}` : page;
}

export function syncReferenceLinks(root, sceneSearch) {
  for (const link of root.querySelectorAll('[data-reference-page]')) {
    link.setAttribute('href', referencePageHref(link.getAttribute('data-reference-page'), sceneSearch));
  }
}

export function setupReferencePage(root, search) {
  const href = viewerReturnHref(search);
  for (const link of root.querySelectorAll('[data-viewer-link]')) link.setAttribute('href', href);
  syncReferenceLinks(root, href.slice(2));
}

if (typeof document !== 'undefined' && document.querySelector('[data-viewer-link]')) {
  setupReferencePage(document, location.search);
}
