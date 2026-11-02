import('./maps.mjs').catch(error=>{
  console.error('流域地図の読み込みに失敗しました',error);
  document.getElementById('map-load-status').textContent='流域一覧を読み込めませんでした。再読み込みするか、時系列画面から流域を選んでください。';
  document.getElementById('map-render-status').textContent='地図を表示できません。';
});
