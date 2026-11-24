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
- **Validación**: cada consulta con su resultado, para marcar si coincide con la planilla y escribir la corrección.
- **Aprendizaje**: debajo de cada respuesta del asesor hay 👍 *Útil* y 👎 *Tiene un error* (con la corrección). En cada pregunta nueva, la página busca las consultas calificadas más parecidas y se las pasa al asesor: no repite los errores marcados y sigue el formato de las respuestas aprobadas. «Coincide / no coincide» en Validación cuenta igual. Lo aprendido se ve (y se puede olvidar) en Memoria → *Lo que aprendió de tus calificaciones*. Las preguntas que más se repiten aparecen como sugerencias.
- **Rapidez**: la respuesta aparece mientras se escribe (streaming), la parte fija de las instrucciones queda en la caché de la IA y la sesión se verifica una vez cada 5 minutos.

## Pasos para dejarla funcionando
1. **Servidor de la IA (Cloudflare Worker).** En Cloudflare → Workers → Crear → pegar `worker/worker.js`.
   - Variables: `FIREBASE_API_KEY` (la de `wrangler.toml`) y `ALLOWED_ORIGINS`.
   - Secreto: `ANTHROPIC_API_KEY` (la clave de la API de Claude). Se carga como *secret* en Cloudflare; no va en la página ni en el chat.
   - Opcional: variable `MODELO_IA` = `claude-haiku-5-5` para gastar menos (por defecto usa `claude-sonnet-5-5`).
   - Opcional: variable `ESFUERZO_IA` = `low` (más rápido), `medium` (por defecto) o `high` (piensa más antes de responder).
   - **Al actualizar el worker** (por ejemplo, para tener la respuesta en vivo): Cloudflare → Workers → `consulta-taller` → Editar código → pegar el `worker/worker.js` nuevo → Implementar. La página sigue funcionando con el worker anterior, pero sin streaming ni caché. La búsqueda en internet cuesta aparte (USD 10 cada 1.000 búsquedas; máximo 3 por consulta).
   - Copiar la dirección del Worker (termina en `.workers.dev`).
2. **En la página**, pestaña Validación → Configuración: pegar la dirección del Worker y los correos con acceso completo (Germán y la responsable operativa). El resto del personal ve sólo Corte.
3. **Usuarios del personal**: crearlos en Firebase → Authentication (correo y contraseña).
4. **Reglas de Firestore**: si las reglas limitan colecciones, permitir a usuarios con sesión leer y escribir `costos_modelo`, `costos_importados`, `costos_corte`, `costos_consultas`, `costos_config` y `costos_memoria`.

## Demo para invitados (tutor, tribunal)
Link: pestaña **Validación → Demo para invitados → Copiar link** (queda `costos/?demo=<cuenta>`). El invitado pone el código y usa la herramienta completa con una foto de los datos: los cambios quedan en la memoria del navegador y no llegan a Firebase; al recargar vuelve a la foto.
- **Qué ve:** modelo, precios, importados, corte, memoria, las últimas 200 consultas y los pedidos **sólo con monto, seña, fechas, estado, evento y productos** (sin nombre, teléfono, escuela, CUIT, domicilio ni notas). Los correos del equipo se reemplazan por «equipo del taller».
- **Foto:** la sube sola la página cada vez que entra un administrador (como mucho cada 6 horas) o con el botón *Actualizar los datos de la demo ahora*.
- **Puesta en marcha (una vez, en Cloudflare):**
  1. Storage & Databases → **KV** → Create → nombre `DEMO`.
  2. Workers → `consulta-taller` → Settings → **Bindings** → Add → KV namespace → nombre de la variable `DEMO`, namespace `DEMO`.
  3. Settings → **Variables and Secrets** → Add → tipo *Secret* → nombre `DEMO_CODE`, valor: el código.
  4. Opcional: variable `DEMO_LIMITE` (preguntas al asesor por día para la demo; por defecto 10).
  5. Editar código → pegar el `worker/worker.js` nuevo → Implementar.
  6. Entrar una vez a la herramienta con tu usuario (sube la foto) y probar el link en una ventana privada.
- **Cortar el acceso:** borrar o cambiar el secreto `DEMO_CODE`.

## Verificación
`engine.js` reproduce el Excel: contribución $20.675.302 (base), $18.364.782 (compras actuales, máquina al 99% en semanas pico), precio sombra ≈ $9 con anticipación y ≈ $31.645 sin anticipación (pico al 45%), y con tiempos +15% anticipa 214 de 25×25 simple y 8 de complejo.
