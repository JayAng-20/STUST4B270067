(function () {
  const products = window.ROK_PRODUCTS || [];
  const newsItems = window.ROK_NEWS || [];
  const currency = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  });
  const orderStatuses = ["新訂單", "處理中", "已出貨", "已完成", "已取消"];
  const adminPassword = "rok1976";
  let activeOrderId = new URLSearchParams(window.location.search).get("order") || "";

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem("rokCart")) || [];
    } catch (error) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem("rokCart", JSON.stringify(cart));
    updateCartBadge();
  }

  function getOrders() {
    try {
      return JSON.parse(localStorage.getItem("rokOrders")) || [];
    } catch (error) {
      return [];
    }
  }

  function saveOrders(orders) {
    localStorage.setItem("rokOrders", JSON.stringify(orders));
  }

  function cartCount() {
    return getCart().reduce((sum, item) => sum + item.quantity, 0);
  }

  function updateCartBadge() {
    document.querySelectorAll("[data-cart-count]").forEach((node) => {
      node.textContent = cartCount();
    });
  }

  function formatPrice(value) {
    return currency.format(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function calculateCartTotals(cart) {
    const subtotal = cart.reduce((sum, item) => {
      const product = products.find((entry) => entry.id === item.productId);
      return sum + (product ? product.price * item.quantity : 0);
    }, 0);
    const shippingFee = subtotal >= 5000 ? 0 : 120;
    return {
      subtotal,
      shippingFee,
      total: subtotal + shippingFee
    };
  }

  function createOrder(cart, formData) {
    const now = new Date();
    const totals = calculateCartTotals(cart);
    const items = cart
      .map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product) return null;
        return {
          productId: product.id,
          name: product.name,
          image: product.image,
          size: product.size,
          switchTech: product.switchTech,
          color: item.color,
          switchName: item.switchName,
          quantity: item.quantity,
          price: product.price,
          subtotal: product.price * item.quantity
        };
      })
      .filter(Boolean);

    const order = {
      id: `ROK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getTime()).slice(-6)}`,
      createdAt: now.toISOString(),
      status: "新訂單",
      customer: {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        shipping: String(formData.get("shipping") || "").trim()
      },
      items,
      subtotal: totals.subtotal,
      shippingFee: totals.shippingFee,
      total: totals.total
    };

    const orders = getOrders();
    orders.unshift(order);
    saveOrders(orders);
    activeOrderId = order.id;
    return order;
  }

  function isAdminLoggedIn() {
    return sessionStorage.getItem("rokAdminLoggedIn") === "true";
  }

  function productUrl(product) {
    return `product.html?id=${encodeURIComponent(product.id)}`;
  }

  function addToCart(productId, options = {}) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const selectedColor = options.color || product.colors[0].name;
    const selectedSwitch = options.switchName || product.switches[0].name;
    const quantity = Math.max(1, Number(options.quantity) || 1);
    const cart = getCart();
    const key = `${product.id}|${selectedColor}|${selectedSwitch}`;
    const existing = cart.find((item) => item.key === key);

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({
        key,
        productId: product.id,
        color: selectedColor,
        switchName: selectedSwitch,
        quantity
      });
    }

    saveCart(cart);
    toast(`${product.name} 已加入購物車`);
  }

  function toast(message) {
    let node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("is-visible");
    window.clearTimeout(window.rokToastTimer);
    window.rokToastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 2200);
  }

  function badgeList(items) {
    return items.map((item) => `<span class="pill">${item}</span>`).join("");
  }

  function colorDots(colors) {
    return colors
      .map((color) => `<span class="swatch" style="--swatch:${color.hex}" title="${color.name}"></span>`)
      .join("");
  }

  function productCard(product) {
    return `
      <article class="product-card">
        <a class="product-media" href="${productUrl(product)}" aria-label="查看 ${product.name}">
          <img src="${product.image}" alt="${product.name} 商品圖" loading="lazy">
        </a>
        <div class="product-body">
          <div class="product-meta">
            <span>${product.size}</span>
            <span>${product.switchTech}</span>
            <span>${product.style}</span>
          </div>
          <h3><a href="${productUrl(product)}">${product.name}</a></h3>
          <p>${product.tagline}</p>
          <div class="card-row">
            <strong>${formatPrice(product.price)}</strong>
            <span class="compare">${formatPrice(product.compareAt)}</span>
          </div>
          <div class="card-row">
            <span class="swatches">${colorDots(product.colors)}</span>
            <span class="mini">${product.specs.connection}</span>
          </div>
          <div class="badges">${badgeList(product.badges.slice(0, 3))}</div>
          <div class="card-actions">
            <a class="btn ghost" href="${productUrl(product)}">查看商品</a>
            <button class="btn primary" data-add="${product.id}" type="button">加入購物車</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderFeatured() {
    const target = document.querySelector("[data-featured-products]");
    if (!target) return;
    const picks = ["summit-100-pro", "orbit-96-optic", "strike-80-he", "spark-60-he"];
    target.innerHTML = picks
      .map((id) => products.find((product) => product.id === id))
      .filter(Boolean)
      .map(productCard)
      .join("");
  }

  function renderProductGrid() {
    const grid = document.querySelector("[data-product-grid]");
    if (!grid) return;

    const size = document.querySelector("[data-filter-size]")?.value || "全部";
    const tech = document.querySelector("[data-filter-tech]")?.value || "全部";
    const style = document.querySelector("[data-filter-style]")?.value || "全部";
    const sort = document.querySelector("[data-sort]")?.value || "featured";

    let visible = products.filter((product) => {
      const matchSize = size === "全部" || product.size === size;
      const matchTech = tech === "全部" || product.switchTech === tech;
      const matchStyle = style === "全部" || product.style === style;
      return matchSize && matchTech && matchStyle;
    });

    visible = [...visible].sort((a, b) => {
      if (sort === "price-low") return a.price - b.price;
      if (sort === "price-high") return b.price - a.price;
      if (sort === "size") return b.size.localeCompare(a.size);
      return products.indexOf(a) - products.indexOf(b);
    });

    grid.innerHTML = visible.map(productCard).join("");
    const count = document.querySelector("[data-product-count]");
    if (count) count.textContent = `${visible.length} 件商品`;
  }

  function renderStoreProducts() {
    const target = document.querySelector("[data-store-products]");
    if (!target) return;
    target.innerHTML = products.map(productCard).join("");
  }

  function optionList(items, selectedName) {
    return items
      .map((item) => {
        const selected = item.name === selectedName ? "selected" : "";
        return `<option value="${item.name}" ${selected}>${item.name}</option>`;
      })
      .join("");
  }

  function renderProductDetail() {
    const target = document.querySelector("[data-product-detail]");
    if (!target) return;

    const params = new URLSearchParams(window.location.search);
    const product = products.find((item) => item.id === params.get("id")) || products[0];
    document.title = `${product.name} | ROK Tech`;

    target.innerHTML = `
      <section class="detail-layout">
        <div class="detail-media">
          <img src="${product.image}" alt="${product.name} 商品圖">
          <div class="detail-thumbs">
            ${product.colors.map((color) => `<span><i style="--swatch:${color.hex}"></i>${color.name}</span>`).join("")}
          </div>
        </div>
        <div class="detail-panel">
          <div class="badges">${badgeList(product.badges)}</div>
          <p class="eyebrow">${product.size} / ${product.switchTech} / ${product.style}</p>
          <h1>${product.name}</h1>
          <p class="lead">${product.tagline}</p>
          <div class="price-line">
            <strong>${formatPrice(product.price)}</strong>
            <span>${formatPrice(product.compareAt)}</span>
          </div>
          <div class="choice-grid">
            <label>
              顏色
              <select data-detail-color>${product.colors.map((color) => `<option value="${color.name}">${color.name}</option>`).join("")}</select>
            </label>
            <label>
              軸體
              <select data-detail-switch>${optionList(product.switches, product.switches[0].name)}</select>
            </label>
            <label>
              數量
              <input data-detail-qty type="number" min="1" value="1">
            </label>
          </div>
          <button class="btn primary wide" data-detail-add="${product.id}" type="button">加入購物車</button>
          <ul class="feature-list">
            ${product.features.map((feature) => `<li>${feature}</li>`).join("")}
          </ul>
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <p class="eyebrow">Switch Lab</p>
          <h2>可選軸體</h2>
        </div>
        <div class="switch-grid">
          ${product.switches
            .map(
              (switchItem) => `
                <article class="spec-card">
                  <h3>${switchItem.name}</h3>
                  <dl>
                    <div><dt>手感</dt><dd>${switchItem.feel}</dd></div>
                    <div><dt>壓力</dt><dd>${switchItem.force}</dd></div>
                    <div><dt>行程</dt><dd>${switchItem.travel}</dd></div>
                  </dl>
                  <p>${switchItem.note}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <p class="eyebrow">Specifications</p>
          <h2>規格</h2>
        </div>
        <div class="spec-table">
          ${Object.entries(product.specs)
            .map(([key, value]) => `<div><span>${labelFor(key)}</span><strong>${value}</strong></div>`)
            .join("")}
        </div>
      </section>
    `;
  }

  function labelFor(key) {
    const labels = {
      layout: "配列",
      case: "外殼",
      connection: "連線",
      polling: "回報率",
      battery: "電池",
      keycaps: "鍵帽"
    };
    return labels[key] || key;
  }

  function renderNews() {
    const targets = document.querySelectorAll("[data-news-list]");
    targets.forEach((target) => {
      target.innerHTML = newsItems
        .map(
          (item) => `
            <article class="news-card">
              <div class="news-top"><span>${item.type}</span><time>${item.date}</time></div>
              <h3>${item.title}</h3>
              <p>${item.summary}</p>
              <a href="${item.link}">閱讀更多</a>
            </article>
          `
        )
        .join("");
    });
  }

  function renderCart() {
    const target = document.querySelector("[data-cart-view]");
    if (!target) return;
    const cart = getCart();

    if (!cart.length) {
      target.innerHTML = `
        <section class="empty-cart">
          <h1>購物車是空的</h1>
          <p>先去挑一把適合你的 ROK 鍵盤。</p>
          <a class="btn primary" href="products.html">前往產品</a>
        </section>
      `;
      return;
    }

    const rows = cart
      .map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product) return "";
        return `
          <article class="cart-item" data-cart-key="${item.key}">
            <img src="${product.image}" alt="${product.name}">
            <div>
              <h3>${product.name}</h3>
              <p>${item.color} / ${item.switchName}</p>
              <strong>${formatPrice(product.price)}</strong>
            </div>
            <div class="quantity">
              <button data-qty="-1" type="button" aria-label="減少數量">-</button>
              <span>${item.quantity}</span>
              <button data-qty="1" type="button" aria-label="增加數量">+</button>
            </div>
            <button class="remove" data-remove type="button">移除</button>
          </article>
        `;
      })
      .join("");

    const totals = calculateCartTotals(cart);

    target.innerHTML = `
      <section class="cart-layout">
        <div class="cart-list">
          ${rows}
        </div>
        <aside class="checkout-panel">
          <h2>訂單摘要</h2>
          <div><span>小計</span><strong>${formatPrice(totals.subtotal)}</strong></div>
          <div><span>運費</span><strong>${totals.shippingFee === 0 ? "免運" : formatPrice(totals.shippingFee)}</strong></div>
          <div class="total"><span>總計</span><strong>${formatPrice(totals.total)}</strong></div>
          <form data-checkout-form>
            <label>收件姓名<input required name="name" placeholder="ROK 使用者"></label>
            <label>電子郵件<input required type="email" name="email" placeholder="hello@example.com"></label>
            <label>配送方式
              <select name="shipping">
                <option>宅配到府</option>
                <option>超商取貨</option>
                <option>實驗室自取</option>
              </select>
            </label>
            <button class="btn primary wide" type="submit">送出訂單</button>
          </form>
        </aside>
      </section>
    `;
  }

  function renderOrderSuccess() {
    const target = document.querySelector("[data-order-success]");
    if (!target) return;

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    const order = getOrders().find((entry) => entry.id === orderId);

    if (!order) {
      target.innerHTML = `
        <section class="empty-cart">
          <h1>找不到訂單</h1>
          <p>這個瀏覽器目前沒有對應的訂單紀錄。</p>
          <a class="btn primary" href="store.html">回到商店</a>
        </section>
      `;
      return;
    }

    target.innerHTML = `
      <section class="success-panel">
        <p class="eyebrow">Order Complete</p>
        <h1>訂單已建立</h1>
        <p>感謝訂購 ROK Tech。你的訂單編號是 <strong>${order.id}</strong>。</p>
        <div class="customer-grid">
          <div><span>收件人</span><strong>${escapeHtml(order.customer.name || "未填寫")}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(order.customer.email || "未填寫")}</strong></div>
          <div><span>配送方式</span><strong>${escapeHtml(order.customer.shipping || "未填寫")}</strong></div>
          <div><span>總金額</span><strong>${formatPrice(order.total)}</strong></div>
        </div>
        <div class="order-items">
          ${order.items
            .map(
              (item) => `
                <article>
                  <img src="${item.image}" alt="${escapeHtml(item.name)}">
                  <div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(item.color)} / ${escapeHtml(item.switchName)}</p>
                    <span>${formatPrice(item.price)} x ${item.quantity}</span>
                  </div>
                  <strong>${formatPrice(item.subtotal)}</strong>
                </article>
              `
            )
            .join("")}
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="store.html">繼續購物</a>
          <a class="btn ghost" href="index.html">回首頁</a>
        </div>
      </section>
    `;
  }

  function statusClass(status) {
    const map = {
      新訂單: "new",
      處理中: "working",
      已出貨: "shipping",
      已完成: "done",
      已取消: "cancelled"
    };
    return map[status] || "new";
  }

  function renderOrderStats(orders) {
    const target = document.querySelector("[data-order-stats]");
    if (!target) return;
    const revenue = orders.reduce((sum, order) => sum + order.total, 0);
    const pending = orders.filter((order) => ["新訂單", "處理中"].includes(order.status)).length;
    const itemCount = orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);

    target.innerHTML = `
      <article><span>訂單數</span><strong>${orders.length}</strong></article>
      <article><span>營收</span><strong>${formatPrice(revenue)}</strong></article>
      <article><span>待處理</span><strong>${pending}</strong></article>
      <article><span>商品件數</span><strong>${itemCount}</strong></article>
    `;
  }

  function orderMatches(order, query) {
    if (!query) return true;
    const text = [
      order.id,
      order.customer.name,
      order.customer.email,
      order.customer.shipping,
      ...order.items.map((item) => `${item.name} ${item.color} ${item.switchName}`)
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query.toLowerCase());
  }

  function renderAdminOrders() {
    const listTarget = document.querySelector("[data-admin-orders]");
    const detailTarget = document.querySelector("[data-order-detail]");
    if (!listTarget || !detailTarget) return;
    if (!isAdminLoggedIn()) return;

    const allOrders = getOrders();
    const statusFilter = document.querySelector("[data-order-status-filter]")?.value || "全部";
    const query = document.querySelector("[data-order-search]")?.value.trim() || "";
    const visibleOrders = allOrders.filter((order) => {
      const statusMatch = statusFilter === "全部" || order.status === statusFilter;
      return statusMatch && orderMatches(order, query);
    });

    renderOrderStats(allOrders);

    if (!visibleOrders.length) {
      listTarget.innerHTML = `
        <section class="empty-cart compact">
          <h2>目前沒有符合條件的訂單</h2>
          <p>先到商店加入商品並送出訂單，後台就會顯示資料。</p>
          <a class="btn primary" href="store.html">前往商店</a>
        </section>
      `;
      detailTarget.innerHTML = `
        <section class="order-detail-empty">
          <h2>訂單明細</h2>
          <p>選擇左側訂單後，這裡會顯示客戶資料、商品品項與狀態調整。</p>
        </section>
      `;
      return;
    }

    if (!visibleOrders.some((order) => order.id === activeOrderId)) {
      activeOrderId = visibleOrders[0].id;
    }

    listTarget.innerHTML = visibleOrders
      .map((order) => {
        const itemSummary = order.items.map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join("、");
        return `
          <article class="order-card ${order.id === activeOrderId ? "is-active" : ""}">
            <button type="button" data-order-open="${order.id}">
              <span class="order-id">${order.id}</span>
              <span class="status-pill ${statusClass(order.status)}">${order.status}</span>
              <strong>${escapeHtml(order.customer.name || "未命名客戶")}</strong>
              <small>${formatDateTime(order.createdAt)}</small>
              <p>${itemSummary}</p>
              <b>${formatPrice(order.total)}</b>
            </button>
          </article>
        `;
      })
      .join("");

    const order = allOrders.find((entry) => entry.id === activeOrderId) || visibleOrders[0];
    const statusOptions = orderStatuses
      .map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`)
      .join("");

    detailTarget.innerHTML = `
      <section class="order-detail-panel">
        <div class="order-detail-head">
          <div>
            <p class="eyebrow">Order Detail</p>
            <h2>${order.id}</h2>
            <p>${formatDateTime(order.createdAt)}</p>
          </div>
          <label>訂單狀態
            <select data-order-status="${order.id}">
              ${statusOptions}
            </select>
          </label>
        </div>
        <div class="customer-grid">
          <div><span>客戶</span><strong>${escapeHtml(order.customer.name || "未填寫")}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(order.customer.email || "未填寫")}</strong></div>
          <div><span>配送</span><strong>${escapeHtml(order.customer.shipping || "未填寫")}</strong></div>
          <div><span>狀態</span><strong class="status-pill ${statusClass(order.status)}">${order.status}</strong></div>
        </div>
        <div class="order-items">
          ${order.items
            .map(
              (item) => `
                <article>
                  <img src="${item.image}" alt="${escapeHtml(item.name)}">
                  <div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(item.size)} / ${escapeHtml(item.switchTech)} / ${escapeHtml(item.color)} / ${escapeHtml(item.switchName)}</p>
                    <span>${formatPrice(item.price)} x ${item.quantity}</span>
                  </div>
                  <strong>${formatPrice(item.subtotal)}</strong>
                </article>
              `
            )
            .join("")}
        </div>
        <div class="order-total-box">
          <div><span>小計</span><strong>${formatPrice(order.subtotal)}</strong></div>
          <div><span>運費</span><strong>${order.shippingFee === 0 ? "免運" : formatPrice(order.shippingFee)}</strong></div>
          <div class="total"><span>總計</span><strong>${formatPrice(order.total)}</strong></div>
        </div>
      </section>
    `;
  }

  function updateOrderStatus(orderId, status) {
    const orders = getOrders();
    const order = orders.find((entry) => entry.id === orderId);
    if (!order) return;
    order.status = status;
    saveOrders(orders);
    renderAdminOrders();
    toast(`${orderId} 已更新為 ${status}`);
  }

  function clearAllOrders() {
    saveOrders([]);
    activeOrderId = "";
    renderAdminOrders();
    toast("所有訂單已清除");
  }

  function renderAdminGate() {
    const gate = document.querySelector("[data-admin-gate]");
    const dashboard = document.querySelector("[data-admin-dashboard]");
    if (!gate || !dashboard) return;

    if (isAdminLoggedIn()) {
      gate.hidden = true;
      dashboard.hidden = false;
      renderAdminOrders();
    } else {
      gate.hidden = false;
      dashboard.hidden = true;
    }
  }

  function updateCartItem(key, delta) {
    const cart = getCart();
    const item = cart.find((entry) => entry.key === key);
    if (!item) return;
    item.quantity += delta;
    const next = cart.filter((entry) => entry.quantity > 0);
    saveCart(next);
    renderCart();
  }

  function removeCartItem(key) {
    saveCart(getCart().filter((entry) => entry.key !== key));
    renderCart();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-add]");
      if (addButton) {
        addToCart(addButton.dataset.add);
      }

      const detailAdd = event.target.closest("[data-detail-add]");
      if (detailAdd) {
        addToCart(detailAdd.dataset.detailAdd, {
          color: document.querySelector("[data-detail-color]")?.value,
          switchName: document.querySelector("[data-detail-switch]")?.value,
          quantity: document.querySelector("[data-detail-qty]")?.value
        });
      }

      const qtyButton = event.target.closest("[data-qty]");
      if (qtyButton) {
        const item = qtyButton.closest("[data-cart-key]");
        updateCartItem(item.dataset.cartKey, Number(qtyButton.dataset.qty));
      }

      const removeButton = event.target.closest("[data-remove]");
      if (removeButton) {
        const item = removeButton.closest("[data-cart-key]");
        removeCartItem(item.dataset.cartKey);
      }

      const downloadButton = event.target.closest("[data-download]");
      if (downloadButton) {
        toast(`${downloadButton.dataset.download} 已開始下載`);
      }

      const orderButton = event.target.closest("[data-order-open]");
      if (orderButton) {
        activeOrderId = orderButton.dataset.orderOpen;
        renderAdminOrders();
      }

      const clearOrdersButton = event.target.closest("[data-clear-orders]");
      if (clearOrdersButton) {
        clearAllOrders();
      }

      const logoutButton = event.target.closest("[data-admin-logout]");
      if (logoutButton) {
        sessionStorage.removeItem("rokAdminLoggedIn");
        toast("已登出後台");
        renderAdminGate();
      }
    });

    document.querySelectorAll("[data-filter-size], [data-filter-tech], [data-filter-style], [data-sort]").forEach((control) => {
      control.addEventListener("change", renderProductGrid);
    });

    document.querySelectorAll("[data-order-status-filter]").forEach((control) => {
      control.addEventListener("change", renderAdminOrders);
    });

    document.querySelectorAll("[data-order-search]").forEach((control) => {
      control.addEventListener("input", renderAdminOrders);
    });

    document.addEventListener("change", (event) => {
      const statusControl = event.target.closest("[data-order-status]");
      if (statusControl) {
        updateOrderStatus(statusControl.dataset.orderStatus, statusControl.value);
      }
    });

    const checkout = document.querySelector("[data-cart-view]");
    checkout?.addEventListener("submit", (event) => {
      if (!event.target.matches("[data-checkout-form]")) return;
      event.preventDefault();
      const cart = getCart();
      if (!cart.length) return;
      const formData = new FormData(event.target);
      const order = createOrder(cart, formData);
      toast(`${formData.get("name")}，訂單 ${order.id} 已建立`);
      saveCart([]);
      window.location.href = `order-success.html?order=${encodeURIComponent(order.id)}`;
    });

    const adminLogin = document.querySelector("[data-admin-login]");
    adminLogin?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const password = String(formData.get("password") || "");
      const message = document.querySelector("[data-admin-message]");
      if (password === adminPassword) {
        sessionStorage.setItem("rokAdminLoggedIn", "true");
        if (message) message.textContent = "";
        toast("後台登入成功");
        renderAdminGate();
      } else if (message) {
        message.textContent = "密碼錯誤，請重新輸入。";
      }
    });
  }

  function markActiveNav() {
    const file = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav a").forEach((link) => {
      const href = link.getAttribute("href");
      const active = href === file || (file === "product.html" && href === "products.html");
      link.classList.toggle("is-active", active);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();
    markActiveNav();
    renderFeatured();
    renderProductGrid();
    renderStoreProducts();
    renderProductDetail();
    renderNews();
    renderCart();
    renderOrderSuccess();
    renderAdminGate();
    bindEvents();
  });
})();
