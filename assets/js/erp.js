// ============================================================
// ROK 企業 ERP 擴充模組（system.html 專用）
// 原則：只「擴充 + 連動」，不更動現有三大模組（訂單/庫存/人事）與其 localStorage 結構。
//   - 現有鍵唯讀連動：rokOrders / rokInventory / rokEmployees
//   - 本檔新增鍵（皆 rok 前綴、首次載入種子假資料）：
//     rokShipments rokStockThreshold rokSuppliers rokPurchases
//     rokAttendance rokLeaves rokPayroll rokFinance rokDocuments
// 導覽：側邊欄 16 模組。既有 3 模組沿用 system.js（透過隱藏的 .sys-tab 觸發其 render）。
// ============================================================
(function () {
  "use strict";
  if (!document.querySelector(".erp-sidebar")) return; // 只在新版 system.html 執行

  // ---------- 小工具 ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function fmt(n) { var x = Number(n); return Number.isFinite(x) ? x.toLocaleString("en-US") : String(n == null ? "" : n); }
  function money(n) { return "$" + fmt(Math.round(Number(n) || 0)); }
  function load(key, fb) { try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function seed(key, data) { if (localStorage.getItem(key) == null) save(key, data); return load(key, data); }
  function uid(p) { return (p || "id") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ym(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
  function monthsAgo(n) { var d = new Date(); d.setMonth(d.getMonth() - n); return ym(d); }

  // ---------- Toast（沿用既有 .sys-toast 樣式與容器）----------
  function toast(msg, kind) {
    var w = $("[data-toast-wrap]"); if (!w) return;
    var e = document.createElement("div"); e.className = "sys-toast" + (kind ? " " + kind : ""); e.textContent = msg;
    w.appendChild(e);
    setTimeout(function () { e.style.transition = "opacity .3s,transform .3s"; e.style.opacity = "0"; e.style.transform = "translateY(8px)"; setTimeout(function () { e.remove(); }, 300); }, 2600);
  }

  // ---------- 狀態標籤配色（語意化，全站一致）----------
  // 綠 ok＝正常/完成/已付款/已核准/有效；黃 warn＝偏低/待審/即將到期/待確認；
  // 紅 danger＝缺貨/逾期/已過期/已拒絕/退貨；藍 info＝進行中/配送中/草稿。
  var BADGE = {
    "待出貨": "warn", "已出貨": "info", "配送中": "info", "已送達": "ok", "退貨處理中": "danger",
    "正常": "ok", "偏低": "warn", "缺貨": "danger", "庫存過高": "info",
    "合作中": "ok", "暫停": "warn", "已終止": "danger",
    "已付款": "ok", "未付款": "warn", "逾期": "danger", "逾期付款": "danger",
    "草稿": "info", "待審核": "warn", "已核准": "ok", "已下單": "info", "已到貨": "ok", "已取消": "danger",
    "已拒絕": "danger", "出勤": "ok", "遲到": "warn", "早退": "warn", "請假": "info", "缺勤": "danger",
    "已發放": "ok", "未發放": "warn", "待確認": "warn",
    "有效": "ok", "即將到期": "warn", "已過期": "danger", "待更新": "warn"
  };
  function badge(text) { return '<span class="tag ' + (BADGE[text] || "muted") + '">' + esc(text) + "</span>"; }
  function kpiCard(label, value, alert) { return "<article><span>" + esc(label) + "</span><strong" + (alert ? ' class="alert"' : "") + ">" + esc(value) + "</strong></article>"; }

  // ---------- 唯讀連動：現有資料 ----------
  function getOrders() { var o = load("rokOrders", []); return Array.isArray(o) ? o : []; }
  function getInventory() { var i = load("rokInventory", []); return Array.isArray(i) ? i : []; }
  function getEmployees() { var e = load("rokEmployees", []); return Array.isArray(e) ? e : []; }
  function orderAmount(o) { return Number(o.total != null ? o.total : (o.amount != null ? o.amount : 0)) || 0; }
  function orderDate(o) { return String(o.date || o.createdAt || o.time || "").slice(0, 10); }
  function orderItems(o) { return Array.isArray(o.items) ? o.items : (Array.isArray(o.cart) ? o.cart : []); }

  // ====================================================================
  // 通用 CRUD 表格模組工廠：吃一份設定，產生 KPI + 搜尋 + 篩選 + 表格 + 新增/編輯/刪除
  // ====================================================================
  var MODULES = {}; // name -> {render, cfg}
  function defineModule(cfg) {
    // cfg: {name,title,key,seed,columns:[{k,label,badge,num}],form:[{k,label,type,options,placeholder}],
    //       filterKey, kpis(rows), beforeSave(rec), extraHead}
    seed(cfg.key, cfg.seed || []);
    var state = { q: "", filter: "" };

    function records() { var r = load(cfg.key, []); return Array.isArray(r) ? r : []; }
    function setRecords(r) { save(cfg.key, r); }

    function render() {
      var panel = document.querySelector('[data-panel="' + cfg.name + '"]'); if (!panel) return;
      var rows = records();
      var kpis = cfg.kpis ? cfg.kpis(rows) : null;
      var filterOpts = "";
      if (cfg.filterKey) {
        var vals = []; rows.forEach(function (r) { if (r[cfg.filterKey] != null && vals.indexOf(r[cfg.filterKey]) < 0) vals.push(r[cfg.filterKey]); });
        filterOpts = '<option value="">全部</option>' + vals.map(function (v) { return '<option' + (state.filter === String(v) ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
      }
      // 搜尋 + 篩選
      var q = state.q.trim().toLowerCase();
      var visible = rows.filter(function (r) {
        var text = cfg.columns.map(function (c) { return r[c.k]; }).join(" ").toLowerCase();
        var okQ = !q || text.indexOf(q) >= 0;
        var okF = !cfg.filterKey || !state.filter || String(r[cfg.filterKey]) === state.filter;
        return okQ && okF;
      });
      var thead = cfg.columns.map(function (c) { return "<th>" + esc(c.label) + "</th>"; }).join("") + "<th>操作</th>";
      var body = visible.length ? visible.map(function (r) {
        var tds = cfg.columns.map(function (c) {
          var v = r[c.k];
          if (c.badge) return "<td>" + badge(v) + "</td>";
          if (c.num) return '<td class="sys-num">' + fmt(v) + "</td>";
          if (c.money) return '<td class="sys-num">' + money(v) + "</td>";
          return "<td>" + (String(v == null ? "" : v).trim() ? esc(v) : '<span class="tag muted">—</span>') + "</td>";
        }).join("");
        return "<tr>" + tds + '<td class="erp-ops">' +
          '<button class="btn ghost tiny" data-edit="' + esc(r._id) + '">編輯</button>' +
          '<button class="btn danger tiny" data-del="' + esc(r._id) + '">刪除</button></td></tr>';
      }).join("") : '<tr><td colspan="' + (cfg.columns.length + 1) + '"><div class="sys-empty">沒有符合條件的資料。</div></td></tr>';

      panel.innerHTML =
        '<div class="erp-page-head"><h2>' + esc(cfg.title) + "</h2>" + (cfg.subtitle ? '<p class="erp-sub">' + esc(cfg.subtitle) + "</p>" : "") + "</div>" +
        (kpis ? '<div class="sys-summary erp-kpi">' + kpis.map(function (k) { return kpiCard(k.label, k.value, k.alert); }).join("") + "</div>" : "") +
        '<div class="sys-toolbar">' +
          '<label class="grow">搜尋<input type="search" data-erp-search placeholder="輸入關鍵字"></label>' +
          (cfg.filterKey ? '<label class="grow">' + esc(cfg.filterLabel || "篩選") + '<select data-erp-filter>' + filterOpts + "</select></label>" : "") +
          '<span class="spacer"></span>' +
          '<button class="btn excel tiny" data-erp-export>匯出 Excel</button>' +
          '<button class="btn primary tiny" data-erp-add>＋ 新增</button>' +
        "</div>" +
        '<div class="sys-table-wrap"><table class="sys-table"><thead><tr>' + thead + "</tr></thead><tbody>" + body + "</tbody></table></div>";

      // 還原搜尋框內容並聚焦點
      var s = $("[data-erp-search]", panel); if (s) { s.value = state.q; s.oninput = function () { state.q = s.value; var pos = s.selectionStart; render(); var s2 = $("[data-erp-search]", panel); if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} } }; }
      var f = $("[data-erp-filter]", panel); if (f) f.onchange = function () { state.filter = f.value; render(); };
      var add = $("[data-erp-add]", panel); if (add) add.onclick = function () { openForm(null); };
      var exp = $("[data-erp-export]", panel); if (exp) exp.onclick = exportRows;
      $$("[data-edit]", panel).forEach(function (b) { b.onclick = function () { openForm(b.getAttribute("data-edit")); }; });
      $$("[data-del]", panel).forEach(function (b) { b.onclick = function () { delRow(b.getAttribute("data-del")); }; });
    }

    function openForm(id) {
      var rec = id ? records().find(function (r) { return r._id === id; }) : {};
      erpForm(cfg.title + (id ? "・編輯" : "・新增"), cfg.form, rec || {}, function (data) {
        var list = records();
        if (id) { var i = list.findIndex(function (r) { return r._id === id; }); if (i >= 0) list[i] = Object.assign(list[i], data); }
        else { data._id = uid(cfg.name); if (cfg.beforeSave) cfg.beforeSave(data, list); list.unshift(data); }
        setRecords(list); render(); refreshDashboard();
        toast(id ? "已更新" : "已新增", "ok");
      });
    }
    function delRow(id) {
      var rec = records().find(function (r) { return r._id === id; }); if (!rec) return;
      erpConfirm("刪除資料", "確定要刪除這筆資料嗎？此動作無法復原。", function () {
        setRecords(records().filter(function (r) { return r._id !== id; })); render(); refreshDashboard(); toast("已刪除", "ok");
      });
    }
    function exportRows() {
      var headers = cfg.columns.map(function (c) { return c.label; });
      var rows = records().map(function (r) { return cfg.columns.map(function (c) { return c.num || c.money ? (Number(r[c.k]) || 0) : (r[c.k] == null ? "" : r[c.k]); }); });
      exportExcel("ROK_" + cfg.title + "_" + ym() + ".xlsx", cfg.title, headers, rows);
    }

    MODULES[cfg.name] = { render: render, records: records };
    return MODULES[cfg.name];
  }

  // ====================================================================
  // 通用表單 Modal / 確認 Modal（ERP 專用，與 system.js 的 modal 分開以免衝突）
  // ====================================================================
  var formSubmit = null, confirmOk = null;
  function erpForm(title, fields, rec, onSubmit) {
    var modal = $("[data-erp-modal]"); if (!modal) return;
    $("[data-erp-title]", modal).textContent = title;
    $("[data-erp-fields]", modal).innerHTML = fields.map(function (f) {
      var v = rec[f.k] == null ? (f.def == null ? "" : f.def) : rec[f.k];
      var cls = "sys-field" + (f.full ? " full" : "");
      if (f.type === "select") {
        return '<div class="' + cls + '"><label>' + esc(f.label) + "</label><select data-f=\"" + f.k + "\">" +
          (f.options || []).map(function (o) { return "<option" + (String(v) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></div>";
      }
      if (f.type === "textarea") return '<div class="' + cls + '"><label>' + esc(f.label) + '</label><textarea data-f="' + f.k + '" rows="2">' + esc(v) + "</textarea></div>";
      return '<div class="' + cls + '"><label>' + esc(f.label) + '</label><input data-f="' + f.k + '" type="' + (f.type || "text") + '" placeholder="' + esc(f.placeholder || "") + '" value="' + esc(v) + '"></div>';
    }).join("");
    formSubmit = function () {
      var data = {};
      $$("[data-f]", modal).forEach(function (el) { var t = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value.trim(); data[el.getAttribute("data-f")] = t; });
      onSubmit(data);
    };
    modal.hidden = false;
  }
  function erpConfirm(title, text, onOk) {
    var m = $("[data-erp-confirm]"); if (!m) { if (confirm(text)) onOk(); return; }
    $("[data-erpc-title]", m).textContent = title; $("[data-erpc-text]", m).textContent = text;
    confirmOk = onOk; m.hidden = false;
  }

  // ---------- Excel 匯出（沿用 xlsx-js-style，粗體標題；獨立小版以免動 system.js）----------
  function exportExcel(filename, sheet, headers, rows) {
    if (typeof XLSX === "undefined") { toast("Excel 函式庫尚未載入，請稍候", "warn"); return; }
    try {
      var aoa = [headers].concat(rows);
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = headers.map(function (h, c) { var max = String(h).length; aoa.forEach(function (r) { var w = String(r[c] == null ? "" : r[c]).length; if (w > max) max = w; }); return { wch: Math.min(max + 4, 40) }; });
      var hs = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, fill: { fgColor: { rgb: "171A20" } }, alignment: { horizontal: "center" } };
      headers.forEach(function (_, c) { var a = XLSX.utils.encode_cell({ r: 0, c: c }); if (ws[a]) ws[a].s = hs; });
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, filename);
      toast("匯出完成：" + filename, "ok");
    } catch (e) { toast("匯出失敗", "warn"); }
  }

  // ====================================================================
  // 各模組資料 + 設定（種子假資料力求逼真）
  // ====================================================================
  var PRODUCTS = ["ROK Summit 100", "ROK Orbit 96", "ROK Strike 80", "ROK Spark 60"];
  var empNames = function () { var e = getEmployees().map(function (x) { return x.name; }).filter(Boolean); return e.length ? e : ["李意新", "蘇郁翔", "鄭家慶"]; };
  var empDept = function (name) { var e = getEmployees().find(function (x) { return x.name === name; }); return e ? e.department || "—" : "—"; };

  // 安全庫存門檻（庫存警示與儀表板共用同一套判定）
  function thresholds() { return load("rokStockThreshold", {}) || {}; }
  function thresholdFor(key) { var t = thresholds(); return t[key] != null ? Number(t[key]) : 200; }
  function stockState(stock, th) { stock = Number(stock) || 0; if (stock === 0) return "缺貨"; if (stock < th) return "偏低"; if (stock > th * 50) return "庫存過高"; return "正常"; }
  function lowStockCount() { return getInventory().filter(function (r) { var st = stockState(r.stock, thresholdFor(r.key || (r.productName + r.color + r.switchName))); return st === "偏低" || st === "缺貨"; }).length; }

  // 出貨／物流（連動訂單）
  defineModule({
    name: "shipping", title: "出貨／物流管理", key: "rokShipments", filterKey: "status", filterLabel: "狀態篩選",
    subtitle: "對訂單執行出貨並追蹤物流狀態；資料連動 rokOrders。",
    columns: [{ k: "id", label: "出貨單號" }, { k: "orderNo", label: "對應訂單" }, { k: "product", label: "商品" }, { k: "qty", label: "數量", num: true }, { k: "receiver", label: "收件人" }, { k: "method", label: "配送方式" }, { k: "tracking", label: "物流單號" }, { k: "date", label: "出貨日期" }, { k: "status", label: "配送狀態", badge: true }],
    form: [{ k: "orderNo", label: "對應訂單編號" }, { k: "product", label: "商品" }, { k: "qty", label: "數量", type: "number", def: 1 }, { k: "receiver", label: "收件人" }, { k: "method", label: "配送方式", type: "select", options: ["宅配", "超商取貨", "自取", "貨運"] }, { k: "tracking", label: "物流單號" }, { k: "date", label: "出貨日期", type: "date" }, { k: "status", label: "配送狀態", type: "select", options: ["待出貨", "已出貨", "配送中", "已送達", "退貨處理中"] }],
    kpis: function (rows) { return [{ label: "出貨單總數", value: fmt(rows.length) }, { label: "待出貨", value: fmt(rows.filter(function (r) { return r.status === "待出貨"; }).length), alert: true }, { label: "配送中", value: fmt(rows.filter(function (r) { return r.status === "配送中"; }).length) }, { label: "已送達", value: fmt(rows.filter(function (r) { return r.status === "已送達"; }).length) }]; },
    seed: [
      { _id: uid("sh"), id: "SH-20260620-01", orderNo: "ORD-1031", product: "ROK Summit 100 / 太空灰 / 線性軸", qty: 2, receiver: "王小明", method: "宅配", tracking: "BX839201", date: daysAgo(5), status: "已送達" },
      { _id: uid("sh"), id: "SH-20260621-02", orderNo: "ORD-1032", product: "ROK Strike 80 / 雪白 / 茶軸", qty: 1, receiver: "陳怡君", method: "超商取貨", tracking: "BX839244", date: daysAgo(4), status: "配送中" },
      { _id: uid("sh"), id: "SH-20260622-03", orderNo: "ORD-1033", product: "ROK Orbit 96 / 午夜藍 / 光軸", qty: 3, receiver: "林志豪", method: "貨運", tracking: "BX839310", date: daysAgo(3), status: "已出貨" },
      { _id: uid("sh"), id: "SH-20260623-04", orderNo: "ORD-1034", product: "ROK Spark 60 / 珊瑚粉 / 磁軸", qty: 1, receiver: "黃淑芬", method: "宅配", tracking: "", date: daysAgo(1), status: "待出貨" },
      { _id: uid("sh"), id: "SH-20260624-05", orderNo: "ORD-1035", product: "ROK Summit 100 / 太空灰 / 靜音軸", qty: 2, receiver: "張家瑋", method: "超商取貨", tracking: "BX839402", date: ymd(), status: "待出貨" },
      { _id: uid("sh"), id: "SH-20260618-06", orderNo: "ORD-1029", product: "ROK Strike 80 / 黑 / 青軸", qty: 1, receiver: "吳承恩", method: "宅配", tracking: "BX839108", date: daysAgo(7), status: "退貨處理中" }
    ]
  });

  // 供應商
  defineModule({
    name: "suppliers", title: "供應商管理", key: "rokSuppliers", filterKey: "status", filterLabel: "合作狀態",
    columns: [{ k: "name", label: "供應商名稱" }, { k: "contact", label: "聯絡人" }, { k: "phone", label: "電話" }, { k: "email", label: "Email" }, { k: "items", label: "供應品項" }, { k: "status", label: "合作狀態", badge: true }, { k: "lastDate", label: "最近進貨" }, { k: "payable", label: "應付帳款", badge: true }],
    form: [{ k: "name", label: "供應商名稱" }, { k: "contact", label: "聯絡人" }, { k: "phone", label: "電話" }, { k: "email", label: "Email" }, { k: "items", label: "供應品項", full: true }, { k: "status", label: "合作狀態", type: "select", options: ["合作中", "暫停", "已終止"] }, { k: "lastDate", label: "最近進貨日期", type: "date" }, { k: "payable", label: "應付帳款", type: "select", options: ["已付款", "未付款", "逾期"] }, { k: "note", label: "備註", full: true }],
    kpis: function (rows) { return [{ label: "供應商總數", value: fmt(rows.length) }, { label: "合作中", value: fmt(rows.filter(function (r) { return r.status === "合作中"; }).length) }, { label: "應付未結", value: fmt(rows.filter(function (r) { return r.payable !== "已付款"; }).length), alert: true }]; },
    seed: [
      { _id: uid("sup"), name: "軸心精密工業", contact: "周明達", phone: "02-2766-1188", email: "sales@axiscore.com.tw", items: "機械軸、光軸", status: "合作中", lastDate: daysAgo(12), payable: "已付款", note: "主力軸體供應商" },
      { _id: uid("sup"), name: "鍵帽王 KeycapKing", contact: "李宛蓁", phone: "04-2358-7700", email: "order@keycapking.com", items: "PBT 鍵帽、客製鍵帽", status: "合作中", lastDate: daysAgo(20), payable: "未付款", note: "" },
      { _id: uid("sup"), name: "稻穀電子材料", contact: "黃國榮", phone: "03-4521-9900", email: "rice@grainelec.com", items: "PCB、控制晶片", status: "合作中", lastDate: daysAgo(8), payable: "逾期", note: "本月應付已逾期 5 天" },
      { _id: uid("sup"), name: "曜石外殼", contact: "蔡佩珊", phone: "07-336-2200", email: "case@obsidian.tw", items: "鋁合金外殼", status: "暫停", lastDate: daysAgo(60), payable: "已付款", note: "品質改善中暫停下單" },
      { _id: uid("sup"), name: "穩態電源", contact: "鄭文彬", phone: "02-8978-4567", email: "pse@steadypwr.com", items: "Type-C 線材、變壓器", status: "合作中", lastDate: daysAgo(30), payable: "未付款", note: "" },
      { _id: uid("sup"), name: "極光包材", contact: "許雅婷", phone: "05-271-3344", email: "pack@aurorapack.tw", items: "紙箱、防震包材", status: "已終止", lastDate: daysAgo(180), payable: "已付款", note: "已換供應商" }
    ]
  });

  // 採購（供應商下拉連動 rokSuppliers）
  defineModule({
    name: "purchases", title: "採購管理", key: "rokPurchases", filterKey: "status", filterLabel: "採購狀態",
    subtitle: "供應商欄位連動供應商主檔。",
    columns: [{ k: "id", label: "採購單號" }, { k: "supplier", label: "供應商" }, { k: "item", label: "採購商品" }, { k: "qty", label: "數量", num: true }, { k: "amount", label: "採購金額", money: true }, { k: "applyDate", label: "申請日期" }, { k: "etaDate", label: "預計到貨" }, { k: "status", label: "採購狀態", badge: true }, { k: "review", label: "審核狀態", badge: true }],
    form: [{ k: "supplier", label: "供應商", type: "select", options: [] }, { k: "item", label: "採購商品" }, { k: "qty", label: "數量", type: "number", def: 100 }, { k: "amount", label: "採購金額", type: "number", def: 0 }, { k: "applyDate", label: "申請日期", type: "date" }, { k: "etaDate", label: "預計到貨日期", type: "date" }, { k: "status", label: "採購狀態", type: "select", options: ["草稿", "待審核", "已核准", "已下單", "已到貨", "已取消"] }, { k: "review", label: "審核狀態", type: "select", options: ["待審核", "已核准", "已拒絕"] }],
    kpis: function (rows) { var m = ym(); var spend = rows.filter(function (r) { return String(r.applyDate).slice(0, 7) === m; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0); return [{ label: "採購單總數", value: fmt(rows.length) }, { label: "待審核", value: fmt(rows.filter(function (r) { return r.review === "待審核"; }).length), alert: true }, { label: "本月進貨金額", value: money(spend) }]; },
    seed: [
      { _id: uid("po"), id: "PO-20260601", supplier: "軸心精密工業", item: "線性軸 ×10000", qty: 10000, amount: 180000, applyDate: monthsAgo(0) + "-03", etaDate: daysAgo(-3), status: "已下單", review: "已核准" },
      { _id: uid("po"), id: "PO-20260605", supplier: "鍵帽王 KeycapKing", item: "PBT 鍵帽組 ×800", qty: 800, amount: 96000, applyDate: monthsAgo(0) + "-05", etaDate: daysAgo(-7), status: "已核准", review: "已核准" },
      { _id: uid("po"), id: "PO-20260610", supplier: "稻穀電子材料", item: "主控 PCB ×1200", qty: 1200, amount: 240000, applyDate: monthsAgo(0) + "-10", etaDate: daysAgo(2), status: "已到貨", review: "已核准" },
      { _id: uid("po"), id: "PO-20260614", supplier: "穩態電源", item: "Type-C 線材 ×3000", qty: 3000, amount: 60000, applyDate: monthsAgo(0) + "-14", etaDate: daysAgo(-10), status: "待審核", review: "待審核" },
      { _id: uid("po"), id: "PO-20260616", supplier: "曜石外殼", item: "鋁外殼 ×500", qty: 500, amount: 150000, applyDate: monthsAgo(0) + "-16", etaDate: daysAgo(-14), status: "草稿", review: "待審核" }
    ]
  });

  // 出勤（員工取自 rokEmployees）
  defineModule({
    name: "attendance", title: "出勤管理", key: "rokAttendance", filterKey: "status", filterLabel: "出勤狀態",
    subtitle: "員工名單連動人事資料 rokEmployees。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "clockIn", label: "上班打卡" }, { k: "clockOut", label: "下班打卡" }, { k: "status", label: "出勤狀態", badge: true }, { k: "flag", label: "遲到/早退", badge: true }, { k: "date", label: "日期" }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "clockIn", label: "上班打卡", placeholder: "09:00" }, { k: "clockOut", label: "下班打卡", placeholder: "18:00" }, { k: "status", label: "出勤狀態", type: "select", options: ["出勤", "請假", "缺勤"] }, { k: "flag", label: "遲到/早退", type: "select", options: ["正常", "遲到", "早退"] }, { k: "date", label: "日期", type: "date" }],
    kpis: function (rows) { var t = ymd(); var today = rows.filter(function (r) { return r.date === t; }); return [{ label: "今日出勤", value: fmt(today.filter(function (r) { return r.status === "出勤"; }).length) }, { label: "今日請假", value: fmt(today.filter(function (r) { return r.status === "請假"; }).length) }, { label: "本月遲到", value: fmt(rows.filter(function (r) { return r.flag === "遲到"; }).length), alert: true }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); },
    seed: (function () { var n = empNames(); return [
      { _id: uid("at"), name: n[0], dept: empDept(n[0]), clockIn: "08:52", clockOut: "18:05", status: "出勤", flag: "正常", date: ymd() },
      { _id: uid("at"), name: n[1] || n[0], dept: empDept(n[1] || n[0]), clockIn: "09:18", clockOut: "18:30", status: "出勤", flag: "遲到", date: ymd() },
      { _id: uid("at"), name: n[2] || n[0], dept: empDept(n[2] || n[0]), clockIn: "—", clockOut: "—", status: "請假", flag: "正常", date: ymd() },
      { _id: uid("at"), name: n[0], dept: empDept(n[0]), clockIn: "08:48", clockOut: "17:40", status: "出勤", flag: "早退", date: daysAgo(1) },
      { _id: uid("at"), name: n[1] || n[0], dept: empDept(n[1] || n[0]), clockIn: "08:55", clockOut: "18:02", status: "出勤", flag: "正常", date: daysAgo(1) }
    ]; })()
  });

  // 請假
  defineModule({
    name: "leaves", title: "請假管理", key: "rokLeaves", filterKey: "review", filterLabel: "審核狀態",
    subtitle: "員工名單連動人事資料 rokEmployees。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "type", label: "請假類型" }, { k: "date", label: "請假日期" }, { k: "days", label: "天數", num: true }, { k: "review", label: "審核狀態", badge: true }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "type", label: "請假類型", type: "select", options: ["特休", "病假", "事假", "婚假", "喪假", "公假"] }, { k: "date", label: "請假日期", type: "date" }, { k: "days", label: "天數", type: "number", def: 1 }, { k: "review", label: "審核狀態", type: "select", options: ["待審核", "已核准", "已拒絕"] }],
    kpis: function (rows) { return [{ label: "請假申請", value: fmt(rows.length) }, { label: "待審核", value: fmt(rows.filter(function (r) { return r.review === "待審核"; }).length), alert: true }, { label: "已核准", value: fmt(rows.filter(function (r) { return r.review === "已核准"; }).length) }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); },
    seed: (function () { var n = empNames(); return [
      { _id: uid("lv"), name: n[0], dept: empDept(n[0]), type: "特休", date: daysAgo(2), days: 1, review: "已核准" },
      { _id: uid("lv"), name: n[2] || n[0], dept: empDept(n[2] || n[0]), type: "病假", date: ymd(), days: 1, review: "待審核" },
      { _id: uid("lv"), name: n[1] || n[0], dept: empDept(n[1] || n[0]), type: "事假", date: daysAgo(-3), days: 2, review: "待審核" },
      { _id: uid("lv"), name: n[0], dept: empDept(n[0]), type: "婚假", date: daysAgo(20), days: 5, review: "已核准" }
    ]; })()
  });

  // 薪資
  defineModule({
    name: "payroll", title: "薪資管理", key: "rokPayroll", filterKey: "status", filterLabel: "發薪狀態",
    subtitle: "員工名單連動人事資料 rokEmployees。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "base", label: "基本薪資", money: true }, { k: "overtime", label: "加班費", money: true }, { k: "bonus", label: "獎金", money: true }, { k: "deduct", label: "扣款", money: true }, { k: "net", label: "實領薪資", money: true }, { k: "month", label: "發薪月份" }, { k: "status", label: "發薪狀態", badge: true }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "base", label: "基本薪資", type: "number", def: 45000 }, { k: "overtime", label: "加班費", type: "number", def: 0 }, { k: "bonus", label: "獎金", type: "number", def: 0 }, { k: "deduct", label: "扣款", type: "number", def: 0 }, { k: "month", label: "發薪月份", placeholder: ym() }, { k: "status", label: "發薪狀態", type: "select", options: ["已發放", "未發放", "待確認"] }],
    kpis: function (rows) { var m = ym(); var cur = rows.filter(function (r) { return String(r.month) === m || !r.month; }); var total = cur.reduce(function (s, r) { return s + netPay(r); }, 0); var paid = cur.filter(function (r) { return r.status === "已發放"; }).reduce(function (s, r) { return s + netPay(r); }, 0); return [{ label: "本月薪資總額", value: money(total) }, { label: "已發放", value: money(paid) }, { label: "待發放", value: money(total - paid), alert: (total - paid) > 0 }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); d.net = netPay(d); },
    seed: (function () { var n = empNames(); var mk = function (nm, b, ot, bo, de, st) { var r = { _id: uid("pr"), name: nm, dept: empDept(nm), base: b, overtime: ot, bonus: bo, deduct: de, month: ym(), status: st }; r.net = netPay(r); return r; }; return [
      mk(n[0], 95000, 6000, 12000, 3200, "已發放"), mk(n[1] || n[0], 95000, 4500, 8000, 3000, "已發放"), mk(n[2] || n[0], 95000, 3000, 5000, 2800, "待確認"), mk(n[0], 48000, 5200, 3000, 1500, "未發放")
    ]; })()
  });
  function netPay(r) { return (Number(r.base) || 0) + (Number(r.overtime) || 0) + (Number(r.bonus) || 0) - (Number(r.deduct) || 0); }

  // 財務（連動訂單收入 + 採購支出）
  defineModule({
    name: "finance", title: "財務管理", key: "rokFinance", filterKey: "status", filterLabel: "款項狀態",
    subtitle: "收入連動訂單、支出連動採購；可另記其他收支與發票。",
    columns: [{ k: "id", label: "單據編號" }, { k: "type", label: "類別" }, { k: "subject", label: "摘要" }, { k: "amount", label: "金額", money: true }, { k: "date", label: "日期" }, { k: "invoice", label: "發票號碼" }, { k: "status", label: "款項狀態", badge: true }],
    form: [{ k: "type", label: "類別", type: "select", options: ["收入", "支出"] }, { k: "subject", label: "摘要" }, { k: "amount", label: "金額", type: "number", def: 0 }, { k: "date", label: "日期", type: "date" }, { k: "invoice", label: "發票號碼" }, { k: "status", label: "款項狀態", type: "select", options: ["已付款", "未付款", "逾期付款"] }],
    kpis: function () { var f = financeSummary(); return [{ label: "本月營收", value: money(f.revenue) }, { label: "本月成本", value: money(f.cost) }, { label: "預估利潤", value: money(f.revenue - f.cost), alert: (f.revenue - f.cost) < 0 }]; },
    seed: [
      { _id: uid("fi"), id: "INV-20260612", type: "支出", subject: "稻穀電子材料 採購款", amount: 240000, date: daysAgo(13), invoice: "AB-11220033", status: "逾期付款" },
      { _id: uid("fi"), id: "INV-20260615", type: "收入", subject: "企業團購（30 把鍵盤）", amount: 174000, date: daysAgo(10), invoice: "RK-20260615", status: "已付款" },
      { _id: uid("fi"), id: "INV-20260619", type: "支出", subject: "辦公室租金", amount: 68000, date: daysAgo(6), invoice: "RENT-0626", status: "已付款" },
      { _id: uid("fi"), id: "INV-20260622", type: "收入", subject: "經銷商鋪貨", amount: 96000, date: daysAgo(3), invoice: "RK-20260622", status: "未付款" }
    ]
  });
  function financeSummary() {
    var m = ym();
    var orderRev = getOrders().filter(function (o) { return orderDate(o).slice(0, 7) === m; }).reduce(function (s, o) { return s + orderAmount(o); }, 0);
    var fin = load("rokFinance", []) || [];
    var extraRev = fin.filter(function (r) { return r.type === "收入" && String(r.date).slice(0, 7) === m; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    var purch = (load("rokPurchases", []) || []).filter(function (p) { return String(p.applyDate).slice(0, 7) === m; }).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var extraCost = fin.filter(function (r) { return r.type === "支出" && String(r.date).slice(0, 7) === m; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    return { revenue: orderRev + extraRev, cost: purch + extraCost };
  }

  // 文件／合約
  defineModule({
    name: "documents", title: "文件／合約管理", key: "rokDocuments", filterKey: "type", filterLabel: "文件類型",
    columns: [{ k: "name", label: "文件名稱" }, { k: "type", label: "文件類型" }, { k: "relate", label: "關聯對象" }, { k: "uploadDate", label: "上傳日期" }, { k: "expireDate", label: "到期日期" }, { k: "owner", label: "負責人" }, { k: "status", label: "文件狀態", badge: true }],
    form: [{ k: "name", label: "文件名稱" }, { k: "type", label: "文件類型", type: "select", options: ["供應商合約", "員工文件", "採購文件", "財務文件", "出貨文件"] }, { k: "relate", label: "關聯對象" }, { k: "uploadDate", label: "上傳日期", type: "date" }, { k: "expireDate", label: "到期日期", type: "date" }, { k: "owner", label: "負責人" }, { k: "status", label: "文件狀態", type: "select", options: ["有效", "即將到期", "已過期", "待更新"] }],
    kpis: function (rows) { return [{ label: "文件總數", value: fmt(rows.length) }, { label: "即將到期", value: fmt(rows.filter(function (r) { return r.status === "即將到期"; }).length), alert: true }, { label: "已過期", value: fmt(rows.filter(function (r) { return r.status === "已過期"; }).length), alert: true }]; },
    seed: [
      { _id: uid("doc"), name: "軸心精密 供貨合約 2026", type: "供應商合約", relate: "軸心精密工業", uploadDate: daysAgo(120), expireDate: daysAgo(-200), owner: "周明達", status: "有效" },
      { _id: uid("doc"), name: "鍵帽王 NDA", type: "供應商合約", relate: "鍵帽王 KeycapKing", uploadDate: daysAgo(90), expireDate: daysAgo(20), owner: "李宛蓁", status: "已過期" },
      { _id: uid("doc"), name: "員工勞動契約（李意新）", type: "員工文件", relate: "李意新", uploadDate: daysAgo(170), expireDate: daysAgo(-10), owner: "人資部", status: "即將到期" },
      { _id: uid("doc"), name: "Q2 採購總表", type: "採購文件", relate: "採購部", uploadDate: daysAgo(15), expireDate: "", owner: "蘇郁翔", status: "有效" },
      { _id: uid("doc"), name: "稻穀電子 對帳單", type: "財務文件", relate: "稻穀電子材料", uploadDate: daysAgo(7), expireDate: daysAgo(-3), owner: "財務部", status: "待更新" }
    ]
  });

  // ====================================================================
  // 庫存警示／倉儲（讀現有 rokInventory，疊加安全庫存門檻；不另做一套庫存）
  // ====================================================================
  var WAREHOUSES = ["A 區-1", "A 區-2", "B 區-1", "B 區-2", "C 區-1"];
  function renderStockAlert() {
    var panel = document.querySelector('[data-panel="stock-alert"]'); if (!panel) return;
    var inv = getInventory();
    var th = thresholds();
    var rows = inv.map(function (r, i) {
      var key = r.key || (r.productName + "|" + r.color + "|" + r.switchName);
      var thv = th[key] != null ? Number(th[key]) : 200;
      return { key: key, name: r.productName, color: r.color, sw: r.switchName, stock: Number(r.stock) || 0, sold: Number(r.sold) || 0, th: thv, wh: WAREHOUSES[i % WAREHOUSES.length], state: stockState(r.stock, thv) };
    });
    var low = rows.filter(function (r) { return r.state === "偏低" || r.state === "缺貨"; }).length;
    var q = (renderStockAlert._q || "").toLowerCase(), fil = renderStockAlert._f || "";
    var visible = rows.filter(function (r) { var t = (r.name + r.color + r.sw + r.wh).toLowerCase(); return (!q || t.indexOf(q) >= 0) && (!fil || r.state === fil); });
    var body = visible.length ? visible.map(function (r) {
      return "<tr>" + "<td>" + esc(r.name) + "</td><td>" + esc(r.color) + "</td><td>" + esc(r.sw) + "</td>" +
        '<td class="sys-num">' + fmt(r.stock) + '</td><td class="sys-num">' + fmt(r.th) + "</td><td>" + esc(r.wh) + "</td>" +
        '<td class="sys-num">' + fmt(r.sold) + "</td>" +
        "<td>" + badge(r.state) + (r.state === "偏低" || r.state === "缺貨" ? ' <span class="tag danger">低庫存警示</span>' : "") + "</td>" +
        '<td class="erp-ops"><button class="btn ghost tiny" data-th="' + esc(r.key) + '" data-cur="' + r.th + '">調整安全庫存</button></td></tr>';
    }).join("") : '<tr><td colspan="9"><div class="sys-empty">沒有符合條件的庫存。</div></td></tr>';
    panel.innerHTML =
      '<div class="erp-page-head"><h2>庫存警示／倉儲</h2><p class="erp-sub">直接讀取現有 rokInventory，疊加安全庫存門檻與警示（不另建庫存）。</p></div>' +
      '<div class="sys-summary erp-kpi">' + kpiCard("SKU 總數", fmt(rows.length)) + kpiCard("低庫存／缺貨", fmt(low), low > 0) + kpiCard("缺貨 SKU", fmt(rows.filter(function (r) { return r.state === "缺貨"; }).length), true) + "</div>" +
      '<div class="sys-toolbar"><label class="grow">搜尋<input type="search" data-sa-search placeholder="產品、顏色、軸體、倉位"></label>' +
        '<label class="grow">狀態篩選<select data-sa-filter><option value="">全部</option><option>正常</option><option>偏低</option><option>缺貨</option><option>庫存過高</option></select></label>' +
        '<span class="spacer"></span></div>' +
      '<div class="sys-table-wrap"><table class="sys-table"><thead><tr><th>商品名稱</th><th>顏色</th><th>軸體/規格</th><th>目前庫存</th><th>安全庫存</th><th>倉庫位置</th><th>已出庫</th><th>庫存狀態</th><th>操作</th></tr></thead><tbody>' + body + "</tbody></table></div>";
    var s = $("[data-sa-search]", panel); if (s) { s.value = renderStockAlert._q || ""; s.oninput = function () { renderStockAlert._q = s.value; var p = s.selectionStart; renderStockAlert(); var s2 = $("[data-sa-search]"); if (s2) { s2.focus(); try { s2.setSelectionRange(p, p); } catch (e) {} } }; }
    var f = $("[data-sa-filter]", panel); if (f) { f.value = renderStockAlert._f || ""; f.onchange = function () { renderStockAlert._f = f.value; renderStockAlert(); }; }
    $$("[data-th]", panel).forEach(function (b) {
      b.onclick = function () {
        erpForm("調整安全庫存", [{ k: "th", label: "安全庫存門檻", type: "number", def: b.getAttribute("data-cur") }], { th: b.getAttribute("data-cur") }, function (d) {
          var t = thresholds(); t[b.getAttribute("data-th")] = Number(d.th) || 0; save("rokStockThreshold", t); renderStockAlert(); refreshDashboard(); toast("已更新安全庫存", "ok");
        });
      };
    });
  }
  MODULES["stock-alert"] = { render: renderStockAlert };

  // ====================================================================
  // 報表分析（彙總 + 匯出按鈕外觀；匯出僅提示，不實作）
  // ====================================================================
  function renderReports() {
    var panel = document.querySelector('[data-panel="reports"]'); if (!panel) return;
    var reps = ["銷售報表", "庫存報表", "進貨報表", "出貨報表", "出勤報表", "財務報表", "熱銷商品排行", "月營收趨勢"];
    panel.innerHTML = '<div class="erp-page-head"><h2>報表分析</h2><p class="erp-sub">各類營運報表彙總與匯出（匯出按鈕為示意）。</p></div>' +
      '<div class="erp-report-grid">' + reps.map(function (name) {
        return '<div class="erp-report-card"><h3>' + esc(name) + "</h3><p class=\"erp-sub\">期間：" + ym() + "　・　資料來源：營運系統彙總</p>" +
          '<div class="erp-report-actions"><button class="btn excel tiny" data-rep-x>匯出 Excel</button><button class="btn ghost tiny" data-rep-p>匯出 PDF</button></div></div>';
      }).join("") + "</div>";
    $$("[data-rep-x],[data-rep-p]", panel).forEach(function (b) { b.onclick = function () { toast("報表匯出為示意功能，尚未串接", "warn"); }; });
  }
  MODULES["reports"] = { render: renderReports };

  // ====================================================================
  // 營運儀表板（即時從現有 + 新資料計算）
  // ====================================================================
  function renderDashboard() {
    var panel = document.querySelector('[data-panel="dashboard"]'); if (!panel) return;
    var orders = getOrders(), inv = getInventory();
    var today = ymd(), m = ym();
    var todayOrders = orders.filter(function (o) { return orderDate(o) === today; }).length;
    var monthRev = orders.filter(function (o) { return orderDate(o).slice(0, 7) === m; }).reduce(function (s, o) { return s + orderAmount(o); }, 0);
    var ships = load("rokShipments", []) || [];
    var pending = ships.filter(function (s) { return s.status === "待出貨"; }).length;
    var low = lowStockCount();
    var purch = (load("rokPurchases", []) || []).filter(function (p) { return String(p.applyDate).slice(0, 7) === m; }).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var att = (load("rokAttendance", []) || []).filter(function (a) { return a.date === today; });
    var present = att.filter(function (a) { return a.status === "出勤"; }).length;
    var onleave = att.filter(function (a) { return a.status === "請假"; }).length;

    // 熱銷商品（彙總訂單品項數量；無資料則用庫存已售出）
    var sales = {};
    orders.forEach(function (o) { orderItems(o).forEach(function (it) { var nm = it.productName || it.name || it.product || "商品"; sales[nm] = (sales[nm] || 0) + (Number(it.qty || it.quantity || 1) || 1); }); });
    if (!Object.keys(sales).length) { inv.forEach(function (r) { if (r.sold) sales[r.productName] = (sales[r.productName] || 0) + Number(r.sold); }); }
    var top = Object.keys(sales).map(function (k) { return { name: k, qty: sales[k] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    if (!top.length) top = PRODUCTS.map(function (p, i) { return { name: p, qty: [128, 96, 73, 51][i] || 40 }; });
    var maxQ = Math.max.apply(null, top.map(function (t) { return t.qty; })) || 1;

    // 月營收趨勢（近 6 月；當月用實算，其餘示意）
    var trend = [];
    for (var i = 5; i >= 0; i--) { var mm = monthsAgo(i); var rev = orders.filter(function (o) { return orderDate(o).slice(0, 7) === mm; }).reduce(function (s, o) { return s + orderAmount(o); }, 0); trend.push({ m: mm.slice(5) + "月", rev: rev }); }
    if (trend.every(function (t) { return !t.rev; })) { var base = [820000, 910000, 1050000, 980000, 1180000, Math.max(monthRev, 1240000)]; trend.forEach(function (t, i) { t.rev = base[i]; }); }
    else { trend[trend.length - 1].rev = Math.max(trend[trend.length - 1].rev, monthRev); }
    var maxR = Math.max.apply(null, trend.map(function (t) { return t.rev; })) || 1;

    var recentShip = ships.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 5);

    panel.innerHTML =
      '<div class="erp-page-head"><h2>營運儀表板</h2><p class="erp-sub">即時彙總自訂單、庫存、出貨、採購、出勤等模組資料。</p></div>' +
      '<div class="sys-summary erp-kpi erp-kpi-6">' +
        kpiCard("今日訂單數", fmt(todayOrders)) + kpiCard("本月營收", money(monthRev)) +
        kpiCard("待出貨訂單", fmt(pending), pending > 0) + kpiCard("低庫存商品", fmt(low), low > 0) +
        kpiCard("本月進貨金額", money(purch)) + kpiCard("今日出勤/請假", present + " / " + onleave) +
      "</div>" +
      '<div class="erp-dash-grid">' +
        '<div class="erp-card"><h3>熱銷商品排行（Top 5）</h3>' + top.map(function (t) {
          return '<div class="erp-bar-row"><span class="erp-bar-label">' + esc(t.name) + '</span><span class="erp-bar"><i style="width:' + Math.round(t.qty / maxQ * 100) + '%"></i></span><span class="erp-bar-val">' + fmt(t.qty) + "</span></div>";
        }).join("") + "</div>" +
        '<div class="erp-card"><h3>月營收趨勢（近 6 月）</h3><div class="erp-trend">' + trend.map(function (t) {
          return '<div class="erp-trend-col"><span class="erp-trend-bar" style="height:' + Math.round(t.rev / maxR * 100) + '%" title="' + money(t.rev) + '"></span><span class="erp-trend-x">' + esc(t.m) + "</span></div>";
        }).join("") + "</div></div>" +
        '<div class="erp-card erp-card-wide"><h3>最近物流狀態</h3>' +
          (recentShip.length ? '<table class="sys-table"><thead><tr><th>出貨單號</th><th>訂單</th><th>收件人</th><th>狀態</th><th>日期</th></tr></thead><tbody>' +
            recentShip.map(function (s) { return "<tr><td>" + esc(s.id) + "</td><td>" + esc(s.orderNo) + "</td><td>" + esc(s.receiver) + "</td><td>" + badge(s.status) + "</td><td>" + esc(s.date) + "</td></tr>"; }).join("") + "</tbody></table>" : '<div class="sys-empty">尚無出貨資料。</div>') +
        "</div>" +
      "</div>";
  }
  MODULES["dashboard"] = { render: renderDashboard };
  function refreshDashboard() { if (document.querySelector('[data-panel="dashboard"]') && !document.querySelector('[data-panel="dashboard"]').hidden) renderDashboard(); }

  // ====================================================================
  // 導覽：側邊欄（既有 3 模組透過隱藏 .sys-tab 觸發 system.js 的 render）
  // ====================================================================
  var EXISTING = { orders: 1, inventory: 1, employees: 1 };
  function navTo(name) {
    $$("[data-nav]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-nav") === name); });
    if (EXISTING[name]) {
      var tab = document.querySelector('.sys-tab[data-tab="' + name + '"]');
      if (tab) tab.click(); // system.js：切換面板 + 重繪庫存/人事
    } else {
      $$(".sys-panel").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (MODULES[name]) MODULES[name].render();
    }
    var layout = document.querySelector(".erp-layout"); if (layout) layout.classList.remove("nav-open");
    try { localStorage.setItem("rokErpLastNav", name); } catch (e) {}
  }

  function setupNav() {
    $$("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { navTo(b.getAttribute("data-nav")); }); });
    // 群組收合
    $$(".erp-group-title").forEach(function (t) { t.addEventListener("click", function () { t.parentElement.classList.toggle("collapsed"); }); });
    // 漢堡選單
    var burger = $("[data-erp-burger]"); var layout = document.querySelector(".erp-layout");
    if (burger && layout) burger.addEventListener("click", function () { layout.classList.toggle("nav-open"); });
    // 點主內容區關閉手機側邊欄
    var main = document.querySelector(".erp-main"); if (main && layout) main.addEventListener("click", function () { if (layout.classList.contains("nav-open")) layout.classList.remove("nav-open"); });
  }

  // ERP modal 關閉/送出 委派
  function setupModals() {
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-erp-close]")) { var m = $("[data-erp-modal]"); if (m) m.hidden = true; }
      if (e.target.closest("[data-erpc-close]")) { var c = $("[data-erp-confirm]"); if (c) c.hidden = true; confirmOk = null; }
      if (e.target.closest("[data-erpc-ok]")) { var fn = confirmOk; var c2 = $("[data-erp-confirm]"); if (c2) c2.hidden = true; confirmOk = null; if (fn) fn(); }
    });
    var form = $("[data-erp-form]"); if (form) form.addEventListener("submit", function (e) { e.preventDefault(); var fn = formSubmit; var m = $("[data-erp-modal]"); if (m) m.hidden = true; if (fn) fn(); });
  }

  // 供應商下拉、員工下拉：開窗前動態填入（連動主檔）
  function refreshDynamicOptions() {
    // purchases 的供應商選項
    var sup = (load("rokSuppliers", []) || []).map(function (s) { return s.name; });
    // 直接在 defineModule 的 form options 上更新（透過全域查找）
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".erp-sidebar")) return;
    // 動態把供應商/員工選項塞進對應模組 form（在 openForm 時即時抓最新，因此改成 render 時更新）
    setupNav();
    setupModals();
    // 預設首頁：儀表板（或上次所在）
    var last = "dashboard"; try { last = localStorage.getItem("rokErpLastNav") || "dashboard"; } catch (e) {}
    if (!document.querySelector('[data-panel="' + last + '"]')) last = "dashboard";
    // 等 system.js 初始化後再切到 dashboard
    setTimeout(function () { navTo(last); }, 0);
  });

  // 讓 purchases 供應商下拉 / HR 員工下拉在開窗時帶最新資料：覆寫 form options 取得方式
  // （openForm 會即時讀 cfg.form；這裡在每次 render 後同步最新選項）
  var origDefine = null; // 已於上面 defineModule 完成；以下用事件補：開窗前刷新 options
  document.addEventListener("click", function (e) {
    var addBtn = e.target.closest("[data-erp-add]"); var editBtn = e.target.closest("[data-edit]");
    if (!addBtn && !editBtn) return;
    var panel = e.target.closest(".sys-panel"); if (!panel) return;
    var name = panel.dataset.panel;
    // 動態選項：供應商、員工
    if (name === "purchases" && MODULES.purchases) { /* options 由下方統一處理 */ }
  }, true);

  // 用 getter 讓 select 永遠拿到最新供應商/員工（覆寫各模組 form 內 options）
  function liveOptions() {
    var supName = (load("rokSuppliers", []) || []).map(function (s) { return s.name; });
    var emps = empNames();
    // purchases.supplier
    var pf = MODULES.purchases; // form 在 cfg 內，無法直接拿；改在 erpForm 前用 hook
    return { suppliers: supName, employees: emps };
  }

  // 在 erpForm 顯示前，動態替換 select options（供應商 / 員工姓名）
  var _erpForm = erpForm;
  erpForm = function (title, fields, rec, onSubmit) {
    var opt = liveOptions();
    fields = fields.map(function (f) {
      if (f.k === "supplier") return Object.assign({}, f, { options: opt.suppliers.length ? opt.suppliers : ["（尚無供應商）"] });
      if (f.k === "name" && (title.indexOf("出勤") >= 0 || title.indexOf("請假") >= 0 || title.indexOf("薪資") >= 0)) return Object.assign({}, f, { options: opt.employees });
      return f;
    });
    _erpForm(title, fields, rec, onSubmit);
  };
})();
