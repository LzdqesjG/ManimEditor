// 属性面板：基于 manim 反射元数据自动生成参数表单。
// 结构性改动（增删参数/对象）走 emit() 重建面板；仅改数值走 emitVisuals() 避免输入框失焦。

function paramType(param) {
  const a = (param.annotation || '').toLowerCase();
  if (a.includes('bool')) return 'bool';
  if (a.includes('int') || a.includes('float') || a.includes('number')) return 'number';
  if (typeof param.default === 'boolean') return 'bool';
  if (typeof param.default === 'number') return 'number';
  return 'text';
}

function coerce(param, raw) {
  if (paramType(param) === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

// 判断参数是否需要"引用场景内某个对象"（如 Transform 的 target_mobject）
function isMobjectParam(param) {
  const a = (param.annotation || '').toLowerCase();
  return a.includes('mobject') || param.name.toLowerCase().includes('mobject');
}

function mobjectSelect(value, onChange) {
  const sel = document.createElement('select');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('none');
  sel.appendChild(none);
  for (const m of state.scene.mobjects) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = `${m.id} (${m.type})`;
    sel.appendChild(o);
  }
  let current = '';
  if (value && typeof value === 'object' && value.$ref) current = value.$ref;
  else if (typeof value === 'string') current = value;
  if (current && !state.scene.mobjects.some((m) => m.id === current)) current = '';
  sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value ? { $ref: sel.value } : null));
  return sel;
}

function paramControl(param, value, onChange) {
  if (isMobjectParam(param)) return mobjectSelect(value, onChange);
  const t = paramType(param);
  if (t === 'bool') {
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = !!value;
    inp.addEventListener('change', () => onChange(inp.checked));
    return inp;
  }
  const inp = document.createElement('input');
  inp.type = t === 'number' ? 'number' : 'text';
  if (t === 'number') inp.step = 'any';
  if (value !== undefined && value !== null) inp.value = value;
  inp.placeholder = param.default_repr ? `默认 ${param.default_repr}` : '';
  inp.spellcheck = false;
  inp.addEventListener('input', () => onChange(coerce(param, inp.value)));
  return inp;
}

function numInput(value, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = 'any';
  inp.value = value;
  inp.spellcheck = false;
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    if (!Number.isNaN(n)) onChange(n);
  });
  return inp;
}

function fieldWrap(labelText, control) {
  const w = document.createElement('div');
  w.className = 'field';
  if (labelText) {
    const l = document.createElement('label');
    l.textContent = labelText;
    w.appendChild(l);
  }
  w.appendChild(control);
  return w;
}

function title(text) {
  const t = document.createElement('div');
  t.className = 'section-title';
  t.textContent = text;
  return t;
}

function triSelect(value, onChange) {
  const sel = document.createElement('select');
  [['', 'visibleAuto'], ['true', 'visibleTrue'], ['false', 'visibleFalse']].forEach(([v, key]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t(key); sel.appendChild(o);
  });
  sel.value = value === true ? 'true' : value === false ? 'false' : '';
  sel.addEventListener('change', () => onChange(sel.value === '' ? null : sel.value === 'true'));
  return sel;
}

// 渲染某个类"必填参数 + 已设置参数 + 添加参数下拉"
// opts.skipFirstPositional：跳过首个必填位置参数（动画的 mobject/vmobject 由"作用对象"表达）
function renderParams(box, meta, spec, setValue, removeValue, opts = {}) {
  const params = (meta && meta.params) || [];
  let posRequired = params.filter((p) => p.positional && p.required);
  const offset = opts.skipFirstPositional ? 1 : 0;
  if (offset) posRequired = posRequired.slice(offset);
  posRequired.forEach((p, i) => {
    const argIndex = i + offset;
    const control = paramControl(p, spec.args[argIndex], (v) => { spec.args[argIndex] = v; emitVisuals(); });
    box.appendChild(fieldWrap(`${p.name} *`, control));
  });

  const kwRequired = params.filter((p) => !p.positional && p.required);
  kwRequired.forEach((p) => {
    const control = paramControl(p, spec.kwargs[p.name], (v) => setValue(p.name, v));
    box.appendChild(fieldWrap(`${p.name} *`, control));
  });

  const setNames = Object.keys(spec.kwargs).filter((n) => !kwRequired.some((p) => p.name === n));
  for (const name of setNames) {
    const p = params.find((pp) => pp.name === name) || { name, annotation: '', default: undefined, default_repr: '' };
    const control = paramControl(p, spec.kwargs[name], (v) => setValue(name, v));
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(control);
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '×';
    del.title = t('removeParam');
    del.addEventListener('click', () => { removeValue(name); emit(); });
    row.appendChild(del);
    box.appendChild(fieldWrap(name, row));
  }

  const used = new Set([
    ...setNames,
    ...kwRequired.map((p) => p.name),
    ...posRequired.map((p) => p.name),
  ]);
  const candidates = params.filter((p) => !used.has(p.name) && !p.required);
  if (candidates.length) {
    const sel = document.createElement('select');
    const head = document.createElement('option');
    head.value = ''; head.textContent = t('addParam');
    sel.appendChild(head);
    for (const p of candidates) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.default_repr ? `${p.name} = ${p.default_repr}` : p.name;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      const p = candidates.find((c) => c.name === sel.value);
      spec.kwargs[sel.value] = p && p.default !== undefined && p.default !== null ? p.default : '';
      emit();
    });
    box.appendChild(fieldWrap('', sel));
  }
}

