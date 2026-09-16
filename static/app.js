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
  subscriptionDragging: false,
  publishDragging: false,
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
    if (!event.target.closest?.(".combo-input")) {
      document.querySelectorAll(".combo-menu").forEach((menu) => menu.classList.add("hidden"));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
  });
  window.addEventListener("resize", hideContextMenu);
  bindSubscriptionDrag();
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
  const recentBrokers = Array.isArray(state.config.recentBrokers) ? state.config.recentBrokers : [];
  const recentHosts = [...new Set(recentBrokers.map((item) => item.host).filter(Boolean))];
  const recentPorts = [...new Set(recentBrokers.map((item) => String(item.port)).filter(Boolean))];
  showModal({
    eyebrow: "BROKER CONNECTION",
    title: "连接 MQTT Broker",
    confirmText: "连接",
    body: `
      <div class="form-grid">
        <div class="form-row"><label for="brokerHost">主机</label><div class="combo-input"><input id="brokerHost" name="host" value="${escapeHtml(broker.host)}" required><button type="button" class="combo-button" data-combo="brokerHost" aria-label="选择最近主机"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></button><div class="combo-menu hidden" id="brokerHostMenu"></div></div></div>
        <div class="form-row"><label for="brokerPort">端口</label><div class="combo-input"><input id="brokerPort" name="port" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(broker.port)}" required><button type="button" class="combo-button" data-combo="brokerPort" aria-label="选择最近端口"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></button><div class="combo-menu hidden" id="brokerPortMenu"></div></div></div>
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
        try {
          state.config = await api("/api/config");
        } catch (error) {
          // Broker 已连接成功，配置刷新失败不影响本次连接状态。
        }
        if (result.subscriptionErrors?.length) {
          toast(`已连接，但 ${result.subscriptionErrors.length} 个订阅失败`, "warning", 6000);
        } else {
          toast(`已连接 ${result.status.message}`);
        }
      } catch (error) {
        updateConnectionStatus({ connected: false, connecting: false, message: "连接失败" });
        try {
          state.config = await api("/api/config");
        } catch (refreshError) {
          // 连接失败时仍尽力刷新最近记录，配置刷新失败不影响错误提示。
        }
        throw error;
      }
    },
  });
  requestAnimationFrame(() => bindBrokerDropdowns({ hosts: recentHosts, ports: recentPorts }));
}

function bindBrokerDropdowns({ hosts, ports }) {
  const combos = [
    { button: els.modalBody.querySelector('[data-combo="brokerHost"]'), menu: $("#brokerHostMenu"), input: $("#brokerHost"), values: hosts },
    { button: els.modalBody.querySelector('[data-combo="brokerPort"]'), menu: $("#brokerPortMenu"), input: $("#brokerPort"), values: ports },
  ];
  const closeMenus = (except = null) => {
    combos.forEach((combo) => {
      if (combo.menu !== except) combo.menu.classList.add("hidden");
    });
  };
  combos.forEach((combo) => {
    combo.button.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = combo.menu.classList.contains("hidden");
      closeMenus();
      if (!willOpen) return;
      combo.menu.replaceChildren();
      if (!combo.values.length) {
        const empty = document.createElement("div");
        empty.className = "combo-empty";
        empty.textContent = "暂无最近记录";
        combo.menu.append(empty);
      } else {
        combo.values.forEach((value) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "combo-item";
          item.textContent = value;
          item.addEventListener("click", () => {
            combo.input.value = value;
            combo.menu.classList.add("hidden");
          });
          combo.menu.append(item);
        });
      }
      combo.menu.classList.remove("hidden");
    });
  });
}

function renderSubscriptions() {
  if (!state.config) return;
  if (state.subscriptionDragging) return;
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
  if (state.publishDragging) return;
  const previousScrollLeft = els.topicRail.scrollLeft;
  const previousScrollBehavior = els.topicRail.style.scrollBehavior;
  els.topicRail.style.scrollBehavior = "auto";
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
  els.topicRail.scrollLeft = previousScrollLeft;
  els.topicRail.style.scrollBehavior = previousScrollBehavior;
  const hasTopics = state.config.publishTopics.length > 0;
  els.publishEditor.classList.toggle("hidden", !hasTopics);
}

function selectPublishTopic(id) {
  captureActiveEditor();
  state.selectedPublishId = id;
  renderPublishTopics();
  loadActiveEditor();
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
    <button data-action="copy-topic"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>复制 topic</button>
    <button data-action="copy-payload"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>复制 payload</button>
    <div class="context-divider"></div>
    <button class="danger" data-action="delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>删除 Topic</button>`;
  els.contextMenu.querySelector('[data-action="edit"]').onclick = () => openPublishTopicModal(item);
  els.contextMenu.querySelector('[data-action="copy-topic"]').onclick = () => copyPublishTopic(item);
  els.contextMenu.querySelector('[data-action="copy-payload"]').onclick = () => copyPublishPayload(item);
  els.contextMenu.querySelector('[data-action="delete"]').onclick = () => confirmDeletePublish(item);
  placeContextMenu(x, y);
}

async function copyTextToClipboard(text, label) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    toast(`${label}已复制`);
  } catch (error) {
    toast(`复制失败：${error.message}`, "error");
  }
}

