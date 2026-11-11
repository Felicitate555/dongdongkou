"""Focused account isolation, guest privacy and native motion checks; no real input."""
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from server.main import app
from server.desktop_control import Motion

with tempfile.TemporaryDirectory() as data:
    os.environ['DDK_DATA_DIR']=data
    os.environ['DDK_DEPLOYMENT_MODE']='local'
    a=TestClient(app); b=TestClient(app); guest=TestClient(app)
    assert a.post('/api/auth/register',json={'username':'review_a','password':'example-review-123'}).status_code==200
    reply=a.post('/api/chat',json={'text':'第一次使用，我该怎么开始？'}).json()
    assert reply['saved'] and reply['source']=='guide' and '短张嘴' in reply['reply']
    assert len(a.get('/api/chat/history').json()['messages'])==2
    assert b.post('/api/auth/register',json={'username':'review_b','password':'example-review-456'}).status_code==200
    assert b.get('/api/chat/history').json()['messages']==[]
    assert not guest.post('/api/chat',json={'text':'第一次使用'}).json()['saved']
    assert guest.get('/api/chat/history').json()['messages']==[]
    cookie=a.cookies.get('ddk_session')
    a.post('/api/auth/logout')
    assert a.get('/api/auth/me',headers={'Cookie':'ddk_session='+cookie}).json()['user'] is None
    assert a.post('/api/auth/login',json={'username':'review_a','password':'example-review-123'}).status_code==200
    assert len(a.get('/api/chat/history').json()['messages'])==2
    assert a.delete('/api/chat/history').status_code==200
    assert a.get('/api/chat/history').json()['messages']==[]
    assert a.post('/api/auth/login',headers={'Origin':'https://evil.example'},json={'username':'review_a','password':'example-review-123'}).status_code==403
    os.environ['DDK_DEPLOYMENT_MODE']='public'
    for path in ('start','stop','gesture'):
        assert guest.post('/api/desktop/'+path,json={'enabled':True}).status_code==403
    assert guest.get('/api/desktop/status').status_code==403
    os.environ['DDK_DEPLOYMENT_MODE']='local'
    print('PASS: account persistence/isolation, guest non-storage, logout revocation, clear, origin fence, public desktop denial')

for fps in (30,60):
    m=Motion()
    for i in range(fps*2): m.step(.2,.8,i/fps)
    assert m.center is not None
    original=(m.x,m.y)
    for i in range(fps*2,fps*10):m.step(.21,.79,i/fps)
    assert (m.x,m.y)==original
    for i in range(fps*10,fps*11):m.step(.5,.5,i/fps)
    assert m.x>.5 and m.y<.5
print('PASS: native mapping centers at 30/60 FPS, neutral holds, right/up movement')
