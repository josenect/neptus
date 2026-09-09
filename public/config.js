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

  // Mensaje que se escribe solo en WhatsApp al pulsar "Pedir por WhatsApp".
  MSG: function (producto, talla) {
    var lineas = ["Hola! Me interesa este producto del catalogo:", ""];
    lineas.push("Referencia: " + producto.ref);
    lineas.push("Categoria: " + producto.cat + (producto.sub ? " / " + producto.sub : ""));
    if (talla) lineas.push("Talla: " + talla);
    lineas.push("", "Sigue disponible?");
    return lineas.join("\n");
  }
};
