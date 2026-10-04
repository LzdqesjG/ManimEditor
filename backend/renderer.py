"""渲染调度：把生成的 manim 代码交给 manim CLI 渲染成 mp4。

渲染是重任务（几秒到几分钟），所以放在后台线程里跑，前端通过任务 id 轮询进度。
任务状态只放内存，进程重启即清空——这对编辑器场景足够。
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from . import codegen
from .schema import SceneSpec

WORKSPACE = Path(__file__).resolve().parent.parent / "workspace"
_MAX_LOG = 40000


@dataclass
class RenderTask:
    id: str
    scene_name: str
    code: str
    status: str = "pending"  # pending | rendering | done | error
    log: str = ""
    video_path: str | None = None
    started_at: float = 0.0
    finished_at: float = 0.0
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "scene_name": self.scene_name,
            "status": self.status,
            "log": self.log,
            "error": self.error,
            "has_video": self.video_path is not None,
            "video_url": f"/api/video/{self.id}" if self.video_path else None,
            "elapsed": round((self.finished_at or time.time()) - self.started_at, 2)
            if self.started_at
            else 0,
        }


_tasks: dict[str, RenderTask] = {}
_lock = threading.Lock()


def get_task(task_id: str) -> RenderTask | None:
    with _lock:
        return _tasks.get(task_id)


def _append_log(task: RenderTask, text: str) -> None:
    task.log += text
    if len(task.log) > _MAX_LOG:
        task.log = task.log[-_MAX_LOG:]


def submit(scene: SceneSpec) -> RenderTask:
    """提交一个渲染任务，立即返回任务对象。"""
    code = codegen.generate(scene)
    task = RenderTask(
        id=uuid.uuid4().hex[:12],
        scene_name=codegen.scene_class_name(scene),
        code=code,
    )
    with _lock:
        _tasks[task.id] = task
    threading.Thread(target=_run, args=(task, scene), daemon=True).start()
    return task


def _find_video(task_dir: Path) -> Path | None:
    videos = [p for p in task_dir.glob("**/*.mp4") if p.is_file()]
    if not videos:
        return None
    return max(videos, key=lambda p: p.stat().st_mtime)


def _run(task: RenderTask, scene: SceneSpec) -> None:
    task.status = "rendering"
    task.started_at = time.time()

    task_dir = WORKSPACE / "tasks" / task.id
    media_dir = task_dir / "media"
    task_dir.mkdir(parents=True, exist_ok=True)

    scene_file = task_dir / "scene.py"
    scene_file.write_text(task.code, encoding="utf-8")

    cmd = [
        sys.executable,
        "-m",
        "manim",
        "render",
        codegen.quality_flag(scene.config.quality),
        "--media_dir",
        str(media_dir),
        "--format=mp4",
        "-o",
        "output",
        str(scene_file),
        task.scene_name,
    ]
    _append_log(task, "$ " + " ".join(cmd) + "\n\n")

    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=str(task_dir),
            env=env,
            encoding="utf-8",
            errors="replace",
        )
    except Exception as exc:  # pragma: no cover - 环境级错误
        task.status = "error"
        task.error = f"无法启动 manim：{exc}"
        _append_log(task, task.error + "\n")
        task.finished_at = time.time()
        return

    assert proc.stdout is not None
    for line in proc.stdout:
        _append_log(task, line)
    proc.wait()

    if proc.returncode != 0:
        task.status = "error"
        task.error = f"manim 退出码 {proc.returncode}"
        task.finished_at = time.time()
        return

    video = _find_video(task_dir)
    if video is None:
        task.status = "error"
        task.error = "渲染完成但未找到 mp4 输出"
    else:
        task.video_path = str(video)
        task.status = "done"
    task.finished_at = time.time()
