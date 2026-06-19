// ============================================================
// ROK 後台管理系統 system.html 專用：庫存（rokInventory）與人事（rokEmployees）模組
// 訂單管理沿用 app.js 既有邏輯；庫存資料層由 app.js 的 window.ROKInventory 提供。
// 四個 key 完全分開：rokOrders / rokInventory / rokEmployees / rokGameHighScore。
// ============================================================
(function () {
  "use strict";

  // ---------- 共用小工具 ----------
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
  }
  // 估算字串顯示寬度（中日韓全形字算 2），給 Excel 欄寬自動調整用。
  function displayWidth(value) {
    const text = value == null ? "" : String(value);
    let width = 0;
    for (const ch of text) width += ch.charCodeAt(0) > 255 ? 2 : 1;
    return width;
  }
  function exportTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function summaryCard(label, value, alert) {
    return "<article><span>" + escapeHtml(label) + "</span><strong" + (alert ? ' class="alert"' : "") + ">" + escapeHtml(value) + "</strong></article>";
  }

  // ---------- 樣式化 Toast（取代瀏覽器原生 alert）----------
  function showToast(message, kind) {
    const wrap = document.querySelector("[data-toast-wrap]");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "sys-toast" + (kind ? " " + kind : "");
    el.textContent = message;
    wrap.appendChild(el);
    window.setTimeout(() => {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      window.setTimeout(() => el.remove(), 300);
    }, 2800);
  }

  // ---------- 通用 Modal 開關 ----------
  function openModal(name) { const m = document.querySelector("[data-modal-" + name + "]"); if (m) m.hidden = false; }
  function closeModal(name) { const m = document.querySelector("[data-modal-" + name + "]"); if (m) m.hidden = true; }

  // ---------- 通用確認視窗 ----------
  let confirmHandler = null;
  function openConfirm(opts) {
    const modal = document.querySelector("[data-modal-confirm]");
    if (!modal) return;
    modal.querySelector("[data-confirm-title]").textContent = opts.title || "確認";
    modal.querySelector("[data-confirm-text]").textContent = opts.text || "";
    const okBtn = modal.querySelector("[data-confirm-ok]");
    okBtn.textContent = opts.okLabel || "確定";
    okBtn.className = "btn " + (opts.okClass || "danger");
    confirmHandler = typeof opts.onOk === "function" ? opts.onOk : null;
    modal.hidden = false;
  }
  function closeConfirm() {
    const modal = document.querySelector("[data-modal-confirm]");
    if (modal) modal.hidden = true;
    confirmHandler = null;
  }

  // ---------- Excel 匯出（與訂單匯出同一套 SheetJS / XLSX）----------
  function exportSheet(filename, sheetName, headers, rows, numberCols) {
    if (typeof XLSX === "undefined") { showToast("Excel 函式庫尚未載入完成，請稍候再試", "warn"); return; }
    try {
      const aoa = [headers].concat(rows);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // 欄寬自動調整（中文算 2 個寬度），上限 46。
      ws["!cols"] = headers.map((header, c) => {
        let max = displayWidth(header);
        aoa.forEach((row) => { max = Math.max(max, displayWidth(row[c])); });
        return { wch: Math.min(max + 2, 46) };
      });
      // 標題列：粗體、白字、深底、置中。
      const headerStyle = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, fill: { fgColor: { rgb: "171A20" } }, alignment: { horizontal: "center", vertical: "center" } };
      headers.forEach((_, c) => { const a = XLSX.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = headerStyle; });
      // 數字欄套千分位格式。
      (numberCols || []).forEach((c) => {
        for (let r = 1; r < aoa.length; r += 1) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && typeof cell.v === "number") cell.z = "#,##0";
        }
      });
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename);
      showToast("匯出完成：" + filename, "ok");
    } catch (error) {
      showToast("匯出失敗，請稍後再試", "warn");
    }
  }

  // ========================================================
  // 分頁切換
  // ========================================================
  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll(".sys-tab"));
    const panels = Array.from(document.querySelectorAll(".sys-panel"));
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
        panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
        if (name === "inventory") renderInventory();
        if (name === "employees") renderEmployees();
      });
    });
  }

  // ========================================================
  // 分頁② 產品進銷資料庫（key: rokInventory，來源 app.js 的 ROKInventory）
  // ========================================================
  let invLastSig = null;

  function getInventoryList() {
    if (!window.ROKInventory) return [];
    try {
      const list = window.ROKInventory.ensure(); // 首次載入會建立全部組合
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }
  function inventoryStatus(stock) {
    const s = Number(stock) || 0;
    if (s === 0) return { label: "缺貨", cls: "danger" };
    if (s < 100) return { label: "低庫存", cls: "warn" };
    return { label: "充足", cls: "ok" };
  }
  function stampInvSync() {
    const node = document.querySelector("[data-inv-sync-time]");
    if (!node) return;
    const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
    node.textContent = "上次同步 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function renderInventory() {
    const body = document.querySelector("[data-inv-body]");
    if (!body) return;
    const list = getInventoryList();
    invLastSig = localStorage.getItem("rokInventory"); // 更新同步基準線
    stampInvSync();

    // 摘要
    const totalStock = list.reduce((s, r) => s + (Number(r.stock) || 0), 0);
    const totalSold = list.reduce((s, r) => s + (Number(r.sold) || 0), 0);
    const summary = document.querySelector("[data-inv-summary]");
    if (summary) summary.innerHTML =
      summaryCard("總組合數", formatNumber(list.length)) +
      summaryCard("總庫存", formatNumber(totalStock)) +
      summaryCard("總售出", formatNumber(totalSold));

    // 篩選 + 搜尋
    const filterVal = (document.querySelector("[data-inv-filter]") || {}).value || "";
    const query = ((document.querySelector("[data-inv-search]") || {}).value || "").trim().toLowerCase();
    const visible = list.filter((r) => {
      const matchProduct = !filterVal || r.productId === filterVal;
      const text = (r.productName + " " + r.color + " " + r.switchName).toLowerCase();
      return matchProduct && (!query || text.includes(query));
    });

    if (!visible.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="sys-empty">' +
        (list.length ? "沒有符合條件的庫存項目。" : "目前沒有庫存資料。") + "</div></td></tr>";
      return;
    }

    body.innerHTML = visible.map((r) => {
      const st = inventoryStatus(r.stock);
      return "<tr>" +
        "<td>" + escapeHtml(r.productName) + "</td>" +
        "<td>" + escapeHtml(r.color) + "</td>" +
        "<td>" + escapeHtml(r.switchName) + "</td>" +
        '<td class="sys-num">' + formatNumber(r.stock) + "</td>" +
        '<td class="sys-num">' + formatNumber(r.sold) + "</td>" +
        '<td><span class="tag ' + st.cls + '">' + st.label + "</span></td>" +
      "</tr>";
    }).join("");
  }

  function fillStockColorSwitch(productId) {
    const products = window.ROK_PRODUCTS || [];
    const product = products.find((p) => p.id === productId) || products[0];
    const colorSel = document.querySelector("[data-stock-color]");
    const switchSel = document.querySelector("[data-stock-switch]");
    if (!product || !colorSel || !switchSel) return;
    colorSel.innerHTML = (product.colors || []).map((c) => '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + "</option>").join("");
    switchSel.innerHTML = (product.switches || []).map((s) => '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + "</option>").join("");
  }

  function addStock() {
    if (!window.ROKInventory) { showToast("庫存模組尚未就緒", "warn"); return; }
    const productId = (document.querySelector("[data-stock-product]") || {}).value;
    const color = (document.querySelector("[data-stock-color]") || {}).value;
    const switchName = (document.querySelector("[data-stock-switch]") || {}).value;
    const qty = Math.floor(Number((document.querySelector("[data-stock-qty]") || {}).value));
    if (!productId || !color || !switchName) { showToast("請完整選擇產品與規格", "warn"); return; }
    if (!qty || qty <= 0) { showToast("請輸入大於 0 的數量", "warn"); return; }

    const list = getInventoryList();
    const key = window.ROKInventory.comboKey(productId, color, switchName);
    let rec = list.find((r) => r.key === key);
    if (!rec) {
      const product = (window.ROK_PRODUCTS || []).find((p) => p.id === productId);
      rec = { key: key, productId: productId, productName: product ? product.name : productId, color: color, switchName: switchName, size: product && product.size, switchTech: product && product.switchTech, stock: 0, sold: 0 };
      list.push(rec);
    }
    rec.stock = (Number(rec.stock) || 0) + qty;
    window.ROKInventory.save(list);
    renderInventory();
    closeModal("add-stock");
    showToast("已新增 " + formatNumber(qty) + " 件：" + rec.productName + " / " + color + " / " + switchName, "ok");
  }

  function doResetInventory() {
    const list = getInventoryList();
    list.forEach((r) => { r.stock = 1000000; r.sold = 0; });
    if (window.ROKInventory) window.ROKInventory.save(list);
    renderInventory();
    showToast("已重置所有庫存為 1,000,000、已售出歸 0", "ok");
  }

  function exportInventory() {
    const list = getInventoryList();
    if (!list.length) { showToast("目前沒有庫存資料可匯出", "warn"); return; }
    const headers = ["產品名稱", "顏色", "軸體/規格", "目前庫存", "已售出", "狀態"];
    const rows = list.map((r) => [
      r.productName || "", r.color || "", r.switchName || "",
      Number(r.stock) || 0, Number(r.sold) || 0, inventoryStatus(r.stock).label
    ]);
    exportSheet("ROK_Tech_產品庫存_" + exportTimestamp() + ".xlsx", "產品庫存", headers, rows, [3, 4]);
  }

  function setupInventory() {
    const products = window.ROK_PRODUCTS || [];

    // 產品篩選下拉
    const filter = document.querySelector("[data-inv-filter]");
    if (filter) products.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; filter.appendChild(o); });

    // 新增存貨：產品下拉 + 連動顏色/軸體
    const stockProduct = document.querySelector("[data-stock-product]");
    if (stockProduct) {
      products.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; stockProduct.appendChild(o); });
      stockProduct.addEventListener("change", () => fillStockColorSwitch(stockProduct.value));
    }

    filter && filter.addEventListener("change", renderInventory);
    const search = document.querySelector("[data-inv-search]");
    search && search.addEventListener("input", renderInventory);

    const refresh = document.querySelector("[data-inv-refresh]");
    refresh && refresh.addEventListener("click", () => { renderInventory(); showToast("庫存已更新", "ok"); });

    const addBtn = document.querySelector("[data-inv-add]");
    addBtn && addBtn.addEventListener("click", () => {
      if (stockProduct) { stockProduct.selectedIndex = 0; fillStockColorSwitch(stockProduct.value); }
      const qty = document.querySelector("[data-stock-qty]"); if (qty) qty.value = "100";
      openModal("add-stock");
    });

    const stockForm = document.querySelector("[data-add-stock-form]");
    stockForm && stockForm.addEventListener("submit", (e) => { e.preventDefault(); addStock(); });

    // 重置庫存（紅色，二次確認）
    const resetBtn = document.querySelector("[data-inv-reset]");
    resetBtn && resetBtn.addEventListener("click", () => {
      openConfirm({
        title: "重置庫存？", text: "這會把所有組合的庫存設回 1,000,000、已售出歸 0。", okLabel: "繼續", okClass: "danger",
        onOk: () => openConfirm({
          title: "再次確認", text: "此動作會清除目前所有銷售數據，確定要重置嗎？", okLabel: "確定重置", okClass: "danger",
          onOk: doResetInventory
        })
      });
    });

    const exportBtn = document.querySelector("[data-inv-export]");
    exportBtn && exportBtn.addEventListener("click", exportInventory);
  }

  // ========================================================
  // 分頁③ 人事管理系統（key: rokEmployees）
  // ========================================================
  const EMP_KEY = "rokEmployees";
  const EMP_FIELDS = [
    { k: "empId", label: "員工編號" }, { k: "name", label: "姓名" }, { k: "gender", label: "性別" },
    { k: "position", label: "職位" }, { k: "department", label: "部門" }, { k: "salary", label: "薪資" },
    { k: "hireDate", label: "入職日期" }, { k: "phone", label: "電話" }, { k: "address", label: "住家地址" }
  ];
  const FOUNDERS = [
    { empId: "4B270067", name: "李意新", gender: "男", position: "網站工程師", department: "技術部", salary: "100,000 USD", hireDate: "2026/1/1", phone: "0900000000", address: "台北市信義區信義路五段7號", isFounder: true },
    { empId: "4B270081", name: "蘇郁翔", gender: "男", position: "企劃執行長", department: "企劃部", salary: "100,000 USD", hireDate: "2026/1/1", phone: "0900000001", address: "台北市信義區信義路五段8號", isFounder: true },
    { empId: "4B270070", name: "鄭家慶", gender: "男", position: "行銷經理", department: "行銷部", salary: "100,000 USD", hireDate: "2026/1/1", phone: "0900000002", address: "台北市信義區信義路五段9號", isFounder: true }
  ];

  function genUid() { return "emp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }

  function getEmployees() {
    let list = null;
    try {
      const raw = localStorage.getItem(EMP_KEY);
      list = raw ? JSON.parse(raw) : null;
    } catch (error) {
      list = null;
    }
    if (!Array.isArray(list)) {
      // 第一次使用（或新電腦）：寫入三位創始成員
      list = FOUNDERS.map((f) => Object.assign({ _uid: genUid() }, f));
      saveEmployees(list);
      return list;
    }
    // 相容：確保每筆都有 _uid
    let patched = false;
    list.forEach((e) => { if (!e._uid) { e._uid = genUid(); patched = true; } });
    if (patched) saveEmployees(list);
    return list;
  }
  function saveEmployees(list) {
    try { localStorage.setItem(EMP_KEY, JSON.stringify(list)); return true; } catch (error) { return false; }
  }
  function employeeMissing(emp) {
    return EMP_FIELDS
      .filter((f) => { const v = emp[f.k]; return v === undefined || v === null || String(v).trim() === ""; })
      .map((f) => f.label);
  }

  function renderEmployees() {
    const body = document.querySelector("[data-emp-body]");
    if (!body) return;
    const list = getEmployees();
    const incompleteCount = list.filter((e) => employeeMissing(e).length).length;

    const summary = document.querySelector("[data-emp-summary]");
    if (summary) summary.innerHTML =
      summaryCard("員工總數", formatNumber(list.length)) +
      summaryCard("資料不完整", formatNumber(incompleteCount), incompleteCount > 0);

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="12"><div class="sys-empty">目前沒有員工資料。</div></td></tr>';
      return;
    }

    body.innerHTML = list.map((e) => {
      const missing = employeeMissing(e);
      const incomplete = missing.length > 0;
      const cell = (v) => "<td>" + (String(v == null ? "" : v).trim() ? escapeHtml(v) : '<span class="tag danger">缺</span>') + "</td>";
      const identity = e.isFounder ? '<span class="tag founder">創始成員</span>' : '<span class="tag muted">一般員工</span>';
      const status = incomplete
        ? '<span class="tag danger">⚠ 資料不完整（缺：' + escapeHtml(missing.join("、")) + "）</span>"
        : '<span class="tag ok">正常</span>';
      const fireBtn = '<button class="btn danger tiny" type="button" data-emp-fire="' + escapeHtml(e._uid) + '">開除員工</button>';
      return '<tr class="' + (incomplete ? "is-incomplete" : "") + '">' +
        cell(e.empId) + cell(e.name) + cell(e.gender) + cell(e.position) + cell(e.department) +
        cell(e.salary) + cell(e.hireDate) + cell(e.phone) + cell(e.address) +
        "<td>" + identity + "</td><td>" + status + "</td><td>" + fireBtn + "</td>" +
      "</tr>";
    }).join("");
  }

  function addEmployee() {
    const form = document.querySelector("[data-add-employee-form]");
    if (!form) return;
    const emp = { _uid: genUid(), isFounder: false };
    form.querySelectorAll("[data-emp-field]").forEach((input) => { emp[input.dataset.empField] = String(input.value || "").trim(); });
    const list = getEmployees();
    list.push(emp); // 即使有欄位空白仍要儲存成功（不阻擋）
    saveEmployees(list);
    renderEmployees();
    closeModal("add-employee");
    const missing = employeeMissing(emp);
    if (missing.length) showToast("已新增員工，但資料不完整（缺：" + missing.join("、") + "）", "warn");
    else showToast("已新增員工：" + (emp.name || emp.empId || "新員工"), "ok");
  }

  function fireEmployee(uid) {
    const list = getEmployees();
    const emp = list.find((e) => e._uid === uid);
    if (!emp) return;
    if (emp.isFounder) {
      // 創始成員不可開除：樣式化提示，不刪除資料
      showToast("此為公司創始成員，無法執行此操作", "warn");
      return;
    }
    openConfirm({
      title: "開除員工", text: "確定要開除 " + (emp.name || emp.empId || "這位員工") + " 嗎？此動作無法復原。",
      okLabel: "確定開除", okClass: "danger",
      onOk: () => {
        const next = getEmployees().filter((e) => e._uid !== uid);
        saveEmployees(next);
        renderEmployees();
        showToast("已開除 " + (emp.name || emp.empId || "員工"), "ok");
      }
    });
  }

  function exportEmployees() {
    const list = getEmployees();
    if (!list.length) { showToast("目前沒有員工資料可匯出", "warn"); return; }
    const headers = ["員工編號", "姓名", "性別", "職位", "部門", "薪資", "入職日期", "電話", "住家地址", "身分", "資料狀態"];
    const rows = list.map((e) => {
      const missing = employeeMissing(e);
      return [
        e.empId || "", e.name || "", e.gender || "", e.position || "", e.department || "",
        e.salary || "", e.hireDate || "", e.phone || "", e.address || "",
        e.isFounder ? "創始成員" : "一般員工",
        missing.length ? "資料不完整（缺：" + missing.join("、") + "）" : "正常"
      ];
    });
    exportSheet("ROK_Tech_員工名冊_" + exportTimestamp() + ".xlsx", "員工名冊", headers, rows, []);
  }

  function setupEmployees() {
    const addBtn = document.querySelector("[data-emp-add]");
    addBtn && addBtn.addEventListener("click", () => {
      const form = document.querySelector("[data-add-employee-form]");
      if (form) form.reset();
      openModal("add-employee");
    });

    const empForm = document.querySelector("[data-add-employee-form]");
    empForm && empForm.addEventListener("submit", (e) => { e.preventDefault(); addEmployee(); });

    const body = document.querySelector("[data-emp-body]");
    body && body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-emp-fire]");
      if (btn) fireEmployee(btn.dataset.empFire);
    });

    const exportBtn = document.querySelector("[data-emp-export]");
    exportBtn && exportBtn.addEventListener("click", exportEmployees);
  }

  // ========================================================
  // 同步：庫存跨分頁（storage）+ 每 2.5 秒輪詢備援，確保前台下單後即時反映
  // 訂單同步由 app.js 負責；這裡負責庫存與員工。
  // ========================================================
  function setupSync() {
    function syncInventory(force) {
      const current = localStorage.getItem("rokInventory");
      if (!force && current === invLastSig) return; // 沒變動就不重繪，避免閃爍
      renderInventory();
    }
    window.addEventListener("storage", (event) => {
      if (event.key === "rokInventory" || event.key === null) syncInventory(true);
      if (event.key === "rokEmployees") renderEmployees();
    });
    window.setInterval(() => syncInventory(false), 2500);
    window.addEventListener("focus", () => syncInventory(false));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncInventory(false); });
  }

  // ========================================================
  // 初始化
  // ========================================================
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector("[data-inv-body]")) return; // 只在 system.html 執行

    // 關閉 modal（遮罩 / × / 取消）委派
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-modal]")) {
        const modal = e.target.closest(".sys-modal");
        if (modal) modal.hidden = true;
      }
    });

    // 確認視窗按鈕
    const confirmModal = document.querySelector("[data-modal-confirm]");
    if (confirmModal) {
      confirmModal.addEventListener("click", (e) => { if (e.target.closest("[data-close-confirm]")) closeConfirm(); });
      const okBtn = confirmModal.querySelector("[data-confirm-ok]");
      okBtn && okBtn.addEventListener("click", () => { const fn = confirmHandler; closeConfirm(); if (fn) fn(); });
    }

    // Esc 關閉所有視窗
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".sys-modal").forEach((m) => { m.hidden = true; });
        confirmHandler = null;
      }
    });

    setupTabs();
    setupInventory();
    setupEmployees();
    renderInventory();  // 首次載入：若無 rokInventory 會建立全部組合
    renderEmployees();  // 首次載入：若無 rokEmployees 會寫入三位創始成員
    setupSync();
  });
})();
