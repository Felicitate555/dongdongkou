# 测试说明

运行冒烟测试：

```bat
.venv\Scripts\activate
python -m unittest discover -s tests
node --test scripts/test_control_safety.mjs
python scripts\smoke_test.py
```

覆盖：导入、health、四页 HTML、AI 本地识别与云端坐标转换、控制会话撤销/超时/实体鼠标接管、异步停止竞态、指令相关路由。全部系统输入测试均使用内存替身；不能代替真实设备验收。
