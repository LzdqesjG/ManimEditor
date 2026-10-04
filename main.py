"""ManimEditor 启动入口。

运行：python main.py
然后浏览器打开 http://127.0.0.1:8000
"""

from __future__ import annotations

import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=False)
