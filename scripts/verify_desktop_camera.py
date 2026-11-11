"""Real camera/native loop with simulated mouse only; never injects system input."""
import time,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.desktop_control import DesktopControl
from server.control_safety import ControlSafety
class SimMouse:
    def __init__(self):self.xy=(960,540);self.moves=0;self.releases=0
    def available(self):return True
    def screen_size(self):return (1920,1080)
    def position(self):return self.xy
    def move(self,x,y):self.xy=(x,y);self.moves+=1;return {'success':True}
    def mouse_down(self):return {'success':True}
    def mouse_up(self):return {'success':True}
    def click(self):return {'success':True}
    def release_all(self):self.releases+=1
m=SimMouse();s=ControlSafety(m);d=DesktopControl(s,m);d.start({'mouth_enabled':False})
end=time.monotonic()+12;phase='';active=False
try:
    while time.monotonic()<end:
        time.sleep(.1);s.check();state=d.status()
        if state['phase']!=phase:phase=state['phase'];print('phase:',phase,flush=True)
        if phase=='active':
            active=True;m.xy=(m.xy[0]+20,m.xy[1]);s.check();time.sleep(.4);break
    print({'native_active':active,'simulated_moves':m.moves,'released':m.releases,'phase':d.status()['phase'],'real_mouse_input':False},flush=True)
finally:
    d.stop('Verification completed')
    if d.worker:d.worker.join(timeout=3)
