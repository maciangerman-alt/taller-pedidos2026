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
  { name: 'requisiciones', description: 'Requisiciones de corte que todavía no están listas, con unidades, fecha y estado.', input_schema: { type: 'object', properties: {} } }
];
const SYSTEM = (fecha) => `Sos el asistente de consulta del modelo de costos del taller. Respondés en español rioplatense, breve y claro, para la responsable operativa y el responsable comercial.
Reglas:
- Todo número que digas tiene que salir de una herramienta. Nunca calcules ni estimes cifras por tu cuenta, ni redondees de otra forma que a la unidad de peso.
- Si la pregunta pide un escenario («qué pasa si…»), usá el parámetro cambios; aclarás que es una simulación y no cambia los datos guardados.
- Si la pregunta no se puede responder con las herramientas, decilo y sugerí qué dato haría falta.
- Al final, en una línea, decí qué cálculo usaste (por ejemplo: «Cálculo: mezcla óptima, compra libre, con anticipación»).
- Los datos vigentes del modelo son al ${fecha || 'último guardado'}. Los costos fijos no cambian con la mezcla: no los sumes a la comparación de fabricar o comprar.`;

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
      body: JSON.stringify({ model: env.MODELO_IA || MODELO_IA, max_tokens: 1500, system: SYSTEM(body.fechaDatos), tools: TOOLS, messages })
    });
    const data = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: data.error?.message || 'error de la IA' }), { status: 502, headers: { ...h, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ content: data.content, stop_reason: data.stop_reason }), { headers: { ...h, 'Content-Type': 'application/json' } });
  }
};
