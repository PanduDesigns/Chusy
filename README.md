# Chusy — Gestor de tareas del equipo

Gestor de tareas multiusuario con Kanban, lista, calendario con hitos,
vista personal "Mis tareas" (con recordatorios privados), etiquetas de
color, subtareas, descripciones con editor de texto enriquecido,
comentarios y enlaces adjuntos. Sitio
100% estático (HTML/CSS/JS, sin paso de compilación) pensado para vivir
en GitHub Pages, con Firebase como base de datos compartida en tiempo real.

Puedes cambiar el nombre "Chusy" por el que prefieras: aparece en
`index.html` (título de la pestaña y pantalla de login) y en
`js/components/sidebar.js`.

**Identidad visual:** el logotipo principal es el propio de Chusy
(`assets/chusy-badge.png`), con los colores de Martech Corporation como
base (gris pizarra #78848C, antracita #3C3C3C, dorado #FCD000 como
acento) — Martech aparece como crédito discreto en la pantalla de login y
al pie de la barra lateral, ya que Chusy es la marca del propio gestor.

**Modelo de acceso:** todo el equipo ve todos los proyectos y tareas de
proyecto — no hay privacidad entre compañeros ahí. La única excepción son
las tareas **personales** de "Mis tareas" (recordatorios propios sin
proyecto), que solo ve quien las creó. Cualquiera puede crear proyectos y
tareas; borrar un proyecto (y sus tareas) o una tarea de otra persona está
limitado a quien lo creó o a un admin.

---

## 1. Puesta en marcha (una sola vez)

### 1.1 Crear el proyecto de Firebase
1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y pulsa **Crear proyecto**.
2. El plan gratuito **Spark** es suficiente — no hace falta pasar a Blaze para nada de lo que usa esta app (los adjuntos son enlaces, no subidas de archivo).

### 1.2 Activar Authentication
**Compilación → Authentication → Comenzar** → pestaña **Sign-in method** → activa **Correo electrónico/contraseña**.

### 1.3 Activar Firestore Database
**Compilación → Firestore Database → Crear base de datos** → modo producción (ya tenemos reglas propias).

### 1.4 Registrar la app web y copiar la configuración
⚙️ **Configuración del proyecto** → "Tus apps" → icono **</>** (Web) → copia `firebaseConfig` en [`js/firebase-config.js`](js/firebase-config.js). No son datos secretos, puedes subirlos a GitHub sin problema.

### 1.5 Publicar las reglas de seguridad
**Firestore Database → Reglas** → pega el contenido de [`firestore.rules`](firestore.rules) → **Publicar**.

Cada vez que este archivo cambie entre una versión y otra del proyecto, hay que repetir este paso — subir el archivo nuevo no actualiza lo ya publicado en tu proyecto de Firebase, solo pegarlo de nuevo en la consola lo hace.

### 1.6 Probar en local
```bash
python3 -m http.server 8000
```
Y abre `http://localhost:8000` (Firebase Auth necesita `http://`, no sirve abrir el archivo con doble clic).

### 1.7 Subir a GitHub y activar GitHub Pages
Sube el contenido de esta carpeta a un repositorio y activa **Settings → Pages → Deploy from a branch → main /(root)**.

---

## 2. Primer uso

La **primera persona que se registre** se convierte automáticamente en **administradora**. El resto queda como **miembro**. Un admin puede ascender a otra persona editando su documento en `users/{uid}` desde la consola de Firebase (`role` → `"admin"`).

Para restringir quién puede registrarse a los correos de tu empresa: Firestore → colección `meta` → documento `config` → campo `allowedEmailDomains` (array), p. ej. `["martechcorp.com"]`.

---

## 3. Cómo funciona lo nuevo de esta versión

### Una sola ventana para crear y editar tareas
Se ve todo el formulario de golpe (fechas, prioridad, responsables, etiquetas, subtareas, adjuntos…) tanto al crear como al editar, y **nada se guarda hasta pulsar "Aceptar"**. Si cierras sin aceptar habiendo cambiado algo, pregunta si quieres descartarlo. Los comentarios son la única excepción: se envían al momento en cuanto pulsas "Enviar", y solo están disponibles editando una tarea ya guardada (una tarea nueva todavía no tiene dónde colgarlos).

### Clic derecho para más acciones
Clic derecho sobre una tarea (en Lista, Tablero o Mis tareas): marcar completada, duplicar, convertir en hito, abrir detalles o eliminar. Clic derecho sobre un proyecto en la barra lateral: editar (nombre, icono y color), archivar o eliminar (esto último borra también todas sus tareas y comentarios).

### Icono y color de proyecto
Cada proyecto se identifica con un emoji "sombreado" del color que elijas, en vez del simple punto de color de antes. Al crear o editar un proyecto hay una rejilla de emojis pensados para procesos industriales (fábrica, engranaje, tornillería, grúa, tronco de madera, coche, tren, avión, barco, componentes eléctricos…), un desplegable "Más iconos" con otra tanda más variada, y un campo para pegar o escribir cualquier otro emoji, así que las combinaciones posibles son prácticamente ilimitadas. Ese icono aparece en la barra lateral, el archivo, el buscador, los filtros, Mis tareas, la cabecera del proyecto y la línea de tiempo global, para diferenciar los proyectos de un vistazo.

### Etiquetas de color
Al escribir una etiqueta en una tarea, se sugieren las que ya existen (con su color) para reutilizarlas; si escribes una nueva, puedes elegirle color desde una paleta, y se queda seleccionado ese mismo color por defecto para la siguiente etiqueta nueva que crees. El color de una etiqueta es compartido: cambiarlo afecta a todas las tareas que la llevan.

### Mis tareas: recordatorios personales
El botón "+ Tarea personal" en "Mis tareas" crea una tarea que **solo tú puedes ver** (sin proyecto, sin responsables) — para apuntes y recordatorios propios. Se distinguen con la etiqueta "🔒 Personal".

### Línea de tiempo / Gantt
Dos formas de verla: por proyecto (pestaña "Línea de tiempo" junto a Lista/Tablero/Calendario, agrupada por sección) o global para todo el departamento (botón fijo en la barra lateral, agrupada por proyecto). Una tarea con fecha de inicio y fecha límite se dibuja como una barra que cubre toda su duración; con una sola fecha, como un bloque de un día; los hitos siempre como un rombo. La línea vertical dorada marca el día de hoy.

