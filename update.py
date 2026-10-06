"""ManimEditor 自更新器。

功能：
  - 检查远端是否有新版本：下载 zip → 解压到 tmp/pkg → 识别项目根 → 比较版本与完成时间
  - 执行更新：**覆盖式**写入新版本包含的文件，同名旧文件先备份到 rollback/<version>/

设计约束：
  1. 只依赖标准库，且不 import 项目内其它模块——更新过程中那些模块会被替换。
  2. 采用"覆盖"而非"整体替换"：不会动 .venv / .git / 用户数据，也不会删除 zip 里没有的文件。

用法：
  作为模块：backend/app.py 用 importlib 加载后调用 check_for_update()
  作为脚本：python update.py --apply --root <项目根> --new <解压出的新版本根> --old-version <v> --result <结果文件>
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# 判定"更新内容根目录"的标志物
REQUIRED_MARKERS = ("main.py", "backend", "frontend")

# 这些顶层条目完全不参与更新：虚拟环境、版本库、更新工作区。
# 尤其是 .venv —— 它是当前进程正在使用的解释器，绝不能移动。
PRESERVE_TOP = {".venv", "venv", ".git", "tmp", "rollback"}

NETWORK_TIMEOUT = 30
# 单个地址的探测超时（只读首包，测出延迟即可）
PROBE_TIMEOUT = 8
TMP_DIR_NAME = "tmp"
PKG_DIR_NAME = "pkg"
RESULT_FILE_NAME = "update_done.json"


def _build_logger() -> logging.Logger:
    """独立的日志器：无论被谁加载都会把流程打到终端。"""
    logger = logging.getLogger("manimeditor.updater")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("[updater] %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


_log = _build_logger()


def read_project_meta(root: Path) -> dict:
    """读取 project.toml 中的 version / complete_time / 更新地址。

    `backup` 既支持单个字符串，也支持字符串数组（多个镜像地址）。
    """
    meta = {"version": "", "complete_time": 0.0, "primary_url": "", "backup_urls": []}
    try:
        import tomllib

        with open(Path(root) / "project.toml", "rb") as fh:
            data = tomllib.load(fh)
        update_cfg = data.get("update") or {}
        meta["version"] = str(data.get("version", "") or "")
        meta["complete_time"] = float(data.get("complete_time", 0) or 0)
        meta["primary_url"] = str(update_cfg.get("primary", "") or "")

        raw_backup = update_cfg.get("backup", "")
        if isinstance(raw_backup, str):
            candidates = [raw_backup]
        elif isinstance(raw_backup, (list, tuple)):
            candidates = [str(item) for item in raw_backup]
        else:
            candidates = []
        meta["backup_urls"] = [item.strip() for item in candidates if item and item.strip()]
    except Exception as exc:
        _log.warning("读取 %s 失败：%s", Path(root) / "project.toml", exc)
    return meta


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "ManimEditor-Updater"})
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT) as response:
        return response.read()


def probe_latency(url: str) -> float | None:
    """探测地址可用性并返回首包延迟（秒）；失败返回 None。"""
    request = urllib.request.Request(url, headers={"User-Agent": "ManimEditor-Updater"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT) as response:
            response.read(1024)  # 只取首包，测通即可
        return time.perf_counter() - start
    except Exception as exc:
        _log.warning("探测失败：%s -> %s", url, exc)
        return None


def rank_update_urls(urls: list[str]) -> list[tuple[str, float | None]]:
    """并发探测所有地址的延迟，按由快到慢排序（不可用的排在最后）。"""
    if not urls:
        return []
    if len(urls) == 1:
        return [(urls[0], probe_latency(urls[0]))]
    with ThreadPoolExecutor(max_workers=len(urls)) as pool:
        probes = list(pool.map(lambda url: (url, probe_latency(url)), urls))
    return sorted(probes, key=lambda item: (item[1] is None, item[1] or 0.0))


def find_update_root(base: Path) -> Path | None:
    """递归查找同时包含 main.py / backend / frontend 的目录。"""
    base = Path(base)
    candidates = [base] + [p for p in base.rglob("*") if p.is_dir()]
    for path in candidates:
        if all((path / marker).exists() for marker in REQUIRED_MARKERS):
            return path
    return None


def _load_gitignore_protected(project_root: Path) -> set[str]:
    """从 .gitignore 归纳出需要保护的顶层条目名，作为 PRESERVE_TOP 的补充。

    目的：即使更新包里意外夹带了被忽略的内容（如 .venv、workspace），也不会污染本地。

    只做保守解析（够用即可）：
      - 跳过注释、空行，以及含通配符的模式（无法对应到具体顶层名）
      - 取路径的第一段作为顶层名，例如 `workspace/*` → `workspace`
      - 若某顶层存在 `!` 取反规则（说明该目录下有内容受版本控制），则不保护它，
        例如 `scenes/*` + `!scenes/Default.json` → 不保护 scenes，允许更新 Default.json
    """
    try:
        lines = (
            (Path(project_root) / ".gitignore").read_text(encoding="utf-8", errors="ignore")
        ).splitlines()
    except Exception:
        return set()

    def _top(text: str) -> str:
        segment = text.strip().lstrip("/").split("/")[0]
        if not segment or any(ch in segment for ch in "*?[]"):
            return ""
        return segment

    ignored: set[str] = set()
    negated: set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("!"):
            name = _top(line[1:])
            if name:
                negated.add(name)
            continue
        if " #" in line:  # 行尾注释
            line = line.split(" #", 1)[0].strip()
        name = _top(line)
        if name:
            ignored.add(name)

    return ignored - negated


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

    _log.info(
        "开始检查更新：本地 version=%r complete_time=%s",
        local["version"],
        local["complete_time"],
    )

    candidates = ([local["primary_url"]] if local["primary_url"] else []) + list(
        local["backup_urls"]
    )
    _log.info("更新地址：primary=%r backup=%r", local["primary_url"], local["backup_urls"])
    if not candidates:
        state["error"] = "no update url configured"
        _log.error("project.toml 未配置任何更新地址")
        return state

    _log.info("共 %d 个候选地址，开始并发探测延迟…", len(candidates))
    ranked = rank_update_urls(candidates)
    for index, (url, latency) in enumerate(ranked, 1):
        _log.info(
            "  延迟排名 %d：%s（%s）",
            index,
            url,
            f"{latency * 1000:.0f} ms" if latency is not None else "不可用",
        )

    blob = None
    errors = []
    for url, latency in ranked:
        if latency is None:
            errors.append(f"{url}: probe failed")
            continue
        _log.info("尝试下载（延迟 %.0f ms）：%s", latency * 1000, url)
        try:
            blob = download(url)
            _log.info("下载成功：%d 字节", len(blob))
            break
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            _log.warning("下载失败：%s", exc)

    if blob is None:
        state["error"] = "download failed -> " + " | ".join(errors)
        _log.error("所有更新地址均下载失败：%s", state["error"])
        return state

    if blob[:2] != b"PK":
        state["error"] = f"downloaded content is not a zip archive (head={blob[:4]!r})"
        _log.error("下载内容不是 zip：头字节=%r", blob[:4])
        return state
    _log.info("格式校验通过：是 zip 压缩包")

    # 只清理解压子目录，避免误删 tmp 下的 update_done.json / update.log
    pkg_dir = project_root / TMP_DIR_NAME / PKG_DIR_NAME
    shutil.rmtree(pkg_dir, ignore_errors=True)
    pkg_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            archive.extractall(pkg_dir)
    except Exception as exc:
        state["error"] = f"unzip failed: {exc}"
        _log.error("解压失败：%s", exc)
        return state
    _log.info("已解压到：%s", pkg_dir)

    new_root = find_update_root(pkg_dir)
    if new_root is None:
        state["error"] = "update structure not recognized (main.py/backend/frontend not found)"
        _log.error("未能在解压内容里找到同时包含 main.py / backend / frontend 的目录")
        return state
    _log.info("识别到更新内容根目录：%s", new_root)

    remote = read_project_meta(new_root)
    state["remote_version"] = remote["version"]
    state["remote_time"] = remote["complete_time"]
    state["new_root"] = str(new_root)
    _log.info(
        "远端信息：version=%r complete_time=%s",
        remote["version"],
        remote["complete_time"],
    )

    if not remote["version"]:
        _log.warning("远端 project.toml 缺少 version 字段，判定为不可更新")
    elif remote["version"] == local["version"]:
        _log.info("版本号相同（%s），无需更新", remote["version"])
    elif remote["complete_time"] <= local["complete_time"]:
        _log.info(
            "远端时间戳并不更新（%s <= %s），无需更新",
            remote["complete_time"],
            local["complete_time"],
        )

    state["available"] = bool(
        remote["version"]
        and remote["version"] != local["version"]
        and remote["complete_time"] > local["complete_time"]
    )
    _log.info("检查结论：available=%s", state["available"])
    return state


def apply_update(project_root: Path, new_root: Path, old_version: str, result_file: Path) -> None:
    """覆盖式更新：只写入新版本包含的文件；同名旧文件先备份到 rollback/<version>/。

    不会删除项目里 zip 未包含的内容（.venv、.git、config.json、scenes、用户自建文件等），
    也不会移动任何受保护的顶层目录。
    """
    project_root = Path(project_root).resolve()
    new_root = Path(new_root).resolve()
    backup_dir = project_root / "rollback" / (old_version or "unknown")
    _log.info(
        "开始应用更新：version=%s -> %s（旧文件备份至 %s）",
        old_version,
        new_root,
        backup_dir,
    )

    protected = set(PRESERVE_TOP) | _load_gitignore_protected(project_root)
    _log.info("受保护顶层条目：%s", ", ".join(sorted(protected)))

    written = 0
    backed_up = 0
    skipped = []
    for src in sorted(new_root.rglob("*")):
        if not src.is_file():
            continue
        rel = src.relative_to(new_root)
        if rel.parts and rel.parts[0] in protected:
            skipped.append(str(rel))
            continue

        dst = project_root / rel
        if dst.is_file():
            backup_path = backup_dir / rel
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup_path)
            backed_up += 1

        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        written += 1

    if skipped:
        _log.info("跳过受保护路径 %d 项：%s", len(skipped), ", ".join(skipped[:10]))
    _log.info("已写入 %d 个文件，备份 %d 个同名旧文件", written, backed_up)

    version = read_project_meta(project_root)["version"]
    result_path = Path(result_file)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps(
            {"version": version, "time": time.time(), "written": written, "backed_up": backed_up},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    _log.info("更新完成：新版本 %s", version)


def resolve_python_executable(project_root: Path) -> str:
    """优先使用 config.json 记录的、最初运行 main.py 的解释器。

    这样即使更新进程由别的解释器拉起，也能回到原环境（依赖齐全）。
    """
    try:
        data = json.loads((Path(project_root) / "config.json").read_text(encoding="utf-8"))
        recorded = str(data.get("python_executable") or "")
        if recorded and Path(recorded).exists():
            _log.info("使用 config.json 记录的解释器：%s", recorded)
            return recorded
        if recorded:
            _log.warning("config.json 记录的解释器不存在：%s，回退", recorded)
    except Exception as exc:
        _log.warning("读取 config.json 失败：%s", exc)
    _log.info("回退到当前解释器：%s", sys.executable)
    return sys.executable


def launch_main(project_root: Path) -> None:
    """以独立进程启动 main.py：工作目录为项目根，解释器为原先的解释器。"""
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    entry = Path(project_root) / "main.py"
    python = resolve_python_executable(project_root)
    _log.info("重新启动 main.py：%s（cwd=%s，解释器 %s）", entry, project_root, python)
    try:
        subprocess.Popen(
            [python, str(entry)],
            cwd=str(project_root),
            creationflags=flags,
            close_fds=True,
        )
    except Exception as exc:
        _log.error("启动 main.py 失败：%s", exc)
        raise


def _attach_file_log(project_root: Path) -> None:
    """把日志同时写一份到 tmp/update.log，便于更新进程脱离终端后排查。"""
    try:
        log_dir = Path(project_root) / TMP_DIR_NAME
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_dir / "update.log", encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        _log.addHandler(handler)
    except Exception:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="ManimEditor updater")
    parser.add_argument("--apply", action="store_true", help="执行更新（备份 + 覆盖 + 重启）")
    parser.add_argument("--root", required=True, help="项目根目录")
    parser.add_argument("--new", required=True, help="解压出的新版本根目录")
    parser.add_argument("--old-version", default="", help="当前版本号（用于 rollback 目录名）")
    parser.add_argument("--result", required=True, help="更新结果标记文件路径")
    parser.add_argument("--wait", type=float, default=2.0, help="执行前等待秒数（等主进程退出）")
    args = parser.parse_args()

    if not args.apply:
        parser.print_help()
        return

    _attach_file_log(Path(args.root))
    _log.info("更新进程已启动，等待 %.1fs 让主进程退出…", args.wait)
    time.sleep(args.wait)
    try:
        apply_update(Path(args.root), Path(args.new), args.old_version, Path(args.result))
        launch_main(Path(args.root))
    except Exception as exc:
        _log.error("更新失败：%s", exc)
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
