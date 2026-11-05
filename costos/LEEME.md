# Costos y Producción — puesta en marcha

Página: https://tallerartesanal.com.ar/costos/ (mismo usuario y misma base de Firebase que el sistema de pedidos).

## Qué tiene
- **Tablero**: ventas del mes contra la meta, ventas por mes y por semana, saldo a cobrar, entregas de la semana, pedidos por estado, margen por hora de máquina, producción pendiente y la decisión de fabricar o comprar.
- **Asesor**: gerente comercial con IA. Planifica eventos (planificador de mezcla con capacidad), consulta ventas, costos y producción, busca el contexto económico en internet y cita la fuente. Los números los calcula `engine.js` (el mismo modelo del Excel). Cada respuesta muestra el cálculo y queda registrada.
- **Memoria**: notas del taller que el asesor lee en cada consulta (otros productos, proveedores, decisiones, aprendizajes de cada evento). El asesor propone guardar cosas y vos confirmás.
- **Modelo**: costo por familia, análisis diferencial y mezcla óptima (programación lineal) con los datos vigentes.
- **Precios**: insumos, sueldos y precios de compra y de venta, con la fecha de la última actualización; importados de los mayoristas; importador de listas.
- **Avisos**: cartel arriba cuando un dato lleva más de 30 días sin actualizar.
- **Corte**: requisiciones de corte con estados (pendiente → cortado → pintado → armado → listo) y la suma de lo pendiente en los pedidos de eventos.
- **Validación**: cada consulta con su resultado, para marcar si coincide con la planilla.

## Pasos para dejarla funcionando
1. **Servidor de la IA (Cloudflare Worker).** En Cloudflare → Workers → Crear → pegar `worker/worker.js`.
   - Variables: `FIREBASE_API_KEY` (la de `wrangler.toml`) y `ALLOWED_ORIGINS`.
   - Secreto: `ANTHROPIC_API_KEY` (la clave de la API de Claude). Se carga como *secret* en Cloudflare; no va en la página ni en el chat.
   - Opcional: variable `MODELO_IA` = `claude-haiku-5-5` para gastar menos (por defecto usa `claude-sonnet-5-5`). La búsqueda en internet cuesta aparte (USD 10 cada 1.000 búsquedas; máximo 3 por consulta).
   - Copiar la dirección del Worker (termina en `.workers.dev`).
2. **En la página**, pestaña Validación → Configuración: pegar la dirección del Worker y los correos con acceso completo (Germán y la responsable operativa). El resto del personal ve sólo Corte.
3. **Usuarios del personal**: crearlos en Firebase → Authentication (correo y contraseña).
4. **Reglas de Firestore**: si las reglas limitan colecciones, permitir a usuarios con sesión leer y escribir `costos_modelo`, `costos_importados`, `costos_corte`, `costos_consultas`, `costos_config` y `costos_memoria`.

## Verificación
`engine.js` reproduce el Excel: contribución $20.675.302 (base), $18.364.782 (compras actuales, máquina al 99% en semanas pico), precio sombra ≈ $9 con anticipación y ≈ $31.645 sin anticipación (pico al 45%), y con tiempos +15% anticipa 214 de 25×25 simple y 8 de complejo.
