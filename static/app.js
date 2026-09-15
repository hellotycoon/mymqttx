"use strict";

const $ = (selector) => document.querySelector(selector);
const els = {
  connectionBtn: $("#connectionBtn"),
  statusText: $("#statusText"),
  sessionPill: $(".session-pill"),
  subscriptionCount: $("#subscriptionCount"),
  subscriptionList: $("#subscriptionList"),
  subscriptionSearch: $("#subscriptionSearch"),
  addSubscriptionBtn: $("#addSubscriptionBtn"),
  workspace: $(".workspace"),
  monitorSection: $(".monitor-section"),
  publisherResizer: $("#publisherResizer"),
  publisherSection: $(".publisher-section"),
  topicRail: $("#topicRail"),
  addPublishTopicBtn: $("#addPublishTopicBtn"),
  publishEditor: $("#publishEditor"),
  activePublishTopic: $("#activePublishTopic"),
  activePublishType: $("#activePublishType"),
  publishQos: $("#publishQos"),
  publishRetain: $("#publishRetain"),
  publishInterval: $("#publishInterval"),
  customIntervalField: $("#customIntervalField"),
  customInterval: $("#customInterval"),
  payloadEditor: $("#payloadEditor"),
  validationStatus: $("#validationStatus"),
  payloadSize: $("#payloadSize"),
  savePublishBtn: $("#savePublishBtn"),
  sendPublishBtn: $("#sendPublishBtn"),
  stopPublishBtn: $("#stopPublishBtn"),
  messageViewport: $("#messageViewport"),
  messageList: $("#messageList"),
  emptyState: $("#emptyState"),
  messageFilter: $("#messageFilter"),
  pauseMessages: $("#pauseMessages"),
  clearMessagesBtn: $("#clearMessagesBtn"),
  railPrevBtn: $("#railPrevBtn"),
  railNextBtn: $("#railNextBtn"),
  modal: $("#appModal"),
  modalForm: $("#modalForm"),
  modalEyebrow: $("#modalEyebrow"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalConfirmBtn: $("#modalConfirmBtn"),
  contextMenu: $("#contextMenu"),
  toastRegion: $("#toastRegion"),
};

const state = {
  config: null,
  connected: false,
  connecting: false,
  selectedPublishId: null,
  selectedSubscriptionId: null,
  filter: "all",
  messages: [],
  messageCounts: new Map(),
  lastSequence: 0,
  publishTimers: new Map(),
  modalHandler: null,
  configSaving: false,
};

async function api(path, options = {}) {
  const init = { method: options.method || "GET", headers: {} };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`服务返回异常（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function iconSvg(kind) {
  const paths = {
    success: '<path d="m5 12 4 4L19 6"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>',
    warning: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v4m0 3h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.success}</svg>`;
}

function toast(message, type = "success", duration = 3200) {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = iconSvg(type);
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);
  els.toastRegion.append(node);
  window.setTimeout(() => node.remove(), duration);
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function activePublish() {
  return state.config?.publishTopics.find((item) => item.id === state.selectedPublishId) || null;
}

function messageTypeForTopic(item) {
  return item?.messageType || "JSON";
}

function subscriptionById(id) {
  return state.config?.subscriptions.find((item) => item.id === id) || null;
}

async function initialize() {
  try {
    state.config = await api("/api/config");
    state.selectedPublishId = state.config.publishTopics[0]?.id || null;
    state.selectedSubscriptionId = state.config.subscriptions[0]?.id || null;
    const status = await api("/api/status");
    state.lastSequence = status.seq || 0;
    updateConnectionStatus(status);
    renderSubscriptions();
    renderPublishTopics();
    loadActiveEditor();
    bindEvents();
    pollEvents();
  } catch (error) {
    toast(`初始化失败：${error.message}`, "error", 8000);
  }
}

function bindEvents() {
  els.connectionBtn.addEventListener("click", handleConnectionClick);
  els.addSubscriptionBtn.addEventListener("click", () => openSubscriptionModal());
  els.addPublishTopicBtn.addEventListener("click", () => openPublishTopicModal());
  els.subscriptionSearch.addEventListener("input", renderSubscriptions);
  els.savePublishBtn.addEventListener("click", saveActivePublish);
  els.sendPublishBtn.addEventListener("click", handleSendClick);
  els.stopPublishBtn.addEventListener("click", () => stopPublisher(state.selectedPublishId));
  els.publishQos.addEventListener("change", captureActiveEditor);
  els.publishRetain.addEventListener("change", captureActiveEditor);
  els.publishInterval.addEventListener("change", () => {
    els.customIntervalField.classList.toggle("hidden", els.publishInterval.value !== "custom");
    captureActiveEditor();
    updateSendButton();
  });
  els.customInterval.addEventListener("input", () => {
    captureActiveEditor();
    updateSendButton();
  });
  els.payloadEditor.addEventListener("input", () => {
    captureActiveEditor();
    validatePayload(false);
  });
  els.payloadEditor.addEventListener("keydown", handleEditorKeydown);
  els.railPrevBtn.addEventListener("click", () => els.topicRail.scrollBy({ left: -320, behavior: "smooth" }));
  els.railNextBtn.addEventListener("click", () => els.topicRail.scrollBy({ left: 320, behavior: "smooth" }));
  els.clearMessagesBtn.addEventListener("click", clearMessages);
  els.messageFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    els.messageFilter.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderMessages();
  });
  els.pauseMessages.addEventListener("change", () => {
    if (!els.pauseMessages.checked) scrollMessagesToBottom();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!els.contextMenu.contains(event.target)) hideContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
  });
  window.addEventListener("resize", hideContextMenu);
  bindTopicRailDrag();
  bindPublisherResize();
  els.modalForm.addEventListener("submit", handleModalSubmit);
}

