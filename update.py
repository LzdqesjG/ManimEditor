"""ManimEditor 自更新器。

功能：
  - 检查远端是否有新版本：下载 zip → 解压到 tmp/ → 识别项目根 → 比较版本与完成时间
  - 执行更新：把当前项目备份到 rollback/<version>/，替换为新版本，再重启 main.py

设计约束：本文件**只依赖标准库**，且不 import 项目内其它模块——
更新过程中那些模块会被整体替换掉。

用法：
  作为模块：backend/app.py 用 importlib 加载后调用 check_for_update()
  作为脚本：python update.py --apply --root <项目根> --new <解压出的新版本根> --old-version <v> --result <结果文件>
"""

from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

# 判定"更新内容根目录"的标志物
REQUIRED_MARKERS = ("main.py", "backend", "frontend")
# 替换时必须保留的顶层条目，否则更新进程会把自己或工作区一并搬走
KEEP_ENTRIES = {"update.py", "rollback", "tmp"}

NETWORK_TIMEOUT = 30
TMP_DIR_NAME = "tmp"
RESULT_FILE_NAME = "update_done.json"


def read_project_meta(root: Path) -> dict:
    """读取 project.toml 中的 version / complete_time / 更新地址。"""
    meta = {"version": "", "complete_time": 0.0, "primary_url": "", "backup_url": ""}
    try:
        import tomllib

        with open(Path(root) / "project.toml", "rb") as fh:
            data = tomllib.load(fh)
        update_cfg = data.get("update") or {}
        meta["version"] = str(data.get("version", "") or "")
        meta["complete_time"] = float(data.get("complete_time", 0) or 0)
        meta["primary_url"] = str(update_cfg.get("primary", "") or "")
        meta["backup_url"] = str(update_cfg.get("backup", "") or "")
    except Exception:
        pass
    return meta


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "ManimEditor-Updater"})
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT) as response:
        return response.read()


def find_update_root(base: Path) -> Path | None:
    """递归查找同时包含 main.py / backend / frontend 的目录。"""
    base = Path(base)
    candidates = [base] + [p for p in base.rglob("*") if p.is_dir()]
    for path in candidates:
        if all((path / marker).exists() for marker in REQUIRED_MARKERS):
            return path
    return None


def check_for_update(project_root: Path) -> dict:
    """检查更新，不改动项目文件。返回状态字典。"""
    project_root = Path(project_root)
    local = read_project_meta(project_root)
    state = {
        "checked": True,
        "available": False,
        "local_version": local["version"],
        "local_time": local["complete_time"],
        "remote_version": "",
        "remote_time": 0.0,
        "new_root": "",
        "error": "",
    }

    urls = [u for u in (local["primary_url"], local["backup_url"]) if u]
    if not urls:
        state["error"] = "no update url configured"
        return state

    blob = None
    errors = []
    for url in urls:
        try:
            blob = download(url)
            break
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    if blob is None:
        state["error"] = "download failed -> " + " | ".join(errors)
        return state

    if blob[:2] != b"PK":
        state["error"] = "downloaded content is not a zip archive"
        return state

    tmp_dir = project_root / TMP_DIR_NAME
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            archive.extractall(tmp_dir)
    except Exception as exc:
        state["error"] = f"unzip failed: {exc}"
        return state

    new_root = find_update_root(tmp_dir)
    if new_root is None:
        state["error"] = "update structure not recognized (main.py/backend/frontend not found)"
        return state

    remote = read_project_meta(new_root)
    state["remote_version"] = remote["version"]
    state["remote_time"] = remote["complete_time"]
    state["new_root"] = str(new_root)

    state["available"] = bool(
        remote["version"]
        and remote["version"] != local["version"]
        and remote["complete_time"] > local["complete_time"]
    )
    return state


def apply_update(project_root: Path, new_root: Path, old_version: str, result_file: Path) -> None:
    """备份当前内容并替换为新版本。应在独立进程、且主进程已退出后调用。"""
    project_root = Path(project_root).resolve()
    new_root = Path(new_root).resolve()
    rollback_dir = project_root / "rollback" / (old_version or "unknown")
    rollback_dir.mkdir(parents=True, exist_ok=True)

    # 1) 备份：除 update.py / rollback / tmp 外的顶层条目全部移入 rollback
    for item in project_root.iterdir():
        if item.name in KEEP_ENTRIES:
            continue
        target = rollback_dir / item.name
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink()
        shutil.move(str(item), str(target))

    # 2) 替换：把新版本内容搬到项目根
    for item in new_root.iterdir():
        shutil.move(str(item), str(project_root / item.name))

    # 3) 记录更新结果，供新进程提示用户
    version = read_project_meta(project_root)["version"]
    result_path = Path(result_file)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps({"version": version, "time": time.time()}, ensure_ascii=False),
        encoding="utf-8",
    )


def launch_main(project_root: Path) -> None:
    """以独立进程启动 main.py。"""
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [sys.executable, str(Path(project_root) / "main.py")],
        cwd=str(project_root),
        creationflags=flags,
        close_fds=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="ManimEditor updater")
    parser.add_argument("--apply", action="store_true", help="执行更新（备份 + 替换 + 重启）")
    parser.add_argument("--root", required=True, help="项目根目录")
    parser.add_argument("--new", required=True, help="解压出的新版本根目录")
    parser.add_argument("--old-version", default="", help="当前版本号（用于 rollback 目录名）")
    parser.add_argument("--result", required=True, help="更新结果标记文件路径")
    parser.add_argument("--wait", type=float, default=2.0, help="执行前等待秒数（等主进程退出）")
    args = parser.parse_args()

    if not args.apply:
        parser.print_help()
        return

    time.sleep(args.wait)
    try:
        apply_update(Path(args.root), Path(args.new), args.old_version, Path(args.result))
        launch_main(Path(args.root))
    except Exception as exc:
        try:
            result_path = Path(args.result)
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps({"version": "", "error": str(exc)}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
