# Novedades: Inicio, Facturas, Productos y Clientes (21/11/2026)

## Páginas nuevas
- **inicio.html**: pantalla de entrada con cards para Pedidos, Facturas, Productos, Asesor comercial y Requisición de corte, más accesos a Clientes, Tablero de costos, Ruta del día, Análisis de clientas y Catálogo. Muestra contadores (pedidos activos, facturas pendientes, productos, requisiciones activas).
- **facturas.html**:
  - *Pendientes*: pedidos con "Requiere factura" sin emitir. Por defecto muestra solo los entregados y cobrados. La condición IVA se puede elegir ahí mismo. Con "Seleccionar todos" + **Emitir** se facturan en tanda, una por una, con el resultado de cada una.
  - *Emitidas*: PDF y WhatsApp de cada factura, total facturado del mes y de los últimos 12 meses (para controlar la categoría de monotributo). Las facturas de prueba no suman.
- **datos.html**: Productos y Clientes. Sirve para buscar, editar, agregar y borrar, para **importar el Excel/CSV de ADM Global** (detecta las columnas solo, valida CUIT, traduce "RI / Exento / Monotrib. / Cons. Final" a la condición IVA de ARCA) y para exportar a Excel.
- **maestros.js**: módulo compartido. Guarda clientes y productos en pocos documentos para no gastar lecturas del plan gratis: abrir el panel cuesta 2 o 3 lecturas, no miles.

## Cambios en páginas que ya existían
- **Panel de pedidos (taller-pedidos-v10.html)**:
  - Botón 🏠 Inicio.
  - **Escuela**: al escribir 2 o 3 letras busca en la base de clientes (con CUIT y condición IVA) y en la base de 2.121 escuelas de Tucumán. Al elegir un cliente con CUIT, completa solo los datos de facturación.
  - **Productos**: buscador con cantidad. Agrega la línea al detalle y suma el precio sugerido al total, que sigue siendo editable.
  - Al guardar un pedido con CUIT válido, ese cliente queda en la base para la próxima vez. No pisa datos cargados a mano.
  - Al elegir una maestra del historial, también se traen su CUIT, razón social y condición IVA.
- **Costos (costos/index.html)**: botón 🏠 y links directos a cada pestaña: `costos/#consultar` (Asesor) y `costos/#corte` (Corte).

## Pistola de código de barras
- Los productos tienen **código interno** y **código de barras**. El importador detecta las dos columnas de ADM Global ("Cód. Art.", "Cód. Barras", "EAN"...) y lee el código completo aunque Excel lo muestre como `7,79E+12`.
- **En el pedido**: con el formulario abierto, escaneá (sin tocar ningún campo, o con el cursor en "Buscar o escanear producto"). El producto se agrega con su precio. Si volvés a escanear el mismo producto, suma 1 a la misma línea. Si el cursor está en otro campo (nombre, teléfono...), la pistola escribe ahí como siempre y no agrega nada.
- **En Productos**: escaneás y se abre la ficha del producto. Si el código no existe, "+ Agregar" lo trae precargado para darlo de alta.
- La pistola funciona como un teclado: escribe el código muy rápido y aprieta Enter. No hace falta instalar nada.

## Navegación
- Botón **🏠 Inicio** visible en todas las pantallas (Pedidos, Facturas, Productos/Clientes, Costos).
- Pestaña **🧾 Facturas** dentro del panel de pedidos, con el número de pendientes. El botón de facturar dentro de cada pedido sigue igual.
- En Facturas hay un botón para volver a **📦 Pedidos**.

## Qué funciona sin Blaze
Inicio, Productos y Clientes (importar, buscar, editar) y los buscadores del panel ya funcionan con el plan gratis. Lo único que necesita Blaze es **emitir** facturas (botón del pedido y bandeja de Facturas).

## Firestore
Colección nueva: `maestros`. Si las reglas de Firestore limitan colecciones y al importar aparece un error de permisos, hay que permitirla para usuarios con sesión (ver SETUP.md, B.3).

