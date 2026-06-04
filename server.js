const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const LOCAL_PASSWORD_FILE = path.join(DATA_DIR, "local-passwords.json");
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const DEVICE_SEEN_WRITE_MS = 60 * 1000;
let storeCache = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
};

const defaultCategories = [
  { id: "cat_signature", name: "主厨推荐" },
  { id: "cat_main", name: "正餐" },
  { id: "cat_soup", name: "汤品小食" },
  { id: "cat_sweet", name: "甜点" },
  { id: "cat_drink", name: "饮品" },
];

const defaultItems = [
  {
    id: "item_rose_beef",
    categoryId: "cat_signature",
    name: "玫瑰盐慢烤牛排",
    description: "低温慢烤，外层焦香，搭配黑椒汁与时蔬。",
    price: 0,
    image: "",
    active: true,
  },
  {
    id: "item_truffle_pasta",
    categoryId: "cat_main",
    name: "黑松露奶油意面",
    description: "浓郁奶香配黑松露香气，适合正式晚餐。",
    price: 0,
    image: "",
    active: true,
  },
  {
    id: "item_chicken_soup",
    categoryId: "cat_soup",
    name: "温补鸡汤",
    description: "清润热汤，适合作为晚餐开场。",
    price: 0,
    image: "",
    active: true,
  },
  {
    id: "item_strawberry_cake",
    categoryId: "cat_sweet",
    name: "草莓云朵蛋糕",
    description: "轻盈奶油、鲜草莓和松软蛋糕胚。",
    price: 0,
    image: "",
    active: true,
  },
  {
    id: "item_lychee_soda",
    categoryId: "cat_drink",
    name: "荔枝气泡饮",
    description: "清爽果香，甜度温和，适合搭配主菜。",
    price: 0,
    image: "",
    active: true,
  },
];

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function makePassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

