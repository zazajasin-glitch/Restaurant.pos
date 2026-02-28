const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== DB (SQLite) =====
const db = new Database(path.join(__dirname, "pos.db"));
db.exec(`PRAGMA journal_mode = WAL;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','cashier','captain')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_iqd INTEGER NOT NULL,
  category_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no INTEGER NOT NULL,
  table_no TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  captain_username TEXT NOT NULL,
  payment_method TEXT,
  tax_pct REAL NOT NULL DEFAULT 0,
  discount_iqd INTEGER NOT NULL DEFAULT 0,
  subtotal_iqd INTEGER NOT NULL,
  tax_iqd INTEGER NOT NULL,
  total_iqd INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','paid','void')) DEFAULT 'open',
  note TEXT
);

CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  price_iqd INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  line_total_iqd INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);

function fmtIQD(n){ return (Math.round(Number(n)||0)).toLocaleString("ar-IQ")+" د.ع"; }
function num(v){ return Math.max(0, Number(v)||0); }

// ===== Seed users (admin + cashier) إذا ماكو =====
(function seed(){
  const c = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  if(c === 0){
    db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,?)")
      .run("admin", bcrypt.hashSync("admin123",10), "admin");
    db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,?)")
      .run("cashier", bcrypt.hashSync("cashier123",10), "cashier");

    // أقسام/أصناف تجريبية
    const cat = db.prepare("INSERT OR IGNORE INTO categories(name) VALUES (?)");
    ["سندويچ","مقبلات","مشروبات"].forEach(x=>cat.run(x));
    const getCat = db.prepare("SELECT id FROM categories WHERE name=?");
    const insP = db.prepare("INSERT INTO products(name,price_iqd,category_id,is_active) VALUES (?,?,?,1)");
    insP.run("برگر لحم",6000,getCat.get("سندويچ").id);
    insP.run("بطاطا",2500,getCat.get("مقبلات").id);
    insP.run("بيبسي",1000,getCat.get("مشروبات").id);
  }
})();

// ===== App =====
app.set("view engine","ejs");
app.set("views", path.join(__dirname,"views"));

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname,"public")));

app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  secret: "CHANGE_THIS_SECRET_LONG_RANDOM",
  resave:false,
  saveUninitialized:false,
  cookie:{ sameSite:"lax" }
}));

function requireAuth(req,res,next){
  if(!req.session.user) return res.redirect("/login");
  next();
}
function requireRole(...roles){
  return (req,res,next)=>{
    if(!req.session.user) return res.redirect("/login");
    if(!roles.includes(req.session.user.role)) return res.status(403).send("Forbidden");
    next();
  };
}

// ===== Pages =====
app.get("/", (req,res)=>{
  if(!req.session.user) return res.redirect("/login");
  if(req.session.user.role === "cashier") return res.redirect("/cashier");
  return res.redirect("/pos");
});

app.get("/login",(req,res)=>res.render("login",{error:null}));

app.post("/login",(req,res)=>{
  const {username,password} = req.body;
  const u = db.prepare("SELECT * FROM users WHERE username=? AND is_active=1").get(username);
  if(!u) return res.render("login",{error:"بيانات الدخول غلط."});
  if(!bcrypt.compareSync(password||"", u.password_hash)) return res.render("login",{error:"بيانات الدخول غلط."});
  req.session.user = { id:u.id, username:u.username, role:u.role };
  res.redirect("/");
});

app.post("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));

// ===== Captain POS =====
app.get("/pos", requireRole("admin","captain"), (req,res)=>{
  res.render("pos", { user:req.session.user, fmtIQD });
});

// ===== Cashier screen =====
app.get("/cashier", requireRole("admin","cashier"), (req,res)=>{
  res.render("cashier", { user:req.session.user, fmtIQD });
});

// ===== Admin: Products =====
app.get("/admin/products", requireRole("admin"), (req,res)=>{
  const cats = db.prepare("SELECT * FROM categories ORDER BY name").all();
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    ORDER BY p.is_active DESC, p.name
  `).all();
  res.render("admin_products", { user:req.session.user, cats, products, fmtIQD });
});

app.post("/admin/categories", requireRole("admin"), (req,res)=>{
  const name = String(req.body.name||"").trim();
  if(name) { try{ db.prepare("INSERT INTO categories(name) VALUES (?)").run(name); }catch{} }
  res.redirect("/admin/products");
});

app.post("/admin/products", requireRole("admin"), (req,res)=>{
  const name = String(req.body.name||"").trim();
  const price = Math.max(0, Number(req.body.price_iqd)||0);
  const category_id = req.body.category_id ? Number(req.body.category_id) : null;
  if(name){
    db.prepare("INSERT INTO products(name,price_iqd,category_id,is_active) VALUES (?,?,?,1)")
      .run(name, price, category_id);
  }
  res.redirect("/admin/products");
});

app.post("/admin/products/:id/toggle", requireRole("admin"), (req,res)=>{
  db.prepare("UPDATE products SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=?")
    .run(Number(req.params.id));
  res.redirect("/admin/products");
});

// ===== Admin: Users (Add Captains/Cashiers) =====
app.get("/admin/users", requireRole("admin"), (req,res)=>{
  const users = db.prepare("SELECT id,username,role,is_active,created_at FROM users ORDER BY role, username").all();
  res.render("admin_users", { user:req.session.user, users });
});

