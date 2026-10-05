// 主控：初始化、事件绑定、代码面板与渲染流程。

function emit() {
  renderInspector();
  renderCanvas();
  renderTimeline();
  scheduleCodeUpdate();
  saveDraft();
}

// 仅改数值时调用：不重建属性面板，避免输入框失焦
function emitVisuals() {
  renderCanvas();
  renderTimeline();
  scheduleCodeUpdate();
  saveDraft();
}

// 本地自动草稿：刷新页面不丢；正式存档走"保存"按钮写 scenes/*.json
const DRAFT_KEY = 'manimeditor.draft';
let _draftTimer = null;

function saveDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.scene));
    } catch (err) { /* 忽略隐私模式/容量异常 */ }
  }, 500);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? normalizeScene(JSON.parse(raw)) : null;
  } catch (err) {
    return null;
  }
}

let _codeTimer = null;
function scheduleCodeUpdate() {
  clearTimeout(_codeTimer);
  _codeTimer = setTimeout(updateCode, 300);
}

async function updateCode() {
  try {
    const result = await API.codegen(state.scene);
    document.getElementById('code-view').textContent = result.code;
  } catch (err) {
    showToast(t('codegenFailed') + err.message, true);
  }
}

let _toastTimer = null;
function showToast(message, isError) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle('err', !!isError);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

function setStatus(text, cls) {
  const el = document.getElementById('render-status');
  el.textContent = text;
  el.className = `status${cls ? ` ${cls}` : ''}`;
}

function showVideo(url) {
  const video = document.getElementById('video');
  video.src = `${url}?t=${Date.now()}`;
  video.hidden = false;
  video.play().catch(() => {});
  document.getElementById('stage-hint').textContent = t('stageHintVideo');
}

// 隐藏并释放视频，让画布重新可见（切换场景 / 新建 / 双击返回画布时调用）
function resetVideo() {
  const video = document.getElementById('video');
  video.pause();
  video.hidden = true;
  video.removeAttribute('src');
  video.load();
  document.getElementById('stage-hint').textContent = t('stageHintAdd');
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'mobjects' || tab === 'animations') {
        document.querySelectorAll('.layout > aside.panel:first-child .tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.libTab = tab;
        renderLibrary();
      } else {
        document.querySelectorAll('.layout > aside.panel:last-child .tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-props').hidden = tab !== 'props';
        document.getElementById('panel-code').hidden = tab !== 'code';
        if (tab === 'code') updateCode();
      }
    });
  });
}

function bindToolbar() {
  document.getElementById('scene-name').addEventListener('input', (e) => {
    state.scene.name = e.target.value || 'MyScene';
    scheduleCodeUpdate();
    saveDraft();
  });
  document.getElementById('quality').addEventListener('change', (e) => {
    state.scene.config.quality = e.target.value;
    saveDraft();
  });
  document.getElementById('scene-type').addEventListener('change', (e) => {
    state.scene.config.scene_type = e.target.value;
    scheduleCodeUpdate();
    saveDraft();
  });
  document.getElementById('lib-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderLibrary();
  });
  document.getElementById('btn-render').addEventListener('click', doRender);
  document.getElementById('btn-refresh-code').addEventListener('click', updateCode);
  document.getElementById('btn-check-update').addEventListener('click', manualCheckUpdate);
  document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
  document.getElementById('btn-save').addEventListener('click', saveSceneToServer);
  document.getElementById('btn-new').addEventListener('click', newScene);
  document.getElementById('scene-list').addEventListener('change', onSceneSelected);

  const video = document.getElementById('video');
  video.addEventListener('dblclick', () => {
    resetVideo();
    renderCanvas();
  });
}

// 切换界面语言并持久化到 config.json
async function changeLanguage(code) {
  await setLanguage(code);
  emit();
  refreshSceneList();
  try {
    await API.saveConfig({ language: code });
  } catch (err) { /* 写入失败则仅本次会话生效 */ }
}