function verifyPassword(password, record) {
  return Boolean(record && password && hashPassword(password, record.salt) === record.hash);
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function randomInitialPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

function readLocalPasswords() {
  try {
    const passwords = JSON.parse(fs.readFileSync(LOCAL_PASSWORD_FILE, "utf8"));
    if (typeof passwords.adminPassword === "string" && typeof passwords.customerPassword === "string") {
      return passwords;
    }
  } catch {
    return null;
  }
  return null;
}

function writeLocalPasswords(passwords) {
  ensureDirs();
  fs.writeFileSync(LOCAL_PASSWORD_FILE, JSON.stringify(passwords, null, 2), "utf8");
}

function storeImageDataUrl(image, itemId) {
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) return image || "";
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return "";
  const mime = match[1].toLowerCase();
  const ext =
    mime === "image/png" ? "png" :
    mime === "image/webp" ? "webp" :
    mime === "image/gif" ? "gif" :
    "jpg";
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return "";
  ensureDirs();
  const safeId = String(itemId || "item").replace(/[^a-zA-Z0-9_-]/g, "");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const fileName = `${safeId}_${hash}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), bytes);
  return `/uploads/${fileName}`;
}

function migrateStoreImages(store) {
  let changed = false;
  for (const item of store.menu.items) {
    if (typeof item.image === "string" && item.image.startsWith("data:image/")) {
      const saved = storeImageDataUrl(item.image, item.id);
      if (saved) {
        item.image = saved;
        changed = true;
      }
    }
  }
  return changed;
}

function markDeviceSeen(store, device) {
  const lastSeenAt = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
  if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > DEVICE_SEEN_WRITE_MS) {
    device.lastSeenAt = nowIso();
    writeStore(store);
  }
}

const savedCredentials = readLocalPasswords();
const initialCredentials = {
  adminPassword: process.env.ADMIN_PASSWORD || savedCredentials?.adminPassword || randomInitialPassword(),
  customerPassword: process.env.CUSTOMER_PASSWORD || savedCredentials?.customerPassword || randomInitialPassword(),
  generatedAdmin: !process.env.ADMIN_PASSWORD && !savedCredentials?.adminPassword,
  generatedCustomer: !process.env.CUSTOMER_PASSWORD && !savedCredentials?.customerPassword,
};

function printStartupCredentials(reason = "") {
  const passwords = readLocalPasswords() || initialCredentials;
  console.log("");
  console.log("当前登录密码：");
  console.log(`宝宝密码：${passwords.adminPassword}`);
  console.log(`宝贝密码：${passwords.customerPassword}`);
  if (reason) console.log(reason);
  console.log("密码明文只保存在本机 data/local-passwords.json；该文件不会上传 GitHub。");
  console.log("");
}

function defaultStore() {
  return {
    version: 2,
    restaurant: {
      name: "私宴菜单",
      subtitle: "Tonight's Private Table",
    },
    security: {
      adminPassword: makePassword(initialCredentials.adminPassword),
      customerPassword: makePassword(initialCredentials.customerPassword),
      trustedDevices: [],
    },
    menu: {
      categories: defaultCategories,
      items: defaultItems,
    },
    orders: [],
  };
}

function ensureStore() {
  ensureDirs();
  if (!fs.existsSync(STORE_FILE)) {
    storeCache = defaultStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeCache, null, 2), "utf8");
    writeLocalPasswords({
      adminPassword: initialCredentials.adminPassword,
      customerPassword: initialCredentials.customerPassword,
    });
    return { created: true, passwordsReset: false };
  }
  if (!readLocalPasswords()) {
    const store = normalizeStore(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
    migrateStoreImages(store);
    store.security.adminPassword = makePassword(initialCredentials.adminPassword);
    store.security.customerPassword = makePassword(initialCredentials.customerPassword);
    store.security.trustedDevices = [];
    writeStore(store);
    writeLocalPasswords({
      adminPassword: initialCredentials.adminPassword,
      customerPassword: initialCredentials.customerPassword,
    });
    return { created: false, passwordsReset: true };
  }
  return { created: false, passwordsReset: false };
}

function normalizeStore(store) {
  const base = defaultStore();
  store.version = 2;
  store.restaurant = { ...base.restaurant, ...(store.restaurant || {}) };
  store.security = {
    ...base.security,
    ...(store.security || {}),
    trustedDevices: Array.isArray(store.security?.trustedDevices)
      ? store.security.trustedDevices
      : [],
  };
  store.menu = {
    categories: Array.isArray(store.menu?.categories) ? store.menu.categories : base.menu.categories,
    items: Array.isArray(store.menu?.items) ? store.menu.items : base.menu.items,
  };
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  for (const item of store.menu.items) {
    item.price = sanitizePrice(item.price);
    item.active = item.active !== false;
  }
  return store;
}

function readStore() {
  if (storeCache) return storeCache;
  ensureStore();
  try {
    const store = normalizeStore(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
    storeCache = store;
    if (migrateStoreImages(store)) writeStore(store);
    return store;
  } catch {
    const backup = `${STORE_FILE}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(STORE_FILE, backup);
    } catch {
      // If the broken file cannot be copied, still restore a usable store.
    }
    const store = defaultStore();
    writeStore(store);
    return store;
  }
}

function writeStore(store) {
  storeCache = store;
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("请求内容太大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
  });
}

function getAuth(req, query) {
  return {
    role: req.headers["x-role"] || query.get("role") || "",
    deviceId: req.headers["x-device-id"] || query.get("deviceId") || "",
    token: req.headers["x-auth-token"] || query.get("token") || "",
  };
}

function requireAuth(req, query, role) {
  const store = readStore();
  const auth = getAuth(req, query);
  if (role && auth.role !== role) return null;
  const device = store.security.trustedDevices.find(
    (entry) =>
      entry.role === auth.role &&
      entry.deviceId === auth.deviceId &&
      entry.token === auth.token
  );
  return device ? { store, auth, device } : null;
}

function summarizeCounts(orders) {
  const counts = {};
  for (const order of orders) {
    if (order.status !== "completed") continue;
    for (const line of order.items) {
      counts[line.itemId] = (counts[line.itemId] || 0) + Number(line.quantity || 0);
    }
  }
  return counts;
}

