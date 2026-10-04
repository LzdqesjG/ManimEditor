// 后端接口封装。所有请求都走同源的 FastAPI。
async function httpGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const API = {
  catalog: () => httpGet('/api/catalog'),
  codegen: (scene) => httpPost('/api/codegen', scene),
  render: (scene) => httpPost('/api/render', scene),
  task: (id) => httpGet('/api/render/' + id),
  scenes: () => httpGet('/api/scenes'),
  saveScene: (name, scene) => httpPost('/api/scenes/' + encodeURIComponent(name), scene),
  loadScene: (name) => httpGet('/api/scenes/' + encodeURIComponent(name)),
  getConfig: () => httpGet('/api/config'),
  saveConfig: (config) => httpPost('/api/config', config),
};
