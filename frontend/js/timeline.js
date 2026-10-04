// 时间轴：以秒为单位的横向轨道，每个动画一行，可水平拖拽调整起始时间。

const TL_PPS = 70;   // 每秒像素
const TL_LEFT = 130; // 左侧标签宽度
const TL_ROW = 30;

function renderTimeline() {
  const box = document.getElementById('timeline');
  const end = Math.max(5, Math.ceil(timelineEnd()));
  const width = TL_LEFT + end * TL_PPS + 60;
  box.innerHTML = '';

  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = `${width}px`;

  // 顶部时间刻度
  const ruler = document.createElement('div');
  ruler.style.position = 'relative';
  ruler.style.height = '18px';
  for (let s = 0; s <= end; s += 1) {
    const line = document.createElement('div');
    line.className = 'tl-axis';
    line.style.left = `${TL_LEFT + s * TL_PPS}px`;
    line.style.top = '18px';
    inner.appendChild(line);

    const lbl = document.createElement('span');
    lbl.textContent = `${s}s`;
    lbl.style.cssText = `position:absolute;left:${TL_LEFT + s * TL_PPS + 3}px;color:#71717a;font-size:10px;line-height:18px`;
    ruler.appendChild(lbl);
  }
  inner.appendChild(ruler);

  if (!state.scene.animations.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    inner.appendChild(empty);
    box.appendChild(inner);
    updateTimelineInfo();
    return;
  }

  for (const a of state.scene.animations) {
    const row = document.createElement('div');
    row.className = 'tl-row';
    row.style.width = `${width}px`;

    const label = document.createElement('span');
    label.className = 'tl-row-label';
    label.textContent = `${a.type} → ${a.targets.join(', ') || t('noTarget')}`;
    row.appendChild(label);

    const dur = a.run_time == null ? 1 : a.run_time;
    const block = document.createElement('div');
    block.className = 'tl-block';
    if (state.selection && state.selection.kind === 'animation' && state.selection.id === a.id) {
      block.classList.add('selected');
    }
    block.style.left = `${TL_LEFT + a.start * TL_PPS}px`;
    block.style.width = `${Math.max(28, dur * TL_PPS)}px`;
    block.textContent = `${a.start.toFixed(2)}s`;
    row.appendChild(block);

    bindBlockDrag(block, a);
    inner.appendChild(row);
  }

  box.appendChild(inner);
  updateTimelineInfo();
}

function bindBlockDrag(block, anim) {
  block.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    state.selection = { kind: 'animation', id: anim.id };
    for (const b of document.querySelectorAll('.tl-block')) b.classList.remove('selected');
    block.classList.add('selected');

    const startX = e.clientX;
    const orig = anim.start;
    block.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const delta = (ev.clientX - startX) / TL_PPS;
      anim.start = Math.max(0, Math.round((orig + delta) * 100) / 100);
      block.style.left = `${TL_LEFT + anim.start * TL_PPS}px`;
      block.textContent = `${anim.start.toFixed(2)}s`;
    };
    const onUp = () => {
      block.removeEventListener('pointermove', onMove);
      block.removeEventListener('pointerup', onUp);
      emit();
    };
    block.addEventListener('pointermove', onMove);
    block.addEventListener('pointerup', onUp);
  });
}

function updateTimelineInfo() {
  const el = document.getElementById('timeline-info');
  if (el) el.textContent = t('timelineInfo', { count: state.scene.animations.length, total: timelineEnd().toFixed(2) });
}