// 首次使用（config.json 不存在）时弹出语言选择；必须选择并确认才能进入
function showLanguageModal() {
  const modal = document.getElementById('lang-modal');
  if (!modal) return;
  const select = document.getElementById('modal-lang-select');
  const confirm = document.getElementById('modal-lang-confirm');
  modal.hidden = false;

  confirm.addEventListener('click', async () => {
    modal.hidden = true;
    await changeLanguage((select && select.value) || DEFAULT_LANG);
  }, { once: true });
}

// 发现新版本时弹窗询问
function showUpdateModal(status) {
  const modal = document.getElementById('update-modal');
  const body = document.getElementById('update-body');
  if (!modal) return;
  if (body) body.textContent = t('updateBody', { version: status.remote_version });
  modal.hidden = false;

  document.getElementById('update-later').addEventListener('click', () => {
    modal.hidden = true;
  }, { once: true });

  document.getElementById('update-now').addEventListener('click', async () => {
    modal.hidden = true;
    setStatus(t('updating'));
    showToast(t('updating'));
    try {
      await API.updateApply();
    } catch (err) {
      showToast(t('updateFailed') + err.message, true);
      return;
    }
    waitForServerRestart();
  }, { once: true });
}

// 更新期间服务会重启：轮询到恢复后自动刷新页面
function waitForServerRestart() {
  const timer = setInterval(async () => {
    try {
      await API.updateStatus();
      clearInterval(timer);
      location.reload();
    } catch (err) { /* 服务尚未恢复，继续等待 */ }
  }, 1500);
}

// 后台检查有延迟，轮询几次直到拿到结果
async function checkForUpdate(attempt = 0) {
  try {
    const status = await API.updateStatus();
    console.log('[update] status:', status);

    if (status && !status.checked) {
      if (attempt < 6) {
        setTimeout(() => checkForUpdate(attempt + 1), 2000);
      } else {
        console.log('[update] 后台检查仍未完成，停止轮询');
      }
      return;
    }
    if (status && status.available) {
      console.log(
        `[update] 发现新版本 ${status.remote_version}（本地 ${status.local_version}），弹出更新提示`
      );
      showUpdateModal(status);
    } else {
      const detail = status && status.error ? `，检查异常：${status.error}` : '';
      console.log(`[update] 无可用更新（本地 ${status ? status.local_version : '?'}${detail}）`);
    }
  } catch (err) {
    console.log('[update] 获取更新状态失败：', err.message);
  }
}

// 右上角按钮触发的手动检查：先请求后端重新检查，再轮询等待结果
async function manualCheckUpdate() {
  const btn = document.getElementById('btn-check-update');
  btn.disabled = true;
  showToast(t('checkingUpdate'));
  try {
    await API.updateCheck();
  } catch (err) {
    btn.disabled = false;
    showToast(t('updateFailed') + err.message, true);
    return;
  }
  pollCheckResult(btn);
}

function pollCheckResult(btn, attempt = 0) {
  setTimeout(async () => {
    try {
      const status = await API.updateStatus();
      if (status && status.checking) {
        if (attempt < 30) {
          pollCheckResult(btn, attempt + 1);
        } else {
          btn.disabled = false;
          showToast(t('updateFailed') + 'timeout', true);
        }
        return;
      }
      btn.disabled = false;
      console.log('[update] 手动检查结果:', status);
      if (status && status.available) {
        showUpdateModal(status);
      } else {
        showToast(status && status.error ? t('updateFailed') + status.error : t('upToDate'));
      }
    } catch (err) {
      btn.disabled = false;
      showToast(t('updateFailed') + err.message, true);
    }
  }, 1000);
}

// 刚完成过更新时，进入页面后提示
async function notifyUpdateResult() {
  try {
    const result = await API.updateResult();
    if (result && result.updated) {
      showToast(t('updateDone', { version: result.version || '' }));
      await API.updateResultAck();
    }
  } catch (err) { /* 忽略 */ }
}