### Calendario: duración completa, no solo el vencimiento
Igual que en la línea de tiempo, una tarea con inicio y fin se dibuja como una barra que ocupa todos los días entre medias (incluso cruzando de una semana a la siguiente), no solo un punto en la fecha límite.

### Línea de tiempo: zoom por días, semanas o meses
Botones "Días / Semanas / Meses" en la propia línea de tiempo (por proyecto y global). En semanas, cada columna muestra su número de semana ISO del año (S29, S30…).

### Filtros, incluidas etiquetas y campos personalizados
Barra de filtros encima de Lista/Tablero/Calendario/Línea de tiempo/Mis tareas: Responsable, Prioridad, Estado, Etiquetas y cualquier campo personalizado del proyecto. Se combinan entre sí y se aplican al momento, sin botón de confirmar.

**Campos personalizados** (por ejemplo "Cliente" con opciones "Talgo, Stelia, Togg"): clic derecho sobre un proyecto en la barra lateral → "Campos personalizados". Una vez creados aparecen como desplegable en cada tarea de ese proyecto y como filtro más.

### Sin parpadeo al abrir la app con sesión iniciada
Antes se veía un instante la pantalla de login incluso con la sesión ya iniciada, mientras Firebase comprobaba si había cuenta. Ahora se muestra una pantalla de carga mínima hasta saber con certeza si hay sesión o no, y solo entonces aparece la pantalla que corresponda.

### Columnas ordenables, redimensionables y ocultables en Lista y Mis tareas
Nombre, Fecha límite, Responsables, Prioridad y cada campo personalizado se pueden pulsar para ordenar — alfabético, por fecha o por valor — con flecha indicando la dirección; un segundo clic invierte el orden. Las tareas completadas siempre van al final.

Cada columna se puede además **redimensionar** (arrastrando su borde derecho) y **ocultar/mostrar** desde el botón "☰ Columnas" de la barra de herramientas, encima de la tabla — la de Nombre no se puede ocultar. Esto es una preferencia de cada persona: se guarda en tu perfil y no cambia lo que ve nadie más del equipo. Si entre anchos y columnas la tabla no cabe en la pantalla, aparece scroll horizontal en vez de aplastar el contenido. Esa cabecera (nombres de columna, con sus botones de ordenar y redimensionar) se queda siempre fija arriba, junto con la barra de herramientas — al desplazarte por una lista larga, solo se mueven las filas y las secciones, nunca la cabecera.

### Campos personalizados también en Mis tareas
Además de los de un proyecto (clic derecho sobre el proyecto → "Campos personalizados", o el botón "+ Campo personalizado" en la barra de herramientas de Lista), ahora "Mis tareas" tiene su propio botón "+ Campo personalizado": son campos tuyos, para clasificar como quieras cualquier tarea que veas ahí (sea de un proyecto o un recordatorio personal), sin que le aparezcan a nadie más. Al abrir una tarea que tiene campos personales rellenables, se marcan con "· personal" para distinguirlos de los del proyecto.

### Tres tipos de campo personalizado
Lista de opciones (como antes), número y texto libre — se elige al crear el campo. Los tres se pueden usar como columna y como filtro.

### Buscador global (⌘K / Ctrl+K)
Botón "Buscar…" arriba de la barra lateral, o el atajo de teclado desde cualquier pantalla. Busca en tareas, proyectos y personas (categorías activables/desactivables), y trae unas "búsquedas guardadas" rápidas: tareas que has creado, que has asignado a otros, y completadas recientemente.

### Archivo
Clic derecho sobre un proyecto → "Archivar proyecto": desaparece de la lista principal pero no se borra. Se consulta desde "Archivo" en la barra lateral; clic derecho sobre un proyecto archivado ahí da las dos acciones que le faltaban: "Desarchivar proyecto" (vuelve a la lista activa) y "Eliminar proyecto" (borra también todas sus tareas y comentarios, con confirmación de por medio — no se puede deshacer).

### Vacaciones inhábiles en la línea de tiempo
Botón "🏖️ Vacaciones inhábiles" en la línea de tiempo (por proyecto y global): sombrea en rojo agosto completo y del 22 de diciembre al 6 de enero, en cualquier nivel de zoom. Son fechas por defecto — si el cierre real de la empresa es distinto, dímelo y las ajusto.

### Corrección: las barras ya no tapan el nombre de la tarea
En la línea de tiempo, la columna de nombres (fija a la izquierda al desplazar) tenía la misma prioridad de apilado que las barras, así que una barra larga podía pintarse encima del texto. Ahora el nombre siempre queda por delante.

### Mi cuenta y administración de equipo
Clic en tu nombre (pie de la barra lateral) abre un menú con **"Mi cuenta"**: ver tu correo, tu rol y desde cuándo eres miembro, cambiar tu nombre visible y cambiar tu contraseña (pide la contraseña actual). Si tu cuenta es admin, ese mismo menú añade **"Administrar equipo"**: lista de todas las cuentas registradas con un desplegable para cambiar el rol de cada una (no te puedes quitar el admin a ti mismo si eres la única persona administradora), y la configuración de qué dominios de correo pueden registrarse — lo que antes solo se podía tocar desde la consola de Firebase.

### Importador de Asana (solo administradores)
Desde el menú de tu nombre (pie de la barra lateral), si eres admin verás también **"Importar desde Asana"** — no aparece para el resto del equipo, así que no hace falta ocultarlo de ningún otro sitio. Carga ahí el archivo `.json` de export (formato `asana-api-export`) y verás un resumen de qué trae y cuánto es nuevo frente a lo ya importado antes; se puede cargar el mismo archivo varias veces sin miedo a duplicar nada.

Reimportar el mismo archivo (o una versión más reciente de un proyecto que ya existía) es seguro y autorreparador: si trae una sección que el proyecto en Chusy todavía no tiene, se añade sola, y las tareas que se hubieran quedado apuntando a una sección que ya no existía se corrigen — esto podía pasar al reimportar un proyecto existente, y hacía que esas tareas «desaparecieran» de Lista o Tablero aunque siguieran contando en el total. Por eso el botón de confirmar sigue activo aunque el resumen diga «nada nuevo»: repasar y reparar sigue siendo útil aun sin crear nada. "Borrar todo lo importado" también limpia el archivo que tuvieras cargado en el panel y su tabla de equivalencias, para no dejar en pantalla a nadie cuyo perfil ficticio se acaba de borrar.

