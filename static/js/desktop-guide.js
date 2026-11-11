import {speak} from './common.js';

export function showDesktopGuide(runtime, assistant) {
  runtime.voice.stop();assistant.stopSpeech();
  let dialog=document.querySelector('#desktop-guide');
  if(!dialog){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/css/desktop-guide.css';document.head.append(link);
    dialog=document.createElement('dialog');dialog.id='desktop-guide';dialog.className='desktop-guide';dialog.setAttribute('aria-labelledby','desktop-guide-title');
    dialog.innerHTML=`<button type="button" class="desktop-guide-close" aria-label="关闭控制助手">×</button>
      <img src="/assets/logo.svg" alt="" width="44" height="44"/>
      <h2 id="desktop-guide-title">让动动口控制你的电脑</h2>
      <p>我是控制助手，陪你完成第一次启动。准备完成后，就能用转头和张嘴操作其他软件。</p>
      <ol><li><strong>下载启动器</strong><p>支持 Windows 10 / 11。点击下面的“一键启动本机助手”。</p></li>
      <li><strong>双击下载的启动器</strong><p>首次自动下载本机助手、准备运行环境。没有 Python 3.11 时，按提示安装后再双击启动器。</p></li>
      <li><strong>进入本机工作台</strong><p>启动完成会自动打开。点“后台控制电脑”，自然平视完成取中后即可切换到其他软件。</p></li></ol>
      <p class="desktop-guide-stop">短张嘴点击，长张嘴拖动，闭嘴松开。按 Esc 或移动实体鼠标可停止。</p>
      <div class="desktop-guide-actions"><a class="btn btn-primary" href="/assets/start-dongdongko.cmd" download="一键启动动动口.cmd">一键启动本机助手</a>
      <a class="btn btn-ghost" href="http://127.0.0.1:8787/console.html" target="_blank" rel="noopener">已启动，打开工作台</a></div>
      <button type="button" class="text-button" data-guide-read>朗读使用步骤</button>
      <p class="desktop-guide-foot">控制服务在你自己的电脑运行；本网页不会操作云服务器的鼠标。</p>`;
    document.body.append(dialog);
    dialog.querySelector('.desktop-guide-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>assistant.stopSpeech());
    dialog.querySelector('[data-guide-read]').onclick=()=>readSteps();
  }
  dialog.showModal();
  function readSteps(){speak('你好，我是动动口控制助手。第一步，点击一键启动本机助手，下载启动器。第二步，双击下载的启动器，首次会自动准备依赖；缺少 Python 时请按提示安装。第三步，打开本机工作台，点击后台控制电脑，自然平视完成取中。之后可以切换其他软件，转头移动，短张嘴点击，长张嘴拖动，闭嘴松开。按 Esc 或移动实体鼠标可停止。',true);}
  if(document.querySelector('#tts-on')?.checked!==false)readSteps();
}
