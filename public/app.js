const STORAGE_KEY = "private-dining-auth-v2";
const DEVICE_KEY = "private-dining-device-v2";

const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const loadingEl = document.querySelector("#loading");
const MAX_IMAGE_EDGE = 900;
const IMAGE_QUALITY = 0.78;

function makeClientId() {
  const cryptoApi = window.crypto || window.msCrypto;
  if (cryptoApi && cryptoApi.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && cryptoApi.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const ui = {
  auth: JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"),
  deviceId: localStorage.getItem(DEVICE_KEY) || makeClientId(),
  state: null,
  loginRole: "customer",
  adminTab: "orders",
  customerTab: "menu",
  selectedCategory: "",
  cart: {},
  checkout: false,
  serviceMode: "now",
  scheduledAt: "",
  note: "",
  eventSource: null,
  lastPendingIds: new Set(),
  loadingCount: 0,
  collapsedAdminCategories: JSON.parse(localStorage.getItem("private-dining-collapsed-admin-cats-v1") || "{}"),
};

localStorage.setItem(DEVICE_KEY, ui.deviceId);

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function fmt(value) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fullFmt(value) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusText(status) {
  return {
    pending: "等待确认",
    accepted: "制作/配送中",
    completed: "订单已送达",
    expired: "未成功",
    cancelled: "已取消",
  }[status] || status;
}

function roleText(role) {
  return role === "admin" ? "宝宝" : "宝贝";
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2400);
}

function showLoading(message = "加载中") {
  ui.loadingCount += 1;
  if (!loadingEl) return;
  loadingEl.querySelector(".loading-text").textContent = message;
  loadingEl.hidden = false;
}

function hideLoading() {
  ui.loadingCount = Math.max(0, ui.loadingCount - 1);
  if (loadingEl && ui.loadingCount === 0) loadingEl.hidden = true;
}

function saveAuth(auth) {
  ui.auth = auth;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function logout() {
  ui.auth = null;
  ui.state = null;
  localStorage.removeItem(STORAGE_KEY);
  if (ui.eventSource) ui.eventSource.close();
  ui.eventSource = null;
  render();
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const silentLoading = options.silentLoading === true;
  const loadingMessage = options.loadingMessage || "加载中";
  if (!silentLoading) showLoading(loadingMessage);
  if (ui.auth) {
    headers["X-Role"] = ui.auth.role;
    headers["X-Device-Id"] = ui.auth.deviceId;
    headers["X-Auth-Token"] = ui.auth.token;
  }
  try {
    const fetchOptions = { ...options, headers };
    delete fetchOptions.silentLoading;
    delete fetchOptions.loadingMessage;
    const response = await fetch(path, fetchOptions);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  } finally {
    if (!silentLoading) hideLoading();
  }
}

async function loadState(silent = false) {
  if (!ui.auth) return;
  try {
    ui.state = await api("/api/state", {
      silentLoading: silent,
      loadingMessage: "加载菜单中",
    });
    ensureSelectedCategory();
    detectNewOrders();
    render();
  } catch (error) {
    if (!silent) toast(error.message);
    logout();
  }
}

function connectEvents() {
  if (!ui.auth || ui.eventSource) return;
  const params = new URLSearchParams({
    role: ui.auth.role,
    deviceId: ui.auth.deviceId,
    token: ui.auth.token,
  });
  ui.eventSource = new EventSource(`/api/events?${params}`);
  ui.eventSource.addEventListener("changed", () => loadState(true));
  ui.eventSource.onerror = () => {
    ui.eventSource.close();
    ui.eventSource = null;
    setTimeout(connectEvents, 1800);
  };
}

function detectNewOrders() {
  if (!ui.state || !ui.auth || ui.auth.role !== "admin") return;
  const pending = ui.state.orders.filter((order) => order.status === "pending").map((order) => order.id);
  const next = new Set(pending);
  const hasNew = pending.some((id) => !ui.lastPendingIds.has(id));
  if (hasNew && ui.lastPendingIds.size) toast("收到新的订单");
  ui.lastPendingIds = next;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth", {
      method: "POST",
      loadingMessage: "正在进入",
      body: JSON.stringify({
        role: ui.loginRole,
        password: form.get("password"),
        deviceId: ui.deviceId,
        deviceName: navigator.userAgent.slice(0, 110),
      }),
    });
    saveAuth({ role: data.role, deviceId: data.deviceId, token: data.token });
    ui.state = data.state;
    ensureSelectedCategory();
    connectEvents();
    render();
  } catch (error) {
    toast(error.message);
  }
}