function updateConnectionStatus(status) {
  state.connected = Boolean(status.connected);
  state.connecting = Boolean(status.connecting);
  els.sessionPill.classList.toggle("connected", state.connected);
  els.sessionPill.classList.toggle("connecting", state.connecting);
  els.statusText.textContent = status.message || (state.connected ? "已连接" : "未连接");
  els.connectionBtn.classList.toggle("connected", state.connected);
  els.connectionBtn.disabled = state.connecting;
  els.connectionBtn.querySelector("span").textContent = state.connected ? "断开连接" : state.connecting ? "正在连接…" : "连接 Broker";
  renderSubscriptions();
}

async function handleConnectionClick() {
  if (state.connected) {
    els.connectionBtn.disabled = true;
    try {
      const result = await api("/api/disconnect", { method: "POST", body: {} });
      updateConnectionStatus(result.status);
      stopAllPublishers();
      toast("已断开 Broker");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      els.connectionBtn.disabled = false;
    }
    return;
  }
  openConnectionModal();
}

function openConnectionModal() {
  const broker = state.config.broker;
  showModal({
    eyebrow: "BROKER CONNECTION",
    title: "连接 MQTT Broker",
    confirmText: "连接",
    body: `
      <div class="form-grid">
        <div class="form-row"><label for="brokerHost">主机</label><input id="brokerHost" name="host" value="${escapeHtml(broker.host)}" required></div>
        <div class="form-row"><label for="brokerPort">端口</label><input id="brokerPort" name="port" type="number" min="1" max="65535" value="${escapeHtml(broker.port)}" required></div>
        <div class="form-row full"><label for="brokerClientId">Client ID</label><input id="brokerClientId" name="clientId" value="${escapeHtml(broker.clientId)}" required></div>
        <div class="form-row"><label for="brokerUsername">用户名（可选）</label><input id="brokerUsername" name="username" value="${escapeHtml(broker.username)}" autocomplete="username"></div>
        <div class="form-row"><label for="brokerPassword">密码（可选）</label><input id="brokerPassword" name="password" type="password" value="${escapeHtml(broker.password)}" autocomplete="current-password"></div>
        <div class="form-row"><label for="brokerKeepalive">Keep Alive（秒）</label><input id="brokerKeepalive" name="keepalive" type="number" min="10" max="65535" value="${escapeHtml(broker.keepalive)}"></div>
        <label class="form-check"><input name="cleanSession" type="checkbox" ${broker.cleanSession ? "checked" : ""}> Clean Session</label>
        <div class="form-note">默认使用 MQTT 3.1.1、TCP、QoS 0。应用启动时不会自动连接，连接参数会保存在本机配置目录。</div>
      </div>`,
    onConfirm: async () => {
      const data = formValues();
      const connection = {
        host: data.host.trim(),
        port: Number(data.port),
        clientId: data.clientId.trim(),
        username: data.username,
        password: data.password,
        keepalive: Number(data.keepalive),
        cleanSession: data.cleanSession === "on",
      };
      if (!connection.host || !connection.clientId) throw new Error("主机和 Client ID 不能为空");
      updateConnectionStatus({ connected: false, connecting: true, message: "正在连接…" });
      try {
        const result = await api("/api/connect", { method: "POST", body: connection });
        state.config.broker = connection;
        updateConnectionStatus(result.status);
        if (result.subscriptionErrors?.length) {
          toast(`已连接，但 ${result.subscriptionErrors.length} 个订阅失败`, "warning", 6000);
        } else {
          toast(`已连接 ${result.status.message}`);
        }
      } catch (error) {
        updateConnectionStatus({ connected: false, connecting: false, message: "连接失败" });
        throw error;
      }
    },
  });
}

