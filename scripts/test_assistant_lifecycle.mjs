import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Assistant} from '../static/js/assistant.js';
import {VoiceController} from '../static/js/voice-controller.js';

test('shared assistant binds on pages without head-control settings',()=>{
  globalThis.window={addEventListener(){}};
  const element={addEventListener(){},prepend(){},remove(){},querySelector(){return null;}};
  const assistant=Object.create(Assistant.prototype);
  assistant.q=selector=>selector==='#mouth-on'?null:element;
  assistant.qa=()=>[];assistant.input=element;
  assert.doesNotThrow(()=>assistant.bind());
});

test('late recognition events cannot revive a stopped microphone',()=>{
  let rec,starts=0;
  globalThis.SpeechRecognition=class {constructor(){rec=this;}start(){starts++;}stop(){}abort(){}};
  const heard=[];
  const voice=new VoiceController({onFinal:text=>heard.push(text)});
  voice.start();voice.stop();rec.onstart();
  rec.onresult({resultIndex:0,results:[Object.assign([{transcript:'不应发送'}],{isFinal:true})]});
  rec.onend();
  assert.equal(voice.listening,false);assert.equal(starts,1);assert.deepEqual(heard,[]);
});

test('repeated starts during startup do not restart recognition',()=>{
  let starts=0;
  globalThis.SpeechRecognition=class {start(){starts++;if(starts>1)throw Error('already started');}stop(){}};
  const voice=new VoiceController({});
  assert.equal(voice.start(),true);assert.equal(voice.start(),true);
  assert.equal(starts,1);assert.equal(voice.listening,true);
});

test('assistant voice fills editable draft without sending or executing commands',()=>{
  let commands=0,rec;
  globalThis.SpeechRecognition=class {constructor(){rec=this;}start(){}abort(){}};
  const assistant=Object.create(Assistant.prototype);
  assistant.input={value:'已有文字',dispatchEvent(){}};
  assistant.q=()=>({textContent:''});
  assistant.send=()=>{throw Error('Voice must wait for manual send');};
  const voice=new VoiceController({onFinal:text=>assistant.utterance(text),onCommand:()=>commands++});
  voice.commandMode=false;voice.start();rec.onstart();
  rec.onresult({resultIndex:0,results:[Object.assign([{transcript:'确认'}],{isFinal:true})]});
  assert.equal(assistant.input.value,'已有文字\n确认');assert.equal(commands,0);
});