function renderMobjectProps(box, spec) {
  box.appendChild(title(`${spec.type}  ·  ${spec.id}`));

  const pos = mobPosition(spec);
  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(numInput(pos.x, (v) => { const p = mobPosition(spec); setMobPosition(spec, v, p.y); emitVisuals(); }));
  row.appendChild(numInput(pos.y, (v) => { const p = mobPosition(spec); setMobPosition(spec, p.x, v); emitVisuals(); }));
  box.appendChild(fieldWrap(t('positionXY'), row));

  box.appendChild(fieldWrap(t('visibleAtStart'), triSelect(spec.visible_at_start, (v) => { spec.visible_at_start = v; emitVisuals(); })));

  const meta = findMeta('mobjects', spec.type);
  renderParams(box, meta, spec,
    (n, v) => {
      if (v === null || v === undefined) delete spec.kwargs[n];
      else spec.kwargs[n] = v;
      emitVisuals();
    },
    (n) => { delete spec.kwargs[n]; });

  const row2 = document.createElement('div');
  row2.className = 'btn-row';
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = t('deleteObject');
  del.addEventListener('click', () => { removeMobject(spec.id); emit(); });
  row2.appendChild(del);
  box.appendChild(row2);
}

function renderAnimationProps(box, anim) {
  box.appendChild(title(`${anim.type}  ·  ${anim.id}`));

  const targets = document.createElement('div');
  targets.className = 'field';
  const tl = document.createElement('label');
  tl.textContent = t('targetsLabel');
  targets.appendChild(tl);
  if (!state.scene.mobjects.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = t('noObjects');
    targets.appendChild(e);
  } else {
    for (const m of state.scene.mobjects) {
      const line = document.createElement('label');
      line.style.display = 'flex';
      line.style.gap = '6px';
      line.style.fontSize = '12px';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = anim.targets.includes(m.id);
      cb.addEventListener('change', () => {
        if (cb.checked) anim.targets.push(m.id);
        else anim.targets = anim.targets.filter((t) => t !== m.id);
        emitVisuals();
      });
      line.appendChild(cb);
      line.appendChild(document.createTextNode(`${m.id} (${m.type})`));
      targets.appendChild(line);
    }
  }
  box.appendChild(targets);

  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(numInput(anim.start, (v) => { anim.start = v; emitVisuals(); }));
  const rt = document.createElement('input');
  rt.type = 'number';
  rt.step = 'any';
  rt.placeholder = 'run_time';
  rt.value = anim.run_time == null ? '' : anim.run_time;
  rt.spellcheck = false;
  rt.addEventListener('input', () => {
    anim.run_time = rt.value === '' ? null : Number(rt.value);
    emitVisuals();
  });
  row.appendChild(rt);
  box.appendChild(fieldWrap(t('timingLabel'), row));

  const meta = findMeta('animations', anim.type);
  renderParams(box, meta, anim,
    (n, v) => {
      if (v === null || v === undefined) delete anim.kwargs[n];
      else anim.kwargs[n] = v;
      emitVisuals();
    },
    (n) => { delete anim.kwargs[n]; },
    { skipFirstPositional: true });

  const row2 = document.createElement('div');
  row2.className = 'btn-row';
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = t('deleteAnimation');
  del.addEventListener('click', () => { removeAnimation(anim.id); emit(); });
  row2.appendChild(del);
  box.appendChild(row2);
}

function renderInspector() {
  const box = document.getElementById('panel-props');
  box.innerHTML = '';
  const item = selectedItem();
  if (!item) {
    box.innerHTML = `<div class="empty">${t('noSelection')}</div>`;
    return;
  }
  if (state.selection.kind === 'mobject') renderMobjectProps(box, item);
  else renderAnimationProps(box, item);
}