function renderSubscriptions() {
  if (!state.config) return;
  const previousScrollTop = els.subscriptionList.scrollTop;
  const query = els.subscriptionSearch.value.trim().toLowerCase();
  const subscriptions = state.config.subscriptions.filter((item) => item.topic.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  for (const item of subscriptions) {
    const node = document.createElement("button");
    const active = item.enabled;
    node.type = "button";
    node.className = `subscription-item${active ? " active" : ""}${item.enabled ? "" : " paused"}${item.id === state.selectedSubscriptionId ? " selected" : ""}`;
    node.dataset.id = item.id;

    const name = document.createElement("span");
    name.className = "subscription-name";
    name.textContent = item.topic;
    node.append(name);
    node.addEventListener("click", () => {
      state.selectedSubscriptionId = item.id;
      state.messageCounts.set(item.topic, 0);
      renderSubscriptions();
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      state.selectedSubscriptionId = item.id;
      renderSubscriptions();
      showSubscriptionMenu(item, event.clientX, event.clientY);
    });
    fragment.append(node);
  }
  els.subscriptionList.replaceChildren(fragment);
  els.subscriptionList.scrollTop = previousScrollTop;
  els.subscriptionCount.textContent = String(state.config.subscriptions.length);
}

function showSubscriptionMenu(item, x, y) {
  const toggleLabel = item.enabled ? "暂停订阅" : "启用订阅";
  els.contextMenu.innerHTML = `
    <button data-action="edit"><svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 7 3 3"/></svg>编辑 topic</button>
    <button data-action="toggle"><svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>${toggleLabel}</button>
    <div class="context-divider"></div>
    <button class="danger" data-action="delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>删除订阅</button>`;
  els.contextMenu.querySelector('[data-action="edit"]').onclick = () => openSubscriptionModal(item);
  els.contextMenu.querySelector('[data-action="toggle"]').onclick = () => toggleSubscription(item);
  els.contextMenu.querySelector('[data-action="delete"]').onclick = () => confirmDeleteSubscription(item);
  placeContextMenu(x, y);
}

function openSubscriptionModal(existing = null) {
  showModal({
    eyebrow: existing ? "EDIT SUBSCRIPTION" : "NEW SUBSCRIPTION",
    title: existing ? "编辑订阅" : "添加订阅",
    confirmText: existing ? "保存" : "添加并保存",
    body: `
      <div class="form-grid">
        <div class="form-row full"><label for="subscriptionTopic">Topic</label><input id="subscriptionTopic" name="topic" value="${escapeHtml(existing?.topic || "")}" placeholder="例如 ads/#" required autofocus></div>
        <div class="form-row"><label for="subscriptionQos">QoS</label><select id="subscriptionQos" name="qos"><option value="0" ${existing?.qos === 0 ? "selected" : ""}>0 · At most once</option><option value="1" ${existing?.qos === 1 ? "selected" : ""}>1 · At least once</option><option value="2" ${existing?.qos === 2 ? "selected" : ""}>2 · Exactly once</option></select></div>
        <label class="form-check"><input name="enabled" type="checkbox" ${existing?.enabled ? "checked" : ""}> 启用订阅</label>
        <div class="form-note">支持 MQTT 通配符 <strong>+</strong> 和 <strong>#</strong>。新增或修改后会立即保存为下次启动的默认配置。</div>
      </div>`,
    onConfirm: async () => {
      const data = formValues();
      const topic = data.topic.trim();
      if (!topic || topic.includes("\0")) throw new Error("Topic 不能为空或包含空字符");
      const duplicate = state.config.subscriptions.some((item) => item.topic === topic && item.id !== existing?.id);
      if (duplicate) throw new Error("该订阅 Topic 已存在");
      const updated = {
        id: existing?.id || uuid(),
        topic,
        qos: Number(data.qos),
        enabled: data.enabled === "on",
      };
      if (existing) {
        if (state.connected && existing.enabled) await api("/api/unsubscribe", { method: "POST", body: { topic: existing.topic } });
        Object.assign(existing, updated);
      } else {
        state.config.subscriptions.push(updated);
        state.selectedSubscriptionId = updated.id;
      }
      await saveConfig();
      if (state.connected && updated.enabled) await api("/api/subscribe", { method: "POST", body: updated });
      renderSubscriptions();
      toast(existing ? "订阅配置已更新" : "订阅已添加并保存");
    },
  });
}

async function toggleSubscription(item) {
  hideContextMenu();
  try {
    if (item.enabled && state.connected) {
      await api("/api/unsubscribe", { method: "POST", body: { topic: item.topic } });
    } else if (!item.enabled && state.connected) {
      await api("/api/subscribe", { method: "POST", body: { topic: item.topic, qos: item.qos } });
    }
    item.enabled = !item.enabled;
    await saveConfig();
    renderSubscriptions();
    toast(item.enabled ? "订阅已启用" : "订阅已暂停");
  } catch (error) {
    toast(error.message, "error");
  }
}

function confirmDeleteSubscription(item) {
  hideContextMenu();
  showModal({
    eyebrow: "REMOVE SUBSCRIPTION",
    title: "删除订阅",
    confirmText: "确认删除",
    body: `<div class="form-note">将从默认配置中删除 <strong>${escapeHtml(item.topic)}</strong>。此操作不会删除 Broker 中的任何数据。</div>`,
    onConfirm: async () => {
      if (state.connected && item.enabled) await api("/api/unsubscribe", { method: "POST", body: { topic: item.topic } });
      state.config.subscriptions = state.config.subscriptions.filter((entry) => entry.id !== item.id);
      state.selectedSubscriptionId = state.config.subscriptions[0]?.id || null;
      await saveConfig();
      renderSubscriptions();
      toast("订阅已删除");
    },
  });
}

function renderPublishTopics() {
  if (!state.config) return;
  const fragment = document.createDocumentFragment();
  for (const item of state.config.publishTopics) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `topic-card${item.id === state.selectedPublishId ? " active" : ""}${state.publishTimers.has(item.id) ? " running" : ""}`;
    card.dataset.id = item.id;
    card.title = `${item.topic} · ${messageTypeForTopic(item)} · QoS ${item.qos} · ${item.intervalMs ? formatInterval(item.intervalMs) : "单次"}`;
    const name = document.createElement("span");
    name.className = "topic-card-name";
    name.textContent = item.topic;
    const meta = document.createElement("span");
    meta.className = "topic-card-meta";
    meta.textContent = `${messageTypeForTopic(item)} · QoS ${item.qos} · ${item.intervalMs ? formatInterval(item.intervalMs) : "单次"}`;
    card.append(name, meta);
    card.addEventListener("click", () => selectPublishTopic(item.id));
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showPublishMenu(item, event.clientX, event.clientY);
    });
    fragment.append(card);
  }
  els.topicRail.replaceChildren(fragment);
  const hasTopics = state.config.publishTopics.length > 0;
  els.publishEditor.classList.toggle("hidden", !hasTopics);
}

