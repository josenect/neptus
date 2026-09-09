/* NEPTUS STORE - catalogo. JS sin dependencias, empaquetado con Vite.
   Carga catalog.json (generado por scripts/build.py) y lo pinta con filtros,
   paginacion, buscador por referencia y pedido por WhatsApp. */

import "./styles.css";

(function () {
  "use strict";

  var CFG = window.CONFIG;

  /* Variables de entorno de Netlify. Si estan definidas en el panel de Netlify mandan sobre
     public/config.js, asi el dueno cambia el telefono desde alli (que ya pide contrasena)
     sin tocar codigo: cambiar la variable y darle a "Trigger deploy". Si no existen, se
     siguen usando los valores de config.js. */
  var ENV = {
    WHATSAPP: import.meta.env.VITE_WHATSAPP,
    STORE: import.meta.env.VITE_STORE,
    TAGLINE: import.meta.env.VITE_TAGLINE
  };
  if (ENV.WHATSAPP) CFG.WHATSAPP = String(ENV.WHATSAPP).replace(/\D/g, "");
  if (ENV.STORE) CFG.STORE = String(ENV.STORE);
  if (ENV.TAGLINE) CFG.TAGLINE = String(ENV.TAGLINE);

  var $ = function (id) { return document.getElementById(id); };

  var DATA = null;          // catalog.json
  var VIEW = [];            // productos tras aplicar filtros
  var LB_INDEX = -1;        // posicion abierta en el lightbox
  var LB_SIZE = null;       // talla elegida dentro del lightbox
  var CAT_SIZES = {};       // categoria -> tallas que existen en ella

  var state = { cat: "", brand: "", size: "", q: "", page: 1 };

  // ------------------------------------------------------------------ util

  function waLink(product, size) {
    return "https://wa.me/" + CFG.WHATSAPP + "?text=" +
      encodeURIComponent(CFG.MSG(product, size));
  }

  function readURL() {
    var p = new URLSearchParams(location.search);
    state.cat = p.get("cat") || "";
    state.brand = p.get("marca") || "";
    state.size = p.get("talla") || "";
    state.q = p.get("q") || "";
    state.page = Math.max(1, parseInt(p.get("p"), 10) || 1);
  }

  function writeURL(replace) {
    var p = new URLSearchParams();
    if (state.cat) p.set("cat", state.cat);
    if (state.brand) p.set("marca", state.brand);
    if (state.size) p.set("talla", state.size);
    if (state.q) p.set("q", state.q);
    if (state.page > 1) p.set("p", state.page);
    var url = location.pathname + (p.toString() ? "?" + p : "");
    history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  // ------------------------------------------------------------------ filtrado

  function coincide(p, q) {
    return p.ref.indexOf(q) !== -1 ||
      p.cat.toUpperCase().indexOf(q) !== -1 ||
      (p.sub && p.sub.toUpperCase().indexOf(q) !== -1) ||
      (p.brand && p.brand.toUpperCase().indexOf(q) !== -1) ||
      p.sizes.indexOf(q) !== -1;
  }

  function applyFilters() {
    var q = state.q.trim().toUpperCase();
    /* Buscar manda sobre los filtros: si el cliente teclea una referencia estando dentro de
       una categoria, la busca en TODO el catalogo en vez de decir que no existe. Los filtros
       no se borran, quedan en espera y vuelven a aplicarse al vaciar el buscador. */
    VIEW = DATA.products.filter(function (p) {
      if (q) return coincide(p, q);
      if (state.cat && p.cat !== state.cat) return false;
      if (state.brand && p.brand !== state.brand) return false;
      if (state.size && p.sizes.indexOf(state.size) === -1) return false;
      return true;
    });
    var maxPage = Math.max(1, Math.ceil(VIEW.length / CFG.PER_PAGE));
    if (state.page > maxPage) state.page = maxPage;
  }

  /* Marcas visibles: solo las que existen dentro de la categoria activa. */
  function brandsInScope() {
    var seen = {};
    DATA.products.forEach(function (p) {
      if (!p.brand) return;
      if (state.cat && p.cat !== state.cat) return;
      seen[p.brand] = (seen[p.brand] || 0) + 1;
    });
    return Object.keys(seen).sort().map(function (b) {
      return { name: b, count: seen[b] };
    });
  }

  /* Tallas visibles: solo las que existen dentro de la categoria activa. */
  function sizesInScope() {
    var seen = {};
    DATA.products.forEach(function (p) {
      if (state.cat && p.cat !== state.cat) return;
      if (state.brand && p.brand !== state.brand) return;
      p.sizes.forEach(function (s) { seen[s] = (seen[s] || 0) + 1; });
    });
    return DATA.sizeOrder.filter(function (s) { return seen[s]; })
      .map(function (s) { return { name: s, count: seen[s] }; });
  }

  // ------------------------------------------------------------------ pintado

  function chip(label, count, active, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", active ? "true" : "false");
    var strong = document.createElement("b");
    strong.textContent = label;
    b.appendChild(strong);
    if (count != null) {
      var s = document.createElement("span");
      s.textContent = count;
      b.appendChild(s);
    }
    b.addEventListener("click", onClick);
    return b;
  }

  /* Marca si la fila puede seguir hacia cada lado, para encender flecha y degradado.
     Sin esto, en escritorio no hay forma de saber que quedan categorias fuera de la vista. */
  function updateScrollHints(chips) {
    var wrap = chips.parentElement;
    if (!wrap || !wrap.classList.contains("chips-wrap")) return;
    var margen = 4;
    var restaDerecha = chips.scrollWidth - chips.clientWidth - chips.scrollLeft;
    wrap.classList.toggle("can-left", chips.scrollLeft > margen);
    wrap.classList.toggle("can-right", restaDerecha > margen);
  }

  function wireScrollHints() {
    Array.prototype.forEach.call(document.querySelectorAll(".chips-wrap"), function (wrap) {
      var chips = wrap.querySelector(".chips");
      chips.addEventListener("scroll", function () { updateScrollHints(chips); });
      wrap.querySelector(".chips-nav.prev").addEventListener("click", function () {
        chips.scrollLeft -= chips.clientWidth * 0.8;
      });
      wrap.querySelector(".chips-nav.next").addEventListener("click", function () {
        chips.scrollLeft += chips.clientWidth * 0.8;
      });
    });
    window.addEventListener("resize", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".chips"), updateScrollHints);
    });
  }

  /* Con 18 categorias la activa puede quedar fuera de la fila con scroll: la traemos a la
     vista moviendo solo el scroll horizontal de la fila, nunca el de la pagina. */
  function revealActive(container) {
    var active = container.querySelector('[aria-pressed="true"]');
    if (!active) return;
    var left = active.offsetLeft - 40;
    var right = active.offsetLeft + active.offsetWidth + 40;
    if (left < container.scrollLeft) container.scrollLeft = Math.max(0, left);
    else if (right > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = right - container.clientWidth;
    }
  }

  /* Los filtros viven en dos sitios: la barra (siempre visible, en filas que se desplazan)
     y el panel de movil (todo desplegado). Se pintan los mismos chips en ambos. */
  function pintar(ids, construir) {
    ids.forEach(function (id) {
      var box = $(id);
      if (!box) return;
      box.textContent = "";
      construir(box);
    });
  }

  function ocultar(ids, oculto) {
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = oculto;
    });
  }

  function renderChips() {
    pintar(["cats", "cats-p"], function (box) {
      box.appendChild(chip("Todo", DATA.products.length, !state.cat, function () {
        state.cat = ""; state.brand = ""; state.page = 1; commit();
      }));
      DATA.categories.forEach(function (c) {
        box.appendChild(chip(c.name, c.count, state.cat === c.name, function () {
          state.cat = state.cat === c.name ? "" : c.name;
          state.brand = "";
          state.page = 1;
          commit();
        }));
      });
    });

    var brands = brandsInScope();
    ocultar(["brand-block", "brand-block-p"], brands.length === 0);
    pintar(["brands", "brands-p"], function (box) {
      if (!brands.length) return;
      box.appendChild(chip("Todas", null, !state.brand, function () {
        state.brand = ""; state.page = 1; commit();
      }));
      brands.forEach(function (b) {
        box.appendChild(chip(b.name, b.count, state.brand === b.name, function () {
          state.brand = state.brand === b.name ? "" : b.name;
          state.page = 1;
          commit();
        }));
      });
    });

    var sizes = sizesInScope();
    ocultar(["size-block", "size-block-p"], sizes.length === 0);
    pintar(["sizes", "sizes-p"], function (box) {
      if (!sizes.length) return;
      box.appendChild(chip("Todas", null, !state.size, function () {
        state.size = ""; state.page = 1; commit();
      }));
      sizes.forEach(function (s) {
        box.appendChild(chip(s.name, s.count, state.size === s.name, function () {
          state.size = state.size === s.name ? "" : s.name;
          state.page = 1;
          commit();
        }));
      });
    });

    $("reset").hidden = !(state.cat || state.brand || state.size || state.q);

    // Solo las filas de la barra se desplazan; las del panel van en varias lineas.
    ["cats", "brands", "sizes"].forEach(function (id) {
      revealActive($(id));
      updateScrollHints($(id));
    });
    renderPills();
  }

  /* Filtros activos como pastillas quitables: en movil los chips viven dentro del panel,
     asi que sin esto no habria forma de ver que hay filtrado sin abrirlo. */
  function activeFilters() {
    var out = [];
    if (state.cat) out.push({ label: state.cat, clear: function () { state.cat = ""; state.brand = ""; } });
    if (state.brand) out.push({ label: state.brand, clear: function () { state.brand = ""; } });
    if (state.size) out.push({ label: "Talla " + state.size, clear: function () { state.size = ""; } });
    if (state.q) out.push({ label: '"' + state.q + '"', clear: function () { state.q = ""; $("q").value = ""; } });
    return out;
  }

  function renderPills() {
    var active = activeFilters();
    var box = $("pills");
    box.textContent = "";
    box.hidden = active.length === 0;

    active.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pill";
      b.setAttribute("aria-label", "Quitar filtro " + f.label);
      var txt = document.createElement("span");
      txt.textContent = f.label;
      var x = document.createElement("em");
      x.textContent = "×";
      b.appendChild(txt);
      b.appendChild(x);
      b.addEventListener("click", function () {
        f.clear();
        state.page = 1;
        commit();
      });
      box.appendChild(b);
    });

    [$("fbadge"), $("fab-badge")].forEach(function (badge) {
      if (!badge) return;
      badge.hidden = active.length === 0;
      badge.textContent = active.length;
    });
  }

  function card(product, index) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "card";

    var img = document.createElement("img");
    img.className = "card-img";
    img.src = "img/grid/" + product.ref + ".webp";
    img.width = product.w;
    img.height = product.h;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = product.cat + " referencia " + product.ref;
    b.appendChild(img);

    var body = document.createElement("div");
    body.className = "card-body";

    var ref = document.createElement("div");
    ref.className = "card-ref";
    ref.textContent = product.ref;
    body.appendChild(ref);

    var cat = document.createElement("p");
    cat.className = "card-cat";
    cat.textContent = product.sub || product.cat;
    body.appendChild(cat);

    // Disponibilidad por talla: lo que hoy obliga a abrir cinco carpetas en Drive.
    // Se pintan las tallas de SU categoria, no la lista global: si mañana entra una categoria
    // con XS..5XL, esta seguira mostrando solo las suyas en vez de nueve badges por tarjeta.
    if (product.sizes.length) {
      var tallas = document.createElement("div");
      tallas.className = "tallas";
      (CAT_SIZES[product.cat] || DATA.sizeOrder).forEach(function (s) {
        var t = document.createElement("span");
        t.className = "talla" + (product.sizes.indexOf(s) !== -1 ? " on" : "");
        t.textContent = s;
        tallas.appendChild(t);
      });
      body.appendChild(tallas);
    }

    b.appendChild(body);
    b.addEventListener("click", function () { openLightbox(index); });
    return b;
  }

  function renderGrid() {
    var grid = $("grid");
    grid.textContent = "";
    var start = (state.page - 1) * CFG.PER_PAGE;
    var page = VIEW.slice(start, start + CFG.PER_PAGE);
    var frag = document.createDocumentFragment();
    page.forEach(function (p, i) { frag.appendChild(card(p, start + i)); });
    grid.appendChild(frag);

    $("empty").hidden = VIEW.length !== 0;
    $("empty-msg").textContent = state.q
      ? 'No se encontró nada para "' + state.q + '" en todo el catálogo.'
      : "No hay productos con esos filtros.";

    var count = $("count");
    count.textContent = "";
    if (VIEW.length) {
      var b = document.createElement("b");
      b.textContent = VIEW.length.toLocaleString("es-CO");
      count.appendChild(b);
      var rango = VIEW.length > CFG.PER_PAGE
        ? " · mostrando " + (start + 1) + "-" + (start + page.length)
        : "";
      count.appendChild(document.createTextNode(
        (VIEW.length === 1 ? " producto" : " productos") + rango));
      // Deja claro por que aparecen productos de fuera de la categoria seleccionada.
      if (state.q && (state.cat || state.brand || state.size)) {
        var nota = document.createElement("em");
        nota.className = "nota";
        nota.textContent = " · buscando en todo el catálogo";
        count.appendChild(nota);
      }
    }
  }

  function pageButton(label, page, opts) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (opts && opts.current) b.setAttribute("aria-current", "true");
    if (opts && opts.disabled) b.disabled = true;
    else b.addEventListener("click", function () { goToPage(page); });
    return b;
  }

  function renderPager() {
    var pager = $("pager");
    pager.textContent = "";
    var total = Math.ceil(VIEW.length / CFG.PER_PAGE);
    if (total <= 1) return;

    pager.appendChild(pageButton("‹", state.page - 1, { disabled: state.page === 1 }));

    // Ventana de paginas alrededor de la actual, con primera y ultima siempre visibles.
    var pages = [];
    for (var i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - state.page) <= 1) pages.push(i);
    }
    var prev = 0;
    pages.forEach(function (n) {
      if (prev && n - prev > 1) {
        var dots = document.createElement("span");
        dots.className = "dots";
        dots.textContent = "…";
        pager.appendChild(dots);
      }
      pager.appendChild(pageButton(String(n), n, { current: n === state.page }));
      prev = n;
    });

    pager.appendChild(pageButton("›", state.page + 1, { disabled: state.page === total }));
  }

  function goToPage(n) {
    state.page = n;
    commit();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* Recalcula y repinta todo, y refleja el estado en la URL. */
  function commit(replaceHistory) {
    applyFilters();
    renderChips();
    renderGrid();
    renderPager();
    $("apply-n").textContent = VIEW.length === 1
      ? "1 producto"
      : VIEW.length.toLocaleString("es-CO") + " productos";
    writeURL(replaceHistory);
  }

  // ------------------------------------------------------------------ panel de filtros

  function setPanel(open) {
    $("filters").classList.toggle("filters--open", open);
    $("scrim").hidden = !open;
    $("open-filters").setAttribute("aria-expanded", open ? "true" : "false");
    // Bloquea el scroll del catalogo mientras el panel esta encima.
    document.body.style.overflow = open ? "hidden" : "";
    if (open) $("panel").scrollTop = 0;
    actualizarBarra();
  }

  /* La barra de filtros ocupa ~170px de alto. En un movil de 640 eso es un tercio de la
     pantalla mientras el cliente recorre el catalogo, asi que se esconde al bajar y vuelve
     al subir, como en cualquier app. */
  var UMBRAL_BARRA = 150;   // altura a partir de la cual se considera que ya no estamos arriba

  /* No depende de la direccion del scroll, solo de la posicion: la barra de filtros pertenece
     a la parte de arriba de la pagina y el boton de abajo cubre todo lo demas. Antes la barra
     reaparecia al menor movimiento hacia arriba y se quedaba tapando el catalogo mientras uno
     seguia subiendo; asi es predecible y nunca hay que adivinar. */
  function actualizarBarra() {
    var filtros = $("filters");
    var panelAbierto = filtros.classList.contains("filters--open");
    var lejosDeArriba = window.scrollY > UMBRAL_BARRA;
    filtros.classList.toggle("oculto", lejosDeArriba && !panelAbierto);
    $("fab").classList.toggle("visible", lejosDeArriba && !panelAbierto);
  }

  function wireAutoHide() {
    var ultimoProceso = 0;

    // Limitador por tiempo en vez de requestAnimationFrame: solo se cambia una clase, no hace
    // falta ir al ritmo del repintado, y asi el comportamiento es verificable sin depender
    // de que el navegador sirva un frame.
    window.addEventListener("scroll", function () {
      var ahora = Date.now();
      if (ahora - ultimoProceso < 80) return;
      ultimoProceso = ahora;
      actualizarBarra();
    }, { passive: true });
  }

  function wireFab() {
    $("fab").addEventListener("click", function () { setPanel(true); });
  }

  function wirePanel() {
    $("open-filters").addEventListener("click", function () {
      setPanel(!$("filters").classList.contains("filters--open"));
    });
    $("close-filters").addEventListener("click", function () { setPanel(false); });
    $("panel-apply").addEventListener("click", function () { setPanel(false); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("panel-clear").addEventListener("click", function () {
      state.cat = state.brand = state.size = "";
      state.page = 1;
      commit();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !lb.open) setPanel(false);
    });
    // Al pasar a escritorio el panel deja de ser una capa: hay que soltar el scroll.
    window.matchMedia("(min-width: 700px)").addEventListener("change", function (e) {
      if (e.matches) setPanel(false);
    });
  }

  // ------------------------------------------------------------------ lightbox

  var lb = $("lb");

  function openLightbox(index) {
    LB_INDEX = index;
    var p = VIEW[index];
    if (!p) return;
    LB_SIZE = p.sizes.length ? p.sizes[0] : null;

    $("lb-img").src = "img/full/" + p.ref + ".webp";
    $("lb-img").alt = p.cat + " referencia " + p.ref;
    $("lb-cat").textContent = p.cat + (p.sub ? " · " + p.sub : "");
    $("lb-ref").textContent = p.ref;

    var wrap = $("lb-sizes-wrap");
    var box = $("lb-sizes");
    box.textContent = "";
    wrap.hidden = p.sizes.length === 0;
    p.sizes.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lb-size";
      b.textContent = s;
      b.setAttribute("aria-pressed", s === LB_SIZE ? "true" : "false");
      b.addEventListener("click", function () {
        LB_SIZE = s;
        Array.prototype.forEach.call(box.children, function (c) {
          c.setAttribute("aria-pressed", c === b ? "true" : "false");
        });
        $("lb-wa").href = waLink(p, LB_SIZE);
      });
      box.appendChild(b);
    });

    $("lb-wa").href = waLink(p, LB_SIZE);
    $("lb-prev").disabled = index === 0;
    $("lb-next").disabled = index >= VIEW.length - 1;

    if (!lb.open) lb.showModal();
  }

  function step(delta) {
    var next = LB_INDEX + delta;
    if (next >= 0 && next < VIEW.length) openLightbox(next);
  }

  $("lb-x").addEventListener("click", function () { lb.close(); });
  $("lb-prev").addEventListener("click", function () { step(-1); });
  $("lb-next").addEventListener("click", function () { step(1); });
  lb.addEventListener("click", function (e) { if (e.target === lb) lb.close(); });
  document.addEventListener("keydown", function (e) {
    if (!lb.open) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  // ------------------------------------------------------------------ arranque

  function wireControls() {
    var input = $("q");
    input.value = state.q;
    var timer;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = input.value;
        state.page = 1;
        commit(true);
      }, 180);
    });

    function clearAll() {
      state.cat = state.brand = state.size = state.q = "";
      state.page = 1;
      input.value = "";
      commit();
    }
    $("reset").addEventListener("click", clearAll);
    $("empty-reset").addEventListener("click", clearAll);
    wirePanel();
    wireScrollHints();
    wireAutoHide();
    wireFab();

    window.addEventListener("popstate", function () {
      readURL();
      $("q").value = state.q;
      applyFilters();
      renderChips();
      renderGrid();
      renderPager();
    });
  }

  fetch("catalog.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (json) {
      DATA = json;
      DATA.categories.forEach(function (c) { CAT_SIZES[c.name] = c.sizes; });

      document.title = CFG.STORE + " · Catálogo";
      $("foot-store").textContent = CFG.STORE;
      $("tagline").textContent = CFG.TAGLINE;
      $("wa-header").href = "https://wa.me/" + CFG.WHATSAPP + "?text=" +
        encodeURIComponent("Hola! Vengo del catalogo de " + CFG.STORE + ".");
      $("foot-meta").textContent =
        DATA.products.length.toLocaleString("es-CO") + " productos · " +
        DATA.categories.length + " categorías · actualizado " + DATA.generated;

      readURL();
      wireControls();
      commit(true);
    })
    .catch(function (err) {
      $("count").textContent = "No se pudo cargar el catálogo (" + err.message + ").";
    });
})();
