// Cloudflare Worker: intermediario entre la página y la IA.
// Guarda la clave de la IA (secreto ANTHROPIC_API_KEY), verifica que quien consulta haya iniciado sesión
// en el sistema del Taller y define las herramientas. La IA nunca calcula: pide a la página que ejecute
// el modelo de costeo y redacta la respuesta con esos resultados.
const MODELO_IA = 'claude-sonnet-5-5';
const ESFUERZO_IA = 'medium'; // low = más rápido; high = piensa más. Se cambia con la variable ESFUERZO_IA.
const FAMILIAS = ['10×10', '9×14', '15×15', '20×20', '25×25 simple', '25×25 complejo'];
const PARAMETROS = ['placa', 'pint', 'barn', 'adh', 'pack', 'vh', 'cmp', 'e_rop', 'kwh', 'tubo', 'opt', 'alq', 'tiempos_pct', 'parte_maquina_pico',
  ...FAMILIAS.map(f => 'precio_venta_' + f), ...FAMILIAS.map(f => 'precio_compra_' + f)];
const CAMBIOS = {
  type: 'array', description: 'Cambios hipotéticos sobre los datos vigentes, para simular. Vacío = datos vigentes. tiempos_pct: porcentaje de aumento de los minutos de máquina y de personal por unidad en la capacidad (15 = +15%; no cambia el costo unitario). parte_maquina_pico: fracción de las horas de las medianas para rompecabezas en semanas pico (0,45 = 45%).',
  items: { type: 'object', properties: { parametro: { type: 'string', enum: PARAMETROS }, valor: { type: 'number' } }, required: ['parametro', 'valor'] }
};
const ESC = { type: 'string', enum: ['libre', 'actual'], description: 'libre: se puede comprar hasta toda la demanda; actual: sólo se compra lo que hoy se compra (15×15 importado).' };
const ANT = { type: 'string', enum: ['sí', 'no'], description: 'Si se permite fabricar antes y guardar para las semanas pico.' };
const TOOLS = [
  { name: 'costeo', description: 'Costo variable, por absorción y total, precio, margen de contribución y margen por hora de máquina de cada familia de rompecabezas, y las tasas por hora.', input_schema: { type: 'object', properties: { familia: { type: 'string', enum: FAMILIAS }, cambios: CAMBIOS } } },
  { name: 'diferencial', description: 'Análisis diferencial fabricar contra comprar, en pesos por año, para la demanda anual de cada familia, sin costos fijos.', input_schema: { type: 'object', properties: { cambios: CAMBIOS } } },
  { name: 'mezcla_optima', description: 'Resuelve la programación lineal: cuánto fabricar, comprar y anticipar de cada familia en el año, la contribución total y el uso de máquina y personal por temporada.', input_schema: { type: 'object', properties: { escenario: ESC, anticipacion: ANT, cambios: CAMBIOS } } },
  { name: 'precio_sombra', description: 'Cuánto sube la contribución total con una hora más de máquina o de personal en una temporada.', input_schema: { type: 'object', properties: { recurso: { type: 'string', enum: ['maquina', 'personal'] }, temporada: { type: 'string', enum: ['Semanas pico', 'Alta (resto)', 'General', 'Baja'] }, escenario: ESC, anticipacion: ANT, cambios: CAMBIOS } } },
  { name: 'buscar_importados', description: 'Busca productos importados de los mayoristas por nombre o medida, con su precio y fecha de actualización.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'datos_vencidos', description: 'Lista los precios y datos del modelo que no se actualizan hace más de 30 días.', input_schema: { type: 'object', properties: {} } },
  { name: 'requisiciones', description: 'Requisiciones de corte que todavía no están listas, con unidades, fecha y estado.', input_schema: { type: 'object', properties: {} } },
  { name: 'ventas_periodo', description: 'Ventas registradas en el sistema de pedidos entre dos fechas (AAAA-MM-DD): cantidad de pedidos, monto, ticket promedio, saldo a cobrar, pedidos por estado y por evento, y unidades por producto de los pedidos de eventos.', input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, evento: { type: 'string', description: 'Opcional: código de evento del sistema de pedidos (jardin2026, padre2026, estudiante2026, madre2026, finano2026).' } }, required: ['desde', 'hasta'] } },
  { name: 'ventas_por_mes', description: 'Monto vendido y cantidad de pedidos por mes, con la meta mensual cargada en el sistema de pedidos.', input_schema: { type: 'object', properties: { desde: { type: 'string', description: 'AAAA-MM' }, hasta: { type: 'string', description: 'AAAA-MM' } } } },
  { name: 'planificar_evento', description: 'Planifica la mezcla de rompecabezas para un evento: para una meta de unidades, cuántas fabricar en las semanas previas, cuántas en la semana del evento y cuántas comprar, con la capacidad de máquina y personal, la contribución y las placas necesarias. Sólo cubre rompecabezas.', input_schema: { type: 'object', properties: { unidades: { type: 'number' }, semanasAntes: { type: 'number', description: 'Semanas disponibles antes de la semana del evento para fabricar por adelantado.' }, semanasEvento: { type: 'number' }, escenario: { type: 'string', enum: ['libre', 'actual', 'sin compras'] }, reparto: { type: 'object', description: 'Opcional: proporción por familia, por ejemplo {"10×10":0.6,"15×15":0.4}. Si falta, usa la mezcla histórica.' }, cambios: CAMBIOS }, required: ['unidades'] } },
  { name: 'proponer_memoria', description: 'Propone guardar en la memoria del taller un dato, una decisión o un aprendizaje que surgió en la conversación. El usuario confirma antes de que se guarde.', input_schema: { type: 'object', properties: { tema: { type: 'string' }, texto: { type: 'string' } }, required: ['tema', 'texto'] } },
];
const BUSQUEDA = modelo => ({ type: /haiku/.test(modelo) ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'San Miguel de Tucumán', region: 'Tucumán', country: 'AR', timezone: 'America/Argentina/Tucuman' } });
// Parte fija del sistema: no cambia nunca, así la IA la toma de la caché (más rápido y más barato).
const SYSTEM_FIJO = `Sos el gerente comercial senior del taller: un ejecutivo con experiencia en ventas mayoristas y minoristas de juguetes didácticos, en planificación de temporadas y en la decisión de fabricar o comprar. Hablás en español rioplatense, directo y concreto, como un asesor que conoce el negocio por dentro.

Qué hacés:
- Ayudás a decidir: planificar eventos (Día de los Jardines, Día del Niño, Día del Estudiante, fin de año), definir la mezcla entre producción propia e importados, fijar precios y metas, y anticipar la producción.
- Combinás tres fuentes y siempre decís de cuál sale cada cosa: (1) los cálculos del modelo y los datos del taller, que obtenés con las herramientas; (2) la memoria del taller, que figura abajo; (3) el contexto económico y las tendencias, que buscás en internet con web_search cuando la pregunta lo pide (consumo, inflación, importaciones, juguetería, fechas comerciales), citando la fuente.
- Cuando das tu criterio de ejecutivo, lo marcás como recomendación y das las alternativas con sus pros y contras. La decisión es del usuario.
- Si falta un dato para responder bien (por ejemplo, el costo de un producto que no es rompecabezas), lo decís y pedís que se cargue en la memoria.
- Cuando surge un dato, una decisión o un aprendizaje que conviene recordar, usás proponer_memoria.

Reglas de números:
- Toda cifra del taller sale de una herramienta o de la memoria. Nunca inventes ni estimes costos, ventas o capacidades por tu cuenta; si hacés una cuenta simple con cifras de las herramientas, mostrala.
- Para «qué pasa si…», usá el parámetro cambios y aclarás que es una simulación.
- El modelo de costeo y el planificador cubren sólo los rompecabezas. Los costos fijos no cambian con la mezcla.
- Cerrá con una línea «Fuentes:» que diga qué herramientas, notas de la memoria o sitios usaste.

Aprendizaje:
- Cada pregunta puede traer un bloque <contexto_de_esta_pregunta> con el modo de explicación y con aprendizajes de consultas anteriores que el usuario calificó. Las correcciones del usuario tienen prioridad sobre tu criterio: no repitas un error que ya te marcó. Las respuestas aprobadas te muestran el enfoque y el formato que le sirven. Las cifras igual se calculan de nuevo con las herramientas.
- No menciones ese bloque salvo que te pregunten; si una corrección cambió tu respuesta, decilo en una frase.`;
// Parte variable: fecha y memoria del taller (queda fija durante cada conversación).
const SYSTEM_VARIABLE = (fecha, hoy, memoria) => `Hoy es ${hoy || 'la fecha actual'}. Datos del modelo vigentes al ${fecha || 'último guardado'}.

MEMORIA DEL TALLER (cargada por el usuario):
${memoria || '(vacía)'}`;

