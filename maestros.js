/* ============================================================================
   maestros.js — Base de CLIENTES y PRODUCTOS del Taller (compartida por el
   panel de pedidos, Facturas y Datos).

   Cómo se guarda (pensado para el plan gratis de Firebase):
   - En vez de un documento por cliente (3.000 clientes = 3.000 lecturas cada
     vez que alguien abre el panel), se guardan en pocos documentos "bloque"
     de hasta 1.200 ítems cada uno:
        maestros/clientes          → { bloques: N, total, actualizado }
        maestros/clientes_0 .. N-1 → { items: [ {...}, ... ] }
     Abrir el panel cuesta 1 + N lecturas (2 o 3), no miles.
   - Requiere que el navegador ya haya hecho firebase.initializeApp().
   ========================================================================== */
(function (global) {
  'use strict';

  const COL = 'maestros';
  const POR_BLOQUE = 1200;

  // Condición frente al IVA del receptor (tabla de ARCA, RG 5616)
  const COND_IVA = {
    1: 'IVA Responsable Inscripto',
    4: 'IVA Sujeto Exento',
    5: 'Consumidor Final',
    6: 'Responsable Monotributo',
    7: 'Sujeto No Categorizado',
    13: 'Monotributista Social',
    15: 'IVA No Alcanzado',
    16: 'Monotributo Trabajador Indep. Promovido',
  };
  const COND_IVA_CORTO = { 1: 'Resp. Inscripto', 4: 'Exento', 5: 'Cons. Final', 6: 'Monotributo', 7: 'No Categ.', 13: 'Monot. Social', 15: 'No Alcanzado', 16: 'Monot. Promovido' };

  // ------------------------------------------------------------ utilidades
  function sinAcentos(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function soloDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  function cuitValido(cuit) {
    const c = soloDigitos(cuit);
    if (c.length !== 11) return false;
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) suma += pesos[i] * Number(c[i]);
    let dv = 11 - (suma % 11);
    if (dv === 11) dv = 0;
    if (dv === 10) dv = 9;
    return dv === Number(c[10]);
  }
  function formatoCuit(cuit) {
    const c = soloDigitos(cuit);
    return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : String(cuit || '');
  }

  /** "Responsable Inscripto", "RI", "EXENTO", "Cons. Final", "Monotributista", "6"... → código ARCA */
  function condIvaDesdeTexto(txt) {
    const t = sinAcentos(txt).replace(/[.\-_/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (/^\d+$/.test(t) && COND_IVA[Number(t)]) return Number(t);
    if (/social/.test(t)) return 13;
    if (/promovid/.test(t)) return 16;
    if (/no alcanz/.test(t)) return 15;
    if (/no categ/.test(t)) return 7;
    // "Responsable NO inscripto" / "No inscripto" / RNI: categoría que ya no existe.
    // NO se mapea a Resp. Inscripto (daría una Factura A equivocada): queda para revisar a mano.
    if (/no inscrip|^r ?n ?i$|no respons/.test(t)) return null;
    if (/inscrip|^r ?i$|^resp insc|^insc\b/.test(t)) return 1;
    if (/exent|^ex$|^exe$|^e$/.test(t)) return 4;
    if (/consumidor|cons final|^c ?f$/.test(t)) return 5;
    if (/monotrib|monotr|^mt$|^mono$|^m$|^rm$|^r m$/.test(t)) return 6;
    return null;
  }

  /** "1.234,56" / "$ 1234.5" / 1234.56 / "-1.500" / "(1.500,00)" / "$12.500,-" → número */
  function numeroAR(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let t = String(v == null ? '' : v).trim().replace(/,-\s*$/, '');
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    let s = t.replace(/[^\d.,\-]/g, '');
    if (/^-/.test(s)) { neg = true; s = s.slice(1); } else if (/\d-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (!s || s.includes('-')) return null; // "10-12" no es un número
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  }

  function nuevoId(prefijo) { return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // Corta textos larguísimos (un mapeo equivocado no puede inflar un bloque hasta el límite de Firestore)
  function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }

  // ------------------------------------------------------- normalización
  // Los ids son ALEATORIOS y no dependen del CUIT ni del código: si después se
  // corrige el CUIT o el código, un alta nueva no puede "pisar" a otro registro.
  // Los duplicados se evitan buscando por CUIT / código (importador y aprenderCliente).
  function normalizarCliente(x) {
    const cuit = soloDigitos(x.cuit);
    const c = {
      id: x.id || nuevoId('c'),
      nombre: txt(x.nombre),
      fantasia: txt(x.fantasia),
      cuit: cuit.length === 11 ? cuit : '',
      dni: /^\d{7,8}$/.test(soloDigitos(x.dni)) ? soloDigitos(x.dni) : '',
      iva: x.iva != null && x.iva !== '' ? Number(x.iva) || null : null,
      dom: txt(x.dom),
      loc: txt(x.loc, 120),
      tel: txt(x.tel, 80),
      mail: txt(x.mail, 160),
      contacto: txt(x.contacto),
      obs: txt(x.obs, 1000),
      origen: x.origen || 'manual',
    };
    Object.keys(c).forEach((k) => { if (c[k] === '' || c[k] == null) delete c[k]; });
    c.id = c.id || nuevoId('c');
    return c;
  }
  function normalizarProducto(x) {
    const p = {
      id: x.id || nuevoId('p'),
      cod: txt(x.cod, 60),
      barra: String(x.barra == null ? '' : x.barra).replace(/\s+/g, '').replace(/\.0+$/, '').slice(0, 60),
      nombre: txt(x.nombre),
      precio: numeroAR(x.precio),
      costo: numeroAR(x.costo),
      rubro: txt(x.rubro, 120),
      // Solo se guarda "activo:false". Sin el campo = activo. Así reimportar
      // un Excel no reactiva un producto dado de baja.
      activo: x.activo === false ? false : null,
      origen: x.origen || null,
    };
    Object.keys(p).forEach((k) => { if (p[k] === '' || p[k] == null) delete p[k]; });
    return p;
  }

  // --------------------------------------------------------- lectura
  // tipo -> { items: [] (SIEMPRE el mismo array, así quien lo tenga guardado ve los cambios),
  //           meta, cargado, promesa }
  const cache = {};
  const MAX_BYTES_BLOQUE = 750000; // Firestore admite 1 MiB por documento: dejamos margen

  function db() { return firebase.firestore(); }
  function refDoc(id) { return db().collection(COL).doc(id); }
  function entrada(tipo) { return cache[tipo] || (cache[tipo] = { items: [], meta: null, cargado: false, promesa: null }); }
  function volcar(tipo, listas, meta) {
    const e = entrada(tipo);
    e.items.length = 0;
    listas.forEach((l, k) => (l || []).forEach((it) => e.items.push({ ...it, _k: k })));
    e.meta = meta || null; e.cargado = true;
    return e.items;
  }

  async function cargar(tipo, { forzar = false } = {}) {
    const e = entrada(tipo);
    if (!forzar && e.cargado) return e.items;
    if (!forzar && e.promesa) return e.promesa;
    const p = (async () => {
      const meta = await refDoc(tipo).get();
      const n = meta.exists ? Number(meta.data().bloques || 0) : 0;
      const snaps = await Promise.all(Array.from({ length: n }, (_, k) => refDoc(`${tipo}_${k}`).get()));
      // Si mientras tanto arrancó otra carga más nueva, que gane esa
      if (e.promesa === p) volcar(tipo, snaps.map((s) => (s.exists ? s.data().items || [] : [])), meta.exists ? meta.data() : null);
      return e.items;
    })();
    e.promesa = p;
    try { return await p; } catch (err) { throw err; } finally { if (e.promesa === p) e.promesa = null; }
  }

  function limpio(it) { const { _k, ...resto } = it; return resto; } // eslint-disable-line no-unused-vars

  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function bytes(x) { const s = JSON.stringify(x); return enc ? enc.encode(s).length : s.length * 3; }
  /** Parte la lista en bloques por cantidad (POR_BLOQUE) y por tamaño (< 1 MiB de Firestore). */
  function partirPorTamano(lista) {
    const partes = [[]]; let tam = 0;
    for (const it of lista) {
      const t = bytes(it) + 2;
      const ult = partes[partes.length - 1];
      if (ult.length && (tam + t > MAX_BYTES_BLOQUE || ult.length >= POR_BLOQUE)) { partes.push([]); tam = 0; }
      partes[partes.length - 1].push(it); tam += t;
    }
    return partes;
  }
  /** Bloque donde va un ítem nuevo: el último si entra (cantidad y tamaño); si no, uno nuevo. */
  function elegirBloque(listas, item) {
    const n = listas.length;
    if (!n) { listas.push([]); return 0; }
    const ult = listas[n - 1];
    if (ult.length < POR_BLOQUE && bytes(ult) + bytes(item) + 2 < MAX_BYTES_BLOQUE) return n - 1;
    listas.push([]); return n;
  }
  function sinIdsRepetidos(lista, prefijo) {
    const vistos = new Set();
    return lista.map((it) => {
      if (!it.id || vistos.has(it.id)) it = { ...it, id: nuevoId(prefijo) };
      vistos.add(it.id); return it;
    });
  }

  // --------------------------------------------------------- escritura
  /**
   * Reemplaza TODA la base de un tipo (lo usa el importador), TODO O NADA:
   * bloques y meta se escriben en una sola transacción. Si se corta la
   * conexión a mitad de camino, la base queda como estaba (nunca mezclada).
   * opciones.siBase: el "actualizado" de la base sobre la que se armó la
   * lista; si en el servidor es otro (alguien guardó mientras tanto), no se
   * escribe nada y se avisa (error.code = 'base-cambio').
   */
  async function guardarTodo(tipo, items, opciones = {}) {
    const lista = sinIdsRepetidos(items.map(limpio), tipo === 'clientes' ? 'c' : 'p');
    const partes = partirPorTamano(lista);
    const metaRef = refDoc(tipo);
    let res = null;
    await db().runTransaction(async (tx) => {
      const meta = await tx.get(metaRef);
      const metaD = meta.exists ? meta.data() : null;
      if (Object.prototype.hasOwnProperty.call(opciones, 'siBase') && ((metaD && metaD.actualizado) || null) !== (opciones.siBase || null)) {
        const err = new Error('La base cambió en otro dispositivo mientras importabas. No se guardó nada: volvé a tocar Importar.');
        err.code = 'base-cambio'; throw err;
      }
      const bloquesAnt = metaD ? Number(metaD.bloques || 0) : 0;
      partes.forEach((p, k) => tx.set(refDoc(`${tipo}_${k}`), { items: p }));
      for (let k = partes.length; k < bloquesAnt; k++) tx.delete(refDoc(`${tipo}_${k}`));
      const nuevaMeta = { bloques: partes.length, total: lista.length, actualizado: new Date().toISOString() };
      tx.set(metaRef, nuevaMeta);
      res = { partes, meta: nuevaMeta };
    });
    return volcar(tipo, res.partes, res.meta);
  }

  /**
   * Modifica la base dentro de una transacción que lee el meta y TODOS los
   * bloques (2 a 4 lecturas): nunca se trabaja sobre una caché vieja. fn(listas)
   * muta las listas y devuelve { tocados: [k...], valor }. Al terminar, la
   * caché queda igual a lo que quedó en Firestore (total recalculado).
   */
  async function mutar(tipo, fn) {
    const metaRef = refDoc(tipo);
    let out = null;
    await db().runTransaction(async (tx) => {
      const meta = await tx.get(metaRef);
      const metaD = meta.exists ? meta.data() : null;
      const n = metaD ? Number(metaD.bloques || 0) : 0;
      const snaps = await Promise.all(Array.from({ length: n }, (_, k) => tx.get(refDoc(`${tipo}_${k}`))));
      const listas = snaps.map((s) => (s.exists ? (s.data().items || []).slice() : []));
      const r = fn(listas) || { tocados: [] };
      if (!r.tocados.length) { out = { listas, meta: metaD, valor: r.valor }; return; }
      [...new Set(r.tocados)].forEach((k) => tx.set(refDoc(`${tipo}_${k}`), { items: listas[k] || [] }));
      const nuevaMeta = { bloques: listas.length, total: listas.reduce((a, l) => a + l.length, 0), actualizado: new Date().toISOString() };
      tx.set(metaRef, nuevaMeta);
      out = { listas, meta: nuevaMeta, valor: r.valor };
    });
    volcar(tipo, out.listas, out.meta);
    return out.valor;
  }

  /** Alta o modificación de UN ítem. Los campos que se vaciaron se borran de verdad (también de la caché). */
  async function guardarUno(tipo, item) {
    const nuevo = limpio(item);
    return mutar(tipo, (listas) => {
      for (let k = 0; k < listas.length; k++) {
        const i = listas[k].findIndex((x) => x.id === nuevo.id);
        if (i >= 0) { listas[k][i] = nuevo; return { tocados: [k], valor: nuevo }; }
      }
      const k = elegirBloque(listas, nuevo);
      listas[k].push(nuevo);
      return { tocados: [k], valor: nuevo };
    });
  }

  /** Borra UN ítem (si por datos viejos hubiera dos con el mismo id, borra solo el primero). */
  async function borrarUno(tipo, id) {
    return mutar(tipo, (listas) => {
      for (let k = 0; k < listas.length; k++) {
        const i = listas[k].findIndex((x) => x.id === id);
        if (i >= 0) { listas[k].splice(i, 1); return { tocados: [k], valor: true }; }
      }
      return { tocados: [], valor: false };
    });
  }

  /**
   * Lo llama el panel al guardar un pedido con CUIT válido Y razón social: si
   * el cliente no existe lo agrega; si existe y le faltaba la condición IVA, la
   * completa. Nunca pisa datos cargados a mano. NO guarda el teléfono del
   * pedido (es el celular de la seño, no el de la institución).
   */
  async function aprenderCliente({ nombre, cuit, iva, fantasia }) {
    const c = soloDigitos(cuit);
    if (!cuitValido(c) || !String(nombre || '').trim()) return null;
    const items = await cargar('clientes');
    // Mismo CUIT (ej. Superior Gobierno) + otra escuela = otro cliente
    const quien = sinAcentos(String(fantasia || '').trim() || nombre);
    const mismo = (x) => x.cuit === c && sinAcentos(x.fantasia || x.nombre) === quien;
    const enCache = items.find(mismo);
    if (enCache && (enCache.iva || !iva)) return enCache; // nada que aprender: ni una lectura más
    return mutar('clientes', (listas) => {
      for (let k = 0; k < listas.length; k++) {
        const i = listas[k].findIndex(mismo);
        if (i < 0) continue;
        const ya = listas[k][i];
        if (!ya.iva && iva) { listas[k][i] = { ...ya, iva: Number(iva) }; return { tocados: [k], valor: listas[k][i] }; }
        return { tocados: [], valor: ya };
      }
      const f = String(fantasia || '').trim();
      const nuevo = normalizarCliente({ nombre, cuit: c, iva, fantasia: f && sinAcentos(f) !== sinAcentos(nombre) ? f : '', origen: 'pedido' });
      const k = elegirBloque(listas, nuevo);
      listas[k].push(nuevo);
      return { tocados: [k], valor: nuevo };
    });
  }

  // --------------------------------------------------------- búsqueda
  function puntaje(textoNorm, palabras) {
    let p = 0;
    for (const w of palabras) {
      const i = textoNorm.indexOf(w);
      if (i < 0) return -1;
      p += i === 0 ? 3 : textoNorm[i - 1] === ' ' ? 2 : 1;
    }
    return p;
  }
  /** Busca por palabras sueltas en cualquier orden ("64 wolf", "jardin 45 yerba"). */
  function buscar(items, q, campos, limite = 8) {
    const palabras = sinAcentos(q).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    const res = [];
    for (const it of items) {
      const texto = ' ' + campos.map((c) => sinAcentos(it[c])).join(' ');
      const p = puntaje(texto.trim(), palabras);
      if (p >= 0) res.push([p, it]);
    }
    res.sort((a, b) => b[0] - a[0] || String(a[1].nombre || a[1].n).length - String(b[1].nombre || b[1].n).length);
    return res.slice(0, limite).map((x) => x[1]);
  }

  /**
   * Coincidencia EXACTA por código de barras o código interno (lo que manda la pistola).
   * Los códigos de barras se comparan sin ceros adelante (Excel suele perderlos:
   * 0012345678905 y 12345678905 son el mismo EAN).
   */
  function sinCeros(s) { return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; }
  function porCodigo(items, codigo) {
    const c = String(codigo || '').trim().toLowerCase();
    if (!c) return null;
    const cn = sinCeros(c);
    return items.find((p) => p.barra && String(p.barra).toLowerCase() === c)
      || items.find((p) => p.barra && sinCeros(String(p.barra).toLowerCase()) === cn)
      || items.find((p) => p.cod && String(p.cod).toLowerCase() === c)
      || null;
  }

  /**
   * Detecta la pistola lectora: escribe muy rápido (menos de ~70 ms entre
   * teclas), al menos 6 caracteres de código (letras, números o guión) y
   * termina con Enter. Solo con el foco FUERA de un campo de texto.
   * Si hay una pausa larga en el medio del código, se descarta TODO hasta el
   * Enter (para no quedarse con "la cola" de un código y agregar otro producto).
   */
  function escucharPistola(onScan, { activo = () => true, minLargo = 6, maxGap = 70 } = {}) {
    let buf = '', ultimo = 0, sucio = false;
    const ahoraMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    document.addEventListener('keydown', (e) => {
      const t = e.target, tag = (t && t.tagName) || '';
      const enCampo = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      if (enCampo || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || !activo()) { buf = ''; sucio = false; return; }
      const ahora = ahoraMs(), gap = ahora - ultimo;
      ultimo = ahora;
      if (buf && gap > 600) { buf = ''; sucio = false; }      // restos viejos: se empieza de cero
      else if (buf && gap > maxGap) sucio = true;             // pausa en el medio del código
      if (e.key === 'Enter') {
        if (!sucio && buf.length >= minLargo && /^[0-9A-Za-z-]+$/.test(buf) && (buf.length >= 6 || /^\d+$/.test(buf))) { e.preventDefault(); e.stopPropagation(); onScan(buf); } // códigos cortos (ADM: 443) solo si son números
        buf = ''; sucio = false; return;
      }
      if (e.key && e.key.length === 1) buf += e.key;
    }, true);
  }

  // Base de escuelas de Tucumán (archivo estático del repo, sin CUIT)
  let escuelasPromesa = null;
  function cargarEscuelas(url) {
    if (!escuelasPromesa) {
      escuelasPromesa = fetch(url || 'base-escuelas.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    }
    return escuelasPromesa;
  }

  // ------------------------------------------------- cliente del facturador
  // Si pedidos/_config_facturacion tiene "urlFacturador" (servidor propio, ej.
  // Render), se llama a ese servidor con el token del usuario. Si no, se usa
  // la Cloud Function de Firebase (requiere plan Blaze).
  let urlFacturadorPromesa = null;
  function urlFacturador() {
    if (!urlFacturadorPromesa) {
      urlFacturadorPromesa = db().collection('pedidos').doc('_config_facturacion').get()
        .then((s) => { const u = s.exists ? String(s.data().urlFacturador || '').trim().replace(/\/+$/, '') : ''; return /^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(u) ? u : ''; })
        .catch(() => '');
    }
    return urlFacturadorPromesa;
  }
  async function llamarFacturador(nombre, datos = {}, { timeout = 310000 } = {}) {
    const base = await urlFacturador();
    if (!base) {
      return firebase.app().functions('southamerica-east1').httpsCallable(nombre, { timeout })(datos);
    }
    const usuario = firebase.auth().currentUser;
    if (!usuario) { const e = new Error('Hay que estar logueado para facturar.'); e.code = 'unauthenticated'; throw e; }
    const token = await usuario.getIdToken();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let r;
    try {
      r = await fetch(`${base}/api/${nombre}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(datos || {}),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError'
        ? 'Se cortó la espera (deadline): ARCA o el servidor tardaron demasiado.'
        : 'No se pudo conectar con el facturador. Si es la primera vez en el día puede estar despertando: esperá un minuto y probá de nuevo.');
      e.code = err && err.name === 'AbortError' ? 'deadline-exceeded' : 'unavailable';
      throw e;
    } finally { if (t) clearTimeout(t); }
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok || !j || j.error) {
      const e = new Error((j && j.error && j.error.message) || `El facturador respondió con error ${r.status}.`);
      e.code = (j && j.error && j.error.code) || (r.status === 504 ? 'deadline-exceeded' : 'internal');
      throw e;
    }
    return { data: j.data };
  }
  /** Despierta el servidor gratuito (se duerme a los 15 min sin uso) sin esperar respuesta. */
  async function despertarFacturador() {
    try { const base = await urlFacturador(); if (base) fetch(`${base}/salud`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) { /* nada */ }
  }

  global.Maestros = {
    COND_IVA, COND_IVA_CORTO, POR_BLOQUE,
    sinAcentos, esc, soloDigitos, cuitValido, formatoCuit, condIvaDesdeTexto, numeroAR, nuevoId,
    normalizarCliente, normalizarProducto, partirPorTamano, MAX_BYTES_BLOQUE,
    cargar, guardarTodo, guardarUno, borrarUno, aprenderCliente, buscar, cargarEscuelas, porCodigo, escucharPistola,
    llamarFacturador, despertarFacturador, urlFacturador,
    _cache: cache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
