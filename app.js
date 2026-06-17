/* ============================================================
   JLD Combat — storefront logic
   Plain ES2015+ JavaScript. No framework, no build step.
   State lives in memory + localStorage. Renders to the DOM.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Config: categories & coupons (edit me) ---------- */
  // Display labels for the category codes used in products.js
  var CATEGORY_LABELS = {
    gloves: "Gloves",
    headgear: "Headgear",
    cup: "Groin Guards",
    boots: "Boots",
    wraps: "Hand Wraps",
    shinguards: "Shin Guards",
    mouthguard: "Mouthguards",
    mitts: "Focus Mitts"
  };
  // Order categories appear in the filter
  var CATEGORY_ORDER = ["gloves", "headgear", "cup", "boots", "wraps", "shinguards", "mouthguard", "mitts"];

  // Glove sub-types. Shown only when "Gloves" is selected. Each product's types are
  // derived automatically from its name by the keyword regexes below — so new gloves
  // added to products.js are tagged with no extra work.
  var GLOVE_TYPES = [
    { key: "training", label: "Training", test: /train/i },
    { key: "fight",    label: "Fight",    test: /\bfight\b/i },
    { key: "laceup",   label: "Lace-up",  test: /lace/i },
    { key: "velcro",   label: "Velcro",   test: /hook|velcro/i },
    { key: "mma",      label: "MMA",      test: /\bmma\b/i }
  ];
  function gloveTypesOf(name) {
    return GLOVE_TYPES.filter(function (t) { return t.test.test(name); }).map(function (t) { return t.key; });
  }

  var PRICE_MAX = 325; // slider top = "$300+" = no upper limit

  // Coupon codes. type: "percent" (value = %) or "fixed" (value = $).
  // brand (optional) restricts the discount to items of that brand.
  // min (optional) = minimum subtotal required.
  var COUPONS = {
    PROLINE10: { type: "percent", value: 10, label: "PROLINE10 — 10% off" },
    VENUM15:   { type: "percent", value: 15, brand: "Venum", label: "VENUM15 — 15% off Venum" },
    WELCOME20: { type: "percent", value: 20, min: 150, label: "WELCOME20 — 20% off $150+" },
    RINGSIDE25:{ type: "fixed", value: 25, min: 100, label: "RINGSIDE25 — $25 off $100+" }
  };

  var FREE_SHIP_THRESHOLD = 0; // everything ships free in this demo

  /* ---------- State ---------- */
  var PRODUCTS = (window.PRODUCTS || []).slice();
  var state = {
    categories: new Set(),   // active category filters (empty = all)
    brands: new Set(),       // active brand filters (empty = all)
    gloveTypes: new Set(),   // active glove sub-type filters (only used for gloves)
    maxPrice: null,          // null = any price; otherwise show price <= maxPrice
    search: "",
    sort: "featured"
  };
  var cart = loadCart();         // { id: qty }
  var coupon = loadCoupon();     // code string or null

  var mqMobile = window.matchMedia("(max-width: 620px)");
  var isMobile = mqMobile.matches;
  var SHELF_LIMIT = 12;          // items shown per category row before "See all"

  /* ---------- Tiny DOM helpers ---------- */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k in n && k !== "list") { try { n[k] = attrs[k]; } catch (e) { n.setAttribute(k, attrs[k]); } }
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function money(n) { return "$" + n.toFixed(2); }
  function byId(id) { return PRODUCTS.filter(function (p) { return p.id === id; })[0]; }

  /* ---------- Persistence (localStorage, fail-safe) ---------- */
  function loadCart() {
    try { return JSON.parse(localStorage.getItem("jld_cart")) || {}; } catch (e) { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem("jld_cart", JSON.stringify(cart)); } catch (e) {}
  }
  function loadCoupon() {
    try { var c = localStorage.getItem("jld_coupon"); return c && COUPONS[c] ? c : null; } catch (e) { return null; }
  }
  function saveCoupon() {
    try {
      if (coupon) localStorage.setItem("jld_coupon", coupon);
      else localStorage.removeItem("jld_coupon");
    } catch (e) {}
  }

  /* ============================================================
     COLORWAY GROUPING
     Products that share a base name ("X - Colorway") are grouped so one
     card represents the model and its colorways. Cart keeps each colorway
     as its own line (each colorway is a distinct product id).
     ============================================================ */
  function parseColorway(name) {
    var i = name.lastIndexOf(" - ");
    if (i > 0) return { base: name.slice(0, i).trim(), color: name.slice(i + 3).trim() };
    return { base: name.trim(), color: null };
  }
  var GROUPS = {};                  // gkey -> [products] in natural order
  PRODUCTS.forEach(function (p) {
    var pc = parseColorway(p.name);
    p._base = pc.base; p._color = pc.color;
    p._gkey = p.brand + "|" + p.category + "|" + pc.base;
    (GROUPS[p._gkey] = GROUPS[p._gkey] || []).push(p);
  });
  Object.keys(GROUPS).forEach(function (k) {
    GROUPS[k].forEach(function (p) { p._multi = GROUPS[k].length > 1; });
  });
  var activeColor = {};             // gkey -> selected product id (persists across renders)

  // Build display units from a (filtered, sorted) flat list: one unit per group,
  // positioned by first appearance; colorways kept in natural group order.
  function groupForDisplay(list) {
    var present = {}; list.forEach(function (p) { present[p.id] = true; });
    var seen = {}, units = [];
    list.forEach(function (p) {
      if (seen[p._gkey]) return;
      seen[p._gkey] = true;
      var cw = GROUPS[p._gkey].filter(function (q) { return present[q.id]; });
      var sel = activeColor[p._gkey];
      var active = (sel && cw.filter(function (q) { return q.id === sel; })[0]) || cw[0];
      units.push({ gkey: p._gkey, colorways: cw, active: active });
    });
    return units;
  }

  /* ----- Swatch colors (approximate, derived from the colorway text) ----- */
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function ad(c) { return Math.max(0, Math.min(255, Math.round(c + amt * 255))); }
    return "#" + [ad(r), ad(g), ad(b)].map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  var COLOR_BASE = {
    black: "#1c1c1c", white: "#f2f2f2", red: "#cc2233", blue: "#2a5bd0", green: "#2e8b57",
    grey: "#8a8f98", gray: "#8a8f98", gold: "#c8962a", silver: "#c2c6cd", navy: "#1e2f55",
    brown: "#6b4423", purple: "#7a3fb0", pink: "#e879a6", orange: "#e6791f", yellow: "#e6c229",
    khaki: "#7c7a52", camel: "#c19a6b", sand: "#d8c39a", ivory: "#efe6cd", burgundy: "#6d1f2c",
    turquoise: "#1ab5a8", aqua: "#3fc1c9", coral: "#ff6f61", corail: "#ff6f61", raspberry: "#b3325a",
    pumpkin: "#d2691e", bronze: "#8c6a3f", chocolate: "#3d2517", ruby: "#9b111e", garnet: "#7a1f2b",
    cobalt: "#1d50c4", emerald: "#1f9e5a", cherry: "#a01030", military: "#5a6650", army: "#4b5320",
    transparent: "#dfe3ea"
  };
  function colorToHex(word) {
    word = word.toLowerCase().trim();
    var keys = Object.keys(COLOR_BASE);
    for (var i = 0; i < keys.length; i++) {
      if (word.indexOf(keys[i]) >= 0) {
        var hex = COLOR_BASE[keys[i]];
        if (/dark|deep|storm|state|grizzly|intense|midnight|night/.test(word)) hex = shade(hex, -0.18);
        else if (/snow|light/.test(word)) hex = shade(hex, 0.18);
        return hex;
      }
    }
    return "#9aa0a8";
  }
  function swatchBg(color) {
    if (!color) return "#cfd3da";
    var parts = color.split("/").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 2);
    var hexes = parts.map(colorToHex);
    if (hexes.length === 2 && hexes[0] !== hexes[1])
      return "linear-gradient(135deg, " + hexes[0] + " 0 50%, " + hexes[1] + " 50% 100%)";
    return hexes[0] || "#cfd3da";
  }
  function swatchesHTML(cw, activeId) {
    return cw.map(function (p) {
      var label = p._color || "Original";
      return '<button class="cw-swatch' + (p.id === activeId ? " active" : "") + '" type="button"' +
        ' data-id="' + p.id + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' +
        ' style="background:' + swatchBg(p._color) + '"></button>';
    }).join("");
  }

  /* ============================================================
     FILTERS
     ============================================================ */
  function buildChips() {
    var cats = $("#categoryChips");
    CATEGORY_ORDER.forEach(function (code) {
      if (!PRODUCTS.some(function (p) { return p.category === code; })) return;
      var c = el("button", { "class": "chip", type: "button", "aria-pressed": "false", "data-cat": code }, CATEGORY_LABELS[code] || code);
      c.addEventListener("click", function () {
        toggleSet(state.categories, code); syncChip(c, state.categories.has(code));
        updateGloveTypeVisibility(); render();
      });
      cats.appendChild(c);
    });

    var brands = unique(PRODUCTS.map(function (p) { return p.brand; })).sort();
    var bWrap = $("#brandChips");
    brands.forEach(function (brand) {
      var c = el("button", { "class": "chip", type: "button", "aria-pressed": "false", "data-brand": brand }, brand);
      c.addEventListener("click", function () { toggleSet(state.brands, brand); syncChip(c, state.brands.has(brand)); render(); });
      bWrap.appendChild(c);
    });

    var gt = $("#gloveTypeChips");
    GLOVE_TYPES.forEach(function (t) {
      var c = el("button", { "class": "chip", type: "button", "aria-pressed": "false", "data-gt": t.key }, t.label);
      c.addEventListener("click", function () { toggleSet(state.gloveTypes, t.key); syncChip(c, state.gloveTypes.has(t.key)); render(); });
      gt.appendChild(c);
    });
  }

  // Glove sub-filters only make sense when Gloves is selected. When it isn't,
  // hide the group and drop any active glove-type filters.
  function updateGloveTypeVisibility() {
    var show = state.categories.has("gloves");
    $("#gloveTypeGroup").hidden = !show;
    if (!show && state.gloveTypes.size) {
      state.gloveTypes.clear();
      document.querySelectorAll("#gloveTypeChips .chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    }
  }
  function toggleSet(set, val) { if (set.has(val)) set.delete(val); else set.add(val); }
  function syncChip(node, on) { node.setAttribute("aria-pressed", on ? "true" : "false"); }
  function unique(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  function applyFilters() {
    var q = state.search.trim().toLowerCase();
    var list = PRODUCTS.filter(function (p) {
      if (state.categories.size && !state.categories.has(p.category)) return false;
      if (state.brands.size && !state.brands.has(p.brand)) return false;
      if (state.maxPrice != null && p.price > state.maxPrice) return false;
      // Glove sub-types only constrain glove-category items; other categories pass through.
      if (state.gloveTypes.size && p.category === "gloves") {
        var types = gloveTypesOf(p.name);
        var match = types.some(function (t) { return state.gloveTypes.has(t); });
        if (!match) return false;
      }
      if (q && (p.name + " " + p.brand + " " + (CATEGORY_LABELS[p.category] || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    switch (state.sort) {
      case "price-asc":  list.sort(function (a, b) { return a.price - b.price; }); break;
      case "price-desc": list.sort(function (a, b) { return b.price - a.price; }); break;
      case "name":       list.sort(function (a, b) { return a.name.localeCompare(b.name); }); break;
      default: /* featured: price high to low */
        list.sort(function (a, b) { return b.price - a.price; });
    }
    return list;
  }

  /* ============================================================
     RENDER GRID
     ============================================================ */
  function render() {
    var list = applyFilters();
    // Mobile "browse" mode: no category chosen and no search -> show category shelves.
    var shelvesMode = isMobile && state.categories.size === 0 && !state.search.trim();

    var label = list.length + (list.length === 1 ? " item" : " items");
    $("#resultCount").textContent = label;
    $("#filtersCount").textContent = label;
    $("#filtersApply").textContent = "Show " + label;
    $("#shelfBack").hidden = !(isMobile && state.categories.size > 0);

    if (list.length === 0) {
      $("#grid").hidden = true; $("#shelves").hidden = true; $("#emptyState").hidden = false;
      return;
    }
    $("#emptyState").hidden = true;

    if (shelvesMode) {
      renderShelves(list);
      $("#shelves").hidden = false; $("#grid").hidden = true;
    } else {
      var grid = $("#grid"); grid.innerHTML = "";
      groupForDisplay(list).forEach(function (u) { grid.appendChild(card(u)); });
      $("#grid").hidden = false; $("#shelves").hidden = true;
    }
  }

  // One horizontal row per category; "See all" expands that category into the grid.
  function renderShelves(list) {
    var wrap = $("#shelves"); wrap.innerHTML = "";
    CATEGORY_ORDER.forEach(function (code) {
      var items = list.filter(function (p) { return p.category === code; });
      if (!items.length) return;
      var units = groupForDisplay(items);
      var sec = el("section", { "class": "shelf" });
      var head = el("div", { "class": "shelf-head" });
      head.innerHTML = '<h3>' + esc(CATEGORY_LABELS[code] || code) +
        '<span class="shelf-count">' + units.length + '</span></h3>';
      var all = el("button", { "class": "shelf-all", type: "button" }, "See all →");
      all.addEventListener("click", function () { selectCategory(code); });
      head.appendChild(all);
      var row = el("div", { "class": "shelf-row" });
      units.slice(0, SHELF_LIMIT).forEach(function (u) { row.appendChild(card(u)); });
      if (units.length > SHELF_LIMIT) {
        var more = el("button", { "class": "shelf-more", type: "button" }, "+" + (units.length - SHELF_LIMIT) + "\nmore");
        more.addEventListener("click", function () { selectCategory(code); });
        row.appendChild(more);
      }
      sec.appendChild(head); sec.appendChild(row);
      wrap.appendChild(sec);
    });
  }

  // Select a single category (or pass null to clear back to shelves). Keeps chips in sync.
  function selectCategory(code) {
    state.categories = code ? new Set([code]) : new Set();
    document.querySelectorAll("#categoryChips .chip").forEach(function (c) {
      c.setAttribute("aria-pressed", c.getAttribute("data-cat") === code ? "true" : "false");
    });
    updateGloveTypeVisibility();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Accepts a display unit { gkey, colorways, active }.
  function card(unit) {
    var cw = unit.colorways, active = unit.active, idx = cw.indexOf(active);
    var multi = cw.length > 1;
    var node = el("article", { "class": "card" });

    var media = '<div class="card-media">';
    if (multi) {
      if (idx > 0) media += '<button class="cw-arrow cw-prev" type="button" aria-label="Previous colour">‹</button>';
      if (idx < cw.length - 1) media += '<button class="cw-arrow cw-next" type="button" aria-label="Next colour">›</button>';
    }
    media += '<img src="images/' + active.img + '" alt="' + esc(active.brand + " " + active.name) + '" loading="lazy" decoding="async" width="800" height="800">';
    if (multi) media += '<div class="cw-swatches">' + swatchesHTML(cw, active.id) + '</div>';
    media += '</div>';

    node.innerHTML = media +
      '<div class="card-body">' +
        '<span class="card-brand">' + esc(active.brand) + '</span>' +
        '<h3 class="card-name">' + esc(multi ? active._base : active.name) + '</h3>' +
        (multi ? '<span class="card-color">' + esc(active._color || "Original") + '</span>' : '') +
        '<p class="card-blurb">' + esc(active.blurb || "") + '</p>' +
        '<div class="card-foot">' +
          '<span class="price">' + money(active.price) + '</span>' +
          '<button class="add-btn" type="button">Add</button>' +
        '</div>' +
      '</div>';

    function setActive(p) {
      unit.active = p; activeColor[unit.gkey] = p.id;
      node.replaceWith(card(unit));   // re-render this card in place
    }
    if (multi) {
      var prev = node.querySelector(".cw-prev"), next = node.querySelector(".cw-next");
      if (prev) prev.addEventListener("click", function (e) { e.stopPropagation(); setActive(cw[idx - 1]); });
      if (next) next.addEventListener("click", function (e) { e.stopPropagation(); setActive(cw[idx + 1]); });
      node.querySelectorAll(".cw-swatch").forEach(function (sw) {
        sw.addEventListener("click", function (e) {
          e.stopPropagation();
          var p = cw.filter(function (q) { return q.id === sw.getAttribute("data-id"); })[0];
          if (p && p !== unit.active) setActive(p);
        });
      });
    }
    node.querySelector(".add-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      addToCart(unit.active.id);
      var btn = e.currentTarget;
      btn.textContent = "Added ✓"; btn.classList.add("added");
      setTimeout(function () { btn.textContent = "Add"; btn.classList.remove("added"); }, 1100);
    });
    node.addEventListener("click", function () { openProductModal(unit.active, unit); });
    return node;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ============================================================
     CART
     ============================================================ */
  function addToCart(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart(); renderCart(); bumpCount();
    toast("Added to cart");
  }
  function setQty(id, qty) {
    if (qty <= 0) delete cart[id]; else cart[id] = qty;
    saveCart(); renderCart();
  }
  function clearCart() {
    cart = {}; coupon = null;
    saveCart(); saveCoupon();
    $("#couponInput").value = ""; setCouponMsg("");
    renderCart(); bumpCount();
    toast("Cart cleared");
  }
  // Change a cart line to a different colorway (merges qty if that colorway is already present).
  function swapColor(oldId, newId) {
    if (oldId === newId || !cart[oldId]) return;
    cart[newId] = (cart[newId] || 0) + cart[oldId];
    delete cart[oldId];
    saveCart(); renderCart(); bumpCount();
  }
  function cartEntries() {
    return Object.keys(cart).map(function (id) {
      return { product: byId(id), qty: cart[id] };
    }).filter(function (e) { return e.product; });
  }
  function cartCount() {
    return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0);
  }
  function bumpCount() {
    var n = cartCount(), badge = $("#cartCount");
    badge.textContent = n; badge.hidden = n === 0;
  }

  /* ----- Totals & coupon math ----- */
  function computeTotals() {
    var entries = cartEntries();
    var subtotal = entries.reduce(function (s, e) { return s + e.product.price * e.qty; }, 0);
    var discount = 0, discountLabel = "";

    if (coupon && COUPONS[coupon]) {
      var c = COUPONS[coupon];
      if (c.min && subtotal < c.min) {
        // no longer qualifies; drop silently
        coupon = null; saveCoupon();
      } else {
        var base = subtotal;
        if (c.brand) {
          base = entries.reduce(function (s, e) {
            return s + (e.product.brand === c.brand ? e.product.price * e.qty : 0);
          }, 0);
        }
        discount = c.type === "percent" ? base * (c.value / 100) : Math.min(c.value, base);
        discount = Math.round(discount * 100) / 100;
        discountLabel = coupon;
      }
    }
    var total = Math.max(0, subtotal - discount);
    return { entries: entries, subtotal: subtotal, discount: discount, discountLabel: discountLabel, total: total };
  }

  function renderCart() {
    var t = computeTotals();
    var box = $("#cartItems");
    box.innerHTML = "";

    var has = t.entries.length > 0;
    $("#cartEmpty").hidden = has;
    $("#cartFoot").hidden = !has;
    $("#clearCart").hidden = !has;
    $("#cartItemsLabel").textContent = has ? "(" + cartCount() + ")" : "";

    t.entries.forEach(function (e) {
      var p = e.product;
      var line = el("div", { "class": "cart-line" });
      var nameHtml = p._multi
        ? esc(p._base) + ' <span class="cl-color">— ' + esc(p._color || "Original") + '</span>'
        : esc(p.name);
      line.innerHTML =
        '<img src="images/' + p.img + '" alt="" loading="lazy">' +
        '<div class="cl-main">' +
          '<div class="cl-brand">' + esc(p.brand) + '</div>' +
          '<div class="cl-name">' + nameHtml + '</div>' +
          '<div class="cl-price">' + money(p.price) + ' each' +
            (p._multi ? ' · <button class="cl-edit" type="button" data-act="edit">Change colour</button>' : '') +
          '</div>' +
          (p._multi ? '<div class="cl-colors" hidden>' + swatchesHTML(GROUPS[p._gkey], p.id) + '</div>' : '') +
          '<div class="cl-controls">' +
            '<div class="qty">' +
              '<button type="button" aria-label="Decrease quantity" data-act="dec">−</button>' +
              '<span>' + e.qty + '</span>' +
              '<button type="button" aria-label="Increase quantity" data-act="inc">+</button>' +
            '</div>' +
            '<button class="cl-remove" type="button" data-act="rm">Remove</button>' +
          '</div>' +
        '</div>';
      line.querySelector('[data-act="dec"]').addEventListener("click", function () { setQty(p.id, e.qty - 1); bumpCount(); });
      line.querySelector('[data-act="inc"]').addEventListener("click", function () { setQty(p.id, e.qty + 1); bumpCount(); });
      line.querySelector('[data-act="rm"]').addEventListener("click", function () { setQty(p.id, 0); bumpCount(); });
      if (p._multi) {
        var colors = line.querySelector(".cl-colors");
        line.querySelector('[data-act="edit"]').addEventListener("click", function () { colors.hidden = !colors.hidden; });
        colors.querySelectorAll(".cw-swatch").forEach(function (sw) {
          sw.addEventListener("click", function () { swapColor(p.id, sw.getAttribute("data-id")); });
        });
      }
      box.appendChild(line);
    });

    $("#sumSubtotal").textContent = money(t.subtotal);
    var dRow = $("#discountRow");
    if (t.discount > 0) {
      dRow.hidden = false;
      $("#discountLabel").textContent = "Discount (" + t.discountLabel + ")";
      $("#sumDiscount").textContent = "-" + money(t.discount);
    } else {
      dRow.hidden = true;
    }
    $("#sumShipping").textContent = "Free";
    $("#sumTotal").textContent = money(t.total);

    // reflect applied coupon in the input/message
    if (coupon && COUPONS[coupon]) {
      $("#couponInput").value = coupon;
      setCouponMsg(COUPONS[coupon].label + " applied", "ok");
    }
  }

  /* ----- Coupon UI ----- */
  function setCouponMsg(msg, kind) {
    var m = $("#couponMsg");
    m.textContent = msg || "";
    m.className = "coupon-msg" + (kind ? " " + kind : "");
  }
  function applyCoupon() {
    var code = $("#couponInput").value.trim().toUpperCase();
    if (!code) { setCouponMsg("Enter a code.", "err"); return; }
    var c = COUPONS[code];
    if (!c) { setCouponMsg("That code isn’t valid.", "err"); return; }
    var subtotal = computeTotals().subtotal;
    if (c.min && subtotal < c.min) {
      setCouponMsg("Spend " + money(c.min) + " to use " + code + ".", "err"); return;
    }
    coupon = code; saveCoupon(); renderCart();
    toast("Coupon applied");
  }

  /* ============================================================
     DRAWER + UI WIRING
     ============================================================ */
  var modalProduct = null, modalUnit = null;
  function fillModal(p) {
    modalProduct = p;
    $("#modalImg").src = "images/" + p.img;
    $("#modalImg").alt = p.brand + " " + p.name;
    $("#modalBrand").textContent = p.brand;
    $("#modalName").textContent = p.name;
    $("#modalPrice").textContent = money(p.price);
    $("#modalDesc").textContent = p.desc || p.blurb || "";
    $("#modalDesc").scrollTop = 0;
  }
  function openProductModal(p, unit) {
    modalUnit = (unit && unit.colorways.length > 1) ? unit : null;
    fillModal(p);
    var sw = $("#modalSwatches");
    if (modalUnit) {
      sw.innerHTML = swatchesHTML(modalUnit.colorways, p.id);
      sw.hidden = false;
      sw.querySelectorAll(".cw-swatch").forEach(function (s) {
        s.addEventListener("click", function () {
          var np = modalUnit.colorways.filter(function (q) { return q.id === s.getAttribute("data-id"); })[0];
          if (!np) return;
          fillModal(np);
          modalUnit.active = np; activeColor[modalUnit.gkey] = np.id;   // keep grid in sync on next render
          sw.querySelectorAll(".cw-swatch").forEach(function (x) { x.classList.toggle("active", x === s); });
        });
      });
    } else { sw.hidden = true; sw.innerHTML = ""; }
    var add = $("#modalAdd"); add.textContent = "Add to cart"; add.classList.remove("added");
    $("#productModal").hidden = false;
    requestAnimationFrame(function () { $("#productModal").classList.add("open"); });
    showOverlay(closeProductModal);
    document.body.style.overflow = "hidden";
    $("#modalClose").focus();
  }
  function closeProductModal() {
    $("#productModal").classList.remove("open");
    setTimeout(function () { $("#productModal").hidden = true; }, 200);
    hideOverlay(); document.body.style.overflow = ""; modalProduct = null;
  }

  function openCart() {
    renderCart();
    $("#cartDrawer").classList.add("open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    showOverlay(closeCart);
    document.body.style.overflow = "hidden";
  }
  function closeCart() {
    $("#cartDrawer").classList.remove("open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    hideOverlay(); document.body.style.overflow = "";
  }
  function openFilters() {
    $("#filters").classList.add("open");
    $("#filterToggle").setAttribute("aria-expanded", "true");
    showOverlay(closeFilters); document.body.style.overflow = "hidden";
  }
  function closeFilters() {
    $("#filters").classList.remove("open");
    $("#filterToggle").setAttribute("aria-expanded", "false");
    hideOverlay(); document.body.style.overflow = "";
  }
  var overlayHandler = null;
  function showOverlay(onClick) {
    var o = $("#overlay"); o.hidden = false; overlayHandler = onClick;
  }
  function hideOverlay() { $("#overlay").hidden = true; overlayHandler = null; }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1900);
  }

  function clearAllFilters() {
    state.categories.clear(); state.brands.clear(); state.gloveTypes.clear();
    state.maxPrice = null; state.search = "";
    $("#searchInput").value = "";
    $("#priceRange").value = PRICE_MAX; updatePriceLabel();
    $("#gloveTypeGroup").hidden = true;
    document.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    render();
  }

  function updatePriceLabel() {
    var v = parseInt($("#priceRange").value, 10);
    if (v >= PRICE_MAX) { state.maxPrice = null; $("#priceLabel").textContent = "Any price"; }
    else                { state.maxPrice = v;    $("#priceLabel").textContent = "Up to $" + v; }
  }

  function wire() {
    $("#cartBtn").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#clearCart").addEventListener("click", clearCart);

    $("#modalClose").addEventListener("click", closeProductModal);
    $("#modalAdd").addEventListener("click", function () {
      if (!modalProduct) return;
      addToCart(modalProduct.id);   // fires the "Added to cart" toast
      closeProductModal();          // task done — close the modal
    });
    $("#overlay").addEventListener("click", function () { if (overlayHandler) overlayHandler(); });

    $("#filterToggle").addEventListener("click", openFilters);
    $("#filtersClose").addEventListener("click", closeFilters);
    $("#filtersApply").addEventListener("click", closeFilters);
    $("#clearFilters").addEventListener("click", clearAllFilters);
    $("#shelfBack").addEventListener("click", function () { selectCategory(null); });

    // Re-render when crossing the mobile breakpoint (shelves <-> grid).
    var onMq = function (e) { isMobile = e.matches; render(); };
    if (mqMobile.addEventListener) mqMobile.addEventListener("change", onMq);
    else mqMobile.addListener(onMq);
    $("#emptyClear").addEventListener("click", clearAllFilters);

    $("#priceRange").addEventListener("input", function () { updatePriceLabel(); render(); });
    $("#sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; render(); });

    var searchTimer;
    $("#searchInput").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var v = e.target.value;
      searchTimer = setTimeout(function () { state.search = v; render(); }, 120);
    });

    $("#applyCoupon").addEventListener("click", applyCoupon);
    $("#couponInput").addEventListener("keydown", function (e) { if (e.key === "Enter") applyCoupon(); });

    $("#checkoutBtn").addEventListener("click", function () {
      var t = computeTotals();
      toast("Demo checkout — " + money(t.total) + " (no payment taken)");
    });

    var backBtn = $("#backToTop");
    function updateBackToTop() {
      var y = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (y > 300) backBtn.classList.add("show");
      else backBtn.classList.remove("show");
    }
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    document.addEventListener("scroll", updateBackToTop, { passive: true, capture: true });
    backBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if ($("#productModal").classList.contains("open")) closeProductModal();
        else if ($("#cartDrawer").classList.contains("open")) closeCart();
        else if ($("#filters").classList.contains("open")) closeFilters();
      }
    });
  }

  /* ---------- Boot ---------- */
  buildChips();
  wire();
  render();
  bumpCount();
  if (coupon) renderCart();
})();