const cors = (origin, env) => ({
  'Access-Control-Allow-Origin': (env.ALLOWED_ORIGINS || 'https://tallerartesanal.com.ar').split(',').includes(origin) ? origin : 'null',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization'
});

// Sesiones ya verificadas (se guardan unos minutos para no consultar a Firebase en cada vuelta).
const sesiones = new Map();
async function sesionValida(token, env) {
  if (!token) return false;
  const t = sesiones.get(token);
  if (t && t > Date.now()) return true;
  const chk = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + env.FIREBASE_API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token })
  });
  if (!chk.ok) return false;
  if (sesiones.size > 500) sesiones.clear();
  sesiones.set(token, Date.now() + 5 * 60 * 1000);
  return true;
}

// ---------- Modo demo (acceso con código, sin escribir en Firebase) ----------
// Secreto DEMO_CODE: el código que se le pasa al invitado. Si no está cargado, la demo queda apagada.
// KV con binding DEMO: guarda la foto de los datos (la sube la página cuando entra un administrador) y el contador diario.
// Variable opcional DEMO_LIMITE: preguntas al asesor por día (por defecto 10).
function codigoValido(codigo, env) {
  const a = String(env.DEMO_CODE || ''), b = String(codigo || '').trim().toLowerCase();
  if (!a || !b) return false;
  const x = a.toLowerCase();
  let d = x.length ^ b.length; // comparación en tiempo constante
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const hoyTucuman = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const limiteDemo = env => +env.DEMO_LIMITE || 10;
async function usadasHoy(env) { return +(await env.DEMO.get('uso:' + hoyTucuman())) || 0; }
// Una pregunta nueva es la vuelta cuyo último mensaje es texto del usuario (no resultados de herramientas ni pause_turn).
function esPreguntaNueva(messages) {
  const u = messages[messages.length - 1];
  return !!u && u.role === 'user' && Array.isArray(u.content) && u.content.some(c => c.type === 'text');
}
const espera = ms => new Promise(r => setTimeout(r, ms));

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = cors(origin, env);
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...h, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const url = new URL(req.url);
    if (req.method !== 'POST') return new Response('No encontrado', { status: 404, headers: h });
    const auth = req.headers.get('Authorization') || '';

    // Demo: el administrador sube la foto de los datos (ya sin datos personales de clientes).
    if (url.pathname === '/demo/foto') {
      if (!env.DEMO) return json({ error: 'demo sin configurar (falta el KV DEMO)' }, 501);
      if (!(await sesionValida(auth.replace('Bearer ', ''), env))) return json({ error: 'sesión no válida' }, 401);
      const texto = await req.text();
      if (texto.length > 20e6) return json({ error: 'foto demasiado grande' }, 413);
      await env.DEMO.put('foto', texto);
      return json({ ok: true, bytes: texto.length });
    }
    // Demo: el invitado entra con el código y recibe la foto.
    if (url.pathname === '/demo/entrar') {
      if (!env.DEMO || !env.DEMO_CODE) return json({ error: 'La demo no está habilitada.' }, 503);
      let codigo = ''; try { codigo = (await req.json()).codigo; } catch (e) {}
      if (!codigoValido(codigo, env)) { await espera(1200); return json({ error: 'Código incorrecto.' }, 401); }
      const foto = await env.DEMO.get('foto');
      if (!foto) return json({ error: 'La demo todavía no tiene datos: el administrador tiene que entrar una vez a la herramienta.' }, 503);
      const usadas = await usadasHoy(env);
      return new Response(`{"limite":${limiteDemo(env)},"restantes":${Math.max(0, limiteDemo(env) - usadas)},"foto":${foto}}`, { headers: { ...h, 'Content-Type': 'application/json' } });
    }
    if (url.pathname !== '/consulta') return new Response('No encontrado', { status: 404, headers: h });

    // 1. ¿Inició sesión en el sistema del Taller, o es un invitado de la demo con el código?
    const body = await req.json();
    const messages = body.messages || [];
    if (auth.startsWith('Demo ')) {
      if (!env.DEMO || !codigoValido(auth.slice(5), env)) return json({ error: 'código de demo no válido' }, 401);
      if (esPreguntaNueva(messages)) {
        const usadas = await usadasHoy(env), lim = limiteDemo(env);
        if (usadas >= lim) return json({ error: `la demo llegó al límite de ${lim} consultas por hoy; mañana se renueva` }, 429);
        await env.DEMO.put('uso:' + hoyTucuman(), String(usadas + 1), { expirationTtl: 3 * 86400 });
      }
    } else if (!(await sesionValida(auth.replace('Bearer ', ''), env))) return json({ error: 'sesión no válida' }, 401);

    // 2. Consulta a la IA con las herramientas fijas.
    // El historial no se recorta acá: la página empieza una conversación nueva cuando se alarga
    // (recortarlo separaba pedidos de cálculo de sus resultados y la consulta fallaba).
    const modelo = env.MODELO_IA || MODELO_IA;
    const conRespaldo = !/haiku/.test(modelo); // si el modelo rechaza una consulta, la reintenta otro modelo
    const pedido = {
      model: modelo, max_tokens: 16000, stream: !!body.stream,
      output_config: { effort: env.ESFUERZO_IA || ESFUERZO_IA },
      cache_control: { type: 'ephemeral' }, // caché de la conversación que va creciendo
      system: [
        { type: 'text', text: SYSTEM_FIJO, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: SYSTEM_VARIABLE(body.fechaDatos, body.hoy, String(body.memoria || '').slice(0, 30000)), cache_control: { type: 'ephemeral' } }
      ],
      tools: [...TOOLS, BUSQUEDA(modelo)],
      messages
    };
    if (conRespaldo) pedido.fallbacks = 'default';
    const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
    if (conRespaldo) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(pedido) });
    if (!r.ok) { let m = 'error de la IA'; try { m = (await r.json()).error?.message || m; } catch (e) {} return json({ error: m }, 502); }
    // 3. Respuesta en vivo: se reenvía tal cual a la página a medida que llega.
    if (pedido.stream) return new Response(r.body, { headers: { ...h, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } });
    const data = await r.json();
    return json({ content: data.content, stop_reason: data.stop_reason });
  }
};
