import {parseScene,resolveScene} from './url-state.mjs';
export function mapRequest(search) {
  const params=new URLSearchParams(search);
  const invalid=[...params.keys()].some(key=>!['scene','basin'].includes(key))||['scene','basin'].some(key=>params.getAll(key).length>1);
  const scene=params.get('scene')??'';
  const badScene=scene!==''&&(!scene.startsWith('?')||parseScene(scene).fatal);
  if(invalid||badScene) return {basin:'',scene:'',warning:'URLの条件を確認できないため、流域一覧を表示します。'};
  return {basin:params.get('basin')??'',scene,warning:''};
}
export function basinDetailHref(bundle,id,scene='') {
  if(!bundle.results.results.some(item=>item.basin_id===id)) throw new Error('流域が見つかりません');
  if(scene) {
    const resolved=resolveScene(scene,bundle);
    if(!resolved.fallback&&!resolved.warnings.length&&resolved.state.basin===id) return './'+scene;
  }
  const params=new URLSearchParams({v:'1',dataset:bundle.results.dataset_version,basin:id,h:'6',view:'timeseries'});
  return './?'+params;
}
export function mapCatalog(bundle) {
  return bundle.results.results.map(result=>{
    const basin=bundle.basins.features.find(item=>item.properties.basin_id===result.basin_id);
    const station=bundle.stations.features.find(item=>item.properties.basin_id===result.basin_id&&item.properties.role==='streamflow');
    if(!basin||!station) throw new Error('流域の位置情報が見つかりません');
    return {id:result.basin_id,name:basin.properties.name,area:basin.properties.area_km2,coordinates:station.geometry.coordinates,
      start:result.period_start,end:result.period_end,horizon:result.horizon_h};
  });
}
export function mapReturnHref(bundle,scene='') {
  if(!scene)return './';
  const resolved=resolveScene(scene,bundle);
  return !resolved.fallback&&!resolved.warnings.length?'./'+scene:'./';
}
export function mapStyle(synthetic,background='none') {
  const style={version:8,sources:{},layers:[{id:'canvas',type:'background',paint:{'background-color':'#edf2f2'}}]};
  if(!synthetic&&background==='gsi') {
    style.sources.background={type:'raster',tiles:['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],tileSize:256,minzoom:2,maxzoom:18,
      attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>'};
    style.layers.push({id:'background',type:'raster',source:'background'});
  }
  return style;
}