app.post("/admin/users", requireRole("admin"), (req,res)=>{
  const username = String(req.body.username||"").trim();
  const password = String(req.body.password||"").trim();
  const role = ["captain","cashier","admin"].includes(req.body.role) ? req.body.role : "captain";
  if(!username || !password) return res.redirect("/admin/users");

  try{
    db.prepare("INSERT INTO users(username,password_hash,role,is_active) VALUES (?,?,?,1)")
      .run(username, bcrypt.hashSync(password,10), role);
  }catch{}
  res.redirect("/admin/users");
});

app.post("/admin/users/:id/toggle", requireRole("admin"), (req,res)=>{
  db.prepare("UPDATE users SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=?")
    .run(Number(req.params.id));
  res.redirect("/admin/users");
});

// ===== API: menu =====
app.get("/api/menu", requireAuth, (req,res)=>{
  const categories = db.prepare("SELECT * FROM categories ORDER BY name").all();
  const products = db.prepare(`
    SELECT p.id,p.name,p.price_iqd,p.category_id,c.name as category_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=1
    ORDER BY c.name, p.name
  `).all();
  res.json({ categories, products });
});

// ===== API: captain creates OPEN order (no payment) =====
app.post("/api/orders/open", requireRole("admin","captain"), (req,res)=>{
  const payload = req.body || {};
  const table_no = String(payload.table_no || "").trim();
  const note = String(payload.note || "").slice(0,200);
  const items = Array.isArray(payload.items) ? payload.items : [];

  if(!table_no) return res.status(400).json({ error:"اكتب رقم الطاولة." });
  if(items.length === 0) return res.status(400).json({ error:"السلة فارغة." });

  const tax_pct = num(payload.tax_pct);
  const discount_iqd = Math.round(num(payload.discount_iqd));

  let subtotal = 0;
  const cleanItems = items.map(it=>{
    const name = String(it.name||"").trim();
    const price = Math.max(0, Number(it.price_iqd)||0);
    const qty = Math.max(1, Number(it.qty)||1);
    const line = price*qty;
    subtotal += line;
    return { product_id: it.product_id ? Number(it.product_id): null, name, price_iqd: price, qty, line_total_iqd: line };
  }).filter(x=>x.name);

  const tax_iqd = Math.round(subtotal*(tax_pct/100));
  const total_iqd = Math.max(0, subtotal + tax_iqd - discount_iqd);

  const last = db.prepare("SELECT COALESCE(MAX(order_no),1000) m FROM orders").get().m;
  const order_no = last + 1;

  const insertOrder = db.prepare(`
    INSERT INTO orders(order_no,table_no,captain_username,payment_method,tax_pct,discount_iqd,subtotal_iqd,tax_iqd,total_iqd,status,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items(order_id,product_id,name,price_iqd,qty,line_total_iqd)
    VALUES (?,?,?,?,?,?)
  `);

  const tx = db.transaction(()=>{
    const info = insertOrder.run(
      order_no, table_no, req.session.user.username,
      null, tax_pct, discount_iqd, subtotal, tax_iqd, total_iqd,
      "open", note
    );
    const orderId = info.lastInsertRowid;
    for(const it of cleanItems){
      insertItem.run(orderId, it.product_id, it.name, it.price_iqd, it.qty, it.line_total_iqd);
    }
    return orderId;
  });

  const orderId = tx();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  const orderItems = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);
  res.json({ order, items: orderItems });
});

// ===== API: cashier list open orders =====
app.get("/api/orders/open", requireRole("admin","cashier"), (req,res)=>{
  const orders = db.prepare(`
    SELECT id,order_no,table_no,created_at,captain_username,total_iqd,note
    FROM orders
    WHERE status='open'
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  res.json({ orders });
});

app.get("/api/orders/:id", requireRole("admin","cashier"), (req,res)=>{
  const id = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if(!order) return res.status(404).json({error:"Not found"});
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  res.json({ order, items });
});

// ===== API: cashier marks PAID =====
app.post("/api/orders/:id/pay", requireRole("admin","cashier"), (req,res)=>{
  const id = Number(req.params.id);
  const payment_method = ["cash","card","credit"].includes(req.body.payment_method) ? req.body.payment_method : "cash";
  db.prepare("UPDATE orders SET status='paid', payment_method=? WHERE id=? AND status='open'").run(payment_method, id);

  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  res.json({ order, items });
});

// ===== Reports (admin only) =====
app.get("/api/reports/today", requireRole("admin"), (req,res)=>{
  const key = new Date().toISOString().slice(0,10);
  const rows = db.prepare(`SELECT * FROM orders WHERE status='paid' AND substr(created_at,1,10)=?`).all(key);

  const total = rows.reduce((s,o)=>s+o.total_iqd,0);
  const byCaptain = {};
  for(const o of rows){
    byCaptain[o.captain_username] = (byCaptain[o.captain_username]||0) + o.total_iqd;
  }
  res.json({ date:key, count:rows.length, total_sales_iqd: total, by_captain: byCaptain });
});

app.listen(PORT, "0.0.0.0", ()=>console.log("Running on", PORT));
