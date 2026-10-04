"""通过反射 manim 自身的类签名，自动生成对象库与参数面板元数据。

核心思路：不手写 manim 的对象清单（几百个类写不完），而是 import manim 后
遍历其命名空间，凡是 Mobject / Animation 的子类就自动收录，并从 __init__
的签名里提取参数（名称、类型、默认值）。这样 manim 覆盖度自动逼近"完整"，
且 manim 升级后无需改代码。
"""

from __future__ import annotations

import inspect
from functools import lru_cache
from typing import Any

_MAX_REPR = 120

# 用于标记"无法安全转成 JSON"的值，由调用方降级为 None
_UNSERIALIZABLE = object()


def _safe_repr(value: Any) -> str:
    """把任意默认值转成可读、可截断的字符串，绝不抛异常。"""
    if value is inspect.Parameter.empty:
        return ""
    try:
        text = repr(value)
    except Exception:
        try:
            text = str(value)
        except Exception:
            return "<无法表示>"
    if len(text) > _MAX_REPR:
        text = text[: _MAX_REPR - 3] + "..."
    return text


def _jsonable(value: Any, _depth: int = 0) -> Any:
    """把默认值转成可 JSON 序列化的形式。

    - 基础类型原样返回；
    - 颜色对象转成十六进制字符串（manim 可直接解析，便于前端生成代码）；
    - 容器递归处理；
    - 无法安全转换时返回 _UNSERIALIZABLE，由调用方降级为 None。
    """
    if value is inspect.Parameter.empty or value is None:
        return None
    if isinstance(value, (bool, int, float, str)):
        return value

    to_hex = getattr(value, "to_hex", None)
    if callable(to_hex):
        try:
            return to_hex()
        except Exception:
            pass

    if _depth >= 3:
        return _UNSERIALIZABLE
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            converted = _jsonable(item, _depth + 1)
            if converted is _UNSERIALIZABLE:
                return _UNSERIALIZABLE
            out.append(converted)
        return out
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            converted = _jsonable(item, _depth + 1)
            if converted is _UNSERIALIZABLE:
                return _UNSERIALIZABLE
            out[str(key)] = converted
        return out
    return _UNSERIALIZABLE


def _describe_params(cls: type) -> list[dict[str, Any]]:
    """提取构造函数参数元数据。"""
    try:
        sig = inspect.signature(cls.__init__)
    except (ValueError, TypeError):
        return []

    params: list[dict[str, Any]] = []
    for name, p in sig.parameters.items():
        if name == "self":
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            # *args / **kwargs 无法在前端逐个渲染，跳过
            continue
        has_default = p.default is not inspect.Parameter.empty
        converted = _jsonable(p.default)
        params.append(
            {
                "name": name,
                "kind": p.kind.name,
                "required": not has_default,
                "default": None if converted is _UNSERIALIZABLE else converted,
                "default_repr": _safe_repr(p.default),
                "annotation": (
                    _safe_repr(p.annotation)
                    if p.annotation is not inspect.Parameter.empty
                    else ""
                ),
                "positional": p.kind
                in (
                    inspect.Parameter.POSITIONAL_ONLY,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                ),
            }
        )
    return params


def _describe_class(cls: type) -> dict[str, Any]:
    doc = (inspect.getdoc(cls) or "").strip().split("\n")[0]
    return {
        "name": cls.__name__,
        "module": getattr(cls, "__module__", ""),
        "doc": doc[:200],
        "params": _describe_params(cls),
    }


@lru_cache(maxsize=1)
def build_catalog() -> dict[str, list[dict[str, Any]]]:
    """扫描 manim 命名空间，返回 {mobjects: [...], animations: [...]}。

    分两步以尽量覆盖：先取 manim 顶层导出的类，再遍历 mobject / animation
    子模块，把未在顶层暴露的类也一并收录。
    """
    import importlib
    import pkgutil

    import manim
    from manim import Animation, Mobject

    mobjects: dict[str, dict[str, Any]] = {}
    animations: dict[str, dict[str, Any]] = {}

    def collect(obj: Any) -> None:
        if not inspect.isclass(obj):
            return
        try:
            if issubclass(obj, Mobject):
                mobjects.setdefault(obj.__name__, _describe_class(obj))
            elif issubclass(obj, Animation):
                animations.setdefault(obj.__name__, _describe_class(obj))
        except TypeError:
            return

    # 1) manim 顶层命名空间
    for name in dir(manim):
        if name.startswith("_"):
            continue
        try:
            collect(getattr(manim, name))
        except Exception:
            continue

    # 2) 子模块扫描（补充未在顶层导出的类）
    for pkg_name in ("manim.mobject", "manim.animation"):
        try:
            pkg = importlib.import_module(pkg_name)
        except Exception:
            continue
        for modinfo in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
            try:
                mod = importlib.import_module(modinfo.name)
            except Exception:
                continue
            for name in dir(mod):
                try:
                    collect(getattr(mod, name))
                except Exception:
                    continue

    def _sorted(d: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [d[k] for k in sorted(d.keys())]

    return {"mobjects": _sorted(mobjects), "animations": _sorted(animations)}


# 常用类优先展示（前端做排序/置顶用）
PRIORITY_NAMES = [
    "Circle",
    "Square",
    "Rectangle",
    "Line",
    "Arrow",
    "Dot",
    "Triangle",
    "Polygon",
    "RegularPolygon",
    "Ellipse",
    "Arc",
    "Angle",
    "Text",
    "MarkupText",
    "MathTex",
    "Tex",
    "NumberLine",
    "Axes",
    "VGroup",
    "Group",
    "Create",
    "FadeIn",
    "FadeOut",
    "Transform",
    "ReplacementTransform",
    "Write",
    "DrawBorderThenFill",
    "GrowFromCenter",
    "Indicate",
    "Rotate",
    "MoveAlongPath",
    "Shift",
    "ApplyMethod",
]