function selectPublishTopic(id) {
  captureActiveEditor();
  state.selectedPublishId = id;
  renderPublishTopics();
  loadActiveEditor();
  requestAnimationFrame(() => {
    const card = [...els.topicRail.children].find((node) => node.dataset.id === id);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  });
}

function loadActiveEditor() {
  const item = activePublish();
  if (!item) return;
  els.activePublishTopic.textContent = item.topic;
  els.activePublishType.textContent = messageTypeForTopic(item);
  els.activePublishType.title = messageTypeForTopic(item) === "JSON" ? "自定义 JSON 消息" : "对应数据类型";
  els.publishQos.value = String(item.qos);
  els.publishRetain.checked = Boolean(item.retain);
  const standard = [0, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  if (standard.includes(Number(item.intervalMs))) {
    els.publishInterval.value = String(item.intervalMs);
    els.customIntervalField.classList.add("hidden");
  } else {
    els.publishInterval.value = "custom";
    els.customInterval.value = String(item.intervalMs || 3000);
    els.customIntervalField.classList.remove("hidden");
  }
  els.payloadEditor.value = item.payload;
  validatePayload(false);
  updateSendButton();
}

function currentInterval() {
  if (els.publishInterval.value === "custom") {
    const value = Number(els.customInterval.value);
    return Number.isFinite(value) ? Math.max(100, Math.min(86400000, Math.round(value))) : 3000;
  }
  return Number(els.publishInterval.value);
}

function captureActiveEditor() {
  const item = activePublish();
  if (!item) return;
  item.payload = els.payloadEditor.value;
  item.qos = Number(els.publishQos.value);
  item.retain = els.publishRetain.checked;
  item.intervalMs = currentInterval();
  updatePayloadSize();
}

function validatePayload(showError = true, item = activePublish()) {
  if (!item) return false;
  try {
    JSON.parse(item.payload);
    els.validationStatus.classList.remove("invalid");
    els.validationStatus.lastElementChild.textContent = "JSON 格式正确";
    return true;
  } catch (error) {
    els.validationStatus.classList.add("invalid");
    els.validationStatus.lastElementChild.textContent = "JSON 格式错误";
    if (showError) toast(`无法发送：${friendlyJsonError(error, item.payload)}`, "error", 6000);
    return false;
  } finally {
    updatePayloadSize();
  }
}

function friendlyJsonError(error, text) {
  const match = /position\s+(\d+)/i.exec(error.message);
  if (!match) return error.message;
  const position = Number(match[1]);
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return `第 ${line} 行，第 ${column} 列：${error.message}`;
}

function updatePayloadSize() {
  const bytes = new TextEncoder().encode(els.payloadEditor.value).length;
  els.payloadSize.textContent = formatBytes(bytes);
}

function updateSendButton() {
  const item = activePublish();
  if (!item) return;
  const running = state.publishTimers.has(item.id);
  els.stopPublishBtn.classList.toggle("hidden", !running);
  const label = els.sendPublishBtn.querySelector("span");
  if (running) label.textContent = "立即发送";
  else label.textContent = currentInterval() > 0 ? "开始循环" : "发送一次";
}

async function saveActivePublish() {
  captureActiveEditor();
  try {
    await saveConfig();
    renderPublishTopics();
    toast("当前发布配置已保存");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function handleSendClick() {
  captureActiveEditor();
  const item = activePublish();
  if (!item || !validatePayload(true, item)) return;
  if (!state.connected) {
    toast("尚未连接 Broker，请先点击右上角“连接 Broker”", "warning", 5000);
    return;
  }
  if (state.publishTimers.has(item.id)) {
    await publishItem(item);
    return;
  }
  if (item.intervalMs > 0) {
    const ok = await publishItem(item);
    if (!ok) return;
    const timer = window.setInterval(async () => {
      const current = state.config.publishTopics.find((entry) => entry.id === item.id);
      if (!current || !state.connected) return stopPublisher(item.id);
      await publishItem(current, false);
    }, item.intervalMs);
    state.publishTimers.set(item.id, timer);
    renderPublishTopics();
    updateSendButton();
    toast(`${item.topic} 已开始按 ${formatInterval(item.intervalMs)} 发送`);
  } else {
    await publishItem(item);
  }
}

async function publishItem(item, showSuccess = true) {
  if (!validateItemJson(item)) {
    stopPublisher(item.id);
    toast(`${item.topic} 的 JSON 格式错误，循环发送已停止`, "error", 6000);
    return false;
  }
  try {
    await api("/api/publish", { method: "POST", body: item });
    if (showSuccess && item.intervalMs === 0) toast(`已发送 ${item.topic}`);
    return true;
  } catch (error) {
    stopPublisher(item.id);
    toast(error.message, "error", 6000);
    return false;
  }
}

function validateItemJson(item) {
  try { JSON.parse(item.payload); return true; } catch { return false; }
}

function stopPublisher(id, notify = true) {
  const timer = state.publishTimers.get(id);
  if (!timer) return;
  window.clearInterval(timer);
  state.publishTimers.delete(id);
  renderPublishTopics();
  updateSendButton();
  if (notify) toast("循环发送已停止");
}

function stopAllPublishers() {
  for (const timer of state.publishTimers.values()) window.clearInterval(timer);
  state.publishTimers.clear();
  renderPublishTopics();
  updateSendButton();
}

function openPublishTopicModal(existing = null) {
  showModal({
    eyebrow: existing ? "EDIT PUBLISH TOPIC" : "NEW PUBLISH TOPIC",
    title: existing ? "编辑发布 Topic" : "添加发布 Topic",
    confirmText: existing ? "保存" : "添加并保存",
    body: `
      <div class="form-grid">
        <div class="form-row full"><label for="publishTopicName">Topic</label><input id="publishTopicName" name="topic" value="${escapeHtml(existing?.topic || "")}" placeholder="例如 test/agent/input" required autofocus></div>
        <div class="form-row"><label for="newPublishQos">QoS</label><select id="newPublishQos" name="qos"><option value="0" ${existing?.qos === 0 ? "selected" : ""}>0 · At most once</option><option value="1" ${existing?.qos === 1 ? "selected" : ""}>1 · At least once</option><option value="2" ${existing?.qos === 2 ? "selected" : ""}>2 · Exactly once</option></select></div>
        <label class="form-check"><input name="retain" type="checkbox" ${existing?.retain ? "checked" : ""}> Retain</label>
        <div class="form-note">发布 Topic 不能包含通配符 <strong>+</strong> 或 <strong>#</strong>。默认 Payload 为一个空 JSON 对象。</div>
      </div>`,
    onConfirm: async () => {
      const data = formValues();
      const topic = data.topic.trim();
      if (!topic) throw new Error("Topic 不能为空");
      if (topic.includes("+") || topic.includes("#") || topic.includes("\0")) throw new Error("发布 Topic 不能包含 +、# 或空字符");
      if (existing) {
        existing.topic = topic;
        existing.qos = Number(data.qos);
        existing.retain = data.retain === "on";
      } else {
        const item = { id: uuid(), topic, payload: "{\n  \n}", qos: Number(data.qos), retain: data.retain === "on", intervalMs: 0 };
        state.config.publishTopics.push(item);
        state.selectedPublishId = item.id;
      }
      await saveConfig();
      renderPublishTopics();
      loadActiveEditor();
      toast(existing ? "发布 Topic 已更新" : "发布 Topic 已添加并保存");
    },
  });
}

function showPublishMenu(item, x, y) {
  els.contextMenu.innerHTML = `
    <button data-action="edit"><svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 7 3 3"/></svg>编辑 Topic</button>
    <button data-action="duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>复制配置</button>
    <div class="context-divider"></div>
    <button class="danger" data-action="delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>删除 Topic</button>`;
  els.contextMenu.querySelector('[data-action="edit"]').onclick = () => openPublishTopicModal(item);
  els.contextMenu.querySelector('[data-action="duplicate"]').onclick = () => duplicatePublishTopic(item);
  els.contextMenu.querySelector('[data-action="delete"]').onclick = () => confirmDeletePublish(item);
  placeContextMenu(x, y);
}

async function duplicatePublishTopic(item) {
  hideContextMenu();
  const clone = { ...item, id: uuid(), topic: `${item.topic}/copy` };
  state.config.publishTopics.push(clone);
  state.selectedPublishId = clone.id;
  try {
    await saveConfig();
    renderPublishTopics();
    loadActiveEditor();
    toast("发布配置已复制");
  } catch (error) {
    toast(error.message, "error");
  }
}

function confirmDeletePublish(item) {
  hideContextMenu();
  showModal({
    eyebrow: "REMOVE PUBLISH TOPIC",
    title: "删除发布 Topic",
    confirmText: "确认删除",
    body: `<div class="form-note">将删除 <strong>${escapeHtml(item.topic)}</strong> 及其已保存的 Payload、QoS、Retain 和发送频率配置。</div>`,
    onConfirm: async () => {
      stopPublisher(item.id, false);
      state.config.publishTopics = state.config.publishTopics.filter((entry) => entry.id !== item.id);
      if (state.selectedPublishId === item.id) state.selectedPublishId = state.config.publishTopics[0]?.id || null;
      await saveConfig();
      renderPublishTopics();
      loadActiveEditor();
      toast("发布 Topic 已删除");
    },
  });
}

async function saveConfig() {
  if (state.configSaving) throw new Error("配置正在保存，请稍后重试");
  state.configSaving = true;
  try {
    state.config = await api("/api/config", { method: "POST", body: state.config });
  } finally {
    state.configSaving = false;
  }
}

async function pollEvents() {
  while (true) {
    try {
      const result = await api(`/api/events?after=${state.lastSequence}`);
      for (const event of result.events || []) {
        state.lastSequence = Math.max(state.lastSequence, event.seq || 0);
        if (event.kind === "status") updateConnectionStatus(event);
        if (event.kind === "message") acceptMessage(event);
      }
    } catch (error) {
      await delay(1000);
    }
  }
}

function acceptMessage(message) {
  state.messages.push(message);
  if (state.messages.length > 1000) state.messages.splice(0, state.messages.length - 1000);
  if (message.direction === "received") {
    const selected = subscriptionById(state.selectedSubscriptionId);
    if (!selected || !topicMatches(selected.topic, message.topic)) {
      state.messageCounts.set(message.topic, (state.messageCounts.get(message.topic) || 0) + 1);
    }
    renderSubscriptions();
  }
  appendMessageIfVisible(message);
}

function appendMessageIfVisible(message) {
  if (state.filter !== "all" && message.direction !== state.filter) return;
  els.emptyState.classList.add("hidden");
  els.messageList.append(createMessageCard(message));
  while (els.messageList.children.length > 600) els.messageList.firstElementChild.remove();
  if (!els.pauseMessages.checked) scrollMessagesToBottom();
}

function renderMessages() {
  const fragment = document.createDocumentFragment();
  const visible = state.messages.filter((message) => state.filter === "all" || message.direction === state.filter);
  for (const message of visible.slice(-600)) fragment.append(createMessageCard(message));
  els.messageList.replaceChildren(fragment);
  els.emptyState.classList.toggle("hidden", visible.length > 0);
  scrollMessagesToBottom();
}

function createMessageCard(message) {
  const card = document.createElement("article");
  card.className = `message-card ${message.direction}`;
  const header = document.createElement("div");
  header.className = "message-header";
  const topic = document.createElement("span");
  topic.className = "message-topic";
  topic.textContent = message.topic;
  const chip = document.createElement("span");
  chip.className = "message-chip";
  chip.textContent = `QoS ${message.qos}${message.retain ? " · Retain" : ""}`;
  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(message.timestamp);
  const payload = document.createElement("pre");
  payload.className = "message-payload";
  payload.textContent = message.payload;
  header.append(topic, chip, time);
  card.append(header, payload);
  return card;
}

function clearMessages() {
  state.messages = [];
  state.messageCounts.clear();
  els.messageList.replaceChildren();
  els.emptyState.classList.remove("hidden");
  renderSubscriptions();
  toast("当前消息记录已清空");
}

function topicMatches(filter, topic) {
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");
  for (let i = 0, j = 0; i < filterParts.length; i += 1, j += 1) {
    if (filterParts[i] === "#") return true;
    if (j >= topicParts.length) return false;
    if (filterParts[i] !== "+" && filterParts[i] !== topicParts[j]) return false;
  }
  return filterParts.length === topicParts.length;
}

function showModal({ eyebrow, title, body, confirmText, onConfirm }) {
  hideContextMenu();
  els.modalEyebrow.textContent = eyebrow;
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = body;
  els.modalConfirmBtn.textContent = confirmText;
  els.modalConfirmBtn.disabled = false;
  state.modalHandler = onConfirm;
  els.modal.showModal();
  requestAnimationFrame(() => els.modalBody.querySelector("[autofocus]")?.focus());
}

async function handleModalSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    els.modal.close();
    return;
  }
  if (!state.modalHandler) return els.modal.close();
  els.modalConfirmBtn.disabled = true;
  try {
    await state.modalHandler();
    els.modal.close();
  } catch (error) {
    toast(error.message, "error", 6000);
  } finally {
    els.modalConfirmBtn.disabled = false;
  }
}

function formValues() {
  return Object.fromEntries(new FormData(els.modalForm).entries());
}

function placeContextMenu(x, y) {
  els.contextMenu.classList.remove("hidden");
  const rect = els.contextMenu.getBoundingClientRect();
  els.contextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  els.contextMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

function hideContextMenu() {
  els.contextMenu.classList.add("hidden");
}

function bindTopicRailDrag() {
  let down = false;
  let startX = 0;
  let scrollLeft = 0;
  let moved = false;
  let pointerId = null;
  els.topicRail.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      els.topicRail.scrollLeft += event.deltaY;
    }
  }, { passive: false });
  els.topicRail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down = true;
    moved = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    scrollLeft = els.topicRail.scrollLeft;
    els.topicRail.classList.add("dragging");
  });
  document.addEventListener("pointermove", (event) => {
    if (!down || event.pointerId !== pointerId) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 4) moved = true;
    els.topicRail.scrollLeft = scrollLeft - delta;
  });
  const finishDrag = (event) => {
    if (event.pointerId !== pointerId) return;
    down = false;
    pointerId = null;
    els.topicRail.classList.remove("dragging");
  };
  document.addEventListener("pointerup", finishDrag);
  document.addEventListener("pointercancel", finishDrag);
  els.topicRail.addEventListener("click", (event) => {
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }
  }, true);
}

