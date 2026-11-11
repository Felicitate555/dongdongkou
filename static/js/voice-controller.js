/**
 * Web Speech 语音控制 — 日常场景 + 可选目标序号辅助
 */

const COMMANDS = [
  { re: /^(口动助手|打开助手|呼叫助手)$/, action: "assistant_open", label: "打开口动助手" },
  { re: /^(暂停控制|停止控制|暂停头控|停止头控|紧急停止)$/, action: "pause_control", label: "停止控制" },
  { re: /(打开|进入).{0,4}演示/, action: "goto_demo", label: "打开演示站" },
  { re: /(回到|返回|打开).{0,4}控制台/, action: "goto_console", label: "回到控制台" },
  { re: /(去|回到|打开).{0,2}首页/, action: "goto_home", label: "去首页" },
  { re: /(打开|进入).{0,4}架构/, action: "goto_arch", label: "架构页" },
  { re: /(单击|点击|点一下|张嘴点)/, action: "click", label: "单击" },
  { re: /双击/, action: "dblclick", label: "双击" },
  { re: /右键/, action: "right", label: "右键" },
  { re: /(向上|往上).{0,2}滚/, action: "scroll_up", label: "向上滚动" },
  { re: /(向下|往下).{0,2}滚/, action: "scroll_down", label: "向下滚动" },
  { re: /^(看看|看一下|帮我看看|帮我看一下|看看页面|分析页面|读屏|看懂当前页面|看一下屏幕|看看屏幕|分析屏幕|截图|截屏|截个图)$/, action: "ai_look", label: "看一下屏幕" },
  { re: /^(确认|确定|执行)$/, action: "confirm", label: "确认" },
  { re: /^(取消|算了)$/, action: "cancel", label: "取消" },
  { re: /(下一[个项]目标|下一目标|下一个|下一[项个])/, action: "next_target", label: "下一目标" },
  { re: /(上一[个项]目标|上一目标|上一个|上一[项个])/, action: "prev_target", label: "上一目标" },
  { re: /第\s*([0-9１-９]{1,2})\s*[个项]?/, action: "pick_n", label: "选择第N个" },
  { re: /(打开|进入).{0,4}(资讯|新闻)/, action: "scene_browse", label: "打开资讯" },
  { re: /(打开|进入).{0,2}天猫/, action: "tmall", label: "打开天猫购物" },
  { re: /(打开|进入).{0,4}(购物|商城|下单)/, action: "scene_shop", label: "打开购物" },
  { re: /(返回|退出|关闭).{0,3}(天猫|演示|购物页|页面)?/, action: "back_close", label: "返回/关闭" },
  { re: /(打开|进入).{0,4}(预约|挂号|医院)/, action: "scene_clinic", label: "打开预约" },
  { re: /输入(.+)/, action: "type", label: "输入" },
];