function syncToolbar() {
  document.getElementById('scene-name').value = state.scene.name;
  document.getElementById('quality').value = state.scene.config.quality;
  document.getElementById('scene-type').value = state.scene.config.scene_type || 'Scene';
}

async function refreshSceneList() {
  const sel = document.getElementById('scene-list');
  try {
    const items = await API.scenes();
    const current = sel.value;
    sel.innerHTML = `<option value="">${t('openScene')}</option>`
      + items.map((i) => `<option value="${i.name}">${i.name}</option>`).join('');
    sel.value = current;
  } catch (err) { /* 列表拉取失败不影响编辑 */ }
}

async function saveSceneToServer() {
  const name = state.scene.name || 'MyScene';
  try {
    const result = await API.saveScene(name, state.scene);
    showToast(t('savedScene', { name: result.name }));
    await refreshSceneList();
  } catch (err) {
    showToast(t('saveFailed') + err.message, true);
  }
}

function newScene() {
  resetVideo();
  state.scene = makeEmptyScene();
  state.selection = null;
  syncToolbar();
  emit();
}

async function onSceneSelected(e) {
  const name = e.target.value;
  if (!name) return;
  try {
    const raw = await API.loadScene(name);
    state.scene = normalizeScene(raw);
    state.selection = null;
    e.target.value = '';
    resetVideo();
    syncToolbar();
    emit();
    showToast(t('openedScene', { name }));
  } catch (err) {
    showToast(t('openFailed') + err.message, true);
  }
}

async function doRender() {
  const btn = document.getElementById('btn-render');
  btn.disabled = true;
  setStatus(t('submitting'));
  try {
    const task = await API.render(state.scene);
    pollRender(task.id, btn);
  } catch (err) {
    btn.disabled = false;
    setStatus(t('submitFailed'), 'err');
    showToast(t('submitFailedDetail') + err.message, true);
  }
}

async function pollRender(taskId, btn) {
  try {
    const task = await API.task(taskId);
    if (task.status === 'done') {
      btn.disabled = false;
      setStatus(`${t('renderDone')} · ${task.elapsed}s`, 'ok');
      showVideo(task.video_url);
      return;
    }
    if (task.status === 'error') {
      btn.disabled = false;
      setStatus(t('renderFailed'), 'err');
      showToast(t('renderFailedDetail') + task.error, true);
      console.error('manim log:\n' + task.log);
      return;
    }
    setStatus(`${t('rendering')} ${task.elapsed}s`);
    setTimeout(() => pollRender(taskId, btn), 800);
  } catch (err) {
    btn.disabled = false;
    setStatus(t('pollFailed'), 'err');
    showToast(t('pollFailedDetail') + err.message, true);
  }
}

async function init() {
  bindToolbar();
  bindTabs();
  bindLibrary();
  bindCanvas();

  // 语言：加载语言清单与默认语言包
  await bootstrapI18n();

  let lang = DEFAULT_LANG;
  let configured = true;
  try {
    const config = await API.getConfig();
    if (config && config.language) lang = config.language;
    configured = !!(config && config.configured);
  } catch (err) {
    lang = DEFAULT_LANG; // 后端不可用时保持默认语言，也不弹窗（此时选择无法持久化）
  }
  await setLanguage(lang);

  const draft = loadDraft();
  if (draft) {
    state.scene = draft;
    syncToolbar();
  }

  try {
    state.catalog = await API.catalog();
  } catch (err) {
    showToast(t('catalogFailed') + err.message, true);
  }
  renderLibrary();
  emit();
  refreshSceneList();

  if (!configured) showLanguageModal();

  // 更新：先提示上次的更新结果，再异步检查新版本
  notifyUpdateResult();
  checkForUpdate();
}

window.addEventListener('DOMContentLoaded', init);
