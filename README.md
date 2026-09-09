# Catálogo web — NEPTUS STORE

Landing estática que muestra el catálogo del local con filtros por categoría, marca y talla,
paginación, buscador por referencia y pedido directo por WhatsApp.

Las fotos viven en la [carpeta de Drive del local](https://drive.google.com/drive/folders/1LLU01ZYmPlCB2qn96H59IutBrpLl1dVZ);
este proyecto las lee, las convierte a un formato que sí se ve en todos los navegadores y
genera el sitio.

---

## Por qué hace falta convertir las fotos

El 93% de las fotos del Drive son **HEIC** (el formato del iPhone). Chrome, Firefox y Android
**no muestran HEIC**: si la web apuntara directamente a esos archivos, la mayoría de clientes
vería la página en blanco. El build las convierte a WebP en dos tamaños.

Además, agrupa las variantes: la misma foto aparece repetida dentro de `TALLA M`, `TALLA L`,
`TALLA XL`… y eso es justo lo que indica en qué tallas hay ese producto. De **1.532 archivos**
salen **~1.010 productos** con sus tallas marcadas.

---

## Puesta en marcha

Hace falta **Node** (para Vite) y **Python 3.9+ con Pillow** (para generar el catálogo).

```bash
npm install          # una sola vez
npm run dev          # abre http://localhost:8080  (y la IP de red para verlo en el móvil)
npm run build        # genera dist/ , que es lo que se publica
npm run preview      # sirve dist/ tal cual quedará publicado
```

## Cómo actualizar el catálogo cuando suban fotos nuevas a Drive

```bash
npm run catalogo     # crawl.py + build.py + verify.py
npm run build        # vuelve a generar dist/
```

`npm run catalogo` descarga y convierte **solo lo nuevo**. Luego se publica `dist/`.

La primera ejecución tarda unos 25–35 minutos porque descarga ~1.000 fotos. Las siguientes
tardan segundos: lo ya descargado queda en `data/cache/` y no se vuelve a bajar.

> **Importante:** las referencias (`CAM-0142`, `GOR-0031`…) se guardan en `data/refs.json` y
> **no cambian nunca**. Como el dueño se las pasa a los clientes por WhatsApp, ese archivo no
> se debe borrar. Si se borra, todas las referencias se renumeran.

> El crawler necesita que la carpeta de Drive siga compartida como
> **"cualquiera con el enlace"**. Si se quita, deja de funcionar.

---

## Cómo publicarlo gratis (Netlify)

Se publica **`dist/`** (lo genera `npm run build`). `netlify.toml` ya trae el build command y
la carpeta de salida, así que Netlify lo detecta solo.

### Opción rápida — arrastrar la carpeta

1. Entrar en [app.netlify.com](https://app.netlify.com) y crear una cuenta gratis.
2. **Sites → Add new site → Deploy manually**.
3. Arrastrar la carpeta **`dist`** completa.

Para actualizar: entrar al sitio → *Deploys* → arrastrar `dist` otra vez.

### Opción con Git — se actualiza solo

1. Subir este repositorio a GitHub.
2. Netlify → **Add new site → Import an existing project** → elegir el repo.
3. No hay que configurar nada: `netlify.toml` ya define `npm run build` y `dist`.
4. A partir de ahí, cada `git push` republica el sitio.

Vale igual para Cloudflare Pages o GitHub Pages con el mismo build command y carpeta. Como
Vite usa `base: "./"`, el sitio funciona tanto en la raíz de un dominio como en un
subdirectorio del tipo `usuario.github.io/neptus`.

---

## Cambiar el teléfono sin tocar código (el panel de Netlify como formulario)

El panel de Netlify ya es un formulario protegido por contraseña, así que sirve de panel de
configuración sin construir nada:

1. Netlify → el sitio → **Site configuration → Environment variables**.
2. Añadir o editar:

   | Variable | Para qué |
   |---|---|
   | `VITE_WHATSAPP` | Número que recibe los pedidos |
   | `VITE_STORE` | Nombre de la tienda |
   | `VITE_TAGLINE` | Frase bajo el nombre |

3. **Deploys → Trigger deploy → Deploy site**. En ~1 minuto está en vivo.

El número se puede escribir como sea (`+57 311 250 7084`, `311-250-7084`): el sitio le quita
todo lo que no sea dígito. Si estas variables no existen, se usan los valores de
`public/config.js`, así que el sitio funciona igual sin configurar nada.

> Ojo: son variables de **compilación**, no de ejecución. Cambiarlas exige republicar (el
> botón *Trigger deploy*). No basta con guardarlas.

---

## Sincronizar sin depender de nadie (el dueño, desde GitHub)

Cuando se suben fotos o carpetas nuevas a Drive, el dueño puede publicarlas él mismo:

1. Entrar a **github.com** con su cuenta (ahí está la contraseña).
2. En el repositorio → pestaña **Actions** → **Sincronizar catálogo** → botón **Run workflow**.
3. Esperar. El proceso lee Drive, descarga y convierte **solo lo nuevo**, y guarda el
   resultado en el repositorio. Netlify detecta el cambio y republica el sitio solo.

En total, un par de minutos. No hace falta tocar código ni tener nada instalado.

### Por qué está montado así y no dentro de Netlify

- La compilación gratuita de Netlify corta a los **15 minutos**, y la primera pasada del
  pipeline descarga ~1.000 fotos (25-35 min). GitHub Actions da 60.
- Y sobre todo: las referencias (`CAM-0142`) se asignan con un contador guardado en
  `data/refs.json`. Netlify **no puede guardar ese archivo de vuelta** en el repositorio, así
  que en la siguiente publicación se renumerarían y las referencias que el dueño ya le pasó a
  sus clientes dejarían de existir. El Action sí lo guarda, junto con las fotos nuevas.

El workflow guarda entre ejecuciones las fotos ya descargadas (caché de GitHub), por eso la
segunda sincronización y las siguientes tardan segundos en vez de media hora.

> Requiere que el proyecto esté en un repositorio de GitHub y que Netlify esté conectado a él
> por Git (no vale el despliegue arrastrando la carpeta).

---

## Cambiar datos del negocio

Todo lo editable está en **`public/config.js`**, comentado:

| Ajuste | Qué hace |
|---|---|
| `WHATSAPP` | Número que recibe los pedidos. Indicativo + número, sin `+` ni espacios. |
| `STORE` | Nombre que sale en la cabecera y en el pie. |
| `TAGLINE` | Frase pequeña bajo el nombre. |
| `PER_PAGE` | Productos por página (48 por defecto). |
| `MSG` | Texto que se escribe solo en WhatsApp al pedir. |

Cambiar el número de WhatsApp es editar una línea. Ese archivo vive en `public/`, así que
Vite lo copia **sin empaquetar**: también se puede editar directamente en `dist/config.js`
después de compilar, sin volver a construir nada.

Si el sitio está en Netlify, lo normal es no tocar este archivo y usar las variables de
entorno (ver arriba), que no requieren acceso al código.

---

## Estructura

```
index.html           Página (entrada de Vite)
src/app.js           Filtros, paginación, buscador y lightbox
src/styles.css       Estilos (móvil primero)
public/config.js     Ajustes del negocio; se copia sin empaquetar
public/catalog.json  Catálogo generado
public/img/          Fotos ya optimizadas (WebP, dos tamaños)
public/_headers      Cabeceras de caché para Cloudflare/Netlify
vite.config.js       Puerto 8080, salida dist/, rutas relativas
netlify.toml         Build command y carpeta de publicación para Netlify
.env.example         Variables de entorno disponibles

scripts/crawl.py     Lee la carpeta de Drive        -> data/tree.json
scripts/build.py     Descarga, agrupa y convierte   -> public/catalog.json + public/img/**
scripts/verify.py    Revisa que el catálogo esté completo
.github/workflows/   Sincronización que el dueño lanza desde GitHub
data/cache/          Fotos ya descargadas (no borrar: evita volver a bajarlas)
data/refs.json       Referencia de cada producto (NO BORRAR)
dist/                Resultado de npm run build: esto es lo que se publica
```

### Cómo se decide qué es un producto

1. Se recorre el árbol de Drive. Una carpeta `TALLA XL` no es un producto: es una talla de la
   categoría que la contiene.
2. Los archivos con el mismo nombre dentro de una misma categoría son **el mismo producto en
   distintas tallas** (verificado: son la misma imagen byte a byte).
3. Después se comparan las fotos por contenido (hash MD5) para fusionar las que se subieron
   dos veces con nombres distintos o que están repetidas en dos categorías.

### Ajustar el peso de las imágenes

En la cabecera de `scripts/build.py`:

```python
GRID_W, GRID_Q = 450, 72   # miniatura del grid  (~37 KB)
FULL_W, FULL_Q = 900, 72   # imagen al ampliar   (~130 KB)
```

Para regenerar con otros valores hay que borrar `public/img/` y volver a ejecutar `build.py`
(no vuelve a descargar de Drive, solo reconvierte).

---

## Requisitos

- **Node 18+** con npm — solo para Vite (servidor de desarrollo y compilación).
- **Python 3.9+ con Pillow** (`pip3 install Pillow`) — solo para generar el catálogo desde Drive.

El sitio publicado no lleva ninguna librería: es HTML, CSS y JS propios.
