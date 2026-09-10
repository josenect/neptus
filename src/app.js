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

  /* Enlace a la foto del producto, resuelto contra la direccion actual: funciona igual en
     local, en una vista previa de Netlify o en el dominio definitivo, sin configurar nada.
     Va directo al archivo que ya publica el sitio, sin paginas ni archivos extra. */
  function fotoProducto(product) {
    return new URL("img/full/" + product.ref + ".webp", location.href).href;
  }

  function waLink(product, size) {
    return "https://wa.me/" + CFG.WHATSAPP + "?text=" +
      encodeURIComponent(CFG.MSG(product, size, fotoProducto(product)));
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

  /* Los chips se pintan en dos juegos de contenedores: las filas de la barra (que solo se
     ven en escritorio) y el panel (el unico sitio donde se filtra en movil). Solo uno de los
     dos esta visible en cada tamano de pantalla, asi que nunca aparecen duplicados. */
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

    var badge = $("fbadge");
    badge.hidden = active.length === 0;
    badge.textContent = active.length;
  }

  /* Carga por proximidad. Con loading="lazy" el navegador pedia las 48 imagenes de la pagina
     de golpe (2,1 MB medidos), porque al insertarse todas juntas las considera casi visibles.
     Aqui la imagen no tiene src hasta que se acerca a la pantalla.

     Se hace midiendo posiciones en el scroll y no con IntersectionObserver a proposito: es
     igual de barato con 48 imagenes y se puede comprobar de verdad. */
  var MARGEN_CARGA = 700;   // px por delante de la pantalla
  var bloqueoImagenes = false;

  // GIF transparente de 1x1. Sin un src valido el navegador pinta el texto alternativo y la
  // rejilla se ve rota mientras las fotos no han llegado; con esto se ve el fondo gris.
  var VACIA = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  function cargarVisibles() {
    // Mientras se ve el cargador o el selector no se gastan datos en fotos tapadas.
    if (bloqueoImagenes) return;
    var pendientes = $("grid").querySelectorAll("img[data-src]");
    var alto = window.innerHeight || document.documentElement.clientHeight;
    for (var i = 0; i < pendientes.length; i++) {
      var img = pendientes[i];
      var r = img.getBoundingClientRect();
      if (r.top < alto + MARGEN_CARGA && r.bottom > -MARGEN_CARGA) {
        img.src = img.getAttribute("data-src");
        img.removeAttribute("data-src");
      }
    }
  }

  function wireCargaImagenes() {
    var ultimo = 0, cola = null;
    function revisar() {
      var ahora = Date.now();
      if (ahora - ultimo >= 100) { ultimo = ahora; cargarVisibles(); }
      clearTimeout(cola);
      cola = setTimeout(cargarVisibles, 120);
    }
    window.addEventListener("scroll", revisar, { passive: true });
    window.addEventListener("resize", revisar);
  }

  function card(product, index) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "card";

    var img = document.createElement("img");
    img.className = "card-img";
    img.src = VACIA;
    img.setAttribute("data-src", "img/grid/" + product.ref + ".webp");
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

    cargarVisibles();
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
    document.body.classList.toggle("panel-abierto", open);
    $("scrim").hidden = !open;
    $("open-filters").setAttribute("aria-expanded", open ? "true" : "false");
    // Bloquea el scroll del catalogo mientras el panel esta encima.
    document.body.style.overflow = open ? "hidden" : "";
    if (open) $("panel").scrollTop = 0;
  }

  /* La barra de filtros ocupa ~170px de alto. En un movil de 640 eso es un tercio de la
     pantalla mientras el cliente recorre el catalogo, asi que se esconde al bajar y vuelve
     al subir, como en cualquier app. */
  function wirePanel() {
    $("open-filters").addEventListener("click", function () {
      setPanel(!document.body.classList.contains("panel-abierto"));
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

  /* Ver de cerca. El desplazamiento lo hace el navegador; aqui solo se cambia el tamano y se
     centra la vista, que es lo unico que el scroll nativo no hace por si mismo. */
  function ampliar(activar) {
    var caja = $("lb-img-box");
    caja.classList.toggle("zoom", activar);
    lb.classList.toggle("ampliada", activar);
    $("lb-zoom").querySelector(".mas").hidden = activar;
    $("lb-zoom").querySelector(".menos").hidden = !activar;
    $("lb-zoom").setAttribute("aria-label", activar ? "Alejar" : "Ver más de cerca");
    if (activar) {
      // Centrar: al ampliar 2,5 veces, sin esto se queda mirando la esquina de arriba.
      caja.scrollLeft = (caja.scrollWidth - caja.clientWidth) / 2;
      caja.scrollTop = (caja.scrollHeight - caja.clientHeight) / 2;
    } else {
      caja.scrollLeft = caja.scrollTop = 0;
    }
  }

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

    ampliar(false);
    if (!lb.open) lb.showModal();
  }

  function step(delta) {
    var next = LB_INDEX + delta;
    if (next >= 0 && next < VIEW.length) openLightbox(next);
  }

  $("lb-zoom").addEventListener("click", function () {
    ampliar(!$("lb-img-box").classList.contains("zoom"));
  });
  // Tocar la foto ampliada la devuelve a su tamano; tocarla normal no hace nada, para no
  // ampliar sin querer mientras se pasa de producto.
  $("lb-img-box").addEventListener("click", function (e) {
    if (e.target !== $("lb-img")) return;
    if ($("lb-img-box").classList.contains("zoom")) ampliar(false);
  });
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

  // ------------------------------------------------------------------ bienvenida

  var CLAVE_VISTO = "neptus:bienvenida";
  var ARRANQUE = Date.now();
  var MINIMO_CARGADOR = 2000;  // el logo se ve entero, con su animacion, aunque el catalogo
                               // llegue en 200 ms. Si tarda mas, manda lo que tarde.

  /* Quita el cargador y, si toca, abre el selector. Se espera un minimo para que el logo no
     aparezca y desaparezca de golpe: un destello se lee como un fallo, no como una marca. */
  function quitarCargador(despues) {
    var espera = Math.max(0, MINIMO_CARGADOR - (Date.now() - ARRANQUE));
    setTimeout(function () {
      var c = $("cargando");
      c.classList.add("fuera");
      /* Se cruzan: el selector empieza a aparecer por debajo cuando el logo lleva un poco
         desvaneciendose. Si se espera a que el logo termine, en el hueco entre los dos se
         ve el catalogo desnudo un instante, y eso es lo que se notaba como un salto. */
      if (despues) setTimeout(despues, 200);
      setTimeout(function () { c.hidden = true; }, 620);
    }, espera);
  }

  function yaVinoAntes() {
    try { return !!localStorage.getItem(CLAVE_VISTO); }
    catch (e) { return true; }   // navegacion privada: mejor no molestar
  }

  function marcarVisto() {
    try { localStorage.setItem(CLAVE_VISTO, "1"); } catch (e) { /* da igual */ }
  }

  /* No aparece si el enlace ya trae filtros: quien llega por un enlace de WhatsApp con la
     categoria puesta ya eligio, y volverselo a preguntar seria absurdo. */
  function tocaBienvenida() {
    if (state.cat || state.brand || state.size || state.q) return false;
    return !yaVinoAntes();
  }

  function cerrarBienvenida(categoria) {
    marcarVisto();
    bloqueoImagenes = false;
    $("bienvenida").hidden = true;
    document.body.classList.remove("arrancando");
    document.body.style.overflow = "";
    if (categoria) {
      state.cat = categoria;
      state.page = 1;
    }
    commit();
    cargarVisibles();   // ahora si: a pedir las fotos que se vean
  }

  function mostrarBienvenida() {
    var caja = $("bien-grid");
    caja.textContent = "";
    DATA.categories.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bien-item";

      if (c.thumb) {
        var img = document.createElement("img");
        img.src = "img/cat/" + c.thumb + ".webp";
        img.width = 260;
        img.height = 260;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        b.appendChild(img);
      }

      var nombre = document.createElement("b");
      nombre.textContent = c.name;
      b.appendChild(nombre);

      var cuenta = document.createElement("span");
      cuenta.textContent = c.count + (c.count === 1 ? " producto" : " productos");
      b.appendChild(cuenta);

      b.addEventListener("click", function () { cerrarBienvenida(c.name); });
      caja.appendChild(b);
    });

    var total = DATA.products.length.toLocaleString("es-CO");
    $("bien-hola").textContent = total + " productos · " + DATA.categories.length + " categorías";
    $("bien-total").textContent = "(" + total + ")";
    $("bien-todo").addEventListener("click", function () { cerrarBienvenida(null); });
    $("bienvenida").hidden = false;
    document.body.style.overflow = "hidden";
  }

  // ------------------------------------------------------------------ recoger la barra

  var UMBRAL_BARRA = 150;   // arriba del todo la barra siempre esta
  var UMBRAL_SUBIR = 900;   // ~una pantalla y media antes de ofrecer volver arriba
  var ultimoYBarra = 0;

  /* Tres reglas y ninguna mas:
       - arriba del todo -> visible
       - bajando         -> se recoge
       - subiendo        -> se queda como este
     Subir NO la despliega a proposito: reaparecia sola tapando el catalogo justo cuando uno
     esta recorriendolo. Para verla antes de llegar arriba esta la pestaña de la flecha. */
  function actualizarBarra() {
    if (document.body.classList.contains("panel-abierto")) return;
    var y = window.scrollY;
    var bajando = y > ultimoYBarra;
    ultimoYBarra = y;

    if (y <= UMBRAL_BARRA) $("filters").classList.remove("oculto");
    else if (bajando) $("filters").classList.add("oculto");

    // Volver arriba: solo cuando rebobinar a mano ya costaria.
    $("subir").classList.toggle("visible", y > UMBRAL_SUBIR);
  }

  function wireBarra() {
    var ultimo = 0, cola = null;
    window.addEventListener("scroll", function () {
      var ahora = Date.now();
      if (ahora - ultimo >= 100) { ultimo = ahora; actualizarBarra(); }
      // Evaluacion final al parar: si se pierde el ultimo evento del gesto, la barra puede
      // quedarse recogida estando arriba del todo y ahi si se ve la franja vacia.
      clearTimeout(cola);
      cola = setTimeout(actualizarBarra, 130);
    }, { passive: true });

    $("subir").addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    $("tirador").addEventListener("click", function () {
      $("filters").classList.remove("oculto");
      ultimoYBarra = window.scrollY;   // que el proximo gesto se mida desde aqui
    });
  }

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
    wireCargaImagenes();
    wireBarra();

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
      // El selector se abre ANTES de pintar: si no, commit() ya habria pedido las primeras
      // fotos de producto y la guarda de cargarVisibles llegaria tarde.
      var conSelector = tocaBienvenida();
      // El selector se abre al retirar el cargador, cruzandose con el (ver quitarCargador).
      bloqueoImagenes = conSelector;
      commit(true);
      quitarCargador(function () {
        if (conSelector) {
          mostrarBienvenida();
        } else {
          document.body.classList.remove("arrancando");
          cargarVisibles();
        }
      });
    })
    .catch(function (err) {
      // Pase lo que pase el cargador se va: dejarlo puesto seria dejar la pantalla en negro.
      bloqueoImagenes = false;
      document.body.classList.remove("arrancando");   // que un fallo no deje la pagina en blanco
      quitarCargador();
      $("count").textContent = "No se pudo cargar el catálogo (" + err.message + ").";
    });
})();
