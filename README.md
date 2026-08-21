# Chusy — Gestor de tareas del equipo

Gestor de tareas multiusuario con Kanban, lista, calendario con hitos,
vista personal "Mis tareas" (con recordatorios privados), etiquetas de
color, subtareas, dependencias, comentarios y enlaces adjuntos. Sitio
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

Cada columna se puede además **redimensionar** (arrastrando su borde derecho) y **ocultar/mostrar** desde el botón "☰ Columnas" de la barra de herramientas, encima de la tabla — la de Nombre no se puede ocultar. Esto es una preferencia de cada persona: se guarda en tu perfil y no cambia lo que ve nadie más del equipo. Si entre anchos y columnas la tabla no cabe en la pantalla, aparece scroll horizontal en vez de aplastar el contenido.

### Campos personalizados también en Mis tareas
Además de los de un proyecto (clic derecho sobre el proyecto → "Campos personalizados", o el botón "+ Campo personalizado" en la barra de herramientas de Lista), ahora "Mis tareas" tiene su propio botón "+ Campo personalizado": son campos tuyos, para clasificar como quieras cualquier tarea que veas ahí (sea de un proyecto o un recordatorio personal), sin que le aparezcan a nadie más. Al abrir una tarea que tiene campos personales rellenables, se marcan con "· personal" para distinguirlos de los del proyecto.

### Tres tipos de campo personalizado
Lista de opciones (como antes), número y texto libre — se elige al crear el campo. Los tres se pueden usar como columna y como filtro.

### Buscador global (⌘K / Ctrl+K)
Botón "Buscar…" arriba de la barra lateral, o el atajo de teclado desde cualquier pantalla. Busca en tareas, proyectos y personas (categorías activables/desactivables), y trae unas "búsquedas guardadas" rápidas: tareas que has creado, que has asignado a otros, y completadas recientemente.

### Archivo
Clic derecho sobre un proyecto → "Archivar proyecto": desaparece de la lista principal pero no se borra. Se consulta desde "Archivo" en la barra lateral, con opción de "Desarchivar" para que vuelva a la lista activa.

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

### Selección múltiple y edición masiva (vista de Lista)
Ctrl/Cmd+clic sobre una tarea la añade o la quita de la selección sin abrir su detalle; Shift+clic selecciona todo el tramo desde la última tocada (puede cruzar secciones). Un clic normal sigue abriendo la tarea como siempre. Con algo seleccionado aparece una barra flotante abajo: mover a otra sección, cambiar de proyecto (ajusta la sección al primero del proyecto destino), asignar a una persona, establecer fecha de inicio y/o límite (cada una con su propia casilla — dejarla en blanco la borra), eliminar, y un menú "···" con marcar como completadas / sin finalizar, agregar colaboradores (sin quitar a los que ya tuviera cada tarea), combinar tareas duplicadas en una sola (une responsables, etiquetas, subtareas, adjuntos y comentarios en la que elijas conservar, y borra las demás) y convertir en hitos. De momento solo está en la vista de Lista de un proyecto.

