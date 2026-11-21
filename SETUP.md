# Facturador ARCA: guía de puesta en marcha

Actualizada el 21/11/2026 (correcciones de la auditoría). Son dos partes que se pueden hacer en paralelo:
**A) trámites en ARCA** (los hace la titular del CUIT) y **B) poner a andar el
código** (desde la PC).

> **Ojo con el 1/12/2026.** Desde esa fecha ARCA rechaza toda factura que no
> informe la *condición frente al IVA del receptor* (RG 5616). Este facturador ya
> la manda, pero **no va a estar en producción para el 1/12**. Mientras tanto se
> sigue facturando con ADM Global, así que hay que confirmar con ADM Global que
> su versión ya manda ese dato. Si no lo manda, el 1/12 se corta la facturación.

---

## A) Trámites en ARCA

Los nombres de los menús de ARCA cambian seguido. Si algo no coincide, buscá la
opción equivalente.

### A.1: Certificado de HOMOLOGACIÓN (pruebas). Empezar por acá

Con este certificado se prueba todo sin emitir facturas reales. No necesita punto
de venta dado de alta.

1. Entrar a ARCA con clave fiscal → **Administrador de Relaciones de Clave
   Fiscal** → *Adherir servicio* → ARCA → Servicios interactivos →
   **"WSASS - Autogestión Certificados Homologación"**. Cerrar sesión y volver a
   entrar.
2. Generar la clave privada y el pedido de certificado (CSR). En la PC, desde
   **Git Bash** (viene con Git para Windows), reemplazando el CUIT:
   ```
   openssl genrsa -out homo.key 2048
   MSYS_NO_PATHCONV=1 openssl req -new -key homo.key -subj "/C=AR/O=Taller Artesanal/CN=tallerhomo/serialNumber=CUIT 27XXXXXXXXX" -out homo.csr
   openssl req -in homo.csr -noout -subject
   ```
   ⚠️ El `MSYS_NO_PATHCONV=1` del principio es obligatorio en **Git Bash**: sin
   eso Git Bash convierte el `/C=AR/...` en una ruta de Windows y OpenSSL falla
   con "Subject does not start with '/'". El último comando tiene que mostrar
   `serialNumber = CUIT 27...`: sin ese dato ARCA rechaza el CSR.
3. Entrar a **WSASS** → *Nuevo certificado* → nombre `tallerhomo` → pegar el
   contenido de `homo.csr` → descargar/copiar el certificado y guardarlo como
   `homo.crt`.
4. En WSASS → *Crear autorización a servicio* → elegir el certificado
   `tallerhomo` y el servicio **wsfe** (Facturación Electrónica).

### A.2: Certificado de PRODUCCIÓN (facturas reales)

1. ✅ Clave fiscal nivel 3 (ya confirmada).
2. Revisar en el **Administrador de Relaciones** si hay una autorización de
   *Facturación Electrónica* a favor de ADM Global. **No tocarla**: ADM Global
   tiene que seguir funcionando hasta que este sistema esté probado.
3. Adherir **"Administración de Certificados Digitales"** (mismo camino que
   A.1.1). Cerrar sesión y volver a entrar.
4. Generar otra clave y otro CSR (no reusar los de homologación):
   ```
   openssl genrsa -out prod.key 2048
   MSYS_NO_PATHCONV=1 openssl req -new -key prod.key -subj "/C=AR/O=Taller Artesanal/CN=tallerfacturador/serialNumber=CUIT 27XXXXXXXXX" -out prod.csr
   openssl req -in prod.csr -noout -subject
   ```
5. En *Administración de Certificados Digitales* → *Agregar alias*
   `tallerfacturador` → subir `prod.csr` → descargar el certificado como
   `prod.crt`.
6. **Administrador de Relaciones** → *Nueva relación* → ARCA → WebServices →
   **Facturación Electrónica** → representante: el computador fiscal
   `tallerfacturador` → confirmar.
7. **Puntos de Venta y Domicilios** → alta de un punto de venta **nuevo**, en el
   sistema que diga **"Web Services"** (no "Comprobantes en línea" ni
   "Controlador fiscal"). Tiene que ser distinto al de ADM Global. Anotar el
   número.
8. Confirmar la **condición frente al IVA** del CUIT en la Constancia de
   Inscripción: Monotributo emite C, Responsable Inscripto emite A/B.

🔒 **Los `.key` son la firma fiscal del CUIT.** No se mandan por WhatsApp ni por
mail, no se pegan en ningún chat y nunca van al repositorio (el `.gitignore` ya
los bloquea). Guardalos en una carpeta fuera del repo y con un backup en un
pendrive.

---

## B) Puesta en marcha del código

### B.1: Requisitos