Como las personas de Asana y las cuentas de Chusy no son las mismas, cada persona de Asana que aparece en el archivo se lista con un desplegable para decir "esto es en realidad Fulanito" (solo se pueden elegir cuentas ya registradas en Chusy — no hay forma de crear cuentas reales desde aquí). Mientras no se le asigne una cuenta real, queda como **usuario ficticio**: sus tareas y comentarios se ven con normalidad, pero no puede entrar en Chusy ni se ofrece como opción al asignar tareas nuevas. En cuanto se aplica una equivalencia, se reescriben automáticamente todas sus tareas y comentarios ya importados con la cuenta real — se puede hacer en el momento de importar o más adelante, según se vaya registrando cada persona; esta tabla de equivalencias está siempre disponible en el mismo panel, no solo durante una importación.

Las subtareas de Asana entran como tareas normales del proyecto (con su responsable, fechas y comentarios propios si los tenían), no como el checklist ligero de "subtareas" de Chusy — se nota porque su descripción empieza con una referencia de vuelta a la tarea de la que venían. Los adjuntos **no se importan**: el export no trae los archivos, y reconstruir enlaces a partir del historial de actividad de Asana solo serviría mientras se mantenga acceso a Asana, lo cual no tiene sentido para una migración que busca dejar de depender de ella. Hay también una "zona de riesgo" en el propio panel para borrar de un tirón todo lo importado (por si una prueba sale mal) sin tocar nada creado a mano.

### He olvidado mi contraseña
Enlace bajo el campo de contraseña en la pantalla de entrada: pide el correo y envía un enlace de Firebase para elegir una contraseña nueva. Por privacidad, el mensaje de confirmación es el mismo exista o no una cuenta con ese correo.

### Barra lateral minimizable
Botón redondo en el borde derecho de la barra lateral (junto al logo): la reduce a una franja estrecha con solo el icono, la lista de proyectos como puntos de color y los iconos de Mis tareas / Línea de tiempo / Archivo — pasa el ratón por encima de cualquier icono para ver su nombre. Se anima con una transición suave. Es una preferencia de este navegador (se guarda con `localStorage`, no en tu cuenta), así que no afecta a otras sesiones ni dispositivos. En pantallas de móvil, donde la barra lateral ya se abre y cierra como un panel superpuesto con el botón de menú, este control no aparece — ahí no hace falta.

### Selección múltiple y edición masiva (Lista y Mis tareas)
Ctrl/Cmd+clic sobre una tarea la añade o la quita de la selección sin abrir su detalle; Shift+clic selecciona todo el tramo desde la última tocada (puede cruzar secciones, o los grupos de fecha en Mis tareas). Un clic normal sigue abriendo la tarea como siempre. Con algo seleccionado aparece una barra flotante abajo: mover a otra sección, cambiar de proyecto (ajusta la sección al primero del proyecto destino), asignar a una persona, establecer fecha de inicio y/o límite (cada una con su propia casilla — dejarla en blanco la borra), eliminar, y un menú "···" con marcar como completadas / sin finalizar, agregar colaboradores (sin quitar a los que ya tuviera cada tarea), combinar tareas duplicadas en una sola (une responsables, etiquetas, subtareas, adjuntos y comentarios en la que elijas conservar, y borra las demás), convertir en hitos, y mover a mis tareas (las saca del proyecto y las deja como tareas personales de quien pulsa el botón — no de quien las tuviera asignadas antes —, sustituyendo los responsables anteriores por esa persona, ya que a partir de ahí solo ella podrá verlas). Disponible tanto en la vista de Lista de un proyecto como en Mis tareas; ahí la selección puede mezclar tareas de varios proyectos distintos y recordatorios personales a la vez, así que "mover a otra sección" no aparece (las secciones son de un proyecto concreto) y "cambiar de proyecto" ofrece todos los proyectos sin excluir ninguno. Sigue faltando en Tablero.

### Corrección: "Mis tareas" ya muestra las tareas de todo el equipo, no solo las de un admin
Solo quien tenía rol de admin veía algo en "Mis tareas" — al resto del equipo le aparecía siempre vacía, por más tareas que tuviera asignadas. La causa estaba en la consulta a Firestore: pedía las tareas con un único `where("assigneeIds","array-contains", uid)`, sin acotar por `projectId` ni `ownerId`. La regla de lectura de tareas es un OR de esos dos campos (más "eres admin"), y Firestore necesita poder demostrar que una consulta cumple la regla a partir de sus propios filtros; como esta no acotaba ninguno de los dos, la rechazaba entera para cualquiera que no fuera admin — la rama "eres admin" era la única que se salvaba siempre, y por eso solo un admin veía resultados. Ahora son dos consultas separadas por debajo (una acotada a `projectId != null`, otra a `ownerId == uid`), cada una calcada a una rama del OR, así que las dos quedan verificables para cualquiera con sesión iniciada — de cara a quien usa la app sigue siendo una sola vista, sin ningún cambio visible más que, ahora sí, ver lo que le corresponde. La consulta de proyecto es nueva para Firestore, así que es fácil que la primera vez que se ejecute pida crear su índice compuesto (el aviso con enlace de siempre, ver el apartado 7).

### Responsables: solo cuentas reales de Chusy
El selector de responsables de una tarea ya no ofrece las cuentas ficticias del importador de Asana — solo se pueden elegir personas con cuenta real. Si una tarea ya tenía asignado alguien ficticio (a quien todavía no se le ha aplicado una equivalencia), esa persona concreta se sigue viendo ahí, marcada con «· Asana», para que sepas que sigue pendiente; el resto de fichas ficticias no aparecen como opción. Mismo criterio en el selector de "asignar a una persona" y en "agregar colaboradores" de la barra de selección múltiple, aunque ahí (al afectar a varias tareas a la vez) no hay excepción posible: no se ofrece ninguna cuenta ficticia.

