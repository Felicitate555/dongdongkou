"""Small SQLite account store. Guest conversations never enter this database."""
from __future__ import annotations
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")
COOKIE = "ddk_session"

@contextmanager
def database():
    folder = Path(os.getenv("DDK_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data")))
    folder.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(folder / "dongdongko.sqlite3", timeout=8)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, salt TEXT, password_hash TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires REAL);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), role TEXT, content TEXT, created REAL);
        CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id,id);
        """)
        yield db
        db.commit()
    finally:
        db.close()

def current_user(request):
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 128:
        return None
    with database() as db:
        row = db.execute("SELECT users.id,username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return dict(row) if row else None

class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=24, pattern=r"^[\w\u4e00-\u9fff-]+$")
    password: str = Field(min_length=8, max_length=128)

def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def new_session(db, response, user_id):
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
    db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time()+7*86400))
    response.set_cookie(COOKIE, token, max_age=7*86400, httponly=True, secure=os.getenv("DDK_DEPLOYMENT_MODE", "local")=="public", samesite="strict", path="/")

@router.post("/auth/register")
def register(body: Credentials, request: Request, response: Response):
    with database() as db:
        salt = secrets.token_hex(16)
        try:
            row = db.execute("INSERT INTO users(username,salt,password_hash,created) VALUES(?,?,?,?)", (body.username, salt, password_hash(body.password,salt), time.time()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "这个用户名已被使用，请换一个或直接登录")
        user = {"id":row.lastrowid,"username":body.username}
        new_session(db,response,user["id"])
        return {"user":user}

@router.post("/auth/login")
def login(body: Credentials, request: Request, response: Response):
    with database() as db:
        row=db.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        # Perform the same expensive hash for unknown users.
        salt=row["salt"] if row else "0"*32
        calculated=password_hash(body.password,salt)
        if not row or not hmac.compare_digest(calculated,row["password_hash"]):
            raise HTTPException(401,"用户名或密码不正确")
        old=request.cookies.get(COOKIE,"")
        db.execute("DELETE FROM sessions WHERE token_hash=?",(hashlib.sha256(old.encode()).hexdigest(),))
        new_session(db,response,row["id"])
        return {"user":{"id":row["id"],"username":row["username"]}}

@router.get("/auth/me")
def me(request: Request):
    return {"user":current_user(request)}

@router.post("/auth/logout")
def logout(request: Request, response: Response):
    token=request.cookies.get(COOKIE,"")
    with database() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(COOKIE,path="/")
    return {"success":True}

def history(user_id, limit=100):
    with database() as db:
        rows=db.execute("SELECT role,content,created FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?",(user_id,limit)).fetchall()
        return [dict(row) for row in reversed(rows)]

@router.get("/chat/history")
def chat_history(request: Request):
    user=current_user(request)
    return {"messages":history(user["id"]) if user else [],"saved":bool(user)}

@router.delete("/chat/history")
def clear_history(request: Request):
    user=current_user(request)
    if not user: raise HTTPException(401,"请先登录")
    with database() as db:
        db.execute("DELETE FROM messages WHERE user_id=?",(user["id"],))
    return {"success":True}

def save_pair(user_id, text, reply):
    with database() as db:
        db.executemany("INSERT INTO messages(user_id,role,content,created) VALUES(?,?,?,?)",[(user_id,"user",text,time.time()),(user_id,"assistant",reply,time.time())])