function shell(content) {
  const state = ui.state;
  return `
    <main class="shell">
      <div class="app-frame">
        <header class="header">
          <div>
            <div class="brand-kicker">${escapeHtml(state.restaurant.subtitle)}</div>
            <h1>${escapeHtml(state.restaurant.name)}</h1>
            <p>${ui.auth.role === "admin" ? "宝宝工作台" : "宝贝点餐台"}</p>
          </div>
          <div class="header-actions">
            <span class="badge">${roleText(ui.auth.role)}</span>
            <button class="ghost" onclick="logout()">退出</button>
          </div>
        </header>
        ${content}
      </div>
    </main>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <section class="login-panel">
        <div class="brand-kicker">Private Table</div>
        <h1 class="title">私宴菜单</h1>
        <p class="subtitle">每台手机或浏览器首次输入密码后会完成安全绑定，之后同一设备不用重复确认。</p>
        <div class="segmented">
          <button class="${ui.loginRole === "customer" ? "active" : ""}" onclick="setLoginRole('customer')">宝贝</button>
          <button class="${ui.loginRole === "admin" ? "active" : ""}" onclick="setLoginRole('admin')">宝宝</button>
        </div>
        <form onsubmit="login(event)">
          <label class="field">
            <span>密码</span>
            <input class="input" name="password" type="password" autocomplete="current-password" required autofocus />
          </label>
          <button class="primary login-submit">进入菜单</button>
        </form>
      </section>
    </main>
  `;
}

function setLoginRole(role) {
  ui.loginRole = role;
  renderLogin();
}

function renderAdmin() {
  const tabs = `
    <nav class="tabbar">
      <button class="${ui.adminTab === "orders" ? "active" : ""}" onclick="setAdminTab('orders')">使用</button>
      <button class="${ui.adminTab === "menu" ? "active" : ""}" onclick="setAdminTab('menu')">设置</button>
      <button class="${ui.adminTab === "security" ? "active" : ""}" onclick="setAdminTab('security')">安全</button>
    </nav>
  `;
  const content =
    ui.adminTab === "orders"
      ? renderAdminOrders()
      : ui.adminTab === "menu"
        ? renderMenuAdmin()
        : renderSecurity();
  app.innerHTML = shell(tabs + content);
}

function setAdminTab(tab) {
  ui.adminTab = tab;
  render();
}

function renderAdminOrders() {
  const pending = ui.state.orders.filter((order) => order.status === "pending");
  const active = ui.state.orders.filter((order) => order.status === "accepted");
  const history = ui.state.orders.filter((order) => !["pending", "accepted"].includes(order.status));
  return `
    <div class="grid two">
      <section>
        <div class="section-title"><h2>待确认</h2><span class="badge">${pending.length} 单</span></div>
        <div class="grid">${pending.map((order) => orderCard(order, "admin")).join("") || empty("暂无待确认订单")}</div>
        <div class="section-title spaced"><h2>制作/配送中</h2><span class="badge">${active.length} 单</span></div>
        <div class="grid">${active.map((order) => orderCard(order, "admin")).join("") || empty("暂无进行中订单")}</div>
      </section>
      <section>
        <div class="section-title"><h2>历史订单</h2><span class="badge">${history.length} 单</span></div>
        <div class="grid">${history.map((order) => orderCard(order, "admin")).join("") || empty("还没有历史订单")}</div>
      </section>
    </div>
  `;
}