### Eliminado el campo "Bloqueada por"
Ocupaba mucho espacio en el modal de tarea y apenas se usaba. El dato (`dependsOn`) sigue existiendo en Firestore para las tareas que ya lo tuvieran (y "Combinar tareas duplicadas" lo sigue uniendo entre las tareas fusionadas), pero ya no hay ninguna forma de verlo ni editarlo desde la interfaz.

### Descripción: editor de texto enriquecido y campo más grande
El campo Descripción es ahora mucho más grande (antes apenas cabían un par de líneas) y tiene un editor de texto enriquecido — barra de herramientas y menú de «/» al estilo Asana, con negrita, cursiva, subrayado, tachado, listas con viñetas y numeradas, cita, enlaces, código en línea, bloque de código y títulos (H1/H2/H3). Las descripciones de tareas antiguas (texto plano, incluidas las importadas de Asana) se siguen viendo con normalidad — se van convirtiendo al nuevo formato en cuanto se editan y guardan de nuevo. Todo el HTML que produce este editor se limpia (se sanea) antes de guardarse en Firestore, quitando cualquier etiqueta o atributo que no sea de puro formato de texto — cualquiera del equipo puede editar la descripción de cualquier tarea de proyecto, así que no basta con confiar en que el editor de turno solo genere marcado "bueno".

### Filtros de "Mis tareas" recordados, con las pendientes visibles de serie
Los filtros que apliques en "Mis tareas" ahora se recuerdan: quedan guardados en este navegador (no en la cuenta — mismo criterio que la barra lateral minimizable, así que en un ordenador compartido cada cuenta guarda los suyos por separado) y se recuperan la próxima vez que entres, en esta sesión o en otra. La primera vez que alguien entra no hay nada guardado todavía, así que por defecto se aplica el filtro "Pendiente" (se ocultan las completadas), para no enterrar la vista bajo todo lo que ya está hecho; en cuanto cambies los filtros a tu gusto, eso es lo que queda recordado a partir de ahí. Cuando el filtro está ocultando algo, el contador de arriba pasa a decir "X de Y tareas" en vez de solo el total.

### Modo claro u oscuro, a elegir
Desde "Mi cuenta" (pie de la barra lateral) hay una sección "Apariencia" con dos opciones: 🌙 Oscuro (el de siempre, y el que se aplica de serie si no has elegido nada todavía) y ☀️ Claro. Se aplica al momento, sin cerrar el modal, y queda guardado en tu cuenta — si entras desde otro dispositivo, se respeta lo último que hayas elegido ahí.

### Recompensa al completar tareas: confeti y rachas
Al marcar una tarea sale un chispazo discreto de confeti desde el propio círculo. Además, la recompensa "grande" (confeti cayendo por toda la pantalla + un mensaje) salta en tres situaciones: al completar varias de golpe con la selección múltiple ("Marcar como completadas" en el menú "···"), al completar 3 o más **seguidas y rápido** marcando el círculo una a una — sin usar la selección múltiple —, y al ir sumando completadas a lo largo del **mismo día** y cruzar uno de los hitos (5, 10, 15, 20, 30, 50, 75, 100 — no hace falta que sean seguidas ni rápidas). Cada situación tiene su propio emoji y sus propias frases. Respeta `prefers-reduced-motion`: si el sistema lo pide, no se dispara ninguna animación (la tarea se completa igual).

### Historial de cambios: v18 → v24

Este proyecto se entrega como ZIPs numerados (`Chusy-18.zip`, `Chusy-19.zip`...); cada número es una entrega completa, no un parche — el ZIP más reciente es siempre la fuente de la verdad, no hay que combinar varios. Este apartado resume qué cambió en cada salto desde la v18, para quien retome el proyecto desde una conversación nueva y no tenga ese contexto. La v23 en concreto junta el trabajo de dos conversaciones distintas hechas en paralelo sobre la v18 — una con la v19→v22 de aquí abajo, otra con lo que se resume en la entrada v22→v23 — combinado a mano en una sola entrega.

**v18 → v19 — Scroll: solo las tareas se mueven, el resto queda fijo.**
Problema: en proyectos/listas largas, la topbar, la barra de filtros, la barra flotante de selección múltiple y el pie de la barra lateral (Nuevo proyecto, tu usuario, Cerrar sesión) se desplazaban con el resto de la página en vez de quedarse fijos. Causa raíz: una sola línea de CSS — `.app-shell` usaba `min-height: 100vh` en vez de `height: 100vh`. Al no tener una altura estricta, en cuanto el contenido de dentro superaba el alto de la pantalla, era el propio `app-shell` el que crecía y acababa siendo el `body` quien hacía scroll. El resto del CSS ya estaba preparado para el comportamiento correcto (`.main-content` y `.sidebar__list` con `overflow-y:auto`, la barra de selección anclada con `position:absolute` dentro de `.main-col`) — solo le faltaba ese contenedor con altura acotada al viewport para activarse. Cambio: `.app-shell { height: 100vh; height: 100dvh; overflow: hidden; }` más `min-height: 0` en la cadena de contenedores flex intermedios (`.main-col`, `.sidebar`, `.sidebar__list`, `.main-content`) para que puedan encogerse y activar su propio scroll interno. Solo `css/styles.css` — sin cambios de JS ni de HTML.

**v19 → v20 — Nueva acción masiva: "Mover a mis tareas".**
En el menú "⋯ Más acciones" de la barra de selección múltiple (vista Lista): saca las tareas seleccionadas de su proyecto y las convierte en tareas personales de quien pulsa el botón — no de quien las tuviera asignadas antes. Sustituye los responsables anteriores por esa persona (si ya lo era, no cambia nada; si no, queda asignada automáticamente), porque al ser ya privada nadie más podría verla de todos modos. Pide confirmación antes, porque a diferencia del resto de acciones masivas, esta cambia quién puede ver la tarea, no solo un campo suyo. Cambios: `js/data/tasks.js` (nueva `bulkMoveToMyTasks(taskIds, uid)`), `js/components/bulk-toolbar.js` (la entrada de menú, su confirmación, y `currentUser` propagado hasta el menú "más acciones", que antes no lo recibía), `js/views/list-view.js` (le pasa `currentUser` a la barra). No hizo falta tocar `firestore.rules`: la regla de actualización de una tarea se evalúa sobre su estado *antes* del cambio, y una tarea de proyecto (`projectId != null`) ya está abierta a todo el equipo para escritura.

