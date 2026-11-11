"""Windows-only head control independent of browser timers and focus.

Camera frames stay in this process. No startup, focus change or restored session
can start control: the user must explicitly press the local desktop button.
"""
from __future__ import annotations
import ctypes
import importlib.util
import math
import os
import statistics
import threading
import time
from . import config

# Same mesh paths as static/js/face-tracker.js; no second recognition pass.
MESH_EDGES = [
    (10,338),(338,297),(297,332),(332,284),(284,251),(251,389),
    (389,356),(356,454),(454,323),(323,361),(361,288),(288,397),
    (397,365),(365,379),(379,378),(378,400),(400,377),(377,152),
    (152,148),(148,176),(176,149),(149,150),(150,136),(136,172),
    (172,58),(58,132),(132,93),(93,234),(234,127),(127,162),
    (162,21),(21,54),(54,103),(103,67),(67,109),(109,10),
    (33,7),(7,163),(163,144),(144,145),(145,153),(153,154),
    (154,155),(155,133),(362,382),(382,381),(381,380),(380,374),
    (374,373),(373,390),(390,249),(249,263),
    (1,2),(2,98),(98,327),(1,4),(4,5),(5,195),(195,197),
]

def camera_preview(cv2, frame, landmarks=None):
    """Preserve camera detail, with the original browser's face mesh overlay."""
    if frame.shape[1]>1280:
        frame=cv2.resize(frame,(1280,round(frame.shape[0]*1280/frame.shape[1])))
    preview=frame.copy();height,width=preview.shape[:2]
    if landmarks:
        point=lambda i:(round(landmarks[i].x*width),round(landmarks[i].y*height))
        for a,b in MESH_EDGES:cv2.line(preview,point(a),point(b),(110,128,0),1,cv2.LINE_AA)
        for i in range(0,len(landmarks),4):cv2.circle(preview,point(i),1,(215,195,0),-1,cv2.LINE_AA)
        for i,color,radius in [(1,(11,158,245),4),(33,(129,185,16),3),(263,(129,185,16),3)]:
            cv2.circle(preview,point(i),radius,color,-1,cv2.LINE_AA)
    ok,encoded=cv2.imencode('.jpg',cv2.flip(preview,1),[cv2.IMWRITE_JPEG_QUALITY,90])
    return encoded.tobytes() if ok else None

def clamp(v,a,b): return max(a,min(b,v))

class Euro:
    def __init__(self): self.x=None; self.dx=0.; self.t=None
    def step(self,x,t,smoothing):
        if self.x is None: self.x=x; self.t=t; return x
        dt=max(.0001,t-self.t)
        alpha=lambda cutoff: 1/(1+1/(2*math.pi*cutoff)/dt)
        a=alpha(1); self.dx=a*((x-self.x)/dt)+(1-a)*self.dx
        a=alpha(.3+(1.1-smoothing)*2.2+.01*abs(self.dx))
        self.x=a*x+(1-a)*self.x; self.t=t
        return self.x

class Motion:
    """Same centered velocity mapping as the user-approved browser controller."""
    def __init__(self,sensitivity=1.2,smoothing=.5):
        self.sensitivity=sensitivity; self.smoothing=smoothing
        self.x=.5; self.y=.5; self.center=None; self.dead=(.08,.08)
        self.samples=[]; self.fx=Euro(); self.fy=Euro(); self.last=None
    def step(self,yaw,pitch,t):
        # Preserve the browser's 30 Hz gain when native inference is slower.
        # A stale pose cannot accumulate more than 100 ms of movement.
        scale=1 if self.last is None else clamp((t-self.last)*30,0,3)
        self.last=t
        if self.center is None:
            self.samples.append((yaw,pitch,t))
            recent=[s for s in self.samples if t-s[2]<=1]
            self.samples=recent if len(recent)>=20 else self.samples[-20:]
            if len(self.samples)>=20 and t-self.samples[0][2]>=.75:
                y=statistics.median(s[0] for s in self.samples); p=statistics.median(s[1] for s in self.samples)
                yn=statistics.median(abs(s[0]-y) for s in self.samples); pn=statistics.median(abs(s[1]-p) for s in self.samples)
                if yn<.045 and pn<.045 and abs(yaw-y)<.12 and abs(pitch-p)<.12:
                    self.center=(y,p); self.dead=(clamp(yn*4+.04,.08,.16),clamp(pn*4+.04,.08,.16)); self.last=None; self.fx=Euro(); self.fy=Euro()
            return False
        dy=yaw-self.center[0]; dp=pitch-self.center[1]
        if abs(dy)>2.5 or abs(dp)>2.5: return False
        outside=lambda v,d: math.copysign(max(0,abs(v)-d),v)
        nx=outside(dy,self.dead[0]); np=outside(dp,self.dead[1])
        if not nx: self.fx=Euro()
        if not np: self.fy=Euro()
        vx=self.fx.step(nx,t,self.smoothing) if nx else 0
        vy=self.fy.step(np,t,self.smoothing) if np else 0
        self.x=clamp(self.x+vx*.018*self.sensitivity*scale,.02,.98)
        self.y=clamp(self.y+vy*.022*self.sensitivity*scale,.02,.98)
        return True