- **Plan Blaze** de Firebase (pago por uso). Cloud Functions y Secret Manager lo
  exigen. Con este volumen el costo es casi nulo (Secret Manager ronda los
  USD 0,06 por secret por mes). Poné una alerta de presupuesto de USD 5 en Google
  Cloud para dormir tranquilo.
- **Node.js 22 LTS** (nodejs.org). Node 20 ya no sirve: Google lo dio de baja en
  Cloud Functions el 30/10/2026 y no deja desplegar con esa versión.
- Firebase CLI:
  ```
  npm install -g firebase-tools
  firebase login
  ```

### B.2: Dependencias y pruebas locales

```
cd functions
npm install
npm test
```
`npm test` corre unas 100 pruebas sin tocar ARCA ni Firebase: que `index.js`
cargue de verdad (sin stubs), firma del login, caché del ticket, XML exacto que
se manda, doble click, cortes de red, timeouts, recuperación, los casos de
doble factura que encontró la auditoría y el PDF. Tiene que terminar en
"✅ Todas las pruebas pasaron". Los PDF de ejemplo quedan en
`functions/test/out/` (se pueden borrar).

### B.3: Reglas de Firestore y usuarios (no saltear)

Las reglas actuales viven solo en la consola (**Firestore → pestaña Reglas**) y,
por lo que hace el código, probablemente están muy abiertas (por ejemplo,
`analisis-clientas-taller.html` lee todos los pedidos sin login).

En el repo está **`firestore.rules.propuesta`**: unas reglas completas,
comentadas, que:
- dejan que el catálogo público siga creando pedidos sin login, pero solo con la
  forma exacta del catálogo y **sin** datos fiscales (ni `factura:true`, ni CUIT,
  ni CAE);
- siguen permitiendo `carritos/{tel}` y `fidelidad/{tel}` del catálogo, acotados;
- exigen ser del staff (por UID) para leer pedidos;
- impiden que el navegador cambie `cae`, `nroComprobante`, `facturaPdfUrl`,
  `facturaAmbiente`, `facturaIntento`, etc. de una factura de producción (solo
  la Cloud Function los escribe). "Borrar factura de PRUEBA" sigue andando en
  homologación;
- cierran `_arca_tickets`, `_arca_numeracion` y la edición de
  `pedidos/_config_facturacion` para el navegador;
- permiten `maestros` y `costos_*` a usuarios logueados.

⚠️ **Advertencias:**
1. **No las publiques sin probarlas.** Seguí la lista de casos que está al
   principio del archivo en el *Simulador de reglas* de la consola, y guardá
   antes una copia de las reglas actuales para volver atrás.
2. Hay que reemplazar `UID_GERMAN` y `UID_NORA` por los UID reales
   (Authentication → Users). Con un UID mal copiado, esa persona se queda sin
   panel.
3. `analisis-clientas-taller.html` deja de funcionar hasta que tenga login.
4. El archivo **no** está enganchado al deploy (no está en `firebase.json`):
   se copia a mano en la consola. Si más adelante querés desplegarlo con el
   CLI, renombralo a `firestore.rules` y agregá
   `"firestore": {"rules": "firestore.rules"}` a `firebase.json`.
5. Si tenés Java en la PC, podés probarlas con el emulador: ver las
   instrucciones al principio de `functions/test/reglas/reglas.test.mjs`.

Además, en **Authentication → Configuración → Acciones del usuario**, desactivá
**"Habilitar la creación (registro)"** si la opción aparece: las cuentas las
creás vos a mano desde la consola. Así nadie puede crearse una cuenta con un
mail de la lista de autorizados.

### B.4: Config fiscal en Firestore

Consola de Firestore → colección `pedidos` → *Agregar documento* con ID
`_config_facturacion`:

| Campo | Tipo | Ejemplo |
|---|---|---|
| `esConfig` | boolean | `true` |
| `ambiente` | string | `"homologacion"` (pasa a `"produccion"` recién al final) |
| `puntoVenta` | number | `5` (en homologación sirve cualquiera, por ejemplo 1) |
| `condicionIVAEmisor` | string | `"monotributo"` o `"responsable_inscripto"` |
| `cuitEmisor` | string | `"27XXXXXXXXX"` |
| `razonSocialEmisor` | string | nombre de la titular tal como figura en ARCA |
| `nombreFantasia` | string | `"Taller Artesanal"` |
| `domicilioEmisor` | string | domicilio fiscal |
| `iibbEmisor` | string | número de Ingresos Brutos (si es igual al CUIT, dejalo vacío y el PDF muestra el CUIT) |
| `inicioActividades` | string | `"01/03/2015"` (**obligatorio en producción**, lo exige la RG 1415) |
| `uidsAutorizados` | array | **recomendado**: los UID de Germán y Nora (Authentication → Users → "User UID") |
| `emailsAutorizados` | array | `maciangerman@gmail.com`, y el mail de Nora (se usa solo si no hay `uidsAutorizados`) |
| `limiteConsumidorFinal` | number | opcional; por defecto `10000000` (ver abajo) |