**v20 → v21 — Gestión de secciones, cabecera de tabla fija, y arreglo de las etiquetas de proyecto.** Tres cambios independientes:
- *Crear, renombrar y eliminar secciones.* Nuevo botón "🗂 Secciones" en la barra de herramientas de Lista, que abre un modal (`js/components/sections-modal.js`, mismo patrón que "Campos personalizados") para editar la lista completa antes de un único "Guardar". Al eliminar una sección con tareas dentro, esas tareas **no se borran**: `saveProjectSections()` (nueva, en `js/data/projects.js`) primero las pasa a `sectionId: null` por lotes, y solo después guarda la nueva lista de secciones. Se añadió un grupo/columna "Sin sección" tanto en Lista como en Tablero para que esas tareas sigan siendo visibles y gestionables, y el desplegable de sección dentro del propio detalle de tarea ganó la opción "— Sin sección —" (antes no existía forma de volver a poner una tarea sin sección desde ahí).
- *Cabecera de columnas fija en Lista y Mis tareas.* Los nombres de columna (con sus botones de ordenar y redimensionar) y la barra de herramientas se quedan arriba; solo las filas y las secciones se desplazan debajo. La pieza sutil: `.list-table-scroll` tiene `overflow-x:auto` para el scroll horizontal, y por especificación de CSS eso obliga al navegador a convertir también su `overflow-y` en `auto` aunque no se pida — en vez de pelear contra eso, se aprovechó dándole una altura acotada (con `.main-content:has(> .list-table-scroll) { overflow: hidden; }`, selector que solo afecta a estas dos vistas) y anclando `.list-table__header` con `position: sticky; top: 0` contra ese contenedor. Solo CSS, sin cambios de JS.
- *Nombres de proyecto largos ya no se salen de su etiqueta de color.* Dentro de una celda de tabla (que es un grid), un `<span>` se "blockifica" automáticamente y se estira al ancho exacto de su columna — con nombres largos, el texto se salía de ese ancho sin fondo detrás. Se arregló con `width: max-content; justify-self: start;` en `.tag-pill` (sin efecto fuera de una grid, así que no afecta a los demás sitios donde se usa esa clase): ahora el fondo coloreado siempre abraza el nombre completo, aunque con nombres muy largos eso implique que se extienda un poco sobre la columna siguiente.

**v21 → v22 — Checkbox en Mis tareas, gestión de archivados por clic derecho, y animación al completar.** Tres cambios independientes:
- *Círculo de completar en Mis tareas.* Ya existía en Lista pero faltaba en `js/views/my-tasks-view.js` — mismo comportamiento: marca/desmarca sin abrir el detalle de la tarea.
- *Desarchivar / eliminar proyectos por clic derecho.* El botón suelto "Desarchivar" de la vista Archivo se sustituyó por un menú contextual (clic derecho sobre cada fila), igual que el de proyectos activos en la barra lateral: "Desarchivar proyecto" y "Eliminar proyecto" (con confirmación; borra también todas sus tareas y comentarios). `js/app.js` le pasa a `renderArchiveView` un `onDelete` nuevo que reutiliza `deleteProjectWithTasks`, que ya existía para proyectos activos.
- *Animación de recompensa al completar tareas.* Nuevo módulo `js/components/celebration.js`, solo CSS + DOM (sin canvas ni librerías) y que respeta `prefers-reduced-motion` (si el sistema lo pide, no se dispara nada — la tarea se completa igual). Dos niveles: al marcar **una** tarea (círculo individual, en Lista o Mis tareas) sale un chispazo discreto de confeti desde el propio círculo, que además hace un pequeño "pop"; al marcar **varias de golpe** ("Marcar como completadas" en el menú "⋯" de la selección múltiple) cae confeti por todo el ancho de la pantalla (más piezas cuantas más tareas) más un mensaje tipo "🎉 5 tareas completadas — Imparable.". Los colores del confeti son los mismos que ya usa la app para etiquetas (`TAG_COLOR_PALETTE`, en `js/data/tags.js`), para no desentonar con el resto del diseño.

**v22 → v23 — Editor de descripción, filtro de responsables ficticios, "Bloqueada por" fuera, y filtros de Mis tareas recordados.** Cuatro cambios independientes, hechos en una conversación en paralelo a la v19→v22 de arriba:
- *Editor de descripción enriquecido y campo más grande.* El campo Descripción del modal de tarea pasa de un `<textarea>` de texto plano a un editor de texto enriquecido (nuevo `js/components/rich-text-editor.js`, reutilizable): barra de herramientas con negrita/cursiva/subrayado/tachado/listas/cita/enlace/código, y menú "/" para insertar bloques (párrafo, títulos H1-H3, listas, cita, bloque de código) — mismo patrón que el editor de Asana. El área editable pasa de 72px de alto mínimo a 220px. La descripción se guarda como HTML en vez de texto plano; `sanitizeHtml()` y `toEditableHtml()` (nuevas, en `js/utils.js`) limpian ese HTML antes de guardarlo en Firestore (nada de `<script>`, atributos `on...` ni enlaces `javascript:` — cualquiera del equipo puede editar la descripción de cualquier tarea de proyecto) y convierten a HTML seguro las descripciones antiguas en texto plano (incluidas las importadas de Asana), que se siguen viendo con normalidad hasta que se editen y guarden de nuevo. `mergeTasks()` en `js/data/tasks.js` también se actualizó para concatenar descripciones como HTML al combinar tareas duplicadas.
- *Solo cuentas reales al asignar responsables.* Los selectores de responsables (modal de tarea, "asignar a una persona" y "agregar colaboradores" de la barra de selección múltiple) ya no ofrecen las cuentas ficticias del importador de Asana. Excepción: si una tarea concreta ya tenía asignada una persona ficticia sin equivalencia aplicada todavía, esa se sigue viendo (marcada "· Asana") para no perderla de vista.
- *Fuera el campo "Bloqueada por".* Ocupaba mucho espacio en el modal de tarea y apenas se usaba. El dato (`dependsOn`) sigue en Firestore para tareas que ya lo tuvieran (y `mergeTasks()` lo sigue uniendo entre tareas fusionadas), pero ya no hay forma de verlo ni editarlo desde la interfaz.
- *Filtros de "Mis tareas" recordados por persona.* Se guardan en `localStorage` (namespaced por `uid`, mismo criterio que `sidebarCollapsed`) y se recuperan al volver a esa vista. La primera vez, sin nada guardado, se aplica "Pendiente" de serie para no enterrar la vista bajo lo ya completado; el contador de arriba pasa a decir "X de Y tareas" cuando el filtro oculta algo. Cambios: `js/app.js` (`loadMyTasksFilters()`/`saveMyTasksFilters()`, y `selectMyTasks()`/`handleFilterChange()` las usan).