async function copyPublishTopic(item) {
  hideContextMenu();
  await copyTextToClipboard(item.topic, "Topic");
}

async function copyPublishPayload(item) {
  hideContextMenu();
  await copyTextToClipboard(item.payload, "Payload");
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

function createDragGhost(source, extraClass) {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add("drag-ghost", extraClass);
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.position = "fixed";
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "9999";
  document.body.append(ghost);
  return ghost;
}

function moveDragGhost(ghost, clientX, clientY, grabX, grabY) {
  if (!ghost) return;
  ghost.style.left = `${clientX - grabX}px`;
  ghost.style.top = `${clientY - grabY}px`;
}

function autoScrollTopicRail(clientX) {
  const rect = els.topicRail.getBoundingClientRect();
  const edge = 46;
  const speed = 18;
  const maxLeft = Math.max(0, els.topicRail.scrollWidth - els.topicRail.clientWidth);
  if (clientX < rect.left + edge && els.topicRail.scrollLeft > 0) {
    els.topicRail.scrollLeft = Math.max(0, els.topicRail.scrollLeft - speed);
  } else if (clientX > rect.right - edge && els.topicRail.scrollLeft < maxLeft) {
    els.topicRail.scrollLeft = Math.min(maxLeft, els.topicRail.scrollLeft + speed);
  }
}

function updateDraggedTransform(element, clientX, clientY, grabX, grabY) {
  element.style.transition = "none";
  element.style.transform = "none";
  const rect = element.getBoundingClientRect();
  element.style.transform = `translate(${clientX - grabX - rect.left}px, ${clientY - grabY - rect.top}px) scale(1.02)`;
}

function updateVerticalLiftTransform(element, clientY, grabY) {
  element.style.transition = "none";
  element.style.transform = "none";
  const rect = element.getBoundingClientRect();
  element.style.transform = `translateY(${clientY - grabY - rect.top}px) scale(1.03)`;
}

function clearDragTransforms(container, draggedEl) {
  for (const child of container.children) {
    if (child === draggedEl) continue;
    child.style.transition = "";
    child.style.transform = "";
  }
  if (draggedEl) {
    draggedEl.style.transition = "";
    draggedEl.style.transform = "";
  }
}

function targetIndexFromPointer(container, draggedEl, coordinate, direction) {
  let index = 0;
  for (const child of container.children) {
    if (child === draggedEl) continue;
    const rect = child.getBoundingClientRect();
    const center = direction === "vertical"
      ? rect.top + rect.height / 2
      : rect.left + rect.width / 2;
    if (coordinate < center) break;
    index += 1;
  }
  return index;
}

function reorderDraggedElement(container, draggedEl, targetIndex, clientX, clientY, grabX, grabY) {
  const children = [...container.children];
  const fromIndex = children.indexOf(draggedEl);
  if (fromIndex < 0) return -1;
  const siblings = children.filter((child) => child !== draggedEl);
  const clamped = Math.max(0, Math.min(targetIndex, siblings.length));
  if (clamped === fromIndex) {
    updateDraggedTransform(draggedEl, clientX, clientY, grabX, grabY);
    return fromIndex;
  }

  draggedEl.style.transition = "none";
  draggedEl.style.transform = "none";
  const firstRects = new Map(children.map((child) => [child, child.getBoundingClientRect()]));
  container.insertBefore(draggedEl, siblings[clamped] || null);
  const lastRects = new Map(children.map((child) => [child, child.getBoundingClientRect()]));

  for (const child of children) {
    if (child === draggedEl) continue;
    const first = firstRects.get(child);
    const last = lastRects.get(child);
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    child.style.transition = "none";
    child.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  void container.offsetWidth;
  for (const child of children) {
    if (child === draggedEl) continue;
    child.style.transition = "transform 190ms cubic-bezier(.2, .8, .2, 1)";
    child.style.transform = "";
  }

  const draggedLast = lastRects.get(draggedEl);
  draggedEl.style.transition = "none";
  draggedEl.style.transform = `translate(${clientX - grabX - draggedLast.left}px, ${clientY - grabY - draggedLast.top}px) scale(1.02)`;
  return clamped;
}

function restoreContainerOrder(container, orderedIds) {
  const children = [...container.children];
  const byId = new Map(children.map((child) => [child.dataset.id, child]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length !== children.length) return;
  const firstRects = new Map(children.map((child) => [child, child.getBoundingClientRect()]));
  container.replaceChildren(...ordered);
  const lastRects = new Map(ordered.map((child) => [child, child.getBoundingClientRect()]));

  for (const child of ordered) {
    const first = firstRects.get(child);
    const last = lastRects.get(child);
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    child.style.transition = "none";
    child.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  void container.offsetWidth;
  for (const child of ordered) {
    child.style.transition = "transform 190ms cubic-bezier(.2, .8, .2, 1)";
    child.style.transform = "";
  }
}

function startSubscriptionDragVisual(element) {
  state.subscriptionDragging = true;
  const ghost = createDragGhost(element, "subscription-ghost");
  element.classList.add("dragging");
  element.style.opacity = "0";
  document.body.classList.add("list-dragging");
  return ghost;
}

function cleanupSubscriptionDragVisual(element, ghost) {
  state.subscriptionDragging = false;
  if (ghost) ghost.remove();
  if (element) {
    element.classList.remove("dragging");
    element.style.opacity = "";
  }
  document.body.classList.remove("list-dragging");
  clearDragTransforms(els.subscriptionList, element);
}

async function commitSubscriptionReorder(displayedIds) {
  const full = state.config.subscriptions;
  const displayedItems = displayedIds
    .map((id) => full.find((item) => item.id === id))
    .filter(Boolean);
  if (!displayedIds.length || displayedItems.length !== displayedIds.length) return;

  const query = els.subscriptionSearch.value.trim().toLowerCase();
  if (!query) {
    if (displayedIds.length !== full.length) return;
    state.config.subscriptions = displayedItems;
  } else {
    const filteredIds = new Set(displayedIds);
    const base = full.filter((item) => !filteredIds.has(item.id));
    const allIds = full.map((item) => item.id);
    const slots = displayedIds.map((id) => allIds.indexOf(id)).sort((a, b) => a - b);
    if (slots.length !== displayedItems.length) return;
    const next = new Array(full.length);
    for (const slot of slots) next[slot] = displayedItems[slots.indexOf(slot)];
    let cursor = 0;
    for (let index = 0; index < next.length; index += 1) {
      if (next[index] === undefined) next[index] = base[cursor++];
    }
    state.config.subscriptions = next;
  }

  await saveConfig();
  state.subscriptionDragging = false;
  renderSubscriptions();
}

function bindSubscriptionDrag() {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let itemEl = null;
  let grabX = 0;
  let grabY = 0;
  let ghost = null;
  let originalOrderIds = [];
  let mode = "idle";
  let moved = false;
  let lastTarget = -1;

  els.subscriptionList.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const node = event.target.closest?.(".subscription-item");
    if (!node || !els.subscriptionList.contains(node)) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    itemEl = node;
    const rect = node.getBoundingClientRect();
    grabX = event.clientX - rect.left;
    grabY = event.clientY - rect.top;
    lastTarget = [...els.subscriptionList.children].indexOf(node);
    mode = "maybe";
    moved = false;
  });

  document.addEventListener("pointermove", (event) => {
    if (mode === "idle" || event.pointerId !== pointerId || !itemEl) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        mode = "dragging";
        moved = true;
        ghost = startSubscriptionDragVisual(itemEl);
      } else if (Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        mode = "ignore";
        return;
      } else {
        return;
      }
    }
    if (mode !== "dragging") return;
    event.preventDefault();
    const target = targetIndexFromPointer(els.subscriptionList, itemEl, event.clientY, "vertical");
    if (target !== lastTarget) {
      lastTarget = reorderDraggedElement(els.subscriptionList, itemEl, target, event.clientX, event.clientY, grabX, grabY);
    } else {
      updateDraggedTransform(itemEl, event.clientX, event.clientY, grabX, grabY);
    }
    moveDragGhost(ghost, event.clientX, event.clientY, grabX, grabY);
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    const draggedEl = itemEl;
    const dragGhost = ghost;
    if (mode === "dragging") {
      const displayedIds = [...els.subscriptionList.children].map((child) => child.dataset.id);
      void commitSubscriptionReorder(displayedIds)
        .catch((error) => toast(error.message, "error"))
        .finally(() => cleanupSubscriptionDragVisual(draggedEl, dragGhost));
    } else {
      cleanupSubscriptionDragVisual(draggedEl, dragGhost);
    }
    pointerId = null;
    itemEl = null;
    ghost = null;
    mode = "idle";
    lastTarget = -1;
  };

  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
  els.subscriptionList.addEventListener("click", (event) => {
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }
  }, true);
}