**Quién puede facturar:** si existe `uidsAutorizados` (con al menos un UID),
manda esa lista y se ignoran los mails. Si no existe, se usa
`emailsAutorizados` como antes. Conviene cargar `uidsAutorizados`: las cuentas
de email/contraseña no tienen el mail verificado, así que con solo
`emailsAutorizados` alguien podría registrarse con un mail de la lista que
todavía no tenga cuenta. El UID no se puede "copiar".

**Consumidor Final por montos grandes:** desde **$10.000.000** la factura a
Consumidor Final tiene que identificar al cliente (RG 5700/2025, vigente desde
el 29/05/2025; la misma resolución eliminó la actualización automática del
monto). El facturador frena antes de llamar a ARCA si el pedido no trae
documento. Se carga el **DNI** (7 u 8 dígitos) o el CUIT en el campo CUIT del
pedido: con DNI sale como DocTipo 96. Si ARCA cambia el tope, cargá el nuevo
valor en `limiteConsumidorFinal` sin tocar el código.

### B.5: Certificados como secrets

Desde la carpeta donde están los archivos (fuera del repo):
```
firebase functions:secrets:set ARCA_CERT_HOMOLOG --data-file=homo.crt
firebase functions:secrets:set ARCA_KEY_HOMOLOG  --data-file=homo.key
```
Los de producción todavía no existen, pero el deploy los exige. Creálos con un
texto provisorio y reemplazalos cuando tengas el certificado real:
```
firebase functions:secrets:set ARCA_CERT_PROD    (escribir: PENDIENTE)
firebase functions:secrets:set ARCA_KEY_PROD     (escribir: PENDIENTE)
```

### B.6: Desplegar

**Antes del primer deploy, crear el bucket de Storage** (si nunca lo hiciste):
consola de Firebase → **Storage** → **Comenzar** → modo producción →
ubicación **southamerica-east1** → Listo. Sin bucket, el deploy de `storage`
falla y la Function no puede subir los PDF (el CAE igual queda guardado y
después se puede tocar "Generar PDF").

```
firebase deploy --only functions,storage
```
Despliega `facturarPedido` y `diagnosticoArca` en `southamerica-east1`, más las
reglas de Storage. Ninguna página del repo usa Storage hoy, pero antes del
primer deploy fijate en la consola (Storage → Rules y Files) que no haya nada
más: estas reglas reemplazan a las que estén cargadas.

### B.7: Probar en homologación (obligatorio)

1. Panel → abrir cualquier pedido → *Requiere factura* → **🔌 Probar conexión
   con ARCA**. Tienen que quedar todos los pasos en ✅ (login WSAA, último número,
   tabla de condiciones IVA). Si falla el login, el mensaje dice por qué.
2. Crear 2 o 3 pedidos de prueba y facturarlos:
   - Consumidor Final sin CUIT → Factura C (o B si es RI).
   - Con CUIT de prueba `20409378472` y condición elegida.
   - El PDF tiene que decir "PRUEBA - SIN VALIDEZ FISCAL" y el QR tiene que
     abrir la página de ARCA al escanearlo con el celu.
   - Números correlativos.
   - Doble click rápido en "Facturar": tiene que salir una sola.
3. Para repetir pruebas sobre el mismo pedido: **🧪 Borrar factura de PRUEBA**
   (solo aparece en homologación).

### B.8: Pasar a producción

1. Varios días de prueba sin errores.
2. Cargar los secrets `ARCA_CERT_PROD` y `ARCA_KEY_PROD` reales y volver a
   desplegar (`firebase deploy --only functions`).
3. En la config: `ambiente` = `"produccion"` y `puntoVenta` = el número nuevo de
   A.2.7.
4. Primera factura real de bajo monto → validarla en **"Constatación de
   Comprobantes"** de ARCA.
5. Después de dos semanas sin problemas, dejar de usar ADM Global.

---

## Cómo funciona (resumen técnico)

- **Botón "Facturar con ARCA"** → primero guarda en Firestore lo que está en el
  formulario (CUIT, total, condición IVA) → pide confirmación → llama a la Cloud
  Function `facturarPedido`.
- La función: verifica que el usuario esté autorizado (UID o mail) → toma un lock del pedido en una
  transacción → valida datos → login WSAA (ticket cacheado 12 h en
  `_arca_tickets`) → pide el último número a ARCA → **guarda el intento** →
  pide el CAE → **guarda el CAE en el pedido de inmediato** → genera el PDF con QR
  → lo sube a Storage → libera el lock.
