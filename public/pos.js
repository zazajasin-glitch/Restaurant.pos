let menu = { categories: [], products: [] };
let activeCat = "الكل";
let cart = [];

const elGrid = document.getElementById("grid");
const elChips = document.getElementById("chips");
const elCart = document.getElementById("cart");
const elSearch = document.getElementById("search");

const elTax = document.getElementById("tax");
const elDiscount = document.getElementById("discount");
const elPayment = document.getElementById("payment");
const elNote = document.getElementById("note");

const elSub = document.getElementById("sub");
const elTaxAmt = document.getElementById("taxAmt");
const elDiscAmt = document.getElementById("discAmt");
const elTotal = document.getElementById("total");

document.getElementById("reload").onclick = loadMenu;
document.getElementById("clear").onclick = () => { cart = []; renderCart(); };
document.getElementById("checkout").onclick = checkout;

elSearch.oninput = renderProducts;
elTax.oninput = renderTotals;
elDiscount.oninput = renderTotals;
elPayment.onchange = renderTotals;

loadMenu();

async function loadMenu(){
  const res = await fetch("/api/menu");
  menu = await res.json();
  renderChips(); renderProducts(); renderCart();
}

function renderChips(){
  const cats = ["الكل", ...menu.categories.map(c => c.name)];
  elChips.innerHTML = "";
  cats.forEach(c => {
    const d = document.createElement("div");
    d.className = "chip" + (c === activeCat ? " active" : "");
    d.textContent = c;
    d.onclick = () => { activeCat = c; renderChips(); renderProducts(); };
    elChips.appendChild(d);
  });
}

function renderProducts(){
  const q = (elSearch.value || "").trim().toLowerCase();
  const filtered = menu.products.filter(p => {
    const matchCat = activeCat === "الكل" ? true : p.category_name === activeCat;
    const matchQ = q ? p.name.toLowerCase().includes(q) : true;
    return matchCat && matchQ;
  });

  elGrid.innerHTML = "";
  filtered.forEach(p => {
    const card = document.createElement("div");
    card.className = "pos-card";
    card.innerHTML = `
      <div class="name">${esc(p.name)}</div>
      <div class="meta d-flex justify-content-between">
        <span>${esc(p.category_name || "—")}</span>
        <span><b>${fmtIQD(p.price_iqd)}</b></span>
      </div>
      <button class="btn btn-primary w-100 mt-2">إضافة</button>
    `;
    card.querySelector("button").onclick = () => addToCart(p);
    elGrid.appendChild(card);
  });

  if(!filtered.length) elGrid.innerHTML = `<div class="text-secondary p-3">ماكو نتائج.</div>`;
}

function addToCart(p){
  const found = cart.find(x => x.product_id === p.id);
  if(found) found.qty += 1;
  else cart.push({ product_id: p.id, name: p.name, price_iqd: p.price_iqd, qty: 1 });
  renderCart();
}

function renderCart(){
  elCart.innerHTML = "";
  if(!cart.length){
    elCart.innerHTML = `<div class="text-secondary">السلة فارغة.</div>`;
    renderTotals(); return;
  }

  cart.forEach(it => {
    const row = document.createElement("div");
    row.className = "p-2 rounded-3 bg-dark bg-opacity-50 border border-light border-opacity-10";
    row.innerHTML = `
      <div class="d-flex justify-content-between">
        <div>
          <div class="fw-bold">${esc(it.name)}</div>
          <div class="text-secondary small">${fmtIQD(it.price_iqd)} للواحد</div>
        </div>
        <div class="text-end">
          <div class="fw-bold">${fmtIQD(it.price_iqd * it.qty)}</div>
          <div class="btn-group btn-group-sm mt-1">
            <button class="btn btn-outline-light">+</button>
            <button class="btn btn-outline-light" disabled>${it.qty}</button>
            <button class="btn btn-outline-light">-</button>
            <button class="btn btn-outline-danger">حذف</button>
          </div>
        </div>
      </div>
    `;
    const [bPlus, , bMinus, bDel] = row.querySelectorAll("button");
    bPlus.onclick = () => { it.qty++; renderCart(); };
    bMinus.onclick = () => { it.qty--; if(it.qty<=0) cart = cart.filter(x => x!==it); renderCart(); };
    bDel.onclick = () => { cart = cart.filter(x => x!==it); renderCart(); };
    elCart.appendChild(row);
  });

  renderTotals();
}

function totals(){
  const sub = cart.reduce((s,i)=> s + i.price_iqd*i.qty, 0);
  const taxPct = Math.max(0, Number(elTax.value)||0);
  const disc = Math.max(0, Number(elDiscount.value)||0);
  const taxAmt = Math.round(sub * taxPct/100);
  const total = Math.max(0, sub + taxAmt - disc);
  return { sub, taxPct, disc, taxAmt, total };
}

function renderTotals(){
  const t = totals();
  elSub.textContent = fmtIQD(t.sub);
  elTaxAmt.textContent = fmtIQD(t.taxAmt);
  elDiscAmt.textContent = fmtIQD(t.disc);
  elTotal.textContent = fmtIQD(t.total);
}

async function checkout(){
  if(!cart.length) return alert("السلة فارغة.");

  const t = totals();
  const payload = {
    items: cart,
    tax_pct: t.taxPct,
    discount_iqd: t.disc,
    payment_method: elPayment.value,
    note: elNote.value || ""
  };

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if(!res.ok) return alert(data.error || "صار خطأ.");

  printReceipt(data.order, data.items);
  cart = []; elNote.value = "";
  renderCart();
}

function printReceipt(order, items){
  const area = document.getElementById("printArea");
  const dt = new Date(order.created_at);

  const rows = items.map(i => `
    <tr>
      <td>${esc(i.name)}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:left">${fmtIQD(i.line_total_iqd)}</td>
    </tr>
  `).join("");

  area.hidden = false;
  area.innerHTML = `
    <div style="text-align:center;font-weight:800;font-size:16px;">مطعمك</div>
    <div style="text-align:center;font-size:12px;">فاتورة</div>
    <hr/>
    <div style="font-size:12px;">
      <div>رقم الطلب: <b>#${order.order_no}</b></div>
      <div>التاريخ: ${dt.toLocaleString("ar-IQ")}</div>
      <div>الدفع: <b>${order.payment_method}</b></div>
    </div>
    <hr/>
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr><th style="text-align:right">الصنف</th><th style="text-align:center">عدد</th><th style="text-align:left">مجموع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr/>
    <div style="font-size:12px;">
      <div style="display:flex;justify-content:space-between;"><span>المجموع</span><b>${fmtIQD(order.subtotal_iqd)}</b></div>
      <div style="display:flex;justify-content:space-between;"><span>الضريبة</span><b>${fmtIQD(order.tax_iqd)}</b></div>
      <div style="display:flex;justify-content:space-between;"><span>الخصم</span><b>${fmtIQD(order.discount_iqd)}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:14px;"><span>الإجمالي</span><b>${fmtIQD(order.total_iqd)}</b></div>
    </div>
    <hr/>
    <div style="text-align:center;font-size:12px;">شكراً لزيارتكم ❤️</div>
  `;

  window.print();
  setTimeout(() => { area.hidden = true; area.innerHTML = ""; }, 400);
}

function fmtIQD(n){ return (Math.round(Number(n)||0)).toLocaleString("ar-IQ")+" د.ع"; }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
