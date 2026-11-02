/** Module linking failures happen before app.start can handle them. */
import('./app.mjs').catch(error=>{
  console.error('画面の読み込みに失敗しました',error);
  document.getElementById('load-status').hidden=true;
  document.getElementById('content').hidden=true;
  const notice=document.getElementById('error');
  notice.hidden=false;
  notice.textContent='画面のプログラムを読み込めませんでした。ページを再読み込みしてください。続く場合は検査付きローカルサーバーを起動し直してください。';
});