function renderMenuAdmin() {
  const categories = ui.state.menu.categories;
  const items = ui.state.menu.items;
  const uncategorized = items.filter((item) => !categories.some((category) => category.id === item.categoryId));
  return `
    <div class="grid">
      <section class="panel">
        <h2>餐厅信息</h2>
        <form class="form-grid" onsubmit="saveRestaurant(event)">
          <label class="field"><span>菜单名称</span><input class="input" name="name" value="${attr(ui.state.restaurant.name)}" /></label>
          <label class="field"><span>副标题</span><input class="input" name="subtitle" value="${attr(ui.state.restaurant.subtitle)}" /></label>
          <div class="wide row-actions"><button class="primary">保存</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-title"><h2>菜品分类</h2></div>
        <div class="category-admin">
          ${categories
            .map(
              (category) => `
                <span class="chip">${escapeHtml(category.name)}
                  <button title="重命名" onclick="renameCategory('${category.id}')">改</button>
                  <button title="删除" onclick="deleteCategory('${category.id}')">×</button>
                </span>`
            )
            .join("")}
        </div>
        <form class="form-grid" onsubmit="addCategory(event)">
          <label class="field"><span>新增分类</span><input class="input" name="name" placeholder="例如：汤品、夜宵、饮品" required /></label>
          <div class="field"><span>&nbsp;</span><button class="secondary">添加分类</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-title"><h2>新增菜品</h2></div>
        ${itemForm("new", {}, categories)}
      </section>
      <section>
        <div class="section-title"><h2>菜品管理</h2><span class="badge">${items.length} 道</span></div>
        <div class="admin-category-list">
          ${categories.map((category) => adminCategoryBlock(category, items.filter((item) => item.categoryId === category.id), categories)).join("")}
          ${uncategorized.length ? adminCategoryBlock({ id: "uncategorized", name: "未分类" }, uncategorized, categories) : ""}
          ${items.length ? "" : empty("还没有菜品")}
        </div>
      </section>
    </div>
  `;
}

function adminCategoryBlock(category, items, categories) {
  const collapsed = ui.collapsedAdminCategories[category.id] === true;
  return `
    <section class="admin-category">
      <button class="admin-category-head" type="button" onclick="toggleAdminCategory('${category.id}')">
        <span>${collapsed ? "展开" : "收起"}</span>
        <strong>${escapeHtml(category.name)}</strong>
        <em>${items.length} 道</em>
      </button>
      <div class="admin-category-body" ${collapsed ? "hidden" : ""}>
        ${items.map((item) => `<div class="admin-card">${itemForm(item.id, item, categories)}</div>`).join("") || empty("这个分类还没有菜品")}
      </div>
    </section>
  `;
}

function toggleAdminCategory(id) {
  ui.collapsedAdminCategories[id] = ui.collapsedAdminCategories[id] !== true;
  localStorage.setItem("private-dining-collapsed-admin-cats-v1", JSON.stringify(ui.collapsedAdminCategories));
  render();
}

