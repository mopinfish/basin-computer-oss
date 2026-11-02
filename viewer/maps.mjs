import {loadBundle} from './contract.mjs';
import {formatJST,requireSixHourDemo} from './ui.mjs';
import {resolveScene} from './url-state.mjs';
import {syncReferenceLinks} from './reference-pages.mjs';
import {mapRequest,mapCatalog,basinDetailHref,mapStyle,mapReturnHref} from './map-catalog.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const bundle=await loadBundle('data/');
requireSixHourDemo(bundle);
const items=mapCatalog(bundle),request=mapRequest(location.search);
const synthetic=bundle.results.extensions?.synthetic===true;
$('map-return-link').textContent=mapReturnHref(bundle,request.scene)!=='./'?'元の時系列へ戻る':'時系列を開く';
$('map-data-kind').textContent=synthetic?'人工配置の合成流域｜表示確認用':'実観測データ｜保存結果';
const priorScene=request.scene?resolveScene(request.scene,bundle):null;
if(priorScene?.warnings.length)request.warning=priorScene.warnings.map(item=>item.message).join(' ');
let selected=request.basin||priorScene?.state.basin||'';
if(selected&&!items.some(item=>item.id===selected)){selected='';request.warning='指定された流域が見つからないため、一覧を表示します。';}
if(request.warning){$('map-warning').textContent=request.warning;$('map-warning').hidden=false;}
let map,gl,popup,geometryReady=false;
const buttons=new Map();
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&popup?.isOpen()){
    event.preventDefault();popup.remove();buttons.get(selected)?.focus({preventScroll:true});
  }
});
function detail(item) {
  const section=node('div');section.className='map-popup';section.append(node('h3',item.name));
  const dl=node('dl');
  for(const [label,value] of [['面積',`${item.area} km²`],['評価期間',`${formatJST(item.start)} 〜 ${formatJST(item.end)} JST（終了を含まない）`],['保存結果',`${item.horizon}時間先予測`]])dl.append(node('dt',label),node('dd',value));
  const link=node('a','この流域の時系列を見る');link.href=basinDetailHref(bundle,item.id,request.scene);
  section.append(dl,link);return section;
}
function syncLinks(id) {
  const href=basinDetailHref(bundle,id||items[0].id,request.scene);
  for(const link of document.querySelectorAll('[data-viewer-link]'))link.href=mapReturnHref(bundle,request.scene);
  syncReferenceLinks(document,new URL(href,location.href).search);
}
function showPopup(item) {
  if(!map||!gl||!geometryReady)return;
  popup?.remove();
  map.setFilter('basin-fill',['!=',['get','basin_id'],item.id]);
  for(const layer of ['selected-fill','selected-halo','selected-basin'])map.setFilter(layer,['==',['get','basin_id'],item.id]);
  popup=new gl.Popup({closeOnClick:false,focusAfterOpen:false,maxWidth:'300px'}).setLngLat(item.coordinates).setDOMContent(detail(item)).addTo(map);
  popup.on('close',()=>{if(document.activeElement===document.body)buttons.get(item.id)?.focus({preventScroll:true});});
  const coordinates=bundle.basins.features.find(f=>f.properties.basin_id===item.id).geometry.coordinates.flat(Infinity);
  // fit the selected catchment without inferring a representative point from its bounding box.
  const bounds=new gl.LngLatBounds();for(let i=0;i<coordinates.length;i+=2)bounds.extend([coordinates[i],coordinates[i+1]]);
  map.fitBounds(bounds,{padding:70,maxZoom:12,duration:0});
}
function select(id,{record=true}={}) {
  const item=items.find(item=>item.id===id);if(!item)return;
  selected=id;
  if(priorScene&&priorScene.state.basin!==id){$('map-warning').textContent='流域を切り替えたため、詳細画面はこの流域の全評価期間から表示します。';$('map-warning').hidden=false;}
  else{$('map-warning').textContent=request.warning;$('map-warning').hidden=!request.warning;}
  for(const [key,button] of buttons)button.setAttribute('aria-pressed',String(key===id));
  $('basin-selection').replaceChildren(detail(item));$('basin-selection').hidden=false;
  syncLinks(id);
  if(record){const params=new URLSearchParams();if(request.scene)params.set('scene',request.scene);params.set('basin',id);history.replaceState(null,'','maps.html?'+params);}
  showPopup(item);
}
for(const item of items){
  const li=node('li'),button=node('button',item.name);button.type='button';button.setAttribute('aria-pressed','false');button.append(node('small',`${item.area} km²`));button.addEventListener('click',()=>select(item.id));buttons.set(item.id,button);li.append(button);$('basin-list').append(li);
}
$('map-load-status').hidden=true;
syncLinks(selected);
if(selected)select(selected,{record:false});
try {
  gl=await import('./vendor/maplibre/maplibre-gl.mjs');
  gl.setWorkerCount(1);
  gl.setWorkerUrl(new URL('./vendor/maplibre/maplibre-gl-worker.mjs',import.meta.url).href);
  map=new gl.Map({container:'basin-map',style:mapStyle(synthetic,document.body.dataset.mapBackground),center:items[0].coordinates,zoom:6,attributionControl:true,locale:{'NavigationControl.ZoomIn':'拡大','NavigationControl.ZoomOut':'縮小','Popup.Close':'閉じる','Map.Title':'流域地図'}});
  map.addControl(new gl.NavigationControl({showCompass:false}),'top-right');
  map.on('error',event=>{
    if(event.sourceId==='background')$('map-render-status').textContent='背景地図を読み込めません。流域は表示できます。';
    else $('map-render-status').textContent='地図の一部を表示できません。一覧からも選択できます。';
  });
  map.on('style.load',()=>{
    map.addSource('basins',{type:'geojson',data:bundle.basins});
    map.addLayer({id:'basin-fill',type:'fill',source:'basins',paint:{'fill-color':'#007f86','fill-opacity':.36}});
    map.addLayer({id:'selected-fill',type:'fill',source:'basins',filter:['==',['get','basin_id'],''],paint:{'fill-color':'#d96a15','fill-opacity':.48}});
    map.addLayer({id:'basin-halo',type:'line',source:'basins',paint:{'line-color':'#ffffff','line-width':5}});
    map.addLayer({id:'basin-border',type:'line',source:'basins',paint:{'line-color':'#00636a','line-width':2.5}});
    map.addLayer({id:'selected-halo',type:'line',source:'basins',filter:['==',['get','basin_id'],''],paint:{'line-color':'#ffffff','line-width':7}});
    map.addLayer({id:'selected-basin',type:'line',source:'basins',filter:['==',['get','basin_id'],''],paint:{'line-color':'#a64700','line-width':4}});
    for(const layer of ['basin-fill','selected-fill'])map.on('click',layer,event=>{if(event.features?.[0])select(event.features[0].properties.basin_id);});
    for(const layer of ['basin-fill','selected-fill']){
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    }
    geometryReady=true;
    const bounds=new gl.LngLatBounds();for(const feature of bundle.basins.features){const coordinates=feature.geometry.coordinates.flat(Infinity);for(let i=0;i<coordinates.length;i+=2)bounds.extend([coordinates[i],coordinates[i+1]]);}map.fitBounds(bounds,{padding:70,maxZoom:9,duration:0});
    if(selected)showPopup(items.find(item=>item.id===selected));
    if($('map-render-status').textContent==='地図を準備しています…')$('map-render-status').textContent=synthetic?'背景なしの人工配置です。':'';
  });
  map.getCanvas().addEventListener('webglcontextlost',()=>{$('map-render-status').textContent='地図の描画が中断しました。一覧から流域を選べます。';});
} catch(error) {
  console.warn('地図を利用できないため一覧を表示します',error);
  $('map-render-status').textContent='この環境では地図を表示できません。一覧から流域を選べます。';
  $('basin-map').hidden=true;
}