**v23 → v24 — Modo claro/oscuro, recompensa por rachas fuera de la selección múltiple, selección múltiple en Mis tareas, y arreglo del icono descentrado en la barra lateral colapsada.** Cuatro cambios independientes:
- *Modo claro/oscuro, elegible desde "Mi cuenta".* Toda la interfaz ya usaba variables CSS para el color (bloque `:root` en `css/styles.css`), así que el modo claro es un segundo bloque de esas mismas variables bajo `:root[data-theme="light"]` — sin tocar reglas una a una. Ese atributo `data-theme` en `<html>` es lo único que distingue un tema del otro; lo pone `js/theme.js` (`applyTheme()` / `getCachedTheme()`), cacheándolo en `localStorage` bajo la clave `chusy:theme`. Para que no se vea ni un parpadeo del tema equivocado mientras carga Firebase, un script embebido al principio de `<head>` en `index.html` lee esa misma clave de forma síncrona y aplica el atributo antes del primer pintado (la pantalla de carga que ya existía cubre ese hueco de sobra). La cuenta (`users/{uid}.theme`, vía `updateUserProfile`) es la fuente de verdad de verdad, para que el tema viaje entre dispositivos: `js/app.js` la aplica en cuanto se conoce el perfil (dentro de `onAuthChange`), reconciliándola con la caché local si difieren. El selector en sí vive en `js/components/account-modal.js` — nueva sección "Apariencia" con dos `.chip` (reutiliza el estilo de las píldoras de prioridad del modal de tarea, cero CSS nuevo) que aplican al momento y guardan en Firestore en segundo plano; si ese guardado falla, el tema se queda igualmente aplicado en este navegador y solo se avisa de que no viajará a otro dispositivo. Detalle no trivial: varios sitios usaban `--color-void` (el fondo de página, muy oscuro en el único tema que existía hasta ahora) como color de *texto* para ponerlo encima de `--color-signal` (el dorado) u otros fondos brillantes — insignia de admin, botón primario, "hoy" del calendario, contador de filtros, texto de las barras del calendario. Al volverse `--color-void` un color claro en el tema claro, ese texto habría dejado de leerse; se creó `--color-ink` (texto oscuro fijo, igual en los dos temas, pensado justo para ir encima de fondos brillantes) y se corrigieron esos puntos (cinco en `css/styles.css`, uno más en `account-modal.js` que además tenía los colores en hexadecimal suelto en vez de variables — la insignia de rol). También se ajustó `--color-signal` específicamente para el tema claro, de `#FCD000` a `#8A6D00`: el dorado original da muy poco contraste como texto sobre blanco (~1,5:1 — prácticamente ilegible), y ese mismo token se usa como color de enlaces y acentos por toda la interfaz, no solo como fondo de insignias. El resto de la paleta (rojo/ámbar/verde de estado, el dorado atenuado de bordes, los "washes" translúcidos) se dejó igual en ambos temas a propósito: son washes de baja opacidad que ya se adaptan solos al fondo que tengan detrás, o colores de estado que conviene reconocer igual en cualquier tema.
- *Recompensa grande también fuera de la selección múltiple: rachas rápidas y del día.* `js/components/celebration.js` reescrito para trackear dos rachas nuevas, además de la ya existente por selección múltiple (ahora identificada internamente como `kind: "selection"`). Racha rápida (`kind: "streak"`): cada `celebrateTask()` (se llama al marcar una tarea individual, en Lista o Mis tareas) guarda su marca de tiempo en una cola en memoria; con 3 o más dentro de los últimos 9 segundos salta la recompensa grande con ese recuento, y sigue saltando en cada una más mientras la racha no se enfríe, como un contador de combo. Racha del día (`kind: "daily"`): un contador en `localStorage` (clave `chusy:dailyCompletions`, guarda también la fecha — se reinicia solo al cambiar de día) que suma con cada completada, incluidas las hechas por selección múltiple (para que el total del día sea real sin importar cómo se complete cada una); al cruzar uno de los hitos (5, 10, 15, 20, 30, 50, 75, 100) salta la recompensa grande mostrando el total acumulado de hoy, no el hito exacto — si una selección múltiple salta de 3 a 8 de golpe, por ejemplo, se cruza el hito de 5 pero el mensaje dice "8 tareas hoy". Si coinciden las dos rachas a la vez, gana la del día (para no lanzar dos recompensas de golpe). Cada tipo tiene su propio emoji y sus propias frases, agrupadas en `CELEBRATION_KINDS`. `celebrateBulk(count, kind)` sigue aceptando tal cual las llamadas ya existentes (`kind` por defecto es `"selection"`), así que `bulk-toolbar.js` no necesitó tocarse para esto — sí gana, por dentro de ese mismo `kind`, la contribución al contador del día.
- *Selección múltiple también en Mis tareas.* `js/views/my-tasks-view.js` gana su propio `createSelectionController()` (de `bulk-selection.js`, que ya era genérico y no necesitó ningún cambio) con el mismo comportamiento que Lista: Ctrl/Cmd+clic para añadir/quitar una tarea, Shift+clic para el tramo, y la misma barra flotante de `bulk-toolbar.js`. Como aquí la selección puede mezclar tareas de varios proyectos a la vez y recordatorios personales (a diferencia de Lista, donde todas son siempre del mismo proyecto), `renderBulkToolbar()` pasa a recibir `project` como parámetro opcional: sin él, "Mover a otra sección" se oculta del todo (las secciones son de un proyecto concreto, no hay uno de referencia posible) y "Cambiar de proyecto" deja de excluir "el proyecto actual" de la lista de destinos (no hay uno) y ofrece todos. El resto de acciones (asignar, fechas, eliminar, marcar completadas, agregar colaboradores, combinar duplicadas, convertir en hitos, mover a mis tareas) no dependían de un proyecto único y siguen funcionando sin tocarlas.
- *Icono de "Mis tareas" descentrado en la barra lateral colapsada.* El contador de pendientes junto a "Mis tareas" (`.sidebar__item-count`) es también un `.sidebar__label`, así que al colapsar la barra ya le tocaba `max-width:0; opacity:0` igual que al texto del nombre — pero al tener además `padding` y `border` propios, esa caja no llegaba a pesar 0px de verdad (ninguno de los dos encoge por debajo de su propio tamaño aunque el contenido sí lo haga a 0). Ese resto invisible-pero-presente descuadraba el `justify-content:center` del icono frente al resto de items de la barra (que, al no tener ese tercer elemento oculto, ya quedaban perfectamente centrados). Arreglo: `display:none` en el contador cuando la barra está colapsada, con su contrapartida `display:inline-block` dentro del `@media (max-width:860px)` — ahí la barra colapsada se ve siempre "expandida" por pantalla, así que el contador sí debe verse. Solo `css/styles.css`.

