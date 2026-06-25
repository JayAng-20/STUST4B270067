// ============================================================
// ROK 企業 ERP 擴充模組（system.html 專用）— 改版 20260625
// 原則：擴充 + 連動，沿用現有三大模組（訂單/庫存/人事）與其 localStorage 結構。
//   - 現有鍵連動：rokOrders / rokInventory / rokEmployees
//   - 供應商為主檔（固定 15 家）：rokSuppliers
//   - 採購（可新增，供應商/品項下拉連動）：rokPurchases
//   - 出勤 / 請假 / 薪資：rokAttendance / rokLeaves / rokPayroll（預設皆空）
//   - 出貨／物流、財務：不另存資料，直接「衍生自訂單」（rokOrders）
// 配色：淺色系（深色僅保留頂部標題列），CSS 於 system.html。
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
  function usd(n) { return fmt(Math.round(Number(n) || 0)) + " USD"; } // 數字 + 一個空白 + USD（保留千分位）
  function load(key, fb) { try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function del(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function seed(key, data) { if (localStorage.getItem(key) == null) save(key, data); return load(key, data); }
  function uid(p) { return (p || "id") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ym(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
  function monthsAgo(n) { var d = new Date(); d.setMonth(d.getMonth() - n); return ym(d); }

  // ---------- Toast ----------
  function toast(msg, kind) {
    var w = $("[data-toast-wrap]"); if (!w) return;
    var e = document.createElement("div"); e.className = "sys-toast" + (kind ? " " + kind : ""); e.textContent = msg;
    w.appendChild(e);
    setTimeout(function () { e.style.transition = "opacity .3s,transform .3s"; e.style.opacity = "0"; e.style.transform = "translateY(8px)"; setTimeout(function () { e.remove(); }, 300); }, 2600);
  }

  // ---------- 狀態標籤配色 ----------
  var BADGE = {
    "新訂單": "info", "處理中": "warn", "已出貨": "info", "已完成": "ok", "已取消": "danger",
    "待出貨": "warn", "配送中": "info", "已送達": "ok", "退貨處理中": "danger",
    "正常": "ok", "偏低": "warn", "缺貨": "danger", "庫存過高": "info",
    "合作中": "ok", "暫停": "warn", "已終止": "danger",
    "已付款": "ok", "未付款": "warn", "逾期": "danger", "逾期付款": "danger",
    "草稿": "info", "待審核": "warn", "已核准": "ok", "已下單": "info", "已到貨": "ok",
    "已拒絕": "danger", "出勤": "ok", "遲到": "warn", "早退": "warn", "請假": "info", "缺勤": "danger",
    "已發放": "ok", "未發放": "warn", "待確認": "warn", "收入": "ok", "支出": "danger"
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
  function orderQty(o) { return orderItems(o).reduce(function (s, it) { return s + (Number(it.quantity || it.qty || 1) || 1); }, 0); }
  function orderProducts(o) { return orderItems(o).map(function (it) { return (it.name || it.productName || it.product || "商品") + " ×" + (Number(it.quantity || it.qty || 1) || 1); }).join("、"); }

  // ====================================================================
  // 供應商主檔（固定 15 家）+ 資料遷移（讓既有使用者也能更新）
  // ====================================================================
  var SUPPLIER_DATA = [
    { name: "櫻軸精密電子有限公司", contact: "001", phone: "0900000010", email: "Rok001@gmail.com", items: "機械軸、靜音軸、熱插拔軸座" },
    { name: "曜鍵鍵帽製造股份有限公司", contact: "002", phone: "0900000011", email: "Rok002@gmail.com", items: "PBT鍵帽、ABS鍵帽、雙色成形鍵帽、客製鍵帽" },
    { name: "迅板電子科技有限公司", contact: "003", phone: "0900000012", email: "Rok003@gmail.com", items: "鍵盤PCB板、熱插拔PCB、RGB燈板、控制電路板" },
    { name: "晶控微電子有限公司", contact: "004", phone: "0900000013", email: "Rok004@gmail.com", items: "MCU控制晶片、藍牙模組、USB控制晶片、無線接收模組" },
    { name: "光河LED材料有限公司", contact: "005", phone: "0900000014", email: "Rok005@gmail.com", items: "RGB LED燈珠、指示燈、導光片、背光模組" },
    { name: "穩鍵平衡器工業有限公司", contact: "006", phone: "0900000015", email: "Rok006@gmail.com", items: "衛星軸、平衡桿、空白鍵穩定器、大鍵位配件" },
    { name: "鋁匠金屬加工有限公司", contact: "007", phone: "0900000016", email: "Rok007@gmail.com", items: "鋁合金鍵盤外殼、CNC上蓋、金屬定位板、金屬旋鈕" },
    { name: "塑源射出成型有限公司", contact: "008", phone: "0900000017", email: "Rok008@gmail.com", items: "塑膠鍵盤外殼、底殼、腳架、塑膠定位板" },
    { name: "柔聲泡棉材料有限公司", contact: "009", phone: "0900000018", email: "Rok009@gmail.com", items: "吸音棉、底部泡棉、軸下墊、Poron墊片、矽膠墊" },
    { name: "線藝連接器有限公司", contact: "010", phone: "0900000019", email: "Rok010@gmail.com", items: "USB-C傳輸線、連接器、排線、客製編織線" },
    { name: "電芯能源科技有限公司", contact: "011", phone: "0900000020", email: "Rok011@gmail.com", items: "鋰電池、充電保護板、無線鍵盤電源模組" },
    { name: "膜界包裝設計有限公司", contact: "012", phone: "0900000021", email: "Rok012@gmail.com", items: "彩盒、內襯、保護袋、說明書、保固卡" },
    { name: "銳印印刷股份有限公司", contact: "013", phone: "0900000022", email: "Rok013@gmail.com", items: "鍵盤外盒印刷、貼紙、品牌卡片、產品標籤" },
    { name: "精準螺絲五金有限公司", contact: "014", phone: "0900000023", email: "Rok014@gmail.com", items: "螺絲、墊片、彈簧、金屬小五金、組裝配件" },
    { name: "鍵合代工製造有限公司", contact: "015", phone: "0900000024", email: "Rok015@gmail.com", items: "鍵盤組裝代工、功能測試、品管檢測、包裝出貨" }
  ];
  function buildSuppliers() {
    return SUPPLIER_DATA.map(function (s) {
      return { _id: uid("sup"), name: s.name, contact: s.contact, phone: s.phone, email: s.email, items: s.items, status: "合作中", lastDate: "2026/06/10", payable: "已付款", note: "" };
    });
  }

  // 把「ERP 衍生/可重置」資料恢復成原始狀態（供「清除所有訂單」連動使用）。
  // 員工(rokEmployees)、庫存(rokInventory)、訂單(rokOrders) 不在此處理。
  function resetErpData() {
    save("rokSuppliers", buildSuppliers());
    save("rokPurchases", []);
    save("rokAttendance", []);
    save("rokLeaves", []);
    save("rokPayroll", []);
    del("rokShipments");      // 出貨改為衍生自訂單，移除舊鍵
    del("rokFinance");        // 財務改為衍生自訂單，移除舊鍵
    del("rokDocuments");      // 文件管理已移除
    del("rokStockThreshold"); // 安全庫存門檻回預設
  }

  // 資料版本遷移：第一次載入此版時，把舊的假資料清乾淨並換成新主檔。
  var ERP_DATA_VERSION = "20260625-1";
  (function migrate() {
    var v = null; try { v = localStorage.getItem("rokErpDataVersion"); } catch (e) {}
    if (v !== ERP_DATA_VERSION) {
      resetErpData();
      try { localStorage.setItem("rokErpDataVersion", ERP_DATA_VERSION); } catch (e) {}
    }
  })();

  // ====================================================================
  // 通用 CRUD 表格模組工廠
  // ====================================================================
  var MODULES = {}; // name -> {render, records}
  function defineModule(cfg) {
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
          if (c.usd) return '<td class="sys-num">' + usd(v) + "</td>";
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
          (cfg.noAdd ? "" : '<button class="btn primary tiny" data-erp-add>＋ 新增</button>') +
        "</div>" +
        '<div class="sys-table-wrap"><table class="sys-table"><thead><tr>' + thead + "</tr></thead><tbody>" + body + "</tbody></table></div>";

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
      var rows = records().map(function (r) { return cfg.columns.map(function (c) { return c.num || c.money || c.usd ? (Number(r[c.k]) || 0) : (r[c.k] == null ? "" : r[c.k]); }); });
      exportExcel("ROK_" + cfg.title + "_" + ym() + ".xlsx", cfg.title, headers, rows);
    }

    MODULES[cfg.name] = { render: render, records: records };
    return MODULES[cfg.name];
  }

  // ====================================================================
  // 通用表單 Modal / 確認 Modal
  // ====================================================================
  var formSubmit = null, confirmOk = null;
  function _erpForm(title, fields, rec, onSubmit) {
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
    return modal;
  }
  function erpConfirm(title, text, onOk) {
    var m = $("[data-erp-confirm]"); if (!m) { if (confirm(text)) onOk(); return; }
    $("[data-erpc-title]", m).textContent = title; $("[data-erpc-text]", m).textContent = text;
    confirmOk = onOk; m.hidden = false;
  }

  // ---------- Excel 匯出 ----------
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
  // 各模組
  // ====================================================================
  var PRODUCTS = ["ROK Summit 100", "ROK Orbit 96", "ROK Strike 80", "ROK Spark 60"];
  var empNames = function () { var e = getEmployees().map(function (x) { return x.name; }).filter(Boolean); return e.length ? e : ["李意新", "蘇郁翔", "鄭家慶"]; };
  var empDept = function (name) { var e = getEmployees().find(function (x) { return x.name === name; }); return e ? e.department || "—" : "—"; };

  // 安全庫存門檻
  function thresholds() { return load("rokStockThreshold", {}) || {}; }
  function thresholdFor(key) { var t = thresholds(); return t[key] != null ? Number(t[key]) : 200; }
  function stockState(stock, th) { stock = Number(stock) || 0; if (stock === 0) return "缺貨"; if (stock < th) return "偏低"; if (stock > th * 50) return "庫存過高"; return "正常"; }
  function lowStockCount() { return getInventory().filter(function (r) { var st = stockState(r.stock, thresholdFor(r.key || (r.productName + r.color + r.switchName))); return st === "偏低" || st === "缺貨"; }).length; }

  // ---------- 供應商（固定 15 家，可編輯）----------
  defineModule({
    name: "suppliers", title: "供應商管理", key: "rokSuppliers", filterKey: "status", filterLabel: "合作狀態",
    subtitle: "公司合作供應商主檔；採購單的供應商與品項即由此連動。",
    columns: [{ k: "name", label: "供應商名稱" }, { k: "contact", label: "聯絡人" }, { k: "phone", label: "電話" }, { k: "email", label: "Email" }, { k: "items", label: "供應品項" }, { k: "status", label: "合作狀態", badge: true }, { k: "lastDate", label: "最近進貨" }, { k: "payable", label: "應付帳款", badge: true }],
    form: [{ k: "name", label: "供應商名稱" }, { k: "contact", label: "聯絡人" }, { k: "phone", label: "電話" }, { k: "email", label: "Email" }, { k: "items", label: "供應品項（以、分隔）", full: true }, { k: "status", label: "合作狀態", type: "select", options: ["合作中", "暫停", "已終止"] }, { k: "lastDate", label: "最近進貨日期", placeholder: "2026/06/10" }, { k: "payable", label: "應付帳款", type: "select", options: ["已付款", "未付款", "逾期"] }, { k: "note", label: "備註", full: true }],
    kpis: function (rows) { return [{ label: "供應商總數", value: fmt(rows.length) }, { label: "合作中", value: fmt(rows.filter(function (r) { return r.status === "合作中"; }).length) }, { label: "應付未結", value: fmt(rows.filter(function (r) { return r.payable !== "已付款"; }).length), alert: true }]; },
    seed: buildSuppliers()
  });

  // ---------- 採購（供應商 + 品項皆下拉連動供應商主檔）----------
  defineModule({
    name: "purchases", title: "採購管理", key: "rokPurchases", filterKey: "status", filterLabel: "採購狀態",
    subtitle: "新增時請先選供應商，採購品項會自動帶出該供應商的供應品項。",
    columns: [{ k: "id", label: "採購單號" }, { k: "supplier", label: "供應商" }, { k: "item", label: "採購品項" }, { k: "qty", label: "數量", num: true }, { k: "amount", label: "採購金額", money: true }, { k: "applyDate", label: "申請日期" }, { k: "etaDate", label: "預計到貨" }, { k: "status", label: "採購狀態", badge: true }, { k: "review", label: "審核狀態", badge: true }],
    form: [{ k: "supplier", label: "供應商", type: "select", options: [] }, { k: "item", label: "採購品項", type: "select", options: [] }, { k: "qty", label: "數量", type: "number", def: 100 }, { k: "amount", label: "採購金額", type: "number", def: 0 }, { k: "applyDate", label: "申請日期", type: "date" }, { k: "etaDate", label: "預計到貨日期", type: "date" }, { k: "status", label: "採購狀態", type: "select", options: ["草稿", "待審核", "已核准", "已下單", "已到貨", "已取消"] }, { k: "review", label: "審核狀態", type: "select", options: ["待審核", "已核准", "已拒絕"] }],
    kpis: function (rows) { var m = ym(); var spend = rows.filter(function (r) { return String(r.applyDate).slice(0, 7) === m; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0); return [{ label: "採購單總數", value: fmt(rows.length) }, { label: "待審核", value: fmt(rows.filter(function (r) { return r.review === "待審核"; }).length), alert: true }, { label: "本月進貨金額", value: money(spend) }]; },
    beforeSave: function (d, list) { d.id = "PO-" + ymd().replace(/-/g, "") + "-" + pad((list.length + 1)); },
    seed: []
  });

  // ---------- 出勤（員工取自 rokEmployees；預設空）----------
  defineModule({
    name: "attendance", title: "出勤管理", key: "rokAttendance", filterKey: "status", filterLabel: "出勤狀態",
    subtitle: "員工名單連動人事資料 rokEmployees。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "clockIn", label: "上班打卡" }, { k: "clockOut", label: "下班打卡" }, { k: "status", label: "出勤狀態", badge: true }, { k: "flag", label: "遲到/早退", badge: true }, { k: "date", label: "日期" }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "clockIn", label: "上班打卡", placeholder: "09:00" }, { k: "clockOut", label: "下班打卡", placeholder: "18:00" }, { k: "status", label: "出勤狀態", type: "select", options: ["出勤", "請假", "缺勤"] }, { k: "flag", label: "遲到/早退", type: "select", options: ["正常", "遲到", "早退"] }, { k: "date", label: "日期", type: "date" }],
    kpis: function (rows) { var t = ymd(); var today = rows.filter(function (r) { return r.date === t; }); return [{ label: "今日出勤", value: fmt(today.filter(function (r) { return r.status === "出勤"; }).length) }, { label: "今日請假", value: fmt(today.filter(function (r) { return r.status === "請假"; }).length) }, { label: "本月遲到", value: fmt(rows.filter(function (r) { return r.flag === "遲到"; }).length), alert: true }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); },
    seed: []
  });

  // ---------- 請假（預設空）----------
  defineModule({
    name: "leaves", title: "請假管理", key: "rokLeaves", filterKey: "review", filterLabel: "審核狀態",
    subtitle: "員工名單連動人事資料 rokEmployees。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "type", label: "請假類型" }, { k: "date", label: "請假日期" }, { k: "days", label: "天數", num: true }, { k: "review", label: "審核狀態", badge: true }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "type", label: "請假類型", type: "select", options: ["特休", "病假", "事假", "婚假", "喪假", "公假"] }, { k: "date", label: "請假日期", type: "date" }, { k: "days", label: "天數", type: "number", def: 1 }, { k: "review", label: "審核狀態", type: "select", options: ["待審核", "已核准", "已拒絕"] }],
    kpis: function (rows) { return [{ label: "請假申請", value: fmt(rows.length) }, { label: "待審核", value: fmt(rows.filter(function (r) { return r.review === "待審核"; }).length), alert: true }, { label: "已核准", value: fmt(rows.filter(function (r) { return r.review === "已核准"; }).length) }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); },
    seed: []
  });

  // ---------- 薪資（預設空；數字一律「金額 + 空白 + USD」，保留千分位）----------
  defineModule({
    name: "payroll", title: "薪資管理", key: "rokPayroll", filterKey: "status", filterLabel: "發薪狀態",
    subtitle: "員工名單連動人事資料 rokEmployees；金額皆以千分位顯示並標註 USD。",
    columns: [{ k: "name", label: "員工姓名" }, { k: "dept", label: "部門" }, { k: "base", label: "基本薪資", usd: true }, { k: "overtime", label: "加班費", usd: true }, { k: "bonus", label: "獎金", usd: true }, { k: "deduct", label: "扣款", usd: true }, { k: "net", label: "實領薪資", usd: true }, { k: "month", label: "發薪月份" }, { k: "status", label: "發薪狀態", badge: true }],
    form: [{ k: "name", label: "員工姓名", type: "select", options: [] }, { k: "base", label: "基本薪資", type: "number", def: 45000 }, { k: "overtime", label: "加班費", type: "number", def: 0 }, { k: "bonus", label: "獎金", type: "number", def: 0 }, { k: "deduct", label: "扣款", type: "number", def: 0 }, { k: "month", label: "發薪月份", placeholder: ym() }, { k: "status", label: "發薪狀態", type: "select", options: ["已發放", "未發放", "待確認"] }],
    kpis: function (rows) { var m = ym(); var cur = rows.filter(function (r) { return String(r.month) === m || !r.month; }); var total = cur.reduce(function (s, r) { return s + netPay(r); }, 0); var paid = cur.filter(function (r) { return r.status === "已發放"; }).reduce(function (s, r) { return s + netPay(r); }, 0); return [{ label: "本月薪資總額", value: usd(total) }, { label: "已發放", value: usd(paid) }, { label: "待發放", value: usd(total - paid), alert: (total - paid) > 0 }]; },
    beforeSave: function (d) { d.dept = empDept(d.name); d.net = netPay(d); },
    seed: []
  });
  function netPay(r) { return (Number(r.base) || 0) + (Number(r.overtime) || 0) + (Number(r.bonus) || 0) - (Number(r.deduct) || 0); }

  // ====================================================================
  // 出貨／物流管理（衍生自訂單：只列出狀態為「已出貨」的訂單）
  // ====================================================================
  function renderShipping() {
    var panel = document.querySelector('[data-panel="shipping"]'); if (!panel) return;
    var shipped = getOrders().filter(function (o) { return o.status === "已出貨"; });
    var q = (renderShipping._q || "").toLowerCase();
    var visible = shipped.filter(function (o) {
      var text = (o.id + " " + ((o.customer && o.customer.name) || "") + " " + orderProducts(o)).toLowerCase();
      return !q || text.indexOf(q) >= 0;
    });
    var body = visible.length ? visible.map(function (o) {
      return "<tr><td>" + esc(o.id) + "</td><td>" + esc((o.customer && o.customer.name) || "—") + "</td><td>" + esc(orderProducts(o)) + "</td>" +
        '<td class="sys-num">' + fmt(orderQty(o)) + '</td><td class="sys-num">' + money(orderAmount(o)) + "</td><td>" + esc(orderDate(o)) + "</td><td>" + badge(o.status) + "</td></tr>";
    }).join("") : '<tr><td colspan="7"><div class="sys-empty">目前沒有「已出貨」的訂單。請到「訂單管理」把訂單狀態改為「已出貨」，這裡就會自動出現。</div></td></tr>';

    panel.innerHTML =
      '<div class="erp-page-head"><h2>出貨／物流管理</h2><p class="erp-sub">資料連動訂單管理：訂單狀態設為「已出貨」會自動列在此；改為「已完成」或「已取消」則自動移除。</p></div>' +
      '<div class="sys-summary erp-kpi">' + kpiCard("出貨中訂單", fmt(shipped.length)) + kpiCard("出貨件數", fmt(shipped.reduce(function (s, o) { return s + orderQty(o); }, 0))) + kpiCard("出貨金額", money(shipped.reduce(function (s, o) { return s + orderAmount(o); }, 0))) + "</div>" +
      '<div class="sys-toolbar"><label class="grow">搜尋<input type="search" data-ship-search placeholder="訂單編號、客戶、商品"></label><span class="spacer"></span></div>' +
      '<div class="sys-table-wrap"><table class="sys-table"><thead><tr><th>訂單編號</th><th>客戶</th><th>商品</th><th>數量</th><th>訂單金額</th><th>下單日期</th><th>狀態</th></tr></thead><tbody>' + body + "</tbody></table></div>";

    var s = $("[data-ship-search]", panel); if (s) { s.value = renderShipping._q || ""; s.oninput = function () { renderShipping._q = s.value; var p = s.selectionStart; renderShipping(); var s2 = $("[data-ship-search]"); if (s2) { s2.focus(); try { s2.setSelectionRange(p, p); } catch (e) {} } }; }
  }
  MODULES["shipping"] = { render: renderShipping };

  // ====================================================================
  // 財務管理（衍生自訂單：只要不是「已取消」即認列為收入）
  // ====================================================================
  function renderFinance() {
    var panel = document.querySelector('[data-panel="finance"]'); if (!panel) return;
    var income = getOrders().filter(function (o) { return o.status !== "已取消"; });
    var m = ym();
    var total = income.reduce(function (s, o) { return s + orderAmount(o); }, 0);
    var monthTotal = income.filter(function (o) { return orderDate(o).slice(0, 7) === m; }).reduce(function (s, o) { return s + orderAmount(o); }, 0);
    var q = (renderFinance._q || "").toLowerCase();
    var visible = income.filter(function (o) {
      var text = (o.id + " " + ((o.customer && o.customer.name) || "") + " " + orderProducts(o)).toLowerCase();
      return !q || text.indexOf(q) >= 0;
    }).sort(function (a, b) { return String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)); });
    var body = visible.length ? visible.map(function (o) {
      return "<tr><td>" + esc(o.id) + "</td><td>" + badge("收入") + "</td><td>" + esc((o.customer && o.customer.name) || "線上訂單") + "</td><td>" + esc(orderProducts(o)) + "</td>" +
        '<td class="sys-num">' + money(orderAmount(o)) + "</td><td>" + esc(orderDate(o)) + "</td><td>" + badge(o.status) + "</td></tr>";
    }).join("") : '<tr><td colspan="7"><div class="sys-empty">目前沒有可認列的訂單收入。前台成立訂單（且未取消）後，這裡會自動列出。</div></td></tr>';

    panel.innerHTML =
      '<div class="erp-page-head"><h2>財務管理</h2><p class="erp-sub">資料全部連動訂單管理：除「已取消」外，所有訂單皆認列為收入（自動更新，無需手動新增）。</p></div>' +
      '<div class="sys-summary erp-kpi">' + kpiCard("認列收入筆數", fmt(income.length)) + kpiCard("認列收入總額", money(total)) + kpiCard("本月認列收入", money(monthTotal)) + "</div>" +
      '<div class="sys-toolbar"><label class="grow">搜尋<input type="search" data-fin-search placeholder="訂單編號、客戶、商品"></label><span class="spacer"></span><button class="btn excel tiny" data-fin-export>匯出 Excel</button></div>' +
      '<div class="sys-table-wrap"><table class="sys-table"><thead><tr><th>訂單編號</th><th>類別</th><th>客戶</th><th>商品</th><th>金額</th><th>日期</th><th>訂單狀態</th></tr></thead><tbody>' + body + "</tbody></table></div>";

    var s = $("[data-fin-search]", panel); if (s) { s.value = renderFinance._q || ""; s.oninput = function () { renderFinance._q = s.value; var p = s.selectionStart; renderFinance(); var s2 = $("[data-fin-search]"); if (s2) { s2.focus(); try { s2.setSelectionRange(p, p); } catch (e) {} } }; }
    var ex = $("[data-fin-export]", panel); if (ex) ex.onclick = function () {
      exportExcel("ROK_財務收入_" + ym() + ".xlsx", "財務收入", ["訂單編號", "類別", "客戶", "商品", "金額", "日期", "訂單狀態"],
        income.map(function (o) { return [o.id, "收入", (o.customer && o.customer.name) || "線上訂單", orderProducts(o), orderAmount(o), orderDate(o), o.status]; }));
    };
  }
  MODULES["finance"] = { render: renderFinance };

  // ====================================================================
  // 庫存警示／倉儲（讀現有 rokInventory，疊加安全庫存門檻）
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
  // 營運儀表板（即時從訂單 + 庫存 + 採購 + 出勤計算）
  // ====================================================================
  function renderDashboard() {
    var panel = document.querySelector('[data-panel="dashboard"]'); if (!panel) return;
    var orders = getOrders(), inv = getInventory();
    var today = ymd(), m = ym();
    var todayOrders = orders.filter(function (o) { return orderDate(o) === today; }).length;
    var monthRev = orders.filter(function (o) { return o.status !== "已取消" && orderDate(o).slice(0, 7) === m; }).reduce(function (s, o) { return s + orderAmount(o); }, 0);
    var pending = orders.filter(function (o) { return o.status === "新訂單" || o.status === "處理中"; }).length;
    var shippedOrders = orders.filter(function (o) { return o.status === "已出貨"; });
    var low = lowStockCount();
    var purch = (load("rokPurchases", []) || []).filter(function (p) { return String(p.applyDate).slice(0, 7) === m; }).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var att = (load("rokAttendance", []) || []).filter(function (a) { return a.date === today; });
    var present = att.filter(function (a) { return a.status === "出勤"; }).length;
    var onleave = att.filter(function (a) { return a.status === "請假"; }).length;

    // 熱銷商品
    var sales = {};
    orders.forEach(function (o) { if (o.status === "已取消") return; orderItems(o).forEach(function (it) { var nm = it.name || it.productName || it.product || "商品"; sales[nm] = (sales[nm] || 0) + (Number(it.quantity || it.qty || 1) || 1); }); });
    if (!Object.keys(sales).length) { inv.forEach(function (r) { if (r.sold) sales[r.productName] = (sales[r.productName] || 0) + Number(r.sold); }); }
    var top = Object.keys(sales).map(function (k) { return { name: k, qty: sales[k] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    if (!top.length) top = PRODUCTS.map(function (p, i) { return { name: p, qty: [128, 96, 73, 51][i] || 40 }; });
    var maxQ = Math.max.apply(null, top.map(function (t) { return t.qty; })) || 1;

    // 月營收趨勢（近 6 月）
    var trend = [];
    for (var i = 5; i >= 0; i--) { var mm = monthsAgo(i); var rev = orders.filter(function (o) { return o.status !== "已取消" && orderDate(o).slice(0, 7) === mm; }).reduce(function (s, o) { return s + orderAmount(o); }, 0); trend.push({ m: mm.slice(5) + "月", rev: rev }); }
    if (trend.every(function (t) { return !t.rev; })) { var base = [820000, 910000, 1050000, 980000, 1180000, Math.max(monthRev, 1240000)]; trend.forEach(function (t, i) { t.rev = base[i]; }); }
    else { trend[trend.length - 1].rev = Math.max(trend[trend.length - 1].rev, monthRev); }
    var maxR = Math.max.apply(null, trend.map(function (t) { return t.rev; })) || 1;

    var recentShip = shippedOrders.slice().sort(function (a, b) { return String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)); }).slice(0, 5);

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
        '<div class="erp-card erp-card-wide"><h3>最近出貨狀態</h3>' +
          (recentShip.length ? '<table class="sys-table"><thead><tr><th>訂單編號</th><th>客戶</th><th>商品</th><th>狀態</th><th>下單日期</th></tr></thead><tbody>' +
            recentShip.map(function (o) { return "<tr><td>" + esc(o.id) + "</td><td>" + esc((o.customer && o.customer.name) || "—") + "</td><td>" + esc(orderProducts(o)) + "</td><td>" + badge(o.status) + "</td><td>" + esc(orderDate(o)) + "</td></tr>"; }).join("") + "</tbody></table>" : '<div class="sys-empty">目前沒有「已出貨」的訂單。</div>') +
        "</div>" +
      "</div>";
  }
  MODULES["dashboard"] = { render: renderDashboard };
  function refreshDashboard() { var d = document.querySelector('[data-panel="dashboard"]'); if (d && !d.hidden) renderDashboard(); }

  // ====================================================================
  // 導覽
  // ====================================================================
  var EXISTING = { orders: 1, inventory: 1, employees: 1 };
  function navTo(name) {
    $$("[data-nav]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-nav") === name); });
    if (EXISTING[name]) {
      var tab = document.querySelector('.sys-tab[data-tab="' + name + '"]');
      if (tab) tab.click();
    } else {
      $$(".sys-panel").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (MODULES[name]) MODULES[name].render();
    }
    var layout = document.querySelector(".erp-layout"); if (layout) layout.classList.remove("nav-open");
    try { localStorage.setItem("rokErpLastNav", name); } catch (e) {}
  }

  function setupNav() {
    $$("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { navTo(b.getAttribute("data-nav")); }); });
    $$(".erp-group-title").forEach(function (t) { t.addEventListener("click", function () { t.parentElement.classList.toggle("collapsed"); }); });
    var burger = $("[data-erp-burger]"); var layout = document.querySelector(".erp-layout");
    if (burger && layout) burger.addEventListener("click", function () { layout.classList.toggle("nav-open"); });
    var main = document.querySelector(".erp-main"); if (main && layout) main.addEventListener("click", function () { if (layout.classList.contains("nav-open")) layout.classList.remove("nav-open"); });
  }

  function setupModals() {
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-erp-close]")) { var m = $("[data-erp-modal]"); if (m) m.hidden = true; }
      if (e.target.closest("[data-erpc-close]")) { var c = $("[data-erp-confirm]"); if (c) c.hidden = true; confirmOk = null; }
      if (e.target.closest("[data-erpc-ok]")) { var fn = confirmOk; var c2 = $("[data-erp-confirm]"); if (c2) c2.hidden = true; confirmOk = null; if (fn) fn(); }
    });
    var form = $("[data-erp-form]"); if (form) form.addEventListener("submit", function (e) { e.preventDefault(); var fn = formSubmit; var m = $("[data-erp-modal]"); if (m) m.hidden = true; if (fn) fn(); });
  }

  // ---------- 供應商品項清單工具 ----------
  function supplierItems(name) {
    var sup = (load("rokSuppliers", []) || []).find(function (s) { return s.name === name; });
    return sup ? String(sup.items || "").split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
  }

  // 在 erpForm 顯示前，動態替換 select options（供應商 / 員工 / 採購品項），並為採購做「供應商→品項」連動。
  function erpForm(title, fields, rec, onSubmit) {
    var supName = (load("rokSuppliers", []) || []).map(function (s) { return s.name; });
    var emps = empNames();
    var isPurchase = title.indexOf("採購") >= 0;
    var curSup = (rec && rec.supplier) || supName[0] || "";
    fields = fields.map(function (f) {
      if (f.k === "supplier") return Object.assign({}, f, { options: supName.length ? supName : ["（尚無供應商）"] });
      if (f.k === "item" && isPurchase) { var its = supplierItems(curSup); return Object.assign({}, f, { type: "select", options: its.length ? its : ["（請先選擇供應商）"] }); }
      if (f.k === "name" && (title.indexOf("出勤") >= 0 || title.indexOf("請假") >= 0 || title.indexOf("薪資") >= 0)) return Object.assign({}, f, { options: emps });
      return f;
    });
    var modal = _erpForm(title, fields, rec, onSubmit);
    // 採購：選供應商→自動帶出該供應商品項
    if (isPurchase && modal) {
      var supSel = modal.querySelector('[data-f="supplier"]');
      var itemSel = modal.querySelector('[data-f="item"]');
      if (supSel && itemSel) {
        supSel.addEventListener("change", function () {
          var its = supplierItems(supSel.value);
          itemSel.innerHTML = (its.length ? its : ["（此供應商尚無品項）"]).map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("");
        });
      }
    }
  }

  // ---------- 對外：讓 app.js 在訂單變動後刷新衍生面板 ----------
  function refreshVisible() {
    var active = document.querySelector('.sys-panel:not([hidden])');
    if (!active) return;
    var name = active.dataset.panel;
    if (MODULES[name] && MODULES[name].render) MODULES[name].render();
  }
  window.ROKErp = {
    refresh: refreshVisible,
    resetAll: function () { resetErpData(); refreshVisible(); }
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".erp-sidebar")) return;
    setupNav();
    setupModals();
    // 跨分頁：訂單／庫存變動時刷新目前衍生面板
    window.addEventListener("storage", function (e) {
      if (e.key === "rokOrders" || e.key === "rokInventory" || e.key === null) refreshVisible();
    });
    var last = "dashboard"; try { last = localStorage.getItem("rokErpLastNav") || "dashboard"; } catch (e) {}
    if (!document.querySelector('[data-panel="' + last + '"]')) last = "dashboard";
    setTimeout(function () { navTo(last); }, 0);
  });
})();
