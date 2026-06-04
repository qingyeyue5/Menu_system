const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const storeFile = path.join(dataDir, "store.json");
const passwordFile = path.join(dataDir, "local-passwords.json");

function makePassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return { salt, hash };
}

function randomPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

if (!fs.existsSync(storeFile)) {
  console.log("没有找到 data\\store.json。");
  console.log("如果还没有启动过系统，请先运行 start-menu.cmd 创建数据文件。");
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
const adminPassword = process.env.ADMIN_PASSWORD || randomPassword();
const customerPassword = process.env.CUSTOMER_PASSWORD || randomPassword();

store.security = store.security || {};
store.security.adminPassword = makePassword(adminPassword);
store.security.customerPassword = makePassword(customerPassword);
store.security.trustedDevices = [];

const backupFile = path.join(dataDir, `store.before-password-reset-${Date.now()}.json`);
fs.copyFileSync(storeFile, backupFile);
fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), "utf8");
fs.writeFileSync(
  passwordFile,
  JSON.stringify({ adminPassword, customerPassword }, null, 2),
  "utf8"
);

console.log("密码已重置，菜单、菜品、价格、图片、订单都已保留。");
console.log("为了安全，已清空设备绑定，需要重新登录一次。");
console.log("");
console.log(`宝宝密码：${adminPassword}`);
console.log(`宝贝密码：${customerPassword}`);
console.log("");
console.log(`重置前备份：${backupFile}`);