const PUBLISHER_RESIZE = {
  minMonitor: 120,
  minPublisher: 330,
  defaultRatio: 0.38,
};

function publisherResizeMetrics() {
  const height = els.workspace.getBoundingClientRect().height;
  const handle = els.publisherResizer.offsetHeight || 10;
  return {
    height,
    handle,
    available: Math.max(0, height - handle),
  };
}

function applyPublisherLayout() {
  const { available, handle } = publisherResizeMetrics();
  if (available <= PUBLISHER_RESIZE.minMonitor + PUBLISHER_RESIZE.minPublisher) return;
  const stored = Number(els.workspace.dataset.publisherRatio);
  const ratio = Number.isFinite(stored) ? stored : PUBLISHER_RESIZE.defaultRatio;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  let publisher = Math.round(available * clampedRatio);
  publisher = Math.max(
    PUBLISHER_RESIZE.minPublisher,
    Math.min(available - PUBLISHER_RESIZE.minMonitor, publisher),
  );
  const monitor = available - publisher;
  els.workspace.style.gridTemplateRows = `${monitor}px ${handle}px ${publisher}px`;
}

function bindPublisherResize() {
  let resizing = false;
  let pointerId = null;
  let startY = 0;
  let startPublisher = 0;
  let startHeight = 0;

  els.publisherResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    resizing = true;
    pointerId = event.pointerId;
    startY = event.clientY;
    startHeight = els.workspace.getBoundingClientRect().height;
    startPublisher = els.publisherSection.getBoundingClientRect().height;
    els.publisherResizer.classList.add("dragging");
    document.body.classList.add("publisher-resizing");
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!resizing || event.pointerId !== pointerId) return;
    const handle = els.publisherResizer.offsetHeight || 10;
    const available = Math.max(0, startHeight - handle);
    if (available < PUBLISHER_RESIZE.minMonitor + PUBLISHER_RESIZE.minPublisher) return;
    const delta = event.clientY - startY;
    let publisher = startPublisher - delta;
    publisher = Math.max(
      PUBLISHER_RESIZE.minPublisher,
      Math.min(available - PUBLISHER_RESIZE.minMonitor, publisher),
    );
    const monitor = available - publisher;
    els.workspace.dataset.resized = "true";
    els.workspace.dataset.publisherRatio = String(publisher / available);
    els.workspace.style.gridTemplateRows = `${monitor}px ${handle}px ${publisher}px`;
  });

  const finishResize = (event) => {
    if (!resizing || event.pointerId !== pointerId) return;
    resizing = false;
    pointerId = null;
    els.publisherResizer.classList.remove("dragging");
    document.body.classList.remove("publisher-resizing");
  };
  document.addEventListener("pointerup", finishResize);
  document.addEventListener("pointercancel", finishResize);

  window.addEventListener("resize", () => {
    if (els.workspace.dataset.resized === "true") applyPublisherLayout();
  });
}

function handleEditorKeydown(event) {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = els.payloadEditor.selectionStart;
    const end = els.payloadEditor.selectionEnd;
    els.payloadEditor.setRangeText("  ", start, end, "end");
    els.payloadEditor.dispatchEvent(new Event("input"));
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleSendClick();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveActivePublish();
  }
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => { els.messageViewport.scrollTop = els.messageViewport.scrollHeight; });
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }).format(new Date(timestamp * 1000));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function formatInterval(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds % 1000 === 0) return `${milliseconds / 1000}s`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

initialize();