function publicState(store, role, deviceId) {
  const menu = {
    categories: store.menu.categories,
    items: store.menu.items.map((item) => ({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      description: item.description,
      price: item.price,
      image: item.image,
      active: item.active !== false,
    })),
  };
  const orders =
    role === "admin"
      ? store.orders
      : store.orders.filter((order) => order.customerDeviceId === deviceId);
  return {
    restaurant: store.restaurant,
    menu,
    orders,
    counts: summarizeCounts(store.orders),
    devices:
      role === "admin"
        ? store.security.trustedDevices.map((device) => ({
            id: device.id,
            role: device.role,
            deviceName: device.deviceName,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
            current: device.deviceId === deviceId,
          }))
        : [],
    serverTime: nowIso(),
    role,
  };
}

function sanitizeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function sanitizePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function expirePendingOrders() {
  const store = readStore();
  let changed = false;
  const current = Date.now();
  for (const order of store.orders) {
    if (order.status === "pending" && new Date(order.expiresAt).getTime() <= current) {
      order.status = "expired";
      order.result = "failed";
      order.timestamps.cancelledAt = nowIso();
      order.cancelReason = "5 分钟内未接单，系统已自动取消";
      changed = true;
    }
  }
  if (changed) {
    writeStore(store);
    broadcast();
  }
}

const clients = new Set();

