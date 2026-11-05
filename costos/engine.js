/* Motor de cálculo del modelo de costeo y de programación lineal del Taller JD.
   Reproduce las fórmulas de Modelo_de_Costeo_Taller_JD.xlsx y de la hoja Solver.
   Todo el cálculo es determinístico: la IA sólo elige qué función llamar. */
(function (root) {
  const SEAS = ['Semanas pico', 'Alta (resto)', 'General', 'Baja'];

  function base() {
    return {
      fechaDatos: '2026-10-31',
      P: {
        placa: 26500, hojas: 9, W: 860, H: 605, pint: 12000, barn: 7000, hl: 30, adh: 15000, adhr: 750, pack: 20,
        vh: 3000, cmp: 49527.18, nfijas: 4,
        t_fij: 21.5, t_arch: 4, t_cc: 2, t_dc: 2, t_cb: 2, t_db: 0.5, t_desp: 0.08, t_ped: 1,
        tubo: 1750000, vt1: 5000, vt2: 10000, opt: 124000, vo1: 3000, vo2: 5000, kw: 1.8, kwh: 251.55,
        nmaq: 2, hist1: 6300000, hist2: 11500000, vmaq: 10, pc: 700000, vpc: 5,
        nprev: 4, cprev: 250000, mprev: 4, nrep: 3.5, crep: 125000, dmant: 4, msem: 4, turno: 8,
        alq: 800000, alq_m2: 225, a_med: 16, a_pin: 48, a_ofi: 36,
        e_rop: 1000000, e_tit: 100000, e_iibb: 92000, e_hon: 80000, e_soft: 69460, e_pub: 75500, e_fer: 100000, e_adm: 750000,
        estr_rc: 0.3, stock: 'sí', modo: 'ocupación', escenario: 'libre'
      },
      S: { // por temporada: pico, alta, general, baja
        jornadas: [20, 73, 135, 47.5], totalJornadas: 275.5,
        hmaq: [10, 8, 8, 8], shm: [0.5, 0.4, 0.3, 0.2], pers: [6, 4, 4, 2], hpers: [8, 6, 6, 6], shp: [0.5, 0.4, 0.3, 0.2]
      },
      F: [ // nombre, ancho, alto, modelo, hojas por tanda, corte caras, corte bases, despegado (min/hoja), armado, control, embolsado (min/u), precio
        { n: '10×10', b: 100, c: 100, mod: 'Tangram y tetris · 7 piezas', tanda: 8, cc: 50, cb: 20, dsp: 4, arm: 1, ctl: 1, emb: 1, pv: 1400 },
        { n: '9×14', b: 90, c: 140, mod: 'Animales · 3 piezas', tanda: 3, cc: 49, cb: 7, dsp: 4, arm: 2, ctl: 1, emb: 1, pv: 1500 },
        { n: '15×15', b: 150, c: 150, mod: 'Animales · 3 a 6 piezas', tanda: 8, cc: 41, cb: 11, dsp: 3, arm: 2, ctl: 1, emb: 1, pv: 3000 },
        { n: '20×20', b: 200, c: 200, mod: 'Frutas', tanda: 2, cc: 37, cb: 8, dsp: 3, arm: 2, ctl: 1, emb: 1, pv: 4500 },
        { n: '25×25 simple', b: 250, c: 250, mod: 'Tangram · 7 piezas + borde', tanda: 8, cc: 24, cb: 7, dsp: 1, arm: 4, ctl: 1, emb: 1, pv: 5500 },
        { n: '25×25 complejo', b: 250, c: 250, mod: 'Tetris · 25 piezas', tanda: 9, cc: 34, cb: 7, dsp: 5, arm: 6, ctl: 1, emb: 1, pv: 5500 }
      ],
      D: [ // demanda por familia y temporada (unidades, a efectos de la simulación)
        [2686.00054536977, 1956.81679423509, 1457.62883652206, 224.634580970865],
        [735.273892307927, 535.664932500109, 399.015715025592, 61.492147863533],
        [1055.47994951035, 768.942841333607, 572.783953238299, 88.2714996428886],
        [272.384072793753, 198.4384288543, 147.816380677182, 22.7799216797028],
        [361.936511804108, 263.679561035846, 196.414366894049, 30.2693373638089],
        [7.98389364273767, 5.81646090520249, 4.33266985795696, 0.66770597126049]
      ],
      reparto: [0.424658695836513, 0.30937419922097, 0.230452209623784, 0.0355148953187338],
      imp15: 853.125, // 15×15 importado que hoy se compra, por año
      compra: [ // alternativa de compra: Mayorista A o B, octubre 2026
        { ref: 'Tangram 10×10', pc: 858, pvi: 1400 },
        { ref: 'Animales 14×12', pc: 3200, pvi: 5200 },
        { ref: 'Animales y otros 15×15', pc: 750, pvi: 1700 },
        { ref: '20×15 animales (económico)', pc: 2340, pvi: 4500 },
        { ref: 'Animales 25×25', pc: 4836, pvi: 9500 },
        { ref: 'Cuerpo humano (económico)', pc: 3432, pvi: 8500 }
      ]
    };
  }

  function costeo(m) {
    const P = m.P, S = m.S;
    const var_h = (P.tubo / P.vt1 + P.tubo / P.vt2) / 2 + (P.opt / P.vo1 + P.opt / P.vo2) / 2 + P.kw * P.kwh;
    const inm_m2 = P.alq * 12 / P.alq_m2;
    const fijosMaq = (P.hist1 + P.hist2) / P.vmaq + P.pc / P.vpc + P.nprev * P.cprev * P.nmaq / P.mprev + P.nmaq * P.nrep * P.crep + inm_m2 * P.a_med;
    const inm_pin = inm_m2 * P.a_pin, f_ofi = inm_m2 * P.a_ofi;
    const hmTurno = S.jornadas.map((j, k) => P.nmaq * S.hmaq[k] * j - P.nmaq * P.dmant * P.turno * j / S.totalJornadas - (k === 0 ? 0 : P.nmaq * P.msem * j / 5.5));
    const hpTot = S.jornadas.map((j, k) => S.pers[k] * S.hpers[k] * j);
    const cap = hmTurno.reduce((a, b) => a + b, 0), hpAno = hpTot.reduce((a, b) => a + b, 0);
    const tasa = fijosMaq / cap;
    const supA = P.e_rop * 12 + P.nfijas * 12 * P.cmp;
    const sup_h = supA / hpAno, pin_hh = inm_pin / hpAno;
    const estr_mes = P.e_tit + P.e_iibb + P.e_hon + P.e_soft + P.e_pub + P.e_fer + P.e_adm;
    const Dann = m.D.map(r => r.reduce((a, b) => a + b, 0));
    const pesoVendido = m.F.reduce((s, f, i) => s + Dann[i] * f.pv, 0) - m.imp15 * m.F[2].pv + m.imp15 * m.compra[2].pvi;
    const estr_pct = (estr_mes * 12 + f_ofi) * P.estr_rc / pesoVendido;
    const fam = m.F.map((f, i) => {
      const E = Math.max(Math.floor(P.W / f.b) * Math.floor(P.H / f.c), Math.floor(P.W / f.c) * Math.floor(P.H / f.b));
      const corte = (f.cc + f.cb) / E;
      const ocup = (f.cc + f.cb + P.t_cc + P.t_dc + f.dsp + P.t_cb + P.t_db + P.t_arch / f.tanda) / E;
      const mo = (P.t_fij + P.t_arch / f.tanda + f.dsp) / E + f.arm + f.ctl + f.emb + P.t_desp + P.t_ped;
      const madera = 2 * f.b * f.c / 1e6 * (P.placa / P.hojas) / (P.W * P.H / 1e6);
      const pintura = ((P.pint + P.barn) / P.hl) / E;
      const adhesivo = (P.adh / P.adhr) * (2 * (f.b + f.c)) / 600;
      const manoObra = mo * P.vh / 60, maquinaVar = corte * var_h / 60, packaging = P.pack;
      const cv = madera + pintura + adhesivo + manoObra + maquinaVar + packaging;
      const maqFija = ocup * tasa / 60, persFijo = mo * sup_h / 60, cuarto = mo * pin_hh / 60;
      const absorcion = cv + maqFija + persFijo + cuarto;
      const margen = f.pv - cv, estructura = f.pv * estr_pct;
      const minMaq = P.modo === 'corte' ? corte : ocup;
      return {
        familia: f.n, unidadesPorHoja: E, minCorte: corte, minOcupacion: ocup, minManoObra: mo,
        madera, pintura, adhesivo, manoObra, maquinaVar, packaging, costoVariable: cv,
        maqFija, persFijo, cuarto, costoAbsorcion: absorcion, precio: f.pv, margen, estructura, costoTotal: absorcion + estructura,
        margenPorHoraMaquina: margen / (minMaq / 60), margenPorHoraPersonal: margen / (mo / 60),
        compraRef: m.compra[i].ref, precioCompra: m.compra[i].pc, precioVentaImportado: m.compra[i].pvi,
        contribucionCompra: m.compra[i].pvi - m.compra[i].pc, demandaAnual: Dann[i], demanda: m.D[i].slice()
      };
    });
    return {
      tarifaVariableHora: var_h, fijosMaquinas: fijosMaq, horasTurno: hmTurno, horasTurnoAno: cap, tasaFijaHoraMaquina: tasa,
      horasPersonal: hpTot, horasPersonalAno: hpAno, tasaFijaHoraPersonal: sup_h, tasaCuartoPintado: pin_hh,
      horasMaquinaDisponibles: hmTurno.map((h, k) => h * S.shm[k]), horasPersonalDisponibles: hpTot.map((h, k) => h * S.shp[k]),
      estructuraMensual: estr_mes, estructuraPorPeso: estr_pct, alquilerM2Ano: inm_m2, familias: fam
    };
  }

  function diferencial(m, c) {
    c = c || costeo(m);
    return c.familias.map((f, i) => {
      const q = Math.round(i === 2 ? f.demandaAnual - m.imp15 : f.demandaAnual);
      const costoFab = q * f.costoVariable, costoComp = q * f.precioCompra;
      const ahorro = costoComp - costoFab, ingresoAdic = q * (f.precioVentaImportado - f.precio);
      const dif = ahorro - ingresoAdic;
      return { familia: f.familia, unidades: q, costoFabricar: costoFab, costoComprar: costoComp, ahorroFabricar: ahorro, ingresoAdicionalComprar: ingresoAdic, diferenciaAFavorDeFabricar: dif, conviene: dif > 0 ? 'Fabricar' : 'Comprar' };
    });
  }

  function solver(m, opts) {
    opts = opts || {};
    const lp = root.solver || (typeof require === 'function' ? require('javascript-lp-solver') : null);
    const c = costeo(m), P = m.P, S = m.S, NF = m.F.length, NS = 4;
    const escenario = opts.escenario || P.escenario, stock = (opts.stock || P.stock) === 'sí';
    const extraHM = opts.extraHorasMaquina || [0, 0, 0, 0], extraHP = opts.extraHorasPersonal || [0, 0, 0, 0];
    const model = { optimize: 'z', opType: 'max', constraints: {}, variables: {} };
    const HM = c.horasMaquinaDisponibles.map((h, k) => h + extraHM[k]), HP = c.horasPersonalDisponibles.map((h, k) => h + extraHP[k]);
    for (let k = 0; k < NS; k++) { model.constraints['maq' + k] = { max: HM[k] }; model.constraints['pers' + k] = { max: HP[k] }; }
    for (let i = 0; i < NF; i++) {
      const f = c.familias[i];
      const fx = opts.factorMinutos || 1;
      const minMaq = (P.modo === 'corte' ? f.minCorte : f.minOcupacion) * fx;
      for (let k = 0; k < NS; k++) {
        const mn = i === 2 ? m.imp15 * m.reparto[k] : 0;
        const mx = escenario === 'libre' ? m.D[i][k] : mn;
        model.constraints[`dem${i}_${k}`] = { max: m.D[i][k] };
        model.constraints[`cmin${i}_${k}`] = { min: mn, max: mx };
        const F = { z: f.margen }; F[`dem${i}_${k}`] = 1; F['maq' + k] = minMaq / 60; F['pers' + k] = f.minManoObra * fx / 60;
        if (k > 0) F[`ant${i}_${k}`] = -1;
        model.variables[`F${i}_${k}`] = F;
        const C = { z: f.contribucionCompra }; C[`dem${i}_${k}`] = 1; C[`cmin${i}_${k}`] = 1;
        model.variables[`C${i}_${k}`] = C;
        if (k > 0) {
          model.constraints[`ant${i}_${k}`] = { max: 0 }; // anticipado − fabricado ≤ 0
          model.constraints[`antmax${i}_${k}`] = { max: stock ? 1e6 : 0 };
          const A = { z: -1 }; A[`dem${i}_0`] = 1; A[`dem${i}_${k}`] = -1; A[`ant${i}_${k}`] = 1; A[`antmax${i}_${k}`] = 1;
          model.variables[`A${i}_${k}`] = A;
        }
      }
    }
    const r = lp.Solve(model);
    const g = (v) => r[v] || 0;
    const fab = [], comp = [], ant = [];
    for (let i = 0; i < NF; i++) {
      fab.push([0, 1, 2, 3].map(k => g(`F${i}_${k}`)));
      comp.push([0, 1, 2, 3].map(k => g(`C${i}_${k}`)));
      ant.push([0, 1, 2, 3].map(k => k ? g(`A${i}_${k}`) : 0));
    }
    const fx2 = opts.factorMinutos || 1;
    const usoMaq = [0, 1, 2, 3].map(k => c.familias.reduce((s, f, i) => s + fab[i][k] * (P.modo === 'corte' ? f.minCorte : f.minOcupacion) * fx2 / 60, 0));
    const usoPers = [0, 1, 2, 3].map(k => c.familias.reduce((s, f, i) => s + fab[i][k] * f.minManoObra * fx2 / 60, 0));
    return {
      factible: !!r.feasible, contribucionTotal: r.result, escenario, anticipacion: stock ? 'sí' : 'no',
      familias: c.familias.map((f, i) => ({ familia: f.familia, fabricar: fab[i], comprar: comp[i], anticipar: ant[i],
        fabricarAno: fab[i].reduce((a, b) => a + b, 0), comprarAno: comp[i].reduce((a, b) => a + b, 0) })),
      temporadas: SEAS.map((t, k) => ({ temporada: t, horasMaquinaUsadas: usoMaq[k], horasMaquinaDisponibles: HM[k], usoMaquina: usoMaq[k] / HM[k],
        horasPersonalUsadas: usoPers[k], horasPersonalDisponibles: HP[k], usoPersonal: usoPers[k] / HP[k] }))
    };
  }

  // precio sombra por diferencias: cuánto sube la contribución con una hora más
  function precioSombra(m, opts) {
    opts = opts || {};
    const k = opts.temporada || 0, rec = opts.recurso || 'maquina';
    const b = solver(m, opts).contribucionTotal;
    const e = [0, 0, 0, 0]; e[k] = 1;
    const o2 = Object.assign({}, opts, rec === 'maquina' ? { extraHorasMaquina: e } : { extraHorasPersonal: e });
    const b1 = solver(m, o2).contribucionTotal;
    return { temporada: SEAS[k], recurso: rec, contribucionActual: b, contribucionConUnaHoraMas: b1, precioSombra: b1 - b };
  }

  // Planificador de un evento: cuántos rompecabezas fabricar antes, fabricar en la semana del evento y comprar,
  // para una meta de unidades. Capacidad semanal tomada de la hoja Capacidad (semana pico y semana de temporada alta).
  function planEvento(m, opts) {
    opts = opts || {};
    const lp = root.solver || (typeof require === 'function' ? require('javascript-lp-solver') : null);
    const c = costeo(m), P = m.P, S = m.S, NF = m.F.length;
    const total = +opts.unidades || 0;
    let rep = opts.reparto;
    if (!rep) { const s = c.familias.reduce((a, f) => a + f.demandaAnual, 0); rep = {}; c.familias.forEach(f => rep[f.familia] = f.demandaAnual / s); }
    const sr = Object.values(rep).reduce((a, b) => a + (+b || 0), 0) || 1;
    const D = c.familias.map(f => total * (+rep[f.familia] || 0) / sr);
    const semAntes = Math.max(0, opts.semanasAntes == null ? 4 : +opts.semanasAntes), semEv = Math.max(1, +opts.semanasEvento || 1);
    const semPico = S.jornadas[0] / 5.5 || 4, semAlta = S.jornadas[1] / 5.5;
    const pMaqEv = opts.parteMaquinaEvento != null ? +opts.parteMaquinaEvento : S.shm[0];
    const pMaqAn = opts.parteMaquinaAntes != null ? +opts.parteMaquinaAntes : S.shm[1];
    const HMe = c.horasTurno[0] / (S.jornadas[0] / 5) * semEv * pMaqEv;            // 5 jornadas por semana pico
    const HMa = c.horasTurno[1] / semAlta * semAntes * pMaqAn;
    const HPe = c.horasPersonal[0] / (S.jornadas[0] / 5) * semEv * S.shp[0];
    const HPa = c.horasPersonal[1] / semAlta * semAntes * S.shp[1];
    const esc = opts.escenario || 'libre';
    const model = { optimize: 'z', opType: 'max', constraints: { me: { max: HMe }, ma: { max: HMa }, pe: { max: HPe }, pa: { max: HPa } }, variables: {} };
    c.familias.forEach((f, i) => {
      const mm = (P.modo === 'corte' ? f.minCorte : f.minOcupacion) / 60, mp = f.minManoObra / 60;
      model.constraints['d' + i] = { max: D[i] };
      const cmax = esc === 'libre' ? D[i] : esc === 'sin compras' ? 0 : (i === 2 ? D[i] * m.imp15 / f.demandaAnual : 0);
      model.constraints['c' + i] = { max: cmax };
      model.variables['Fe' + i] = { z: f.margen, ['d' + i]: 1, me: mm, pe: mp };
      model.variables['Fa' + i] = { z: f.margen - 1, ['d' + i]: 1, ma: mm, pa: mp };
      model.variables['C' + i] = { z: f.contribucionCompra, ['d' + i]: 1, ['c' + i]: 1 };
    });
    const r = lp.Solve(model), g = v => r[v] || 0;
    const fam = c.familias.map((f, i) => {
      const fe = g('Fe' + i), fa = g('Fa' + i), co = g('C' + i), hojas = 2 * Math.ceil((fe + fa) / f.unidadesPorHoja);
      return { familia: f.familia, meta: D[i], fabricarAntes: fa, fabricarSemanaEvento: fe, comprar: co, sinCubrir: Math.max(0, D[i] - fe - fa - co),
        hojasCarasYBases: hojas, placasAprox: hojas / P.hojas, contribucion: (fe + fa) * f.margen + co * f.contribucionCompra };
    });
    const uso = (k, list) => c.familias.reduce((s, f, i) => s + g(k + i) * list(f), 0);
    return { factible: !!r.feasible, unidadesMeta: total, escenario: esc, semanasAntes: semAntes, semanasEvento: semEv,
      contribucionTotal: fam.reduce((s, x) => s + x.contribucion, 0), familias: fam,
      horas: { maquinaEvento: { usadas: uso('Fe', f => (P.modo === 'corte' ? f.minCorte : f.minOcupacion) / 60), disponibles: HMe },
        maquinaAntes: { usadas: uso('Fa', f => (P.modo === 'corte' ? f.minCorte : f.minOcupacion) / 60), disponibles: HMa },
        personalEvento: { usadas: uso('Fe', f => f.minManoObra / 60), disponibles: HPe }, personalAntes: { usadas: uso('Fa', f => f.minManoObra / 60), disponibles: HPa } },
      nota: 'Sólo rompecabezas. Capacidad por semana con la parte máxima declarada; no incluye costo de mantener stock.' };
  }

  const api = { base, costeo, diferencial, solver, precioSombra, planEvento, SEAS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ModeloJD = api;
})(typeof window !== 'undefined' ? window : globalThis);
