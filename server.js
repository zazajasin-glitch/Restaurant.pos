const express = require("express");
const path = require("path");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== DB =====
const db = new Database("pos.db");

// جداول
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','cashier','captain')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  price_iqd INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','void')),
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  paid_by_user_id INTEGER,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(paid_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price_iqd INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

// Seed Users (إذا ماكو مستخدمين)
const usersCount = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
if (usersCount === 0) {
  const ins = db.prepare(`INSERT INTO users (username,password_hash,role) VALUES (?,?,?)`);
  ins.run("admin", bcrypt.hashSync("admin123", 10), "admin");
  ins.run("cashier", bcrypt.hashSync("cashier123", 10), "cashier");
  // كابتن افتراضي للتجربة (تگدر تلغيه بعدين)
  ins.run("captain1", bcrypt.hashSync("1234", 10), "captain");
}

// ===== App Setup =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "pos-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: "sessions.db", dir: "." }),
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));

// ===== Helpers =====
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (!roles.includes(req.session.user.role)) return res.status(403).send("Forbidden");
    next();
  };
}

// ===== Pages =====
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const r = req.session.user.role;
  if (r === "admin") return res.redirect("/admin/users");
  if (r === "cashier") return res.redirect("/cashier");
  return res.redirect("/pos");
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE username=?`).get(username);
  if (!user) return res.status(401).render("login", { error: "بيانات الدخول غلط" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).render("login", { error: "بيانات الدخول غلط" });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Admin pages
app.get("/admin/users", requireRole("admin"), (req, res) => {
  const users = db.prepare(`SELECT id, username, role, created_at FROM users ORDER BY id DESC`).all();
  res.render("admin_users", { user: req.session.user, users });
});

app.get("/admin/products", requireRole("admin"), (req, res) => {
  const products = db.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
  res.render("admin_products", { user: req.session.user, products });
});

// Captain POS page
app.get("/pos", requireRole("admin", "captain"), (req, res) => {
  res.render("pos", { user: req.session.user });
});

// Cashier page
app.get("/cashier", requireRole("admin", "cashier"), (req, res) => {
  res.render("cashier", { user: req.session.user });
});

// Reports page
app.get("/reports", requireRole("admin"), (req, res) => {
  res.render("reports", { user: req.session.user });
});

// ===== API =====

// Users (Admin)
app.post("/api/admin/users", requireRole("admin"), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ ok: false, msg: "ناقص بيانات" });
  if (!["admin", "cashier", "captain"].includes(role)) return res.status(400).json({ ok: false, msg: "role غلط" });

  try {
    db.prepare(`INSERT INTO users (username,password_hash,role) VALUES (?,?,?)`)
      .run(username.trim(), bcrypt.hashSync(password, 10), role);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, msg: "اسم المستخدم موجود" });
  }
});

app.post("/api/admin/users/:id/delete", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ ok: false, msg: "ما تگدر تمسح نفسك" });
  db.prepare(`DELETE FROM users WHERE id=?`).run(id);
  res.json({ ok: true });
});

// Products
app.get("/api/products", requireAuth, (req, res) => {
  const products = db.prepare(`SELECT id,name,category,price_iqd,active FROM products WHERE active=1 ORDER BY id DESC`).all();
  res.json({ ok: true, products });
});

app.post("/api/admin/products", requireRole("admin"), (req, res) => {
  const { name, category, price_iqd } = req.body;
  if (!name) return res.status(400).json({ ok: false, msg: "الاسم مطلوب" });
  const p = parseInt(price_iqd, 10);
  if (Number.isNaN(p) || p < 0) return res.status(400).json({ ok: false, msg: "السعر غلط" });

  db.prepare(`INSERT INTO products (name,category,price_iqd,active) VALUES (?,?,?,1)`)
    .run(name.trim(), (category || "").trim(), p);
  res.json({ ok: true });
});

app.post("/api/admin/products/:id/toggle", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE products SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?`).run(id);
  res.json({ ok: true });
});

// Orders (Captain creates, Cashier pays)
app.post("/api/orders", requireRole("admin", "captain"), (req, res) => {
  const { table_no, items } = req.body;
  if (!table_no || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, msg: "ناقص بيانات الأوردر" });

  const tx = db.transaction(() => {
    const order = db.prepare(`INSERT INTO orders (table_no, created_by_user_id, status) VALUES (?,?, 'open')`)
      .run(String(table_no).trim(), req.session.user.id);
    const orderId = order.lastInsertRowid;

    const getProd = db.prepare(`SELECT id, price_iqd FROM products WHERE id=? AND active=1`);
    const insItem = db.prepare(`INSERT INTO order_items (order_id, product_id, qty, price_iqd) VALUES (?,?,?,?)`);

    for (const it of items) {
      const pid = Number(it.product_id);
      const qty = Math.max(1, Number(it.qty || 1));
      const prod = getProd.get(pid);
      if (!prod) throw new Error("منتج غير موجود");
      insItem.run(orderId, pid, qty, prod.price_iqd);
    }
    return orderId;
  });

  try {
    const orderId = tx();
    res.json({ ok: true, order_id: orderId });
  } catch (e) {
    res.status(400).json({ ok: false, msg: e.message });
  }
});

app.get("/api/orders/open", requireRole("admin", "cashier"), (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.table_no, o.created_at, u.username AS captain
    FROM orders o
    JOIN users u ON u.id = o.created_by_user_id
    WHERE o.status='open'
    ORDER BY o.id DESC
  `).all();

  const itemsByOrder = db.prepare(`
    SELECT oi.order_id, p.name, oi.qty, oi.price_iqd
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `);

  const data = rows.map(o => {
    const items = itemsByOrder.all(o.id);
    const total = items.reduce((s, x) => s + (x.qty * x.price_iqd), 0);
    return { ...o, items, total_iqd: total };
  });

  res.json({ ok: true, orders: data });
});

app.post("/api/orders/:id/pay", requireRole("admin", "cashier"), (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
  if (!order) return res.status(404).json({ ok: false, msg: "الأوردر مو موجود" });
  if (order.status !== "open") return res.status(400).json({ ok: false, msg: "الأوردر مو مفتوح" });

  db.prepare(`UPDATE orders SET status='paid', paid_at=datetime('now'), paid_by_user_id=? WHERE id=?`)
    .run(req.session.user.id, id);

  res.json({ ok: true });
});

// Reports
app.get("/api/reports/summary", requireRole("admin"), (req, res) => {
  const totalPaid = db.prepare(`
    SELECT COALESCE(SUM(oi.qty * oi.price_iqd),0) AS total
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    WHERE o.status='paid'
  `).get().total;

  const byCaptain = db.prepare(`
    SELECT u.username AS captain,
           COALESCE(SUM(oi.qty * oi.price_iqd),0) AS total_iqd,
           COUNT(DISTINCT o.id) AS orders_count
    FROM orders o
    JOIN users u ON u.id=o.created_by_user_id
    JOIN order_items oi ON oi.order_id=o.id
    WHERE o.status IN ('open','paid')
    GROUP BY u.username
    ORDER BY total_iqd DESC
  `).all();

  res.json({ ok: true, total_paid_iqd: totalPaid, by_captain: byCaptain });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log("POS running on port", PORT);
});
