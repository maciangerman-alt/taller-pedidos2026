// Cloudflare Worker: intermediario entre la página y la IA.
// Guarda la clave de la IA (secreto ANTHROPIC_API_KEY), verifica que quien consulta haya iniciado sesión
// en el sistema del Taller y define las herramientas. La IA nunca calcula: pide a la página que ejecute
// el modelo de costeo y redacta la respuesta con esos resultados.
const MODELO_IA = 'claude-sonnet-5-5';
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
  { type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'San Miguel de Tucumán', region: 'Tucumán', country: 'AR', timezone: 'America/Argentina/Tucuman' } }
];
const SYSTEM = (fecha, hoy, memoria) => `Sos el gerente comercial senior del taller: un ejecutivo con experiencia en ventas mayoristas y minoristas de juguetes didácticos, en planificación de temporadas y en la decisión de fabricar o comprar. Hablás en español rioplatense, directo y concreto, como un asesor que conoce el negocio por dentro. Hoy es ${hoy || 'la fecha actual'}.

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
- Datos del modelo vigentes al ${fecha || 'último guardado'}.
- Cerrá con una línea «Fuentes:» que diga qué herramientas, notas de la memoria o sitios usaste.

MEMORIA DEL TALLER (cargada por el usuario):
${memoria || '(vacía)'}`;

const cors = (origin, env) => ({
  'Access-Control-Allow-Origin': (env.ALLOWED_ORIGINS || 'https://tallerartesanal.com.ar').split(',').includes(origin) ? origin : 'null',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization'
});

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/consulta') return new Response('No encontrado', { status: 404, headers: h });
    // 1. ¿Inició sesión en el sistema del Taller?
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const chk = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + env.FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token })
    });
    if (!chk.ok) return new Response(JSON.stringify({ error: 'sesión no válida' }), { status: 401, headers: { ...h, 'Content-Type': 'application/json' } });
    // 2. Consulta a la IA con las herramientas fijas
    const body = await req.json();
    const messages = (body.messages || []).slice(-30);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.MODELO_IA || MODELO_IA, max_tokens: 3000, system: SYSTEM(body.fechaDatos, body.hoy, String(body.memoria || '').slice(0, 20000)), tools: TOOLS, messages })
    });
    const data = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: data.error?.message || 'error de la IA' }), { status: 502, headers: { ...h, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ content: data.content, stop_reason: data.stop_reason }), { headers: { ...h, 'Content-Type': 'application/json' } });
  }
};
