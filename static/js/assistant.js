import {api, toast, setFloatingDocument, createCameraPreview} from './common.js';

export class Assistant {
  q(selector){return this.pip?.document.querySelector(selector)||document.querySelector(selector);}
  qa(selector){return [...document.querySelectorAll(selector),...(this.pip?[...this.pip.document.querySelectorAll(selector)]:[])];}
  constructor(runtime, look) {
    this.runtime=runtime; this.look=look; this.messages=[]; this.user=null; this.busy=false;
    // Assistant microphone is dictation; only buttons can send or confirm.
    runtime.voice.commandMode=false;
    const originalPose=runtime.cursor.applyPose.bind(runtime.cursor);
    runtime.cursor.applyPose=(yaw,pitch,ear,jaw,now)=>{
      if(this.awaitMouthClose){if(jaw<runtime.cursor.jawThreshold)this.awaitMouthClose=false;else jaw=0;}
      return originalPose(yaw,pitch,ear,jaw,now);
    };
    this.speaking=false; this.resumeVoice=false; this.nativeRunning=false; this.epoch=0;
    this.log=this.q('#assistant-log');
    this.input=this.q('#assistant-input');
    this.bind(); this.restore();
  }
  bind() {
    if(typeof document!=='undefined'&&!document.querySelector('link[data-compose-attachment]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href='/css/compose-attachment.css?v=20261021l';link.dataset.composeAttachment='';document.head.append(link);
    }
    this.q('#assistant-float')?.addEventListener('click',()=>this.float());
    const review=this.q('#screen-review'),form=this.q('#chat-form');
    if(review&&form){form.prepend(review);this.q('#screen-send')?.remove();const note=review.querySelector('p');if(note)note.textContent='截图将与文字一起发送';const remove=this.q('#screen-cancel');remove.textContent='移除截图';remove.type='button';}
    this.q('#screen-cancel')?.addEventListener('click',()=>{this.pendingImage=null;this.q('#screen-review').hidden=true;});
    this.q('#chat-form').addEventListener('submit',e=>{e.preventDefault();this.runtime.voice.stop();this.send(this.input.value);});
    this.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.runtime.voice.stop();this.send(this.input.value);}});
    this.qa('[data-ask]').forEach(el=>el.addEventListener('click',()=>this.send(el.dataset.ask)));
    this.q('#account-open').addEventListener('click',()=>{
      this.runtime.voice.stop(); this.stopSpeech(); this.syncMouth();
      this.q('#account-dialog').showModal();
      this.q('#account-username').focus();
    });
    this.q('#account-close').addEventListener('click',()=>this.q('#account-dialog').close());
    this.q('#auth-form').addEventListener('submit',e=>{e.preventDefault();this.authenticate();});
    this.qa('[data-auth-mode]').forEach(el=>el.addEventListener('click',()=>{
      this.authMode=el.dataset.authMode;
      this.qa('[data-auth-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===el)));
      this.q('#auth-submit').textContent=this.authMode==='register'?'注册并保存对话':'登录';
      this.q('#account-password').autocomplete=this.authMode==='register'?'new-password':'current-password';
      this.q('#auth-error').textContent='';
    }));
    this.authMode='login';
    this.q('#guest-use').addEventListener('click',async()=>{
      if(this.busy)return;
      try {await api('/api/auth/logout',{});this.epoch++;this.user=null;this.messages=[];this.render();this.accountState();this.q('#account-dialog').close();}
      catch(e){this.q('#auth-error').textContent=e.message;}
    });
    this.q('#chat-clear').addEventListener('click',async()=>{
      if(this.busy)return;
      if(!window.confirm(this.user?'清空这个账号保存在服务器的全部对话？':'清空本次游客对话？'))return;
      try{if(this.user)await api('/api/chat/history',null,'DELETE');this.epoch++;this.messages=[];this.render();}
      catch(e){toast(e.message);}
    });
    this.q('#speech-stop').addEventListener('click',()=>this.stopSpeech());
    this.q('#tts-on').addEventListener('change',()=>{if(!this.q('#tts-on').checked)this.stopSpeech();});
    this.q('#mouth-on')?.addEventListener('change',()=>this.syncMouth());
    this.q('#btn-mic').addEventListener('click',()=>{if(this.speaking)this.stopSpeech();this.syncMouth();});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'){this.stopSpeech();this.runtime.voice.stop();this.syncMouth();}});
    window.addEventListener('blur',()=>{if(this.pip||this.floatingOpening)return;this.stopSpeech();this.runtime.voice.stop();this.syncMouth();});
    window.addEventListener('ddk-speech-start',e=>{
      this.externalSpeechId=e.detail;this.externalSpeaking=true;this.runtime.voice.stop();this.syncMouth();
    });
    window.addEventListener('ddk-speech-end',e=>{
      if(e.detail!==this.externalSpeechId)return;
      this.externalSpeaking=false;this.syncMouth();
    });
  }
  async restore(){
    const epoch=this.epoch;
    try{
      const result=await api('/api/auth/me',null,'GET');
      if(epoch!==this.epoch)return;
      this.user=result.user;
      if(this.user){const h=await api('/api/chat/history',null,'GET');if(epoch!==this.epoch)return;this.messages=h.messages||[];}
    }catch{toast('对话记录暂未连接，可以先使用头控');}
    this.accountState();this.render();
  }
  accountState(){
    this.q('#account-open').textContent=this.user?this.user.username:'登录/注册';
    this.q('#chat-storage').textContent=this.user?'对话已为你保存，可随时清空':'游客模式 · 本次对话不保存';
    this.q('#auth-current').textContent=this.user?`当前账号：${this.user.username}`:'无需登录也能使用全部体验；注册后保存对话。';
    this.q('#guest-use').textContent=this.user?'退出，使用游客模式':'先以游客体验';
  }
  async authenticate(){
    if(this.busy)return;
    const button=this.q('#auth-submit');button.disabled=true;
    try{
      const result=await api('/api/auth/'+this.authMode,{username:this.q('#account-username').value.trim(),password:this.q('#account-password').value});
      this.epoch++;this.user=result.user;this.messages=[];this.q('#account-password').value='';
      this.accountState();this.render();this.q('#account-dialog').close();await this.restore();
    }catch(e){this.q('#auth-error').textContent=e.message;}
    finally{button.disabled=false;}
  }
  render(){
    this.log.replaceChildren();
    if(!this.messages.length){
      const welcome=document.createElement('div');welcome.className='assistant-welcome';
      const title=document.createElement('h3');title.textContent='想做什么，直接告诉我';
      const p=document.createElement('p');p.textContent='我可以陪你聊聊、解释操作，也可以帮你找到当前页面的入口。';
      welcome.append(title,p);this.log.append(welcome);
    }
    for(const message of this.messages.slice(-100)){
      const row=document.createElement('article');row.className='chat-message '+message.role;
      const label=document.createElement('span');label.className='chat-speaker';label.textContent=message.role==='user'?'你':'口动助手';
      const text=document.createElement('p');text.textContent=message.role==='assistant'?message.content.replace(/\*\*|__/g,'').replace(/`([^`]+)`/g,'$1'):message.content;
      row.append(label,text);this.log.append(row);
    }
    const scroll=this.chatScroll||this.log;scroll.scrollTop=scroll.scrollHeight;
  }
  async send(raw,image=null,fromVoice=false){
    image=image||this.pendingImage;
    const text=String(raw||'').trim()||(image?'请帮我概括这张截图的内容，并告诉我可以进行哪些操作。':'');if(!text||this.busy)return;
    if(text.length>2000){toast('每次最多输入 2000 字');return;}
    this.stopSpeech();this.resumeVoice=fromVoice;this.runtime.voice.stop();this.syncMouth();
    const previous=this.messages.slice(-12).map(m=>({role:m.role,content:m.content}));
    const epoch=this.epoch;this.busy=true;this.input.value='';
    this.pendingImage=null;this.q('#screen-review').hidden=true;
    this.messages.push({role:'user',content:text});this.render();
    this.q('#chat-send').disabled=true;
    this.q('#chat-state').hidden=false;this.q('#chat-state').textContent='正在回复…';
    this.q('#chat-error').textContent='';
    try{
      const result=await api(image?'/api/chat/screen':'/api/chat',image?{text,image}:{text,history:previous});
      if(epoch!==this.epoch)return;
      this.messages.push({role:'assistant',content:result.reply});this.render();
      this.q('#chat-state').textContent=result.source==='guide'?'使用指引 · 已回复':'MiMo · 已回复';
      this.read(result.reply);
      if(fromVoice&&!this.speaking&&this.resumeVoice)this.runtime.voice.start();
    }catch(e){
      if(epoch!==this.epoch)return;
      this.messages.pop();this.render();this.input.value=text;if(image){this.pendingImage=image;this.q('#screen-review').hidden=false;}
      this.q('#chat-error').textContent=e.message+'；内容保留在输入框，可重试。';
      this.q('#chat-state').textContent='暂未连接';
    }finally{this.busy=false;this.q('#chat-send').disabled=false;this.q('#chat-state').hidden=true;}
  }
  utterance(text){
    const transcript=String(text||'').trim();if(!transcript||this.busy)return;
    const draft=this.input.value;
    const combined=draft+(draft&&!/\s$/.test(draft)?'\n':'')+transcript;
    this.input.value=combined.slice(0,2000);
    this.input.dispatchEvent(new Event('input',{bubbles:true}));
    this.input.scrollTop=this.input.scrollHeight;
    this.q('#voice-bubble').textContent=combined.length>2000?'输入已达 2000 字，请编辑后发送。':'已转成文字，可编辑后点“发送”。';
  }
  syncMouth(){
    const enabled=this.q('#mouth-on')?.checked!==false&&!this.runtime.voice.listening&&!this.speaking&&!this.externalSpeaking;
    if(enabled&&this.mouthAllowed===false)this.awaitMouthClose=true;
    this.mouthAllowed=enabled;
    this.runtime.cursor.clickMode=enabled?'mouth':'none';
    if(!enabled){this.runtime.cursor._jawLatched=false;if(this.runtime.cursor._dragging){this.runtime.cursor._endDrag();this.runtime.cursor._dragging=false;}}
    if(this.q('#gesture-hint'))this.q('#gesture-hint').textContent=enabled?'短张嘴点击 · 长张嘴拖动 · 闭嘴松开':'正在说话或聆听，张嘴点击已暂停';
    if(this.nativeRunning)api('/api/desktop/gesture',{enabled}).catch(()=>{});
  }
  read(text){
    if(!this.q('#tts-on').checked||!('speechSynthesis'in window))return;
    const speechEpoch=(this.speechEpoch||0)+1;this.speechEpoch=speechEpoch;
    this.runtime.voice.stop();this.speaking=true;this.syncMouth();
    const u=new SpeechSynthesisUtterance(text.replace(/\*\*|__|`/g,''));u.lang='zh-CN';u.rate=1;
    const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>/zh-CN/i.test(v.lang))||null;
    this.q('#speech-stop').hidden=false;
    const finish=()=>{if(this.speechEpoch!==speechEpoch)return;this.speaking=false;this.q('#speech-stop').hidden=true;this.syncMouth();if(this.resumeVoice&&(this.pip||!document.hidden))this.runtime.voice.start();};
    u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);
  }
  confirmScreen(fromVoice=false){
    if(!this.pendingImage)return;
    const image=this.pendingImage;this.q('#screen-review').hidden=true;this.pendingImage=null;
    this.send(this.input.value.trim()||'请帮我概括这个页面，告诉我有哪些主要内容，以及接下来可以做什么。',image,fromVoice);
  }
  async captureScreen(fromVoice=false){
    if(this.busy)return;
    this.runtime.voice.stop();this.stopSpeech();
    const previews=[...document.querySelectorAll('video,#desktop-preview'),...(this.pip?[...this.pip.document.querySelectorAll('video,.floating-camera')]:[])];
    for(const el of previews)el.style.visibility='hidden';
    let stream;
    try{
      const h=await api('/api/health',null,'GET');let image;
      if(h.deployment_mode==='local'){
        const drawingWindow=this.pip||window;
        await new Promise(resolve=>drawingWindow.requestAnimationFrame(()=>drawingWindow.requestAnimationFrame(resolve)));
        image=(await api('/api/desktop/screenshot',{})).image;
      }else{
        stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
        const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();
        const canvas=document.createElement('canvas');const scale=Math.min(1,1440/video.videoWidth,900/video.videoHeight);
        canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);image=canvas.toDataURL('image/jpeg',.78);
      }
      this.pendingImage=image;this.q('#screen-shot').src=image;this.q('#screen-review').hidden=false;
      if(fromVoice)this.runtime.voice.start();
    }catch(e){toast(e.name==='NotAllowedError'?'请点击“看一下屏幕”，选择要分享的窗口。':e.message||'截图未完成，请重试');}
    finally{stream?.getTracks().forEach(t=>t.stop());for(const el of previews)el.style.visibility='';}
  }
  async float(){
    if(this.pip){this.pip.focus();return;}
    if(!('documentPictureInPicture'in window)){toast('悬浮窗需要支持画中画的 Chrome 或 Edge');return;}
    this.floatingOpening=true;
    try{
      const pip=await window.documentPictureInPicture.requestWindow({width:380,height:650});this.pip=pip;this.runtime.voice.timerView=pip;setFloatingDocument(pip.document);
      pip.document.title='动动口 · 悬浮助手';
      for(const href of ['/css/global.css','/css/assistant.css','/css/compose-attachment.css?v=20261021l','/css/floating.css?v=20261021-scroll']){
        const link=pip.document.createElement('link');link.rel='stylesheet';link.href=new URL(href,location.href).href;pip.document.head.append(link);
      }
      const root=this.q('.assistant');this.homeParent=root.parentNode;this.homeNext=root.nextSibling;
      const homeChildren=[...root.childNodes];
      const controls=pip.document.createElement('div');controls.className='floating-controls';
      const back=pip.document.createElement('button');back.className='text-button';back.textContent='回到工作台';back.onclick=()=>{pip.close();window.focus();};
      const stop=pip.document.createElement('button');stop.className='btn btn-danger';stop.textContent='暂停控制';stop.onclick=()=>api('/api/desktop/stop',{}).catch(()=>toast('请按 Esc 或持续闭眼停止'));
      controls.append(back,stop);
      const preview=pip.document.createElement('img');preview.className='floating-camera';preview.alt='本机摄像头预览';preview.hidden=true;
      const content=pip.document.createElement('div');content.className='floating-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','助手对话，可滚动');
      const compose=pip.document.createElement('div');compose.className='floating-compose';
      for(const node of homeChildren){
        if(node.nodeType===1&&node.matches('#voice-bubble,.voice-actions,#chat-form'))compose.append(node);else content.append(node);
      }
      root.replaceChildren(controls,preview,content,compose);pip.document.body.append(root);this.chatScroll=content;
      const cameraPreview=createCameraPreview(preview,pip);
      let refreshing=false;
      const refresh=async()=>{if(refreshing)return;refreshing=true;try{const state=await api('/api/desktop/status',null,'GET');if(pip.closed)return;this.nativeRunning=!!state.running;preview.hidden=!state.running;cameraPreview.setActive(!!state.running);}catch{preview.hidden=true;cameraPreview.stop();}finally{refreshing=false;}};
      refresh();const timer=pip.setInterval(refresh,1500);
      pip.addEventListener('keydown',e=>{if(e.key==='Escape'){api('/api/desktop/stop',{}).catch(()=>{});this.runtime.voice.stop();this.stopSpeech();}});
      pip.addEventListener('pagehide',()=>{
        pip.clearInterval(timer);cameraPreview.stop();this.runtime.voice.stop();this.stopSpeech();root.replaceChildren(...homeChildren);this.chatScroll=null;
        this.homeParent.insertBefore(root,this.homeNext?.parentNode===this.homeParent?this.homeNext:null);
        this.pip=null;this.runtime.voice.timerView=null;setFloatingDocument(null);
      },{once:true});
    }catch(e){this.pip=null;setFloatingDocument(null);toast('悬浮窗没有打开，请再点一次');}
    finally{this.floatingOpening=false;}
  }
  stopSpeech(){
    this.resumeVoice=false;
    this.speechEpoch=(this.speechEpoch||0)+1;
    if('speechSynthesis'in window)speechSynthesis.cancel();
    this.speaking=false;this.externalSpeaking=false;this.externalSpeechId=null;this.q('#speech-stop').hidden=true;this.syncMouth();
  }
}