function startTopicReorderVisual(card) {
  state.publishDragging = true;
  const ghost = createDragGhost(card, "topic-ghost");
  card.classList.add("reordering");
  card.style.opacity = "0";
  els.topicRail.classList.add("reordering");
  document.body.classList.add("topic-reordering");
  return ghost;
}

function cleanupTopicReorderVisual(card, ghost) {
  state.publishDragging = false;
  if (ghost) ghost.remove();
  if (card) {
    card.classList.remove("reordering");
    card.style.opacity = "";
  }
  els.topicRail.classList.remove("reordering");
  document.body.classList.remove("topic-reordering");
  clearDragTransforms(els.topicRail, card);
}

async function commitPublishReorder(orderedIds) {
  const byId = new Map(state.config.publishTopics.map((item) => [item.id, item]));
  const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (next.length !== state.config.publishTopics.length) return;
  const changed = next.some((item, index) => state.config.publishTopics[index]?.id !== item.id);
  if (!changed) return;
  state.config.publishTopics = next;
  await saveConfig();
  state.publishDragging = false;
  renderPublishTopics();
}

function bindTopicRailDrag() {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startIndex = 0;
  let scrollLeft = 0;
  let cardEl = null;
  let cardStartRect = null;
  let grabX = 0;
  let grabY = 0;
  let ghost = null;
  let originalOrderIds = [];
  let startOnCard = false;
  let mode = "idle";
  let moved = false;
  let lastTarget = -1;

  els.topicRail.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      els.topicRail.scrollLeft += event.deltaY;
    }
  }, { passive: false });

  els.topicRail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    scrollLeft = els.topicRail.scrollLeft;
    cardEl = event.target.closest?.(".topic-card") || null;
    startOnCard = Boolean(cardEl);
    if (cardEl) {
      cardStartRect = cardEl.getBoundingClientRect();
      grabX = event.clientX - cardStartRect.left;
      grabY = event.clientY - cardStartRect.top;
      startIndex = [...els.topicRail.children].indexOf(cardEl);
      lastTarget = startIndex;
      originalOrderIds = [...els.topicRail.children].map((child) => child.dataset.id);
    }
    mode = "maybe";
    moved = false;
  });

  document.addEventListener("pointermove", (event) => {
    if (mode === "idle" || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === "maybe") {
      const insideOriginalCard = Boolean(cardStartRect && event.clientX >= cardStartRect.left && event.clientX <= cardStartRect.right && event.clientY >= cardStartRect.top && event.clientY <= cardStartRect.bottom);
      const outsideOriginalCard = Boolean(cardStartRect && (event.clientX < cardStartRect.left - 18 || event.clientX > cardStartRect.right + 18 || event.clientY < cardStartRect.top - 18 || event.clientY > cardStartRect.bottom + 18));
      if (startOnCard && cardEl && !insideOriginalCard && outsideOriginalCard) {
        mode = "reorder";
        moved = true;
        ghost = startTopicReorderVisual(cardEl);
      } else if (Math.abs(dx) > 5 && Math.abs(dx) >= Math.abs(dy)) {
        mode = "scroll";
        moved = true;
        els.topicRail.classList.add("dragging");
      } else {
        return;
      }
    }
    if (mode === "scroll") {
      event.preventDefault();
      els.topicRail.scrollLeft = scrollLeft - dx;
      return;
    }
    if (mode === "reorder") {
      event.preventDefault();
      moveDragGhost(ghost, event.clientX, event.clientY, grabX, grabY);
      const railRect = els.topicRail.getBoundingClientRect();
      const tooFar = event.clientY < railRect.top - 48 || event.clientY > railRect.bottom + 48;
      if (tooFar) {
        if (lastTarget !== -1) {
          restoreContainerOrder(els.topicRail, originalOrderIds);
          lastTarget = -1;
        }
        return;
      }
      autoScrollTopicRail(event.clientX);
      const target = targetIndexFromPointer(els.topicRail, cardEl, event.clientX, "horizontal");
      if (target !== lastTarget) {
        lastTarget = reorderDraggedElement(els.topicRail, cardEl, target, event.clientX, event.clientY, grabX, grabY);
        updateVerticalLiftTransform(cardEl, event.clientY, grabY);
      } else {
        updateVerticalLiftTransform(cardEl, event.clientY, grabY);
      }
    }
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    const draggedEl = cardEl;
    const dragGhost = ghost;
    if (mode === "reorder") {
      const orderedIds = [...els.topicRail.children].map((child) => child.dataset.id);
      void commitPublishReorder(orderedIds)
        .catch((error) => toast(error.message, "error"))
        .finally(() => cleanupTopicReorderVisual(draggedEl, dragGhost));
    } else {
      cleanupTopicReorderVisual(draggedEl, dragGhost);
    }
    els.topicRail.classList.remove("dragging");
    pointerId = null;
    cardEl = null;
    cardStartRect = null;
    ghost = null;
    originalOrderIds = [];
    startOnCard = false;
    startIndex = 0;
    mode = "idle";
    lastTarget = -1;
  };

  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
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
