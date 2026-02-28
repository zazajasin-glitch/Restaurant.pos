const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "CHANGE_THIS_SECRET_NOW_123456789",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax" },
  })
);

// ===== أدوات =====
const fmtIQD = (n) => (Math.round(Number(n) || 0)).toLocaleString("ar-IQ") + " د.ع";
const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const clamp = (n, min = 0) => Math.max(min, Number(n) || 0);

// ===== “قاعدة بيانات” مؤقتة بالذاكرة (تشتغل فوراً) =====
const store = {
  users: [],
  categories: [],
  products: [],
  orders: [], // {id, orderNo, createdAt, paymentMethod, taxPct, discountIqd, subtotalIqd, taxIqd, totalIqd, note, items:[...] }
};

function seed() {
  if (store.users.length === 0) {
    store.users.push({
      id: 1,
      username: "admin",
      passwordHash: bcrypt.hashSync("admin123", 10),
      role: "admin",
    });
  }
  if (store.categories.length === 0) {
    store.categories.push({ id: 1, name: "سندويچ" }, { id: 2, name: "مقبلات" }, { id: 3, name: "مشروبات" });
  }
  if (store.products.length === 0) {
    store.products.push(
      { id: 1, name: "برگر لحم", priceIqd: 6000, categoryId: 1, isActive: true },
      { id: 2, name: "بطاطا", priceIqd: 2500, categoryId: 2, isActive: true },
      { id: 3, name: "بيبسي", priceIqd: 1000, categoryId: 3, isActive: true }
    );
  }
}
seed();

const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1);
const nextOrderNo = () => (store.orders.length ? Math.max(...store.orders.map((o) => o.orderNo)) + 1 : 1001);

// ===== صلاحيات =====
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.status(403).send("Forbidden");
  next();
}

// ===== صفحات =====
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return res.redirect("/pos");
});

app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const u = store.users.find((x) => x.username === username);
  if (!u) return res.render("login", { error: "بيانات الدخول غلط." });
  const ok = bcrypt.compareSync(password || "", u.passwordHash);
  if (!ok) return res.render("login", { error: "بيانات الدخول غلط." });

  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.redirect("/pos");
});

app.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

app.get("/pos", requireAuth, (req, res) => {
  res.render("pos", { user: req.session.user, fmtIQD });
});

app.get("/admin/products", requireAdmin, (req, res) => {
  const cats = store.categories.slice().sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const products = store.products
    .map((p) => ({
      ...p,
      categoryName: (store.categories.find((c) => c.id === p.categoryId) || {}).name || "—",
    }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "ar"));

  res.render("admin_products", { user: req.session.user, cats, products, fmtIQD });
});

app.get("/admin/reports", requireAdmin, (req, res) => {
  res.render("reports", { user: req.session.user, fmtIQD });
});

// ===== إدارة =====
app.post("/admin/categories", requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name && !store.categories.some((c) => c.name === name)) {
    store.categories.push({ id: nextId(store.categories), name });
  }
  res.redirect("/admin/products");
});

app.post("/admin/products", requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const priceIqd = clamp(req.body.price_iqd, 0);
  const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
  if (name) {
    store.products.push({
      id: nextId(store.products),
      name,
      priceIqd,
      categoryId,
      isActive: true,
    });
  }
  res.redirect("/admin/products");
});

app.post("/admin/products/:id/toggle", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const p = store.products.find((x) => x.id === id);
  if (p) p.isActive = !p.isActive;
  res.redirect("/admin/products");
});

// ===== API =====
app.get("/api/menu", requireAuth, (req, res) => {
  const categories = store.categories.slice().sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const products = store.products
    .filter((p) => p.isActive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      price_iqd: p.priceIqd,
      category_id: p.categoryId,
      category_name: (store.categories.find((c) => c.id === p.categoryId) || {}).name || "—",
    }));
  res.json({ categories, products });
});

app.post("/api/orders", requireAuth, (req, res) => {
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return res.status(400).json({ error: "السلة فارغة." });

  const taxPct = clamp(payload.tax_pct, 0);
  const discountIqd = clamp(payload.discount_iqd, 0);
  const paymentMethod = ["cash", "card", "credit"].includes(payload.payment_method) ? payload.payment_method : "cash";
  const note = String(payload.note || "").slice(0, 200);

  let subtotal = 0;
  const cleanItems = items.map((it) => {
    const name = String(it.name || "").trim();
    const price = clamp(it.price_iqd, 0);
    const qty = Math.max(1, Number(it.qty) || 1);
    const line = price * qty;
    subtotal += line;
    return { product_id: it.product_id ? Number(it.product_id) : null, name, price_iqd: price, qty, line_total_iqd: line };
  }).filter(x => x.name);

  const taxIqd = Math.round(subtotal * (taxPct / 100));
  const totalIqd = Math.max(0, subtotal + taxIqd - discountIqd);

  const order = {
    id: nextId(store.orders),
    orderNo: nextOrderNo(),
    createdAt: new Date().toISOString(),
    paymentMethod,
    taxPct,
    discountIqd,
    subtotalIqd: subtotal,
    taxIqd,
    totalIqd,
    note,
    items: cleanItems,
  };
  store.orders.unshift(order);

  res.json({
    order: {
      order_no: order.orderNo,
      created_at: order.createdAt,
      payment_method: order.paymentMethod,
      tax_pct: order.taxPct,
      discount_iqd: order.discountIqd,
      subtotal_iqd: order.subtotalIqd,
      tax_iqd: order.taxIqd,
      total_iqd: order.totalIqd,
      note: order.note
    },
    items: order.items
  });
});

// ===== تقارير =====
app.get("/api/reports/today", requireAdmin, (req, res) => {
  const key = todayKey();
  const todays = store.orders.filter((o) => o.createdAt.slice(0, 10) === key);

  const totalSales = todays.reduce((s, o) => s + o.totalIqd, 0);
  const count = todays.length;

  const byPayment = { cash: 0, card: 0, credit: 0 };
  for (const o of todays) byPayment[o.paymentMethod] += o.totalIqd;

  const itemMap = new Map(); // name -> {qty, total}
  for (const o of todays) {
    for (const it of o.items) {
      const prev = itemMap.get(it.name) || { qty: 0, total: 0 };
      prev.qty += it.qty;
      prev.total += it.line_total_iqd;
      itemMap.set(it.name, prev);
    }
  }
  const topItems = Array.from(itemMap.entries())
    .map(([name, v]) => ({ name, qty: v.qty, total_iqd: v.total }))
    .sort((a, b) => b.total_iqd - a.total_iqd)
    .slice(0, 10);

  res.json({ date: key, count, total_sales_iqd: totalSales, by_payment: byPayment, top_items: topItems });
});

app.get("/api/reports/range", requireAdmin, (req, res) => {
  const from = String(req.query.from || todayKey()).slice(0, 10);
  const to = String(req.query.to || todayKey()).slice(0, 10);

  const inRange = store.orders.filter((o) => {
    const k = o.createdAt.slice(0, 10);
    return k >= from && k <= to;
  });

  const totalSales = inRange.reduce((s, o) => s + o.totalIqd, 0);
  const count = inRange.length;

  res.json({ from, to, count, total_sales_iqd: totalSales });
});

// ===== تشغيل =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Running on port", PORT));