---

## 4. Estructura del proyecto

```
index.html                 Pantalla de login/registro + estructura de la app
css/styles.css              Todo el diseño
assets/                     Logo de Chusy (principal) y de Martech Corporation (crédito)
js/
  firebase-config.js        ← AQUÍ pegas tu configuración de Firebase
  firebase-init.js           Inicializa Firebase (auth, db)
  auth.js                    Registro / inicio de sesión / roles
  theme.js                    Modo claro/oscuro: aplica el tema (atributo `data-theme` en `<html>`) y lo cachea en este navegador — la cuenta (`users/{uid}.theme`) es la fuente de verdad, esto solo evita el parpadeo mientras carga
  utils.js                   Fechas, avatares, contraste de color, helpers
  data/
    projects.js               CRUD de proyectos (incluye borrado en cascada, archivado y gestión de secciones — crear/renombrar/eliminar, con reasignación de tareas huérfanas a "sin sección")
    tasks.js                   CRUD de tareas (proyecto y personales) + operaciones en lote para la selección múltiple de Lista y Mis tareas (mover, cambiar de proyecto, mover a mis tareas, asignar, fechas, completar, combinar duplicadas, borrar)
    tags.js                     Registro compartido de etiquetas (nombre + color)
    comments.js                  Comentarios de una tarea
    users.js                      Perfil de usuario (Firestore) y configuración del equipo
    asana-import.js                Importador de Asana: lee el export, resuelve equivalencias y escribe/reescribe en Firestore
  components/
    sidebar.js                  Proyectos + Mis tareas + Línea de tiempo + Archivo + buscador + menú de cuenta
    topbar.js                    Selector de vista + nueva tarea
    project-modal.js             Crear proyecto
    edit-project-modal.js         Editar nombre/icono/color de un proyecto existente
    project-appearance-picker.js  Selector de icono+color compartido (crear y editar)
    custom-fields-modal.js        Definir campos personalizados (lista/número/texto)
    task-modal.js                  Formulario único de tarea (crear/editar)
    rich-text-editor.js            Editor de texto enriquecido reutilizable (barra de herramientas + menú "/"), lo usa el campo Descripción del modal de tarea
    context-menu.js                Menú contextual reutilizable (clic derecho)
    filter-bar.js                   Barra de filtros reutilizable
    search-modal.js                  Buscador global (⌘K / Ctrl+K)
    account-modal.js                  "Mi cuenta": nombre, rol, apariencia (modo claro/oscuro) y cambio de contraseña
    team-admin-modal.js                Panel de admin: roles del equipo y dominios permitidos
    asana-import-modal.js               Panel de admin: importar desde Asana y mapear personas
    reset-password-modal.js              "He olvidado mi contraseña" (pantalla de login)
    table-columns.js                     Ancho/orden/visibilidad de columnas de tabla (Lista y Mis tareas), por persona
    bulk-selection.js                     Controlador de selección múltiple de tareas (Ctrl/Cmd+clic, Shift+clic) — lo usan Lista y Mis tareas, cada una con su propia instancia
    bulk-toolbar.js                        Barra flotante de acciones masivas sobre la selección (mover, cambiar de proyecto, mover a mis tareas, asignar, fechas, completar, combinar duplicadas, convertir en hitos...) — la usan Lista y Mis tareas
    sections-modal.js                       Crear/renombrar/eliminar las secciones de un proyecto (columnas del Tablero, agrupaciones de la Lista)
    celebration.js                          Confeti al completar tareas: chispazo pequeño al marcar una, y recompensa grande (confeti por toda la pantalla + mensaje) al completar varias de golpe por selección múltiple, varias seguidas y rápido, o al cruzar un hito de tareas completadas en el día
  task-filters.js             Filtrado y ordenación de tareas (compartido por todas las vistas)
  views/
    list-view.js                  Vista de Lista: tabla ordenable (+ menú contextual, selección múltiple y su barra de acciones masivas)
    board-view.js                  Vista de Tablero (Kanban con drag & drop)
    calendar-view.js                Vista de Calendario (barras de duración + hitos)
    timeline-view.js                 Línea de tiempo/Gantt (por proyecto o global, zoom, vacaciones)
    my-tasks-view.js                  "Mis tareas": tabla ordenable (proyecto + personales), con selección múltiple y su barra de acciones masivas, igual que Lista
    archive-view.js                   Proyectos archivados
  app.js                     Conecta todo: sesión, estado, enrutado simple
firestore.rules             Reglas de seguridad de Firestore
```

## 5. Modelo de datos (Firestore)