- **Si se corta la conexión** después de que ARCA emitió, el próximo click
  consulta a ARCA (`FECompConsultar`) y recupera esa misma factura en vez de
  emitir otra.
- **Si falla el PDF**, el CAE ya quedó guardado: el botón pasa a "Generar PDF" y
  solo rehace el PDF.
- **Registro de numeración** (`_arca_numeracion`): antes de pedir el CAE con
  el número N se anota qué pedido lo pide. Así, si un envío viejo del mismo
  pedido llega tarde a ARCA, se adopta en vez de emitir otro; y nunca se
  adopta la factura de otro pedido aunque tenga el mismo importe. Si hay una
  duda real, no emite nada y pide revisar en ARCA ("Mis Comprobantes"). La
  numeración la sigue decidiendo ARCA (último autorizado + 1).
- Si otro pedido tiene un pedido de CAE sin respuesta con el mismo número,
  espera unos segundos; si no se resuelve, avisa "probá de nuevo en N
  segundos" (hasta 2 minutos).
- Si otro sistema ocupó el número (error 10016), reintenta con el siguiente.
- **Timeouts:** cada llamada a ARCA corta a los 20 s y todo el trámite con
  ARCA a los ~95 s, así la Function (120 s) siempre contesta con un mensaje
  claro. Si el corte fue justo al pedir el CAE, el mensaje dice que puede
  haberse emitido y que se vuelva a tocar "Facturar" en un minuto: el sistema
  verifica en ARCA antes de emitir otra.
- **Ticket de ARCA:** si dos facturas se loguean a la vez, se hace un solo
  login; si ARCA rechaza el ticket guardado (cambió la CUIT o el
  certificado), se borra y se pide uno nuevo.
- **PDF:** el detalle sale tal como se cargó en el pedido ("2 x Rompecabezas").
  La RG 1415 pide cantidad, precio unitario y subtotal: hoy el panel no guarda
  precios por ítem, así que conviene escribir el detalle con precios o validar
  con la contadora. Si un pedido trae `detalleFactura`
  (`[{cantidad, descripcion, precioUnitario}]`) y la suma da el total, el PDF
  arma la tabla con precios. El domicilio del cliente se toma del pedido
  (`domicilioReceptor`) o de la base de clientes de Datos (por CUIT).
- Fechas en hora argentina (las Functions corren en UTC).

## Cambios del 20/11/2026 respecto de la primera versión

- Se agregó `CondicionIVAReceptorId` (RG 5616, obligatorio desde el 1/12/2026) y
  el selector "Condición IVA del cliente" en el panel.
- Se corrigió el orden de los campos del XML según el manual de WSFEv1.
- Node 22, ya que Node 20 fue dado de baja.
- Recuperación ante cortes de red y PDF separado del CAE: no hay doble emisión.
- Solo facturan los mails en `emailsAutorizados`.
- Las letras A/B/C se deciden por emisor y receptor (RI a Monotributista = A,
  según RG 5003) y se validan antes de llamar a ARCA.
- Se valida el dígito verificador del CUIT.
- PDF completo: ORIGINAL, código de comprobante, IIBB, inicio de actividades,
  condición IVA del cliente, leyendas, varias páginas, marca de PRUEBA.
- Panel: guarda antes de facturar, confirmación, no se puede desmarcar una
  factura con CAE, "Generar PDF", "Probar conexión", "Borrar factura de prueba".
- Se corrigió el comando del CSR (faltaba `serialNumber=CUIT`).
- Texto por defecto del detalle: "Juguetes didácticos de madera" (antes decía
  "Indumentaria").

## Cambios del 21/11/2026 (auditoría)

- **Crítico:** `functions/src/admin.js` usaba la API vieja de firebase-admin,
  que la v14 eliminó: el deploy fallaba. Ahora usa la API modular y hay una
  prueba que carga `index.js` de verdad.
- Registro de numeración contra las dos formas de doble factura encontradas
  (reintento por 10016 con un envío viejo en vuelo, y recuperación que adoptaba
  la factura de otro pedido de Consumidor Final con el mismo importe).
- Timeouts en todas las llamadas a ARCA, login único y relectura del ticket
  ante "alreadyAuthenticated", invalidación del ticket ante errores 600/601.
- `uidsAutorizados`, tope de Consumidor Final, DNI, `inicioActividades`
  obligatorio en producción, domicilio del cliente, razón social larga partida
  en líneas, leyenda "A CONSUMIDOR FINAL".
- Storage: los PDF se pueden descargar con el link pero no listar.
- La Function acepta `totalEsperado` (opcional): si el panel lo manda y el
  total guardado no coincide, no emite.
- El panel tiene que esperar más que la Function: `httpsCallable(..., { timeout: 130000 })`.

## No se tocó

`index.html` (catálogo público), el worker de Mercado Pago y el resto del panel.
