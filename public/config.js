/* ------------------------------------------------------------------
   NEPTUS STORE - configuracion editable
   Este es el unico archivo que hay que tocar para cambiar el negocio.
   ------------------------------------------------------------------ */

window.CONFIG = {

  // Numero de WhatsApp que recibe los pedidos.
  // Formato: indicativo de pais + numero, SIN el "+", SIN espacios ni guiones.
  WHATSAPP: "573112507084",          // +57 311 250 7084

  // Nombre completo: titulo de la pestana, pie de pagina y mensaje de WhatsApp.
  // El logo de la cabecera NO sale de aqui: es public/logo.png, se cambia reemplazando ese
  // archivo (PNG con fondo transparente).
  STORE: "NEPTUS STORE",
  TAGLINE: "Catalogo completo · Envios a todo el pais",

  // Cuantos productos se muestran por pagina.
  PER_PAGE: 48,

  // Viendo el catalogo completo, cuantos productos seguidos de la misma categoria antes de
  // pasar a la siguiente. Con 2, la primera pagina ensena las 18 categorias en vez de vaciar
  // la primera entera. Subirlo agrupa mas; bajarlo a 1 alterna producto a producto.
  POR_CATEGORIA: 2,

  // Mensaje que se escribe solo en WhatsApp al pulsar "Pedir por WhatsApp".
  // El enlace apunta a la foto del producto: el dueno lo toca y la ve, sin tener que
  // buscarla entre 1.016 referencias.
  MSG: function (producto, talla, enlace) {
    var lineas = ["Hola! Me interesa este producto del catalogo:", ""];
    lineas.push("Referencia: " + producto.ref);
    lineas.push("Categoria: " + producto.cat + (producto.sub ? " / " + producto.sub : ""));
    if (talla) lineas.push("Talla: " + talla);
    if (enlace) lineas.push("", enlace);
    lineas.push("", "Sigue disponible?");
    return lineas.join("\n");
  }
};