## Correcciones de la auditoría (22/11/2026)
**Facturación**
- Guardar un pedido desde las pestañas Padre / Estudiante / Madre / Jardines ya **no le borra la factura**. Si tiene CAE, "Requiere factura" queda fijo: no se puede destildar desde ningún formulario.
- Si alguien emite la factura desde la bandeja mientras otro tiene el pedido abierto, al guardar no se pisa (tampoco la condición IVA elegida en la bandeja).
- Con "¿Factura ya emitida? (otro sistema)" tildado desaparece el botón "Facturar con ARCA": no se puede hacer doble factura ADM + ARCA.
- La factura sale por el total que se confirmó. Si el total cambió (por ejemplo, se escaneó algo con el cartel abierto) no se emite y se avisa.
- Si ARCA tarda, el sistema espera hasta 5 minutos. Si igual se corta, el mensaje dice: **puede que se haya emitido; volvé a abrir el pedido en unos minutos, el sistema lo recupera solo; NO vuelvas a apretar enseguida**.
- Bandeja de Facturas: los pedidos que **nadie del taller marcó para facturar** (por ejemplo, del catálogo web) aparecen en rojo con 🚩 y "Seleccionar todos" no los marca. Se pueden tildar a mano (pide confirmación) o abrirlos en el panel y guardarlos. Desde ahora el panel deja anotado quién marcó "Requiere factura".
- "Facturado este mes" y "Últimos 12 meses" ahora suman también lo emitido en ADM Global (se muestra el desglose).
- "Pedidos Excel" del panel trae razón social, condición IVA, comprobante, CAE y link al PDF.

**Buscadores y pistola**
- Elegir otra escuela (o escribirla a mano) **borra el CUIT del cliente anterior**: ya no se puede facturar al CUIT equivocado. Si hay un CUIT cargado con "Requiere factura" apagado, se avisa.
- Elegir un cliente ya no pega el teléfono de la institución en el pedido, y el panel ya no guarda el celular de la seño en la ficha del cliente.
- Si se escanea con el cursor en "Cantidad", se agrega el producto (antes ponía una cantidad de 13 dígitos). La cantidad tiene tope 999.
- La pistola no hace nada con un cartel abierto ni en un pedido ya facturado, y no confunde un tipeo rápido corto con un código.
- Los códigos de barras con ceros adelante (0012345678905) se encuentran aunque Excel se haya comido los ceros.

**Productos y Clientes (importar Excel)**
- Los precios con formato de miles (`1,500`) se importan bien: antes quedaban divididos por 1000.
- Los CSV de Google Sheets/LibreOffice (UTF-8) se leen con acentos y eñes. Los códigos como `10-12` o `0001` ya no se convierten en fechas o números.
- "Responsable no inscripto" ya no se toma como Responsable Inscripto: queda con ❓ para revisarlo a mano. Un DNI no se marca como "CUIT inválido".
- Mejor detección de columnas (no confunde el precio de costo con el de venta), de la fila de títulos y de la hoja correcta. Las filas de TOTAL se saltean. Se avisa de CUIT, códigos y códigos de barras repetidos.
- Importar es **todo o nada**: si se corta internet a mitad de camino, la base queda como estaba. Antes de "Reemplazar todo" se guarda una copia (`maestros/<tipo>_respaldo`).
- Si alguien guardó algo en otro celular mientras importabas, no se pisa: avisa y hay que tocar Importar de nuevo.
- Corregir el CUIT o el código de un registro ya no hace que un alta nueva lo pise. Un campo que se vacía se borra de verdad.
- Importar y exportar la base quedan solo para los mails autorizados a facturar (`emailsAutorizados`); el resto puede buscar y editar fichas.

**Otras**
- **Análisis de clientas** pide ingresar con mail y contraseña (antes leía los pedidos sin sesión).
- Inicio cuenta como activos también los pedidos "confirmado" que entran por el catálogo web.
