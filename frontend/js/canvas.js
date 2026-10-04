// 画布：manim 坐标的近似可视化。不是逐帧精确预览，仅用于摆位与结构确认。

const CANVAS_SHAPES = {
  Circle: 'circle', Ellipse: 'circle',
  Square: 'rect', Rectangle: 'rect', RoundedRectangle: 'rect', Rectangle2D: 'rect',
  Triangle: 'triangle', Polygon: 'poly', RegularPolygon: 'poly', Star: 'poly',
  Line: 'line', Arrow: 'arrow', DoubleArrow: 'arrow', DashedLine: 'line',
  Dot: 'dot', SmallDot: 'dot', AnnotationDot: 'dot',
  Text: 'text', MarkupText: 'text', MathTex: 'text', Tex: 'text', Paragraph: 'text',
  NumberLine: 'line', Axes: 'rect', NumberPlane: 'rect',
  VGroup: 'rect', Group: 'rect',
};

function shapeOf(type) {
  return CANVAS_SHAPES[type] || 'rect';
}

function layoutCanvas() {
  const cv = document.getElementById('canvas');
  const wrap = document.getElementById('canvas-wrap');
  const fw = state.scene.config.frame_width || 14.22;
  const fh = state.scene.config.frame_height || 8;
  const ar = fw / fh;
  let W = Math.max(2, wrap.clientWidth * 0.96);
  let H = Math.max(2, wrap.clientHeight * 0.96);
  if (W / H > ar) W = H * ar; else H = W / ar;
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  return { cv, W, H, fw, fh, dpr };
}

function objColor(spec) {
  return spec.kwargs.fill_color || spec.kwargs.stroke_color || spec.kwargs.color || '#4c8dff';
}

function numKw(spec, names, fallback) {
  for (const n of names) {
    if (typeof spec.kwargs[n] === 'number') return spec.kwargs[n];
  }
  for (const a of spec.args) if (typeof a === 'number') return a;
  return fallback;
}

function objSize(spec) {
  switch (shapeOf(spec.type)) {
    case 'circle': return numKw(spec, ['radius'], 1);
    case 'rect': return numKw(spec, ['width', 'side_length'], 2) / 2;
    case 'poly': case 'triangle': return numKw(spec, ['side_length', 'radius'], 1.5);
    default: return 1;
  }
}

function renderCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const video = document.getElementById('video');
  if (video && !video.hidden) return; // 正在播放视频时不覆盖画布
  if (wrap.clientWidth < 2) return;

  const { cv, W, H, fw, fh, dpr } = layoutCanvas();
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = state.scene.config.background_color || '#000';
  ctx.fillRect(0, 0, W, H);

  // 原点十字
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();

  const toPx = (x, y) => [(x / fw + 0.5) * W, (0.5 - y / fh) * H];

  for (const spec of state.scene.mobjects) {
    const { x, y } = mobPosition(spec);
    const [px, py] = toPx(x, y);
    const shape = shapeOf(spec.type);
    const unit = (W / fw); // 1 manim 单位对应的像素
    const r = Math.max(3, objSize(spec) * unit);
    const color = objColor(spec);
    const selected = state.selection && state.selection.kind === 'mobject' && state.selection.id === spec.id;

    ctx.save();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#ffffff' : color;
    ctx.fillStyle = selected ? 'rgba(255,255,255,0.25)' : 'rgba(76,141,255,0.18)';

    if (shape === 'circle') {
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (shape === 'dot') {
      ctx.beginPath(); ctx.arc(px, py, Math.max(3, r * 0.12), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (shape === 'line' || shape === 'arrow') {
      ctx.beginPath(); ctx.moveTo(px - r, py); ctx.lineTo(px + r, py); ctx.stroke();
      if (shape === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(px + r, py);
        ctx.lineTo(px + r - unit * 0.3, py - unit * 0.15);
        ctx.lineTo(px + r - unit * 0.3, py + unit * 0.15);
        ctx.closePath(); ctx.fill();
      }
    } else if (shape === 'triangle' || shape === 'poly') {
      const n = shape === 'triangle' ? 3 : 6;
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x2 = px + r * Math.cos(ang);
        const y2 = py + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (shape === 'text') {
      ctx.fillStyle = selected ? '#fff' : color;
      const label = (typeof spec.args[0] === 'string' && spec.args[0]) || spec.label || spec.type;
      ctx.font = `${Math.max(12, unit * 0.8)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px, py);
    } else {
      ctx.beginPath();
      ctx.rect(px - r, py - r * 0.6, r * 2, r * 1.2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

let _drag = null;

function hitTest(event) {
  const { cv, W, H, fw, fh } = layoutCanvas();
  const rect = cv.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const toPx = (x, y) => [(x / fw + 0.5) * W, (0.5 - y / fh) * H];
  const unit = W / fw;

  for (let i = state.scene.mobjects.length - 1; i >= 0; i -= 1) {
    const spec = state.scene.mobjects[i];
    const { x, y } = mobPosition(spec);
    const [px, py] = toPx(x, y);
    const r = Math.max(10, objSize(spec) * unit);
    if (Math.hypot(mx - px, my - py) <= r) return spec;
  }
  return null;
}

function bindCanvas() {
  const cv = document.getElementById('canvas');
  cv.addEventListener('pointerdown', (e) => {
    const hit = hitTest(e);
    if (!hit) {
      state.selection = null;
      emit();
      return;
    }
    state.selection = { kind: 'mobject', id: hit.id };
    _drag = {
      id: hit.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: mobPosition(hit),
    };
    cv.setPointerCapture(e.pointerId);
    emit();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!_drag) return;
    const spec = findMobject(_drag.id);
    if (!spec) return;
    const { W, H, fw, fh } = layoutCanvas();
    const dx = e.clientX - _drag.startX;
    const dy = e.clientY - _drag.startY;
    setMobPosition(spec, _drag.orig.x + (dx / W) * fw, _drag.orig.y - (dy / H) * fh);
    renderCanvas();
  });

  const endDrag = () => {
    if (_drag) { _drag = null; emit(); }
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => renderCanvas());
}