### Corrección: "Mis tareas" ya muestra las tareas de todo el equipo, no solo las de un admin
Solo quien tenía rol de admin veía algo en "Mis tareas" — al resto del equipo le aparecía siempre vacía, por más tareas que tuviera asignadas. La causa estaba en la consulta a Firestore: pedía las tareas con un único `where("assigneeIds","array-contains", uid)`, sin acotar por `projectId` ni `ownerId`. La regla de lectura de tareas es un OR de esos dos campos (más "eres admin"), y Firestore necesita poder demostrar que una consulta cumple la regla a partir de sus propios filtros; como esta no acotaba ninguno de los dos, la rechazaba entera para cualquiera que no fuera admin — la rama "eres admin" era la única que se salvaba siempre, y por eso solo un admin veía resultados. Ahora son dos consultas separadas por debajo (una acotada a `projectId != null`, otra a `ownerId == uid`), cada una calcada a una rama del OR, así que las dos quedan verificables para cualquiera con sesión iniciada — de cara a quien usa la app sigue siendo una sola vista, sin ningún cambio visible más que, ahora sí, ver lo que le corresponde. La consulta de proyecto es nueva para Firestore, así que es fácil que la primera vez que se ejecute pida crear su índice compuesto (el aviso con enlace de siempre, ver el apartado 7).

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
  utils.js                   Fechas, avatares, contraste de color, helpers
  data/
    projects.js               CRUD de proyectos (incluye borrado en cascada y archivado)
    tasks.js                   CRUD de tareas (proyecto y personales) + operaciones en lote para la selección múltiple de Lista (mover, asignar, fechas, completar, combinar duplicadas, borrar)
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
    context-menu.js                Menú contextual reutilizable (clic derecho)
    filter-bar.js                   Barra de filtros reutilizable
    search-modal.js                  Buscador global (⌘K / Ctrl+K)
    account-modal.js                  "Mi cuenta": nombre, rol y cambio de contraseña
    team-admin-modal.js                Panel de admin: roles del equipo y dominios permitidos
    asana-import-modal.js               Panel de admin: importar desde Asana y mapear personas
    reset-password-modal.js              "He olvidado mi contraseña" (pantalla de login)
    table-columns.js                     Ancho/orden/visibilidad de columnas de tabla (Lista y Mis tareas), por persona
    bulk-selection.js                     Controlador de selección múltiple de tareas (Ctrl/Cmd+clic, Shift+clic) — reutilizable, de momento solo lo usa Lista
    bulk-toolbar.js                        Barra flotante de acciones masivas sobre la selección (mover, cambiar de proyecto, asignar, fechas, completar, combinar duplicadas, convertir en hitos...)
  task-filters.js             Filtrado y ordenación de tareas (compartido por todas las vistas)
  views/
    list-view.js                  Vista de Lista: tabla ordenable (+ menú contextual, selección múltiple y su barra de acciones masivas)
    board-view.js                  Vista de Tablero (Kanban con drag & drop)
    calendar-view.js                Vista de Calendario (barras de duración + hitos)
    timeline-view.js                 Línea de tiempo/Gantt (por proyecto o global, zoom, vacaciones)
    my-tasks-view.js                  "Mis tareas": tabla ordenable (proyecto + personales)
    archive-view.js                   Proyectos archivados
  app.js                     Conecta todo: sesión, estado, enrutado simple