function toHalfWidthDigits(s) {
  return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export class VoiceController {
  constructor({ onCommand, onInterim, onFinal, onError, onState }) {
    this.onCommand = onCommand;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onError = onError;
    this.onState = onState;
    this.enabled = true;
    this.commandMode = true;
    this.listening = false;
    this.wanted = false;
    this.phase = 'idle';
    this.lastError = null;
    this.rec = null;
    this._init();
  }

  _init() {
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
    if (!SR) {
      this.supported = false;
      return;
    }
    this.supported = true;
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      if (!this.wanted || !this.listening || this.phase === 'stopping') return;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = (res[0].transcript || "").trim();
        if (!text) continue;
        if (res.isFinal) {
          this.partial = '';
          this.onFinal?.(text);
          const cmd = this.match(text);
          if (cmd && this.commandMode) this.onCommand?.(cmd, text);
        } else {
          interim += text;
        }
      }
      if (interim) { this.partial=interim;this.onInterim?.(interim); }
      if (!this.commandMode && !this.audioWatch) this._endAfterSilence();
    };
    rec.onspeechend = () => { if (!this.commandMode && !this.audioWatch) this._endAfterSilence(); };
    rec.onspeechstart = () => this._clearEndTimer();
    rec.onerror = (e) => {
      const error = e.error || "unknown";
      if (!this.wanted && error === 'aborted') return;
      const fatal = ["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(error);
      const messages = {
        "not-allowed": "麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。",
        "service-not-allowed": "浏览器语音服务不可用。请使用 Chrome/Edge 并检查网络。",
        "audio-capture": "没有检测到可用麦克风。检查设备连接后重试。",
        network: "语音识别网络中断。检查网络后重新开始聆听。",
        "no-speech": "没有听到语音，请靠近麦克风再试。",
        aborted: "语音聆听已停止。",
      };
      this.onError?.({ error, fatal, message: messages[error] || "语音识别暂时不可用，请重新开始聆听。" });
      if (fatal) {
        this.lastError = error;
        this.wanted = false;
        this.listening = false;
        this._clearEndTimer();this._stopAudioWatch();
        this.onState?.({ listening: false, reason: "error" });
      }
    };
    rec.onstart = () => {
      if (!this.wanted || this.phase === 'stopping') { try { rec.abort(); } catch {} return; }
      this.phase = 'active';
      this.lastError = null;
      this.listening = true;
      this.onState?.({ listening: true });
    };
    rec.onend = () => {
      this.phase = 'idle';
      if (this.wanted && this.enabled) {
        this.start();
      } else {
        this.listening = false;
        this.onState?.({ listening: false, reason: this.lastError ? "error" : undefined });
      }
    };
    this.rec = rec;
  }

  match(raw) {
    const text = (raw || "")
      .replace(/[，。！？、,.!?~\s]/g, "")
      .replace(/^(请|帮我|麻烦你?)/, "");
    const normalized = toHalfWidthDigits(text);
    // Questions belong to the assistant; mentioning “点击” must not click anything.
    if (/怎么|如何|为什么|什么|能否|怎么办|可以吗|没反应|不能|不要/.test(normalized)) return null;
    for (const c of COMMANDS) {
      const re = c.action === "pick_n" ? new RegExp(c.re.source) : c.re;
      const src = c.action === "pick_n" ? normalized : text;
      if (re.test(src)) {
        if (c.action === "type") {
          const m = text.match(/输入(.+)/);
          return { ...c, value: m ? m[1].replace(/[。！!，,]/g, "") : "" };
        }
        if (c.action === "pick_n") {
          const m = normalized.match(/第\s*([0-9]{1,2})/);
          return { ...c, value: m ? Number(m[1]) : 1 };
        }
        return { ...c };
      }
    }
    return null;
  }

  start() {
    if (!this.supported || !this.rec) return false;
    if (!this.enabled) this.enabled = true;
    this.wanted = true;
    if (this.phase !== 'idle') {
      this.listening = true;
      this.onState?.({listening: true});
      return true;
    }
    this.lastError = null;
    try {
      this.phase = 'starting';
      this.rec.start();
      this.listening = true;
      this.onState?.({ listening: true });
      if (!this.commandMode) this._watchSilence();
      return true;
    } catch (error) {
      this.phase = 'idle';
      this.wanted = false;
      this.listening = false;
      const message = error?.name === "NotAllowedError"
        ? "麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。"
        : "语音聆听未能启动，请稍后重试。";
      this.onError?.({ error: error?.name || "start-failed", fatal: true, message });
      this.onState?.({ listening: false, reason: "start-error" });
      return false;
    }
  }

  stop() {
    this.wanted = false;
    this.listening = false;
    this._clearEndTimer();
    this._stopAudioWatch();
    if (!this.commandMode && this.partial) { const text=this.partial;this.partial='';this.onFinal?.(text); }
    this.onState?.({ listening: false });
    if (this.phase === 'idle' || this.phase === 'stopping') return;
    this.phase = 'stopping';
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
  }

  _clearEndTimer() { if(this.endTimer){this.endTimer.view.clearTimeout(this.endTimer.id);this.endTimer=null;} }
  _endAfterSilence() {
    this._clearEndTimer();
    const view=this.timerView||globalThis;
    this.endTimer={view,id:view.setTimeout(()=>{if(this.wanted)this.stop();},500)};
  }
  async _watchSilence() {
    if(this.audioWatch||!globalThis.navigator?.mediaDevices?.getUserMedia)return;
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;
    const watch={};this.audioWatch=watch;
    try {
      watch.context=new Audio();watch.context.resume().catch(()=>{});
      watch.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(this.audioWatch!==watch||!this.wanted){watch.stream.getTracks().forEach(t=>t.stop());return;}
      const analyser=watch.context.createAnalyser();analyser.fftSize=1024;
      watch.source=watch.context.createMediaStreamSource(watch.stream);watch.source.connect(analyser);
      const samples=new Float32Array(analyser.fftSize);let heard=false,lastSound=performance.now(),started=lastSound;
      watch.view=this.timerView||globalThis;
      watch.timer=watch.view.setInterval(()=>{
        analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length),now=performance.now();
        if(rms>.012){heard=true;lastSound=now;}
        if(this.partial)heard=true;
        if((heard&&now-lastSound>=500)||(!heard&&now-started>6000))this.stop();
      },50);
    } catch { if(this.audioWatch===watch){this._stopAudioWatch();if(this.partial)this._endAfterSilence();} }
  }
  _stopAudioWatch() {
    const watch=this.audioWatch;this.audioWatch=null;if(!watch)return;
    watch.view?.clearInterval(watch.timer);watch.source?.disconnect();
    watch.stream?.getTracks().forEach(t=>t.stop());watch.context?.close().catch(()=>{});
  }
}
