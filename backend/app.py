"""FastAPI 应用：对外提供 manim 元数据、代码生成、渲染等接口，并托管前端页面。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import codegen, manim_api, renderer
from .schema import SceneSpec

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
SCENES_DIR = BASE_DIR / "scenes"

app = FastAPI(title="ManimEditor", version="0.1.0")


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
    return json.loads(path.read_text(encoding="utf-8"))


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
