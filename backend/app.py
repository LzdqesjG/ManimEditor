"""FastAPI 应用：对外提供 manim 元数据、代码生成、渲染、自更新等接口，并托管前端页面。"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import codegen, manim_api, renderer
from .schema import AppConfig, SceneSpec

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
SCENES_DIR = BASE_DIR / "scenes"
CONFIG_FILE = BASE_DIR / "config.json"
LANGUAGES_FILE = FRONTEND_DIR / "lang" / "languages.json"
UPDATER_FILE = BASE_DIR / "update.py"


def _load_supported_languages() -> tuple[str, ...]:
    """从 frontend/lang/languages.json 读取支持的语言代码，与前端语言包保持一致。"""
    try:
        data = json.loads(LANGUAGES_FILE.read_text(encoding="utf-8"))
        codes = tuple(
            item["code"] for item in data if isinstance(item, dict) and item.get("code")
        )
        if codes:
            return codes
    except Exception:
        pass
    return ("en_us",)


# 支持的语言代码，与 frontend/lang/<code>.json 一一对应
SUPPORTED_LANGUAGES = _load_supported_languages()
DEFAULT_LANGUAGE = "en_us"


# ------------------------------------------------------------------ 自更新

_update_state: dict = {
    "checked": False,
    "available": False,
    "local_version": "",
    "local_time": 0.0,
    "remote_version": "",
    "remote_time": 0.0,
    "new_root": "",
    "error": "",
}
_update_lock = threading.Lock()
_updater_module = None


def _load_updater():
    """按文件路径加载根目录的 update.py，避免依赖 sys.path。"""
    global _updater_module
    if _updater_module is None:
        spec = importlib.util.spec_from_file_location("manim_editor_updater", UPDATER_FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _updater_module = module
    return _updater_module


def _run_update_check(delay: float = 2.0) -> None:
    """后台线程：启动后异步检查更新，不阻塞服务。"""
    print(f"[update] {delay:.0f}s 后开始检查更新…", flush=True)
    time.sleep(delay)
    try:
        result = _load_updater().check_for_update(BASE_DIR)
    except Exception as exc:
        result = {"checked": True, "error": str(exc)}
        print(f"[update] 检查过程出错：{exc}", flush=True)
    with _update_lock:
        for key in _update_state:
            if key in result:
                _update_state[key] = result[key]
        snapshot = dict(_update_state)
    print(
        "[update] 检查完成 -> available={available} local={local_version} "
        "remote={remote_version} error={error}".format(**snapshot),
        flush=True,
    )


def _update_result_file() -> Path:
    return BASE_DIR / "tmp" / "update_done.json"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_run_update_check, daemon=True).start()
    yield


app = FastAPI(title="ManimEditor", version="0.1.0", lifespan=lifespan)


def _scene_path(name: str) -> Path:
    """把场景名转成安全的文件名，避免路径穿越。"""
    safe = re.sub(r"[^\w\u4e00-\u9fff.\- ]", "_", name).strip() or "untitled"
    return SCENES_DIR / f"{safe}.json"


@app.get("/api/catalog")
def api_catalog() -> dict:
    """返回 manim 全部 Mobject / Animation 的反射清单，供前端生成对象库与参数面板。"""
    data = manim_api.build_catalog()
    data["priority"] = manim_api.PRIORITY_NAMES
    return data


@app.get("/api/config")
def api_get_config() -> dict:
    """读取 config.json 中的应用配置。

    configured 表示配置文件是否存在且有效：为 False 时前端会弹出首次使用的语言选择。
    文件缺失或读取失败时回退为默认语言。
    """
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("language") in SUPPORTED_LANGUAGES:
            return {"language": data["language"], "configured": True}
    except Exception:
        pass
    return {"language": DEFAULT_LANGUAGE, "configured": False}


@app.post("/api/config")
def api_set_config(payload: AppConfig) -> dict:
    """把应用配置写入 config.json。"""
    language = payload.language if payload.language in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE
    CONFIG_FILE.write_text(
        json.dumps({"language": language}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"language": language}


@app.get("/api/update/status")
def api_update_status() -> dict:
    """返回后台更新检查的结果。"""
    with _update_lock:
        return dict(_update_state)


@app.post("/api/update/apply")
def api_update_apply() -> dict:
    """启动独立更新进程，随后终止当前服务进程（更新进程会重新拉起 main.py）。"""
    with _update_lock:
        state = dict(_update_state)
    if not state.get("available"):
        raise HTTPException(status_code=400, detail="没有可用更新")
    new_root = state.get("new_root") or ""
    if not new_root or not Path(new_root).exists():
        raise HTTPException(status_code=400, detail="更新内容不存在，请重新检查更新")

    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [
            sys.executable,
            str(UPDATER_FILE),
            "--apply",
            "--root", str(BASE_DIR),
            "--new", new_root,
            "--old-version", state.get("local_version", ""),
            "--result", str(_update_result_file()),
        ],
        cwd=str(BASE_DIR),
        creationflags=flags,
        close_fds=True,
    )
    # 留出时间返回响应，然后终止本进程
    threading.Timer(1.2, lambda: os._exit(0)).start()
    return {"ok": True}


@app.get("/api/update/result")
def api_update_result() -> dict:
    """读取上次更新的结果标记（存在说明刚刚更新过）。"""
    path = _update_result_file()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return {"updated": not data.get("error"), **data}
        except Exception:
            return {"updated": False}
    return {"updated": False}


@app.post("/api/update/result/ack")
def api_update_result_ack() -> dict:
    """确认已提示过更新完成，清除标记。"""
    path = _update_result_file()
    if path.exists():
        path.unlink()
    return {"ok": True}


@app.get("/manifest.json")
def get_web_app_manifest() -> dict:
    return FileResponse(str(FRONTEND_DIR / "manifest.json"))


@app.get("/api/scenes")
def api_list_scenes() -> list[dict]:
    """列出已保存的场景文件。"""
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(SCENES_DIR.glob("*.json")):
        items.append({"name": path.stem, "mtime": path.stat().st_mtime})
    return items


@app.post("/api/scenes/{name}")
def api_save_scene(name: str, scene: SceneSpec) -> dict:
    """把场景保存为 scenes/<name>.json。"""
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    path = _scene_path(name)
    path.write_text(scene.model_dump_json(indent=2), encoding="utf-8")
    return {"name": path.stem}


@app.get("/api/scenes/{name}")
def api_load_scene(name: str) -> dict:
    path = _scene_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="场景不存在")
    # 用 SceneSpec 规范化，补齐手写场景文件中省略的默认字段（如 kwargs/args/methods）
    scene = SceneSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))
    return json.loads(scene.model_dump_json())


@app.delete("/api/scenes/{name}")
def api_delete_scene(name: str) -> dict:
    path = _scene_path(name)
    if path.exists():
        path.unlink()
    return {"ok": True}


@app.post("/api/codegen")
def api_codegen(scene: SceneSpec) -> dict:
    """只生成代码，不渲染——用于代码面板实时预览。"""
    return {
        "code": codegen.generate(scene),
        "class_name": codegen.scene_class_name(scene),
    }


@app.post("/api/render")
def api_render(scene: SceneSpec) -> dict:
    task = renderer.submit(scene)
    return task.to_dict()


@app.get("/api/render/{task_id}")
def api_render_status(task_id: str) -> dict:
    task = renderer.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task.to_dict()


@app.get("/api/video/{task_id}")
def api_video(task_id: str) -> FileResponse:
    task = renderer.get_task(task_id)
    if task is None or not task.video_path:
        raise HTTPException(status_code=404, detail="视频不存在")
    return FileResponse(task.video_path, media_type="video/mp4")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR), check_dir=False), name="static")
