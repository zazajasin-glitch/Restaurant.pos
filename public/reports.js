const todayBox = document.getElementById("todayBox");
const topItems = document.getElementById("topItems");
const rangeBox = document.getElementById("rangeBox");

document.getElementById("refreshToday").onclick = loadToday;
document.getElementById("rangeBtn").onclick = loadRange;

(function initDates(){
  const t = new Date().toISOString().slice(0,10);
  document.getElementById("from").value = t;
  document.getElementById("to").value = t;
})();

loadToday();

async function loadToday(){
  todayBox.textContent = "جاري التحميل...";
  topItems.innerHTML = "";
  const res = await fetch("/api/reports/today");
  const data = await res.json();

  todayBox.innerHTML = `
    <div>التاريخ: <b>${data.date}</b></div>
    <div>عدد الطلبات: <b>${data.count}</b></div>
    <div>المبيعات: <b>${fmtIQD(data.total_sales_iqd)}</b></div>
    <div class="mt-2 text-secondary">
      كاش: ${fmtIQD(data.by_payment.cash)} • بطاقة: ${fmtIQD(data.by_payment.card)} • آجل: ${fmtIQD(data.by_payment.credit)}
    </div>
  `;

  if(data.top_items?.length){
    topItems.innerHTML = `
      <div class="mt-3 fw-bold">الأكثر مبيعاً</div>
      <div class="table-responsive mt-2">
        <table class="table table-dark table-hover">
          <thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            ${data.top_items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${fmtIQD(i.total_iqd)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  } else {
    topItems.innerHTML = `<div class="text-secondary mt-3">ماكو مبيعات اليوم.</div>`;
  }
}

async function loadRange(){
  rangeBox.textContent = "جاري التحميل...";
  const from = document.getElementById("from").value;
  const to = document.getElementById("to").value;
  const res = await fetch(`/api/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const data = await res.json();
  rangeBox.innerHTML = `
    <div>من: <b>${data.from}</b> إلى: <b>${data.to}</b></div>
    <div>عدد الطلبات: <b>${data.count}</b></div>
    <div>المبيعات: <b>${fmtIQD(data.total_sales_iqd)}</b></div>
  `;
}

function fmtIQD(n){ return (Math.round(Number(n)||0)).toLocaleString("ar-IQ")+" د.ع"; }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