firestore.rules             Reglas de seguridad de Firestore
```

## 5. Modelo de datos (Firestore)

- **`users/{uid}`** — `name`, `email`, `role` (`admin` | `miembro`), `personalCustomFieldDefs[]` (mismo formato que los de proyecto, pero solo tuyos — se usan en "Mis tareas"), `columnPrefs` (`{[scopeKey]: {widths:{[colKey]:px}, hidden:[colKey,...]}}`, `scopeKey` = `project:<id>` o `mytasks` — anchos y columnas ocultas de las tablas, por persona). Un perfil "ficticio" creado por el importador de Asana añade además `isImported: true`, `asanaGid` (id de esa persona en Asana) y `mergedInto` (uid real una vez se le aplica una equivalencia; `null` mientras sigue ficticio) — su `{uid}` no es un UID de Firebase Auth real, sino `asana:<gid>`
- **`projects/{id}`** — `name`, `description`, `color`, `icon` (emoji; `📁` si no se ha elegido uno), `sections[]`, `memberIds[]` (informativo), `customFieldDefs[]` (`{id,name,type:'lista'|'numero'|'texto',options[]}`), `archived`, `createdBy`. Si viene de una importación, además `asanaGid`
- **`tasks/{id}`** — `projectId` (null si es personal), `ownerId` (solo tareas personales), `sectionId`, `title`, `description`, `assigneeIds[]`, `startDate`, `dueDate`, `priority`, `tags[]` (nombres; el color vive en `tags/`), `dependsOn[]`, `subtasks[]`, `attachments[]` (`{id,name,url}`), `customFields` (`{[fieldId]: valor}`), `isComplete`, `isMilestone`, `order`. Si viene de una importación, además `asanaGid`
- **`tasks/{id}/comments/{id}`** — `authorId`, `authorName`, `text`. Si viene de una importación, además `asanaGid`; si llegó por combinar tareas duplicadas, además `mergedFrom` (título de la tarea original de la que venía)
- **`tags/{slug}`** — `name`, `color`
- **`meta/asanaUserMap`** — `{[gidDeAsana]: uidReal}`: la tabla de equivalencias del importador de Asana. Quien no aparezca aquí sigue siendo un usuario ficticio
- **`meta/asanaImportIndex`** — `{projects:{[gid]:id}, tasks:{[gid]:id}, comments:{[gid]:{taskId,commentId}}}`: de qué se ha importado ya, para que repetir una importación no duplique nada y se pueda deshacer una prueba de un tirón

## 6. Qué falta (próxima iteración)

- Vistas guardadas de verdad (nombrar y guardar una combinación de filtros para reutilizarla — ahora mismo el buscador trae unas cuantas ya hechas, pero no se pueden crear personalizadas)
- Notificaciones dentro de la app
- Panel con métricas (completadas, vencidas, carga por persona)
- Automatizaciones, formularios de solicitud, revisión de archivos, metas/OKRs, integraciones
- Flechas de dependencia dibujadas en la línea de tiempo (los datos de "bloqueada por" ya existen, falta representarlos visualmente ahí)
- Eliminar una cuenta por completo: un admin puede quitarle acceso a todo cambiándole el rol, pero borrar de verdad la cuenta de Firebase Authentication de otra persona no se puede hacer desde el navegador (hace falta el SDK de administración de Firebase, con un backend) — de momento no está implementado
- Selección múltiple y barra de acciones masivas: de momento solo en la vista de Lista de un proyecto — llevarla también a Tablero y a Mis tareas

## 7. Limitaciones conocidas

- La primera vez que Firestore ejecute algunas consultas puede mostrarte en la consola un enlace para crear un índice compuesto — es normal, solo hay que pulsarlo una vez.
- El orden de tareas al arrastrar en el tablero usa valores numéricos intermedios; a gran escala convendría "renormalizar" los números de vez en cuando (no es un problema al tamaño de un departamento).
- Al abrir una tarea desde "Mis tareas" que pertenece a un proyecto distinto al que tienes seleccionado, el selector de "bloqueada por" solo lista las tareas de ese proyecto que también tienes asignadas a ti, no todas.
- Los anchos de columna "de serie" son valores fijos pensados para el contenido habitual (fecha corta, una etiqueta de prioridad, unos pocos avatares), no una medición real del contenido de cada tarea — para eso están el arrastre y el ocultar/mostrar, que si ajustas una vez quedan guardados para ti.
- El importador de Asana no trae adjuntos, campos personalizados ni dependencias como dato estructurado, aunque el historial de actividad demuestre que los dos últimos sí se usaron en su momento. Para no perderlos en la importación definitiva, hay que pedirle esos campos a la API al generar el export; los adjuntos, mejor añadirlos aparte en su forma normal (un archivo que subir a donde vaya a vivir), no como enlace a Asana.
- Una vez aplicada una equivalencia (persona de Asana → cuenta real), cambiarla por otra cuenta distinta no está pensado para hacerse desde el panel — solo el primer paso de "ficticio → cuenta real" reescribe tareas y comentarios automáticamente.
- Combinar tareas duplicadas traslada los comentarios a la tarea que sobrevive, pero mover un comentario ajeno (que no escribiste tú) exige ser admin — la misma regla que usa el importador de Asana para reasignar autoría histórica. Si no eres admin y alguna de las tareas fusionadas tenía comentarios de otras personas, esos concretos no se trasladan: se quedan colgando en la tarea que se borra (igual que ya pasa hoy al borrar una tarea suelta desde el menú contextual, que tampoco limpia sus comentarios).
- El borrado masivo desde la barra de selección no es una única operación atómica: borra tarea por tarea, así que si seleccionas alguna de la que no eres ni su dueña ni admin, esa en concreto no se borra y se avisa de cuántas sí se pudieron eliminar.
