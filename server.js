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
  paid_by_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price_iqd INTEGER NOT NULL DEFAULT 0
);
`);

// Seed Users
const usersCount = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
if (usersCount === 0) {
  const ins = db.prepare(`INSERT INTO users (username,password_hash,role) VALUES (?,?,?)`);
  ins.run("admin", bcrypt.hashSync("admin123", 10), "admin");
  ins.run("cashier", bcrypt.hashSync("cashier123", 10), "cashier");
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
    if (!roles.includes(req.session.user.role))
      return res.status(403).send("Forbidden");
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
  if (!user) return res.render("login", { error: "بيانات الدخول غلط" });

  if (!bcrypt.compareSync(password, user.password_hash))
    return res.render("login", { error: "بيانات الدخول غلط" });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ===== Admin =====
app.get("/admin/users", requireRole("admin"), (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, created_at
    FROM users
    ORDER BY id DESC
  `).all();
  res.render("admin_users", { user: req.session.user, users });
});

app.get("/admin/products", requireRole("admin"), (req, res) => {
  const products = db.prepare(`
    SELECT id, name, category, price_iqd, active
    FROM products
    ORDER BY id DESC
  `).all();

  res.render("admin_products", {
    user: req.session.user,
    products
  });
});

app.post("/admin/products", requireRole("admin"), (req, res) => {
  const { name, category, price_iqd } = req.body;
  if (!name) return res.redirect("/admin/products");

  const p = parseInt(price_iqd, 10);
  if (Number.isNaN(p) || p < 0) return res.redirect("/admin/products");

  db.prepare(`
    INSERT INTO products (name, category, price_iqd, active)
    VALUES (?, ?, ?, 1)
  `).run(name.trim(), (category || "").trim(), p);

  res.redirect("/admin/products");
});

// ===== POS =====
app.get("/pos", requireRole("admin", "captain"), (req, res) => {
  res.render("pos", { user: req.session.user });
});

app.get("/cashier", requireRole("admin", "cashier"), (req, res) => {
  res.render("cashier", { user: req.session.user });
});

app.get("/reports", requireRole("admin"), (req, res) => {
  res.render("reports", { user: req.session.user });
});

// ===== API =====
app.get("/api/products", requireAuth, (req, res) => {
  const products = db.prepare(`
    SELECT id,name,category,price_iqd,active
    FROM products
    WHERE active=1
    ORDER BY id DESC
  `).all();
  res.json({ ok: true, products });
});

app.post("/api/admin/products/:id/toggle", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`
    UPDATE products
    SET active = CASE WHEN active=1 THEN 0 ELSE 1 END
    WHERE id=?
  `).run(id);
  res.json({ ok: true });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log("POS running on port", PORT);
});