class DesktopControl:
    def __init__(self,safety,mouse):
        self.safety=safety; self.mouse=mouse; self.lock=threading.RLock()
        self.worker=None; self.cancel=threading.Event(); self.state={"running":False,"phase":"stopped","message":"未开启后台控制"}
        self.mouth_enabled=True
        self.mouth_rearm=False
        self.recenter_requested=False
        self.preview_jpeg=None
    def available(self):
        return os.name=="nt" and self.mouse.available() and importlib.util.find_spec("mediapipe") is not None
    def status(self):
        with self.lock: return dict(self.state,available=self.available())
    def stop(self,reason="已停止后台控制"):
        with self.lock:
            self.cancel.set(); self.safety.shutdown()
            self.preview_jpeg=None
            self.state.update(running=False,phase="stopped",message=reason)
    def start(self,settings):
        with self.lock:
            if self.worker and self.worker.is_alive(): raise ValueError("后台控制仍在运行或释放摄像头，请稍后再试")
            if not self.available(): raise ValueError("后台控制需要 Windows 本机服务及 MediaPipe 依赖")
            self.cancel=threading.Event(); self.mouth_enabled=settings.get("mouth_enabled",True)
            self.recenter_requested=False
            self.state={"running":True,"phase":"starting","message":"正在连接本机摄像头，请保持自然坐姿"}
            self.worker=threading.Thread(target=self._run,args=(settings,self.cancel),daemon=True,name="ddk-desktop-camera")
            self.worker.start()
            threading.Thread(target=self._keys,args=(self.cancel,),daemon=True,name="ddk-global-stop").start()
            return self.status()
    def _keys(self,cancel):
        while not cancel.wait(.03):
            if ctypes.windll.user32.GetAsyncKeyState(0x1B)&0x8000:
                self.stop("已按全局 Esc，后台控制已停止")
                return
    def _run(self,settings,cancel):
        cap=None; detector=None; token=None; sequence=0; open_at=None; dragging=False; last_action=0.; lost_at=None; eyes_at=None; preview_at=0.
        try:
            import cv2
            import mediapipe as mp
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            # Native MediaPipe cannot reliably open Unicode Windows paths.
            opts=vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_buffer=config.FACE_LANDMARKER.read_bytes()),running_mode=vision.RunningMode.VIDEO,num_faces=1,output_face_blendshapes=True)
            detector=vision.FaceLandmarker.create_from_options(opts)
            cap=cv2.VideoCapture(0,cv2.CAP_MSMF)
            if not cap.isOpened(): raise RuntimeError("无法开启摄像头，请关闭其他占用摄像头的应用后重试")
            with self.lock: self.state.update(phase="centering",message="摄像头已连接，请自然平视约一秒")
            motion=Motion(settings.get("sensitivity",1.2),settings.get("smoothing",.5))
            width,height=self.mouse.screen_size(); start=time.monotonic(); calibration_started=start; last_ts=-1
            def action(fn):
                nonlocal sequence
                if cancel.is_set(): return
                sequence+=1
                return self.safety.execute(token,sequence,fn)
            while not cancel.is_set():
                frame_start=time.monotonic()
                ok,frame=cap.read()
                if not ok: raise RuntimeError("摄像头已断开，后台控制已停止")
                camera_frame=frame
                if frame.shape[1]>640:
                    frame=cv2.resize(frame,(640,round(frame.shape[0]*640/frame.shape[1])))
                ts=max(last_ts+1,int((time.monotonic()-start)*1000)); last_ts=ts
                result=detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)),ts)
                now=time.monotonic()
                if cancel.is_set(): break
                if self.recenter_requested:
                    self.recenter_requested=False
                    if token: self.safety.stop(token)
                    token=None; sequence=0; open_at=None; dragging=False
                    motion=Motion(settings.get("sensitivity",1.2),settings.get("smoothing",.5)); calibration_started=now
                if not result.face_landmarks:
                    preview=camera_preview(cv2,camera_frame)
                    if preview:
                        with self.lock:
                            if not cancel.is_set():self.preview_jpeg=preview
                    with self.lock: self.state.update(face_detected=False,message="请让完整面部进入摄像头画面")
                    lost_at=lost_at or now
                    if token and now-lost_at>.45: raise RuntimeError("未检测到人脸，已停止；准备好后重新开启")
                    if not token and now-calibration_started>15: raise RuntimeError("没有找到稳定人脸，请正对摄像头后重试")
                    continue
                lost_at=None
                with self.lock: self.state.update(face_detected=True)
                lms=result.face_landmarks[0]; nose=lms[1]; le=lms[33]; re=lms[263]
                if now-preview_at>=1/30:
                    preview_at=now;preview=camera_preview(cv2,camera_frame,lms)
                    if preview:
                        with self.lock:
                            if not cancel.is_set():self.preview_jpeg=preview
                def ear(ids):
                    p=[lms[i] for i in ids]
                    dist=lambda a,b:math.hypot(a.x-b.x,a.y-b.y)
                    return (dist(p[1],p[5])+dist(p[2],p[4]))/max(.001,2*dist(p[0],p[3]))
                closed=ear([33,160,158,133,153,144])<.18 and ear([362,385,387,263,373,380])<.18
                eyes_at=(eyes_at or now) if closed else None
                if eyes_at is not None and now-eyes_at>=1.2: raise RuntimeError("检测到持续闭眼，后台控制已停止")
                yaw=((le.x+re.x)/2-nose.x)*10; pitch=(nose.y-(le.y+re.y)/2)*10
                jaw=next((c.score for c in result.face_blendshapes[0] if c.category_name in {"jawOpen","JawOpen"}),None) if result.face_blendshapes else None
                if jaw is None:
                    face_h=math.hypot(lms[10].x-lms[152].x,lms[10].y-lms[152].y) or 1e-6
                    jaw=clamp(math.hypot(lms[13].x-lms[14].x,lms[13].y-lms[14].y)/face_h*4,0,1)
                if not motion.step(yaw,pitch,now):
                    with self.lock: self.state.update(phase="centering",message="请自然平视约一秒，正在取中",samples=len(motion.samples))
                    if now-calibration_started>15: raise RuntimeError("未完成稳定取中，请保持自然坐姿后重新开启")
                    continue
                if token is None:
                    with self.lock:
                        if cancel.is_set(): break
                        token=self.safety.start()
                    # Begin from the current desktop pointer, avoiding a center jump.
                    px,py=self.mouse.position(); motion.x=px/max(1,width-1); motion.y=py/max(1,height-1)
                x=round(motion.x*(width-1)); y=round(motion.y*(height-1))
                action(lambda:self.mouse.move(x,y))
                if jaw<settings.get("jaw_threshold",.5):self.mouth_rearm=False
                mouth_open=jaw>=settings.get("jaw_threshold",.5) and self.mouth_enabled and not self.mouth_rearm
                if not self.mouth_enabled:
                    open_at=None
                    if dragging: action(lambda:self.mouse.mouse_up()); dragging=False
                elif mouth_open and now-last_action>.8:
                    if open_at is None: open_at=now
                    if not dragging and now-open_at>=.45:
                        action(lambda:self.mouse.mouse_down()); dragging=True
                elif not mouth_open:
                    if dragging:
                        action(lambda:self.mouse.mouse_up()); dragging=False; last_action=now
                    elif open_at is not None and now-open_at<.45:
                        action(lambda:self.mouse.click()); last_action=now
                    open_at=None
                with self.lock:
                    if not cancel.is_set(): self.state.update(phase="active",message="后台控制中 · 切换应用也可使用",x=round(motion.x,3),y=round(motion.y,3),mouth_paused=not self.mouth_enabled)
                cancel.wait(max(0,1/30-(time.monotonic()-frame_start)))
        except Exception as error:
            # Third party model errors can contain internals; expose only known safe failures.
            reason=str(error) if isinstance(error,(RuntimeError,ValueError)) else "后台控制已停止，请检查摄像头或依赖后重试"
            from .control_safety import ControlStopped
            if isinstance(error,ControlStopped): reason=str(error)
            self.stop(reason)
        finally:
            if token: self.safety.stop(token)
            if cap is not None: cap.release()
            if detector is not None: detector.close()
            with self.lock:
                self.state["running"]=False
                if self.state.get("phase")!="stopped": self.state.update(phase="stopped",message="后台控制已停止")