function itemForm(idValue, item, categories) {
  const isNew = idValue === "new";
  const imagePreview = item.image
    ? `<img class="thumb" src="${item.image}" alt="${attr(item.name || "菜品图片")}" loading="lazy" decoding="async" />`
    : "";
  return `
    <form class="form-grid" onsubmit="${isNew ? "addItem(event)" : `saveItem(event, '${idValue}')`}">
      <label class="field">
        <span>名称</span>
        <input class="input" name="name" value="${attr(item.name || "")}" required />
      </label>
      <label class="field">
        <span>分类</span>
        <select class="select" name="categoryId">
          ${categories.map((category) => `<option value="${category.id}" ${category.id === item.categoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>价格</span>
        <input class="input" name="price" type="number" min="0" step="0.01" value="${attr(item.price != null ? item.price : 0)}" />
      </label>
      <label class="field">
        <span>图片</span>
        <input class="input file-input" name="imageFile" type="file" accept="image/*" />
      </label>
      <label class="field wide">
        <span>介绍</span>
        <textarea class="textarea" name="description">${escapeHtml(item.description || "")}</textarea>
      </label>
      <input type="hidden" name="currentImage" value="${attr(item.image || "")}" />
      ${imagePreview ? `<div class="wide">${imagePreview}</div>` : ""}
      <label class="field">
        <span>显示状态</span>
        <select class="select" name="active">
          <option value="true" ${item.active !== false ? "selected" : ""}>显示</option>
          <option value="false" ${item.active === false ? "selected" : ""}>隐藏</option>
        </select>
      </label>
      <div class="field">
        <span>&nbsp;</span>
        <div class="row-actions">
          <button class="primary">${isNew ? "添加" : "保存"}</button>
          ${isNew ? "" : `<button type="button" class="danger" onclick="deleteItem('${idValue}')">删除</button>`}
        </div>
      </div>
    </form>
  `;
}

function renderSecurity() {
  const devices = ui.state.devices || [];
  return `
    <div class="grid two">
      <section class="panel">
        <h2>修改密码</h2>
        <form onsubmit="savePasswords(event)">
          <label class="field"><span>新的宝宝密码</span><input class="input" name="adminPassword" type="password" autocomplete="new-password" /></label>
          <label class="field"><span>新的宝贝密码</span><input class="input" name="customerPassword" type="password" autocomplete="new-password" /></label>
          <button class="primary form-submit">保存密码</button>
        </form>
      </section>
      <section class="panel">
        <h2>已绑定设备</h2>
        <p class="subtitle">通过密码的设备会保存在这里；移除后，对方需要重新输入对应端的密码。</p>
        <div class="device-list">
          ${devices
            .map(
              (device) => `
                <div class="device-row">
                  <div>
                    <strong>${roleText(device.role)}${device.current ? " · 当前设备" : ""}</strong>
                    <div class="small">${escapeHtml(device.deviceName || "未知浏览器")}</div>
                    <div class="small">绑定：${fullFmt(device.createdAt)}；最近使用：${fullFmt(device.lastSeenAt)}</div>
                  </div>
                  <button class="danger" ${device.current ? "disabled" : ""} onclick="removeDevice('${device.id}')">移除</button>
                </div>`
            )
            .join("") || empty("暂无绑定设备")}
        </div>
      </section>
    </div>
  `;
}

function renderCustomer() {
  if (ui.checkout) {
    app.innerHTML = shell(renderCheckout());
    return;
  }
  const tabs = `
    <nav class="tabbar">
      <button class="${ui.customerTab === "menu" ? "active" : ""}" onclick="setCustomerTab('menu')">点菜</button>
      <button class="${ui.customerTab === "orders" ? "active" : ""}" onclick="setCustomerTab('orders')">我的订单</button>
    </nav>
  `;
  const content = ui.customerTab === "menu" ? renderMenu() : renderCustomerOrders();
  app.innerHTML = shell(tabs + content + renderCartBar());
}

function setCustomerTab(tab) {
  ui.customerTab = tab;
  render();
}

function renderMenu() {
  const categories = ui.state.menu.categories;
  const items = ui.state.menu.items.filter((item) => item.active);
  const selected = ui.selectedCategory || (categories[0] ? categories[0].id : "");
  const selectedItems = items.filter((item) => item.categoryId === selected);
  return `
    <div class="menu-layout">
      <aside class="category-rail">
        ${categories.map((category) => `<button class="category-btn ${selected === category.id ? "active" : ""}" onclick="selectCategory('${category.id}')">${escapeHtml(category.name)}</button>`).join("")}
      </aside>
      <section class="dish-list">
        ${selectedItems.map(dishCard).join("") || empty("这个分类还没有可点菜品")}
      </section>
    </div>
  `;
}

function dishCard(item) {
  const confirmedCount = ui.state.counts[item.id] || 0;
  const qty = ui.cart[item.id] || 0;
  return `
    <article class="dish-card">
      <div class="dish-image">${item.image ? `<img src="${item.image}" alt="${attr(item.name)}" loading="lazy" decoding="async" />` : ""}</div>
      <div class="dish-body">
        <div class="dish-name">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="price">${money(item.price)}</span>
        </div>
        <p class="dish-desc">${escapeHtml(item.description || "主理人还没有写介绍。")}</p>
        <div class="qty">
          <span class="small">已成功点过 ${confirmedCount} 份</span>
          <div class="stepper">
            <button onclick="changeQty('${item.id}', -1)" aria-label="减少">−</button>
            <span>${qty}</span>
            <button onclick="changeQty('${item.id}', 1)" aria-label="增加">+</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCartBar() {
  const lines = cartLines();
  if (!lines.length || ui.customerTab !== "menu") return "";
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.item.price, 0);
  return `
    <div class="cart-bar">
      <div>
        <strong>已选 ${count} 份</strong>
        <div class="small">合计 ${money(total)}</div>
      </div>
      <button class="primary" onclick="openCheckout()">去下单</button>
    </div>
  `;
}

function renderCheckout() {
  const lines = cartLines();
  const total = lines.reduce((sum, line) => sum + line.quantity * line.item.price, 0);
  return `
    <section class="checkout panel">
      <div class="section-title">
        <h2>确认订单</h2>
        <button class="ghost" onclick="closeCheckout()">返回选菜</button>
      </div>
      <div class="checkout-list">
        ${lines
          .map(
            (line) => `
              <div class="line">
                <div>
                  <strong>${escapeHtml(line.item.name)}</strong>
                  <div class="small">${money(line.item.price)} × ${line.quantity}</div>
                </div>
                <strong>${money(line.item.price * line.quantity)}</strong>
              </div>`
          )
          .join("")}
      </div>
      <div class="segmented">
        <button class="${ui.serviceMode === "now" ? "active" : ""}" onclick="setServiceMode('now')">立刻下单</button>
        <button class="${ui.serviceMode === "scheduled" ? "active" : ""}" onclick="setServiceMode('scheduled')">预约下单</button>
      </div>
      ${
        ui.serviceMode === "scheduled"
          ? `<label class="field"><span>预约时间</span><input class="input" type="datetime-local" value="${attr(ui.scheduledAt)}" onchange="ui.scheduledAt=this.value" /></label>`
          : ""
      }
      <label class="field">
        <span>备注</span>
        <textarea class="textarea" onchange="ui.note=this.value" placeholder="口味、时间、想说的话">${escapeHtml(ui.note)}</textarea>
      </label>
      <div class="section-title checkout-total">
        <h2>合计 ${money(total)}</h2>
        <div class="order-actions">
          <button class="ghost" onclick="closeCheckout()">取消</button>
          <button class="primary" onclick="submitOrder()">确认下单</button>
        </div>
      </div>
    </section>
  `;
}

function renderCustomerOrders() {
  const active = ui.state.orders.filter((order) => ["pending", "accepted"].includes(order.status));
  const history = ui.state.orders.filter((order) => !["pending", "accepted"].includes(order.status));
  return `
    <section>
      <div class="section-title"><h2>当前订单</h2><span class="badge">${active.length} 单</span></div>
      <div class="grid">${active.map((order) => orderCard(order, "customer")).join("") || empty("暂无当前订单")}</div>
      <div class="section-title spaced"><h2>历史订单</h2><span class="badge">${history.length} 单</span></div>
      <div class="grid">${history.map((order) => orderCard(order, "customer")).join("") || empty("还没有历史订单")}</div>
    </section>
  `;
}

function orderCard(order, role) {
  const note = order.note ? `<div class="small">备注：${escapeHtml(order.note)}</div>` : "";
  const schedule = order.serviceMode === "scheduled" ? `<div class="small">预约：${escapeHtml(order.scheduledAt || "未填写")}</div>` : "";
  const reason = order.cancelReason ? `<div class="small">原因：${escapeHtml(order.cancelReason)}</div>` : "";
  const actions = role === "admin" ? adminOrderActions(order) : customerOrderActions(order);
  const countdown =
    order.status === "pending"
      ? `<div class="small">接单倒计时：<span data-countdown="${attr(order.expiresAt)}">${pendingLeft(order.expiresAt)}</span></div>`
      : "";
  return `
    <article class="order-card">
      <div class="order-head">
        <div>
          <strong>订单 ${escapeHtml(order.orderNo)}</strong>
          <div class="small">${order.serviceMode === "scheduled" ? "预约" : "立刻"} · ${fullFmt(order.createdAt)}</div>
        </div>
        <span class="status ${order.status}">${statusText(order.status)}</span>
      </div>
      <div class="order-lines">
        ${order.items
          .map(
            (line) => `
              <div class="line">
                <span>${escapeHtml(line.name)} <span class="small">× ${line.quantity}</span></span>
                <strong>${money(line.subtotal)}</strong>
              </div>`
          )
          .join("")}
      </div>
      ${schedule}
      ${note}
      ${reason}
      ${countdown}
      <div class="order-meta">
        <span class="small">下单：${fmt(order.timestamps.orderedAt)}</span>
        <span class="small">确认：${fmt(order.timestamps.acceptedAt)}</span>
        <span class="small">完成：${fmt(order.timestamps.completedAt)}</span>
      </div>
      <div class="section-title order-footer">
        <strong>合计 ${money(order.total)}</strong>
        <div class="order-actions">${actions}</div>
      </div>
    </article>
  `;
}

function pendingLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "即将自动取消";
  const minute = Math.floor(ms / 60000);
  const second = Math.floor((ms % 60000) / 1000);
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function updateCountdowns() {
  document.querySelectorAll("[data-countdown]").forEach((node) => {
    node.textContent = pendingLeft(node.dataset.countdown);
  });
}

function adminOrderActions(order) {
  if (order.status === "pending") {
    return `<button class="primary" onclick="orderAction('${order.id}','accept')">接收</button><button class="danger" onclick="orderAction('${order.id}','cancel')">取消</button>`;
  }
  if (order.status === "accepted") {
    return `<button class="primary" onclick="orderAction('${order.id}','complete')">完成订单</button>`;
  }
  return "";
}

function customerOrderActions(order) {
  const repeat = `<button class="secondary" onclick="repeatOrder('${order.id}')">再来一次</button>`;
  if (order.status === "pending") {
    return `<button class="ghost" onclick="orderAction('${order.id}','cancel')">取消订单</button>${repeat}`;
  }
  return repeat;
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function ensureSelectedCategory() {
  const categories = ui.state && ui.state.menu ? ui.state.menu.categories : [];
  if (!categories.some((category) => category.id === ui.selectedCategory)) {
    ui.selectedCategory = categories[0] ? categories[0].id : "";
  }
}

function selectCategory(id) {
  ui.selectedCategory = id;
  render();
}

function changeQty(itemId, delta) {
  const next = Math.max(0, (ui.cart[itemId] || 0) + delta);
  if (next) ui.cart[itemId] = next;
  else delete ui.cart[itemId];
  render();
}

function cartLines() {
  const items = new Map(ui.state.menu.items.map((item) => [item.id, item]));
  return Object.entries(ui.cart)
    .map(([itemId, quantity]) => ({ item: items.get(itemId), quantity }))
    .filter((line) => line.item && line.item.active && line.quantity > 0);
}

function openCheckout() {
  if (!cartLines().length) return toast("还没有选择菜品");
  ui.checkout = true;
  render();
}

function closeCheckout() {
  ui.checkout = false;
  render();
}

function setServiceMode(mode) {
  ui.serviceMode = mode;
  render();
}

async function submitOrder() {
  try {
    const data = await api("/api/orders", {
      method: "POST",
      loadingMessage: "正在下单",
      body: JSON.stringify({
        items: cartLines().map((line) => ({ itemId: line.item.id, quantity: line.quantity })),
        serviceMode: ui.serviceMode,
        scheduledAt: ui.scheduledAt,
        note: ui.note,
      }),
    });
    ui.state = data;
    ui.cart = {};
    ui.checkout = false;
    ui.customerTab = "orders";
    ui.note = "";
    ui.serviceMode = "now";
    toast("已下单，等待确认");
    render();
  } catch (error) {
    toast(error.message);
  }
}

function repeatOrder(orderId) {
  const order = ui.state.orders.find((entry) => entry.id === orderId);
  if (!order) return;
  ui.cart = {};
  for (const line of order.items) ui.cart[line.itemId] = line.quantity;
  ui.customerTab = "menu";
  ui.checkout = false;
  toast("已放回菜单");
  render();
}

async function orderAction(orderId, action) {
  try {
    const body = action === "cancel" ? JSON.stringify({ reason: "手动取消" }) : undefined;
    ui.state = await api(`/api/orders/${orderId}/${action}`, {
      method: "POST",
      body,
      loadingMessage: action === "accept" ? "正在接收" : action === "complete" ? "正在完成" : "正在取消",
    });
    toast(action === "accept" ? "已接收订单" : action === "complete" ? "订单已完成" : "已取消订单");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function saveRestaurant(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await mutate("/api/settings", {
    restaurant: { name: form.get("name"), subtitle: form.get("subtitle") },
  });
}

async function savePasswords(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {};
  if (form.get("adminPassword")) payload.adminPassword = form.get("adminPassword");
  if (form.get("customerPassword")) payload.customerPassword = form.get("customerPassword");
  if (!payload.adminPassword && !payload.customerPassword) return toast("请输入新密码");
  await mutate("/api/settings", payload, "密码已保存");
  event.currentTarget.reset();
}

async function removeDevice(id) {
  if (!confirm("移除后，该设备下次进入需要重新输入密码。确定移除吗？")) return;
  await mutate(`/api/devices/${id}`, {}, "设备已移除", "DELETE");
}

async function addCategory(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await mutate("/api/categories", { name: form.get("name") }, "分类已添加");
  event.currentTarget.reset();
}

async function renameCategory(id) {
  const category = ui.state.menu.categories.find((entry) => entry.id === id);
  const name = prompt("新的分类名称", category ? category.name : "");
  if (!name) return;
  await mutate(`/api/categories/${id}`, { name }, "分类已重命名", "PATCH");
}

async function deleteCategory(id) {
  if (!confirm("删除分类后，该分类下菜品会被隐藏。确定删除吗？")) return;
  await mutate(`/api/categories/${id}`, {}, "分类已删除", "DELETE");
}

async function addItem(event) {
  event.preventDefault();
  const payload = await formToItem(event.currentTarget);
  await mutate("/api/items", payload, "菜品已添加");
  event.currentTarget.reset();
}

async function saveItem(event, id) {
  event.preventDefault();
  const payload = await formToItem(event.currentTarget);
  await mutate(`/api/items/${id}`, payload, "菜品已保存", "PATCH");
}

async function deleteItem(id) {
  if (!confirm("确定删除这道菜吗？")) return;
  await mutate(`/api/items/${id}`, {}, "菜品已删除", "DELETE");
}

async function formToItem(form) {
  const data = new FormData(form);
  const file = data.get("imageFile");
  const image = file && file.size ? await fileToDataUrl(file) : data.get("currentImage");
  return {
    name: data.get("name"),
    categoryId: data.get("categoryId"),
    price: data.get("price"),
    description: data.get("description"),
    image,
    active: data.get("active") === "true",
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.fillStyle = "#11120f";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
        } catch {
          resolve(reader.result);
        }
      };
      image.onerror = () => resolve(reader.result);
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function mutate(path, payload, message = "已保存", method = "POST") {
  try {
    ui.state = await api(path, {
      method,
      body: JSON.stringify(payload),
      loadingMessage: "正在保存",
    });
    ensureSelectedCategory();
    toast(message);
    render();
  } catch (error) {
    toast(error.message);
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(value) {
  return escapeHtml(value);
}

function render() {
  if (!ui.auth || !ui.state) return renderLogin();
  connectEvents();
  if (ui.auth.role === "admin") renderAdmin();
  else renderCustomer();
}

setInterval(() => {
  if (ui.state && ui.state.orders && ui.state.orders.some((order) => order.status === "pending")) updateCountdowns();
}, 1000);

window.login = login;
window.logout = logout;
window.setLoginRole = setLoginRole;
window.setAdminTab = setAdminTab;
window.setCustomerTab = setCustomerTab;
window.selectCategory = selectCategory;
window.changeQty = changeQty;
window.openCheckout = openCheckout;
window.closeCheckout = closeCheckout;
window.setServiceMode = setServiceMode;
window.submitOrder = submitOrder;
window.repeatOrder = repeatOrder;
window.orderAction = orderAction;
window.saveRestaurant = saveRestaurant;
window.savePasswords = savePasswords;
window.removeDevice = removeDevice;
window.addCategory = addCategory;
window.renameCategory = renameCategory;
window.deleteCategory = deleteCategory;
window.toggleAdminCategory = toggleAdminCategory;
window.addItem = addItem;
window.saveItem = saveItem;
window.deleteItem = deleteItem;
window.ui = ui;

if (ui.auth) {
  loadState(false).then(connectEvents);
} else {
  renderLogin();
}