function broadcast() {
  for (const client of clients) {
    client.write(`event: changed\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
  }
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" };
    if (safePath.startsWith("/uploads/") || safePath.startsWith("/assets/")) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const query = url.searchParams;
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/auth") {
    const body = await parseBody(req);
    const role = body.role === "admin" ? "admin" : "customer";
    const password = String(body.password || "");
    const deviceId = sanitizeText(body.deviceId, crypto.randomUUID());
    const deviceName = sanitizeText(body.deviceName, "浏览器设备").slice(0, 120);
    const store = readStore();
    const passwordRecord = role === "admin" ? store.security.adminPassword : store.security.customerPassword;
    if (!verifyPassword(password, passwordRecord)) {
      return sendJson(res, 401, { error: "密码不正确" });
    }
    let device = store.security.trustedDevices.find((entry) => entry.role === role && entry.deviceId === deviceId);
    if (!device) {
      device = {
        id: id("dev"),
        role,
        deviceId,
        deviceName,
        token: crypto.randomBytes(24).toString("hex"),
        createdAt: nowIso(),
        lastSeenAt: nowIso(),
      };
      store.security.trustedDevices.push(device);
    } else {
      device.deviceName = deviceName || device.deviceName;
      device.lastSeenAt = nowIso();
    }
    writeStore(store);
    broadcast();
    return sendJson(res, 200, { role, deviceId, token: device.token, state: publicState(store, role, deviceId) });
  }

  if (req.method === "GET" && pathname === "/api/state") {
    const authed = requireAuth(req, query);
    if (!authed) return sendJson(res, 401, { error: "需要重新验证" });
    markDeviceSeen(authed.store, authed.device);
    return sendJson(res, 200, publicState(authed.store, authed.auth.role, authed.auth.deviceId));
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const authed = requireAuth(req, query);
    if (!authed) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("需要重新验证");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const body = await parseBody(req);
    if (body.restaurant) {
      authed.store.restaurant.name = sanitizeText(body.restaurant.name, authed.store.restaurant.name).slice(0, 40);
      authed.store.restaurant.subtitle = sanitizeText(body.restaurant.subtitle, authed.store.restaurant.subtitle).slice(0, 80);
    }
    const localPasswords = readLocalPasswords() || {
      adminPassword: initialCredentials.adminPassword,
      customerPassword: initialCredentials.customerPassword,
    };
    let passwordChanged = false;
    if (body.adminPassword) {
      localPasswords.adminPassword = String(body.adminPassword);
      authed.store.security.adminPassword = makePassword(localPasswords.adminPassword);
      passwordChanged = true;
    }
    if (body.customerPassword) {
      localPasswords.customerPassword = String(body.customerPassword);
      authed.store.security.customerPassword = makePassword(localPasswords.customerPassword);
      passwordChanged = true;
    }
    if (passwordChanged) writeLocalPasswords(localPasswords);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (req.method === "DELETE" && pathname.match(/^\/api\/devices\/[^/]+$/)) {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const deviceId = pathname.split("/").pop();
    const target = authed.store.security.trustedDevices.find((device) => device.id === deviceId);
    if (!target) return sendJson(res, 404, { error: "设备不存在" });
    if (target.deviceId === authed.auth.deviceId && target.role === authed.auth.role) {
      return sendJson(res, 400, { error: "不能移除当前正在使用的设备" });
    }
    authed.store.security.trustedDevices = authed.store.security.trustedDevices.filter((device) => device.id !== deviceId);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (req.method === "POST" && pathname === "/api/categories") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const body = await parseBody(req);
    const name = sanitizeText(body.name).slice(0, 30);
    if (!name) return sendJson(res, 400, { error: "分类名称不能为空" });
    authed.store.menu.categories.push({ id: id("cat"), name });
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch && req.method === "PATCH") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const body = await parseBody(req);
    const category = authed.store.menu.categories.find((entry) => entry.id === categoryMatch[1]);
    if (!category) return sendJson(res, 404, { error: "分类不存在" });
    category.name = sanitizeText(body.name, category.name).slice(0, 30);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (categoryMatch && req.method === "DELETE") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    authed.store.menu.categories = authed.store.menu.categories.filter((entry) => entry.id !== categoryMatch[1]);
    for (const item of authed.store.menu.items) {
      if (item.categoryId === categoryMatch[1]) item.active = false;
    }
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (req.method === "POST" && pathname === "/api/items") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const body = await parseBody(req);
    const item = {
      id: id("item"),
      categoryId: sanitizeText(body.categoryId),
      name: sanitizeText(body.name, "新菜品").slice(0, 40),
      description: sanitizeText(body.description).slice(0, 240),
      price: sanitizePrice(body.price),
      image: "",
      active: body.active !== false,
    };
    item.image = storeImageDataUrl(String(body.image || ""), item.id);
    if (!authed.store.menu.categories.some((category) => category.id === item.categoryId)) {
      item.categoryId = authed.store.menu.categories[0]?.id || "";
    }
    authed.store.menu.items.push(item);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && req.method === "PATCH") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    const body = await parseBody(req);
    const item = authed.store.menu.items.find((entry) => entry.id === itemMatch[1]);
    if (!item) return sendJson(res, 404, { error: "菜品不存在" });
    if ("categoryId" in body) item.categoryId = sanitizeText(body.categoryId, item.categoryId);
    if ("name" in body) item.name = sanitizeText(body.name, item.name).slice(0, 40);
    if ("description" in body) item.description = sanitizeText(body.description, item.description).slice(0, 240);
    if ("price" in body) item.price = sanitizePrice(body.price);
    if ("image" in body) item.image = storeImageDataUrl(String(body.image || ""), item.id);
    if ("active" in body) item.active = body.active !== false;
    if (!authed.store.menu.categories.some((category) => category.id === item.categoryId)) {
      item.categoryId = authed.store.menu.categories[0]?.id || "";
    }
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (itemMatch && req.method === "DELETE") {
    const authed = requireAuth(req, query, "admin");
    if (!authed) return sendJson(res, 401, { error: "需要管理员验证" });
    authed.store.menu.items = authed.store.menu.items.filter((entry) => entry.id !== itemMatch[1]);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "admin", authed.auth.deviceId));
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const authed = requireAuth(req, query, "customer");
    if (!authed) return sendJson(res, 401, { error: "需要顾客端验证" });
    const body = await parseBody(req);
    const itemMap = new Map(authed.store.menu.items.filter((item) => item.active !== false).map((item) => [item.id, item]));
    const lines = Array.isArray(body.items)
      ? body.items
          .map((line) => {
            const item = itemMap.get(line.itemId);
            const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
            if (!item || quantity < 1) return null;
            return {
              itemId: item.id,
              name: item.name,
              price: item.price,
              quantity,
              subtotal: Math.round(item.price * quantity * 100) / 100,
            };
          })
          .filter(Boolean)
      : [];
    if (!lines.length) return sendJson(res, 400, { error: "还没有选择菜品" });
    const serviceMode = body.serviceMode === "scheduled" ? "scheduled" : "now";
    const scheduledAt = serviceMode === "scheduled" ? sanitizeText(body.scheduledAt).slice(0, 40) : "";
    if (serviceMode === "scheduled" && !scheduledAt) {
      return sendJson(res, 400, { error: "请选择预约时间" });
    }
    const createdAt = nowIso();
    const order = {
      id: id("order"),
      orderNo: new Date().toISOString().replace(/\D/g, "").slice(2, 14),
      customerDeviceId: authed.auth.deviceId,
      customerDeviceName: authed.device.deviceName,
      items: lines,
      total: Math.round(lines.reduce((sum, line) => sum + line.subtotal, 0) * 100) / 100,
      serviceMode,
      scheduledAt,
      note: sanitizeText(body.note).slice(0, 400),
      status: "pending",
      result: "waiting",
      createdAt,
      expiresAt: new Date(Date.now() + PENDING_TIMEOUT_MS).toISOString(),
      timestamps: {
        orderedAt: createdAt,
        acceptedAt: "",
        completedAt: "",
        cancelledAt: "",
      },
    };
    authed.store.orders.unshift(order);
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, "customer", authed.auth.deviceId));
  }

  const orderAction = pathname.match(/^\/api\/orders\/([^/]+)\/(accept|complete|cancel)$/);
  if (orderAction && req.method === "POST") {
    const action = orderAction[2];
    const role = action === "cancel" ? undefined : "admin";
    const authed = requireAuth(req, query, role);
    if (!authed) return sendJson(res, 401, { error: "需要重新验证" });
    const order = authed.store.orders.find((entry) => entry.id === orderAction[1]);
    if (!order) return sendJson(res, 404, { error: "订单不存在" });
    if (action === "accept") {
      if (order.status !== "pending") return sendJson(res, 400, { error: "订单当前不能接收" });
      if (new Date(order.expiresAt).getTime() <= Date.now()) {
        order.status = "expired";
        order.result = "failed";
        order.timestamps.cancelledAt = nowIso();
        order.cancelReason = "5 分钟内未接单，系统已自动取消";
      } else {
        order.status = "accepted";
        order.result = "in_progress";
        order.timestamps.acceptedAt = nowIso();
      }
    }
    if (action === "complete") {
      if (order.status !== "accepted") return sendJson(res, 400, { error: "订单当前不能完成" });
      order.status = "completed";
      order.result = "success";
      order.timestamps.completedAt = nowIso();
    }
    if (action === "cancel") {
      const canCancel =
        authed.auth.role === "admin" ||
        (authed.auth.role === "customer" && order.customerDeviceId === authed.auth.deviceId && order.status === "pending");
      if (!canCancel) return sendJson(res, 403, { error: "订单当前不能取消" });
      order.status = "cancelled";
      order.result = "failed";
      order.timestamps.cancelledAt = nowIso();
      order.cancelReason = sanitizeText((await parseBody(req)).reason, "手动取消").slice(0, 120);
    }
    writeStore(authed.store);
    broadcast();
    return sendJson(res, 200, publicState(authed.store, authed.auth.role, authed.auth.deviceId));
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    expirePendingOrders();
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务端错误" });
  }
});

const storeStatus = ensureStore();
printStartupCredentials(
  storeStatus.passwordsReset
    ? "提示：旧数据没有可展示的明文密码记录，已自动重置两边密码并清空设备绑定。"
    : ""
);
setInterval(expirePendingOrders, 10 * 1000);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`点菜系统已启动：http://localhost:${PORT}`);
});
