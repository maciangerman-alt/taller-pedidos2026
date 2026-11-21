# LEEME: Facturador ARCA para taller-pedidos2026

**Estado al 20/11/2026:** el código está revisado y probado sin conexión (más de 40
pruebas automáticas del backend con un ARCA simulado, más pruebas del panel en el
navegador). Todavía **no se probó contra ARCA real**: falta el certificado de
homologación. Nada está subido a GitHub.

## Qué hay

- `functions/`: Cloud Functions (Node 22).
  - `facturarPedido`: emite la factura (WSAA + WSFEv1), genera el PDF con QR y lo
    sube a Storage.
  - `diagnosticoArca`: prueba la conexión sin emitir nada.
  - `npm test`: pruebas locales.
- `taller-pedidos-v10.html`: en el modal del pedido, sección Facturación, están el
  selector de condición IVA del cliente, "Facturar con ARCA", "Ver PDF", "Enviar
  por WhatsApp", "Generar PDF", "Probar conexión" y "Borrar factura de prueba".
- `firebase.json`, `.firebaserc`, `storage.rules`, `.gitignore`.

## Qué sigue

Todo el paso a paso (trámites en ARCA, deploy, pruebas y paso a producción) está
en **`SETUP.md`**.

Orden recomendado:
1. Certificado de **homologación** por WSASS (SETUP A.1).
2. Node 22 + Firebase CLI + `npm test` (B.1 y B.2).
3. Reglas de Firestore, config y secrets (B.3 a B.5).
4. Deploy y "Probar conexión con ARCA" (B.6 y B.7).

⚠️ Hasta que esto esté en producción se sigue facturando con ADM Global. ADM Global
tiene que informar la condición IVA del receptor desde el **1/12/2026** (RG 5616).