- **`users/{uid}`** — `name`, `email`, `role` (`admin` | `miembro`), `theme` (`"dark"` | `"light"` — opcional; sin definir se trata como `"dark"`), `personalCustomFieldDefs[]` (mismo formato que los de proyecto, pero solo tuyos — se usan en "Mis tareas"), `columnPrefs` (`{[scopeKey]: {widths:{[colKey]:px}, hidden:[colKey,...]}}`, `scopeKey` = `project:<id>` o `mytasks` — anchos y columnas ocultas de las tablas, por persona). Un perfil "ficticio" creado por el importador de Asana añade además `isImported: true`, `asanaGid` (id de esa persona en Asana) y `mergedInto` (uid real una vez se le aplica una equivalencia; `null` mientras sigue ficticio) — su `{uid}` no es un UID de Firebase Auth real, sino `asana:<gid>`
- **`projects/{id}`** — `name`, `description`, `color`, `icon` (emoji; `📁` si no se ha elegido uno), `sections[]`, `memberIds[]` (informativo), `customFieldDefs[]` (`{id,name,type:'lista'|'numero'|'texto',options[]}`), `archived`, `createdBy`. Si viene de una importación, además `asanaGid`
- **`tasks/{id}`** — `projectId` (null si es personal), `ownerId` (solo tareas personales), `sectionId`, `title`, `description` (HTML del editor enriquecido; texto plano en tareas antiguas que no se han vuelto a editar), `assigneeIds[]`, `startDate`, `dueDate`, `priority`, `tags[]` (nombres; el color vive en `tags/`), `dependsOn[]` (dato heredado — ya no se edita desde la interfaz, ver apartado 7), `subtasks[]`, `attachments[]` (`{id,name,url}`), `customFields` (`{[fieldId]: valor}`), `isComplete`, `isMilestone`, `order`. Si viene de una importación, además `asanaGid`
- **`tasks/{id}/comments/{id}`** — `authorId`, `authorName`, `text`. Si viene de una importación, además `asanaGid`; si llegó por combinar tareas duplicadas, además `mergedFrom` (título de la tarea original de la que venía)
- **`tags/{slug}`** — `name`, `color`
- **`meta/asanaUserMap`** — `{[gidDeAsana]: uidReal}`: la tabla de equivalencias del importador de Asana. Quien no aparezca aquí sigue siendo un usuario ficticio
- **`meta/asanaImportIndex`** — `{projects:{[gid]:id}, tasks:{[gid]:id}, comments:{[gid]:{taskId,commentId}}}`: de qué se ha importado ya, para que repetir una importación no duplique nada y se pueda deshacer una prueba de un tirón

## 6. Qué falta (próxima iteración)

- Vistas guardadas de verdad (nombrar y guardar una combinación de filtros para reutilizarla — ahora mismo el buscador trae unas cuantas ya hechas, pero no se pueden crear personalizadas)
- Notificaciones dentro de la app
- Panel con métricas (completadas, vencidas, carga por persona)
- Automatizaciones, formularios de solicitud, revisión de archivos, metas/OKRs, integraciones
- Convertir texto de la descripción directamente en una subtarea enlazada (como el botón "Crear tarea" del editor de Asana) — el editor de texto enriquecido no lo trae todavía; encaja mejor como una función aparte, con su propio diseño.
- Eliminar una cuenta por completo: un admin puede quitarle acceso a todo cambiándole el rol, pero borrar de verdad la cuenta de Firebase Authentication de otra persona no se puede hacer desde el navegador (hace falta el SDK de administración de Firebase, con un backend) — de momento no está implementado
- Selección múltiple y barra de acciones masivas en Tablero (ya está en Lista y en Mis tareas)

## 7. Limitaciones conocidas

- La primera vez que Firestore ejecute algunas consultas puede mostrarte en la consola un enlace para crear un índice compuesto — es normal, solo hay que pulsarlo una vez.
- El orden de tareas al arrastrar en el tablero usa valores numéricos intermedios; a gran escala convendría "renormalizar" los números de vez en cuando (no es un problema al tamaño de un departamento).
- Los anchos de columna "de serie" son valores fijos pensados para el contenido habitual (fecha corta, una etiqueta de prioridad, unos pocos avatares), no una medición real del contenido de cada tarea — para eso están el arrastre y el ocultar/mostrar, que si ajustas una vez quedan guardados para ti.
- El importador de Asana no trae adjuntos, campos personalizados ni dependencias como dato estructurado, aunque el historial de actividad demuestre que los dos últimos sí se usaron en su momento. Para no perderlos en la importación definitiva, hay que pedirle esos campos a la API al generar el export; los adjuntos, mejor añadirlos aparte en su forma normal (un archivo que subir a donde vaya a vivir), no como enlace a Asana.
- Una vez aplicada una equivalencia (persona de Asana → cuenta real), cambiarla por otra cuenta distinta no está pensado para hacerse desde el panel — solo el primer paso de "ficticio → cuenta real" reescribe tareas y comentarios automáticamente.
- Combinar tareas duplicadas traslada los comentarios a la tarea que sobrevive, pero mover un comentario ajeno (que no escribiste tú) exige ser admin — la misma regla que usa el importador de Asana para reasignar autoría histórica. Si no eres admin y alguna de las tareas fusionadas tenía comentarios de otras personas, esos concretos no se trasladan: se quedan colgando en la tarea que se borra (igual que ya pasa hoy al borrar una tarea suelta desde el menú contextual, que tampoco limpia sus comentarios).
- El borrado masivo desde la barra de selección no es una única operación atómica: borra tarea por tarea, así que si seleccionas alguna de la que no eres ni su dueña ni admin, esa en concreto no se borra y se avisa de cuántas sí se pudieron eliminar.
- Si una tarea ya tenía guardada una dependencia ("bloqueada por") de cuando esa función todavía existía en la interfaz, el dato sigue en Firestore pero ya no hay manera de verlo ni de quitarlo desde ahí.
- El editor de descripción usa `document.execCommand` por debajo para negrita, listas, citas, etc. — la documentación de los navegadores lo marca como obsoleto, pero lo siguen soportando todos los navegadores actuales; si algún día alguno deja de hacerlo, ahí está la pista de por dónde mirar.
- Los filtros recordados de "Mis tareas" son una preferencia de este navegador, no de la cuenta (igual que la barra lateral minimizable): si entras desde otro dispositivo, empiezan de cero con "Pendiente" aplicado de serie.
- El contador de "tareas completadas hoy" (para la recompensa grande por racha del día) también es de este navegador, no de la cuenta — mismo criterio que el punto anterior. Completar tareas repartido entre el ordenador y el móvil el mismo día no las suma en un único contador: cada uno lleva el suyo y el hito puede saltar en un dispositivo sin haber saltado todavía en el otro. El modo claro/oscuro es la excepción entre las preferencias nuevas: ese sí es de la cuenta (`users/{uid}.theme`), no de este navegador — viaja contigo entre dispositivos.
