// 对象库：从 /api/catalog 的反射清单渲染 manim 的图形与动画，点击即加入场景。
function shortModule(mod) {
  return (mod || '').replace(/^manim\./, '');
}

function renderLibrary() {
  const box = document.getElementById('lib-list');
  const q = state.search.trim().toLowerCase();
  const items = (state.catalog[state.libTab] || []).filter(
    (it) => !q || it.name.toLowerCase().includes(q) || (it.doc || '').toLowerCase().includes(q)
  );
  const prio = state.catalog.priority || [];
  items.sort((a, b) => {
    let ia = prio.indexOf(a.name); let ib = prio.indexOf(b.name);
    if (ia < 0) ia = 1e9;
    if (ib < 0) ib = 1e9;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });

  if (!items.length) {
    box.innerHTML = `<div class="empty">${t('noResults')}</div>`;
    return;
  }
  box.innerHTML = items.map((it) => {
    const doc = (it.doc || '').replace(/"/g, '&quot;');
    return `<div class="lib-item" data-name="${it.name}" title="${doc}">
      <span class="name">${it.name}</span>
      <span class="mod">${shortModule(it.module)}</span></div>`;
  }).join('');
}

function bindLibrary() {
  const box = document.getElementById('lib-list');
  box.addEventListener('click', (e) => {
    const el = e.target.closest('.lib-item');
    if (el) addFromLibrary(el.dataset.name);
  });
}

function addFromLibrary(name) {
  if (state.libTab === 'mobjects') {
    const spec = makeMobject(name);
    state.scene.mobjects.push(spec);
    state.selection = { kind: 'mobject', id: spec.id };
  } else {
    const spec = makeAnimation(name);
    state.scene.animations.push(spec);
    state.selection = { kind: 'animation', id: spec.id };
  }
  emit();
}
