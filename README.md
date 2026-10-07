# Chusy — Gestor de tareas del equipo

Gestor de tareas multiusuario inspirado en Asana y hecho a medida para el equipo de Martech Corporation. Sitio 100 % estático (HTML, CSS y JS con módulos ES, sin paso de compilación) en GitHub Pages, con Firebase (Auth + Firestore, plan gratuito Spark) como base de datos compartida en tiempo real.

- **Marca:** logotipo propio de Chusy (`assets/chusy-badge.png`) con la paleta de Martech (gris pizarra `#78848C`, antracita `#3C3C3C`, dorado `#FCD000`). Martech sale como crédito en el login y al pie de la barra lateral. El nombre «Chusy» está en `index.html` y `js/components/sidebar.js`.
- **Roles:** **Admin** (todo: además administra el equipo, importa de Asana, configura Creación Rápida y la Conexión con Outlook, y ve Métricas), **Revisor** (Miembro + Métricas) y **Miembro** (por defecto; la primera persona que se registra nace admin).
- **Departamentos:** Diseño - Industria, Diseño - Automoción, Técnicos y Producción. Una capa aparte del rol: solo dan acceso a secciones exclusivas (hoy, Ofertas).
- **Acceso:** todo el equipo ve todos los proyectos y sus tareas. Excepciones: las tareas **personales** (solo quien conste como responsable) y las **secciones exclusivas** (solo admin o el departamento con acceso). Cualquiera crea proyectos y tareas; borrar un proyecto o una tarea de proyecto ajena queda para quien lo creó o un admin.

## Índice

1. [Puesta en marcha](#1-puesta-en-marcha-una-sola-vez)
2. [Cómo se trabaja en este proyecto](#2-cómo-se-trabaja-en-este-proyecto)
3. [Funciones](#3-funciones)
4. [Estructura del proyecto](#4-estructura-del-proyecto)
5. [Modelo de datos y reglas de acceso](#5-modelo-de-datos-y-reglas-de-acceso)
6. [Pendiente e ideas](#6-pendiente-e-ideas)
7. [Limitaciones y trampas conocidas](#7-limitaciones-y-trampas-conocidas)
8. [Historial de cambios](#8-historial-de-cambios)

---

## 1. Puesta en marcha (una sola vez)

1. **Proyecto de Firebase** ([console.firebase.google.com](https://console.firebase.google.com)): plan **Spark** (gratuito). No hace falta Blaze para nada de lo que usa la app (los adjuntos son enlaces, no subidas).
2. **Authentication** → Comenzar → Sign-in method → activar *Correo electrónico/contraseña*.
3. **Firestore Database** → Crear base de datos → modo producción (las reglas son propias).
4. **Registrar la app web** (⚙️ Configuración del proyecto → Tus apps → `</>`) y pegar `firebaseConfig` en `js/firebase-config.js`. No son datos secretos.
5. **Publicar las reglas:** Firestore → Reglas → pegar `firestore.rules` → Publicar. **Subir el archivo a GitHub no actualiza las reglas publicadas: hay que pegarlas de nuevo cada vez que cambien.**
6. **Probar en local:** `python3 -m http.server 8000` y abrir `http://localhost:8000` (Firebase Auth no funciona abriendo el archivo con doble clic).
7. **GitHub Pages:** subir la carpeta a un repositorio → Settings → Pages → Deploy from a branch → `main` / (root).

**Primer uso.** La primera persona que se registre es admin; el resto, Miembro. Un admin cambia roles desde «Administrar equipo» (menú del nombre, pie de la barra lateral) o editando `users/{uid}.role` en la consola (`admin`, `revisor` o `miembro`). Para limitar el registro a correos de la empresa: «Administrar equipo» → dominios permitidos (o `meta/config.allowedEmailDomains`, un array como `["martechcorp.com"]`).

---

## 2. Cómo se trabaja en este proyecto

**Entregas.** Cada versión es un ZIP **completo** y numerado (`Chusy-N.zip`), no un parche: el más reciente es la fuente de la verdad y una conversación nueva empieza subiéndolo. Si dos conversaciones trabajan a la vez sobre la misma versión hay que fusionar a mano (ya pasó en la v23, v29, v36 y v46); al fusionar, comprobar que `firestore.rules` no tenga dos bloques `match` para la misma colección.

**Checklist antes de entregar**

1. **README al día:** el apartado 3 si cambia una función; el 4 y el 5 si cambian archivos o datos; el 6 y el 7 si cambia algo pendiente o una limitación; y **una entrada breve en el historial (apartado 8)**.
2. **Si cambia `css/styles.css`:** subir el número de `css/styles.css?v=N` en `index.html` (ahora `?v=57`). Sin eso, el navegador o GitHub Pages pueden servir el CSS viejo y parecer que un arreglo no funciona. Ante un «sigue igual»: Ctrl+F5 antes de buscar un bug.
3. **Si cambia `firestore.rules`:** avisar de que hay que republicarlas (apartado 1, paso 5).
4. **Índices compuestos:** si Firestore los pide, la consola del navegador (F12) trae un enlace que lo crea; esperar a que pase de «Compilando» a «Habilitado».
5. **No tocar `js/firebase-config.js`** (tiene la configuración del proyecto real).

**Cómo redactar una entrada del historial.** Qué se pidió, qué se hizo y en qué archivos, y qué hay que hacer al publicar (reglas, índices, pasos manuales). Sin recuentos de pruebas ni avisos de «no probado»: si algo sigue siendo un riesgo real, va a «Limitaciones» (apartado 7), no al historial.

**Verificación habitual.** Arnés de Node.js + `jsdom` con los módulos reales de `js/` y un Firestore simulado en memoria (no va dentro del ZIP). Para código que genera archivos (Excel, PDF) conviene ejecutar el código real y convertir el resultado a PDF/imagen con LibreOffice, no fiarse de leerlo.

**Dónde tocar para…**

| Quiero… | Dónde |
|---|---|
| Añadir o renombrar un departamento | `DEPARTMENTS` en `js/departments.js` (y, si abre una sección exclusiva, su grupo en `DEPARTMENT_GROUPS`) |
| Crear otra sección exclusiva como Ofertas | Una entrada nueva en `EXCLUSIVE_PROJECT_SEEDS` (`js/data/projects.js`) |
| Añadir un campo o sección a una exclusiva ya creada | Añadirlo a la definición del seed (instalaciones nuevas), subir `seedVersion` y listarlo en `fieldsAddedIn` / `sectionsAddedIn` de esa versión (los ya creados lo reciben una sola vez, sin tocar lo que el equipo cambió a mano) |
| Cambiar a qué sección va una oferta | `js/offers.js` (`offerSectionOnCompletionChange`, `planOfferRepositioning`…) |
| Cambiar qué se escribe al convertir una tarea en oferta | `planTaskToOffer()` en `js/offers.js` (quién lo ve y la confirmación: `js/components/convert-to-offers.js`) |
| Cambiar qué rutas se reconocen en una descripción | `findLocationInDescription()` en `js/location.js` |
| Nuevo tipo de notificación | Campo `type` de `notifications/{id}` (`js/data/notifications.js`, `js/components/notification-bell.js`) |
| Cambiar permisos de datos | `firestore.rules` y republicar. Roles, departamentos y Métricas son solo comprobaciones de interfaz |
| Cambiar el nombre «Chusy» | `index.html` y `js/components/sidebar.js` |

---
## 3. Funciones

### 3.1 Tareas y proyectos

- **Ventana única de tarea/oferta** (crear y editar): todo el formulario a la vista y **nada se guarda hasta «Aceptar»** (cerrar con cambios pregunta si descartar). Los comentarios son la excepción: se envían al momento y solo existen en tareas ya guardadas.
- **Título con negrita parcial:** botón «B» o Ctrl/Cmd+B. Se guarda como texto con `**así**` (nunca HTML) y se ve en negrita en todas las vistas; para ordenar, buscar y exportar se usa el texto sin marcas.
- **Descripción:** editor enriquecido (`rich-text-editor.js`: barra y menú «/», negrita, cursiva, subrayado, tachado, listas, cita, enlaces, código, H1–H3). El HTML se sanea antes de guardar, porque cualquiera puede editar la descripción de cualquier tarea de proyecto. Las descripciones antiguas en texto plano se ven igual y se convierten al editarlas.
- **Etiquetas:** al escribir se sugieren las existentes (con color); una nueva elige color de una paleta. El color es compartido por todas las tareas que la llevan.
- **Campos personalizados** (lista, número o texto): por proyecto (clic derecho en el proyecto → «Campos personalizados», o «+ Campo personalizado» en la Lista) y personales en «Mis tareas» (solo tuyos, marcados «· personal»). Sirven de columna y de filtro.
- **Varios proyectos a la vez:** el campo «Proyectos» del detalle añade la tarea a más de uno, cada uno con su propia sección. Quitar el último proyecto la deja como personal de quien conste como responsable (el primero de la lista, o quien edita si no hay ninguno).
- **Responsables:** solo cuentas reales. Si una tarea ya tenía una cuenta ficticia de Asana o eliminada, sigue visible marcada «· Asana» / «· Eliminado».
- **Mis tareas:** tareas asignadas a ti de cualquier proyecto más las personales. «+ Tarea personal» crea una sin proyecto («🔒 Personal»; la ve y edita quien conste como responsable). Una tarea personal es de quien la lleve en cada momento: reasignarla la traspasa; si siguen constando varias personas, no cambia de dueño. Se agrupa por urgencia: Vencidas, Hoy, Mañana, Próximos 7 días, Más adelante y Sin fecha (una vencida ya completada va a «Hoy»). Los filtros se recuerdan en este navegador, con «Pendiente» de serie.
- **Secciones:** «🗂 Secciones» (Lista y línea de tiempo de un proyecto) crea, renombra, reordena, colorea (paleta de 8 o «Auto») y elimina. Eliminar no borra tareas: pasan a «Sin sección», que sale siempre **primero** en Lista, Tablero y línea de tiempo (a propósito: al final se olvidaban).
- **Icono y color de proyecto:** un emoji sobre el color elegido (rejilla de iconos industriales, «Más iconos» y campo libre).
- **Clic derecho:** *tarea* → completar, duplicar, convertir en hito, convertir en oferta (solo con acceso a Ofertas, ver 3.6), detalles, eliminar (y «Abrir Ubicación» en una oferta con Ubicación); *proyecto en la barra lateral* → editar, Propiedades, Abrir Ubicación, campos personalizados, archivar, eliminar (borra también sus tareas y comentarios); *proyecto archivado* → desarchivar, eliminar, Abrir Ubicación.
- **Selección múltiple** (Lista y Mis tareas; Ctrl/Cmd+clic y Shift+clic; falta en Tablero): barra flotante con mover de sección, cambiar de proyecto (traslado completo: queda solo en ese; para añadir uno sin perder los demás, usar el detalle), asignar, fechas (casilla vacía = borrar) y eliminar; y en «···»: completar/reabrir, añadir colaboradores, combinar duplicadas (une responsables, etiquetas, subtareas, adjuntos y comentarios en la que se conserve), convertir en hitos, convertir en ofertas (ver 3.6) y mover a mis tareas (las deja personales de quien pulsa). En Mis tareas no hay «mover de sección» y «cambiar de proyecto» ofrece todos.
- **Completar:** chispazo de confeti; confeti grande al completar varias por selección múltiple, 3 o más seguidas y rápido, o al cruzar 5/10/15/20/30/50/75/100 completadas en el día (contador de este navegador). Respeta `prefers-reduced-motion`.
- **Dato heredado:** `dependsOn` («Bloqueada por») ya no se ve ni se edita; el dato sigue en Firestore y «Combinar» lo une.

### 3.2 Vistas, filtros y columnas

- **Vistas:** Lista (tabla), Tablero (Kanban con arrastrar y soltar), Calendario (barras de duración completa más hitos) y Línea de tiempo, además de Mis tareas, Archivo, Métricas y la línea de tiempo global.
- **Filtros** sobre todas las vistas: Responsable, Prioridad, Estado, Etiquetas y campos personalizados; se aplican al momento y se combinan. El cuadro de búsqueda filtra por título y descripción sin distinguir mayúsculas ni acentos y no se recuerda entre sesiones.
- **Buscador global** (⌘K / Ctrl+K): tareas, proyectos y personas, con búsquedas rápidas (creadas por ti, asignadas a otros, completadas recientemente).
- **Columnas (Lista y Mis tareas):** ordenar pulsando la cabecera (segundo clic invierte; las completadas siempre al final; sin orden elegido: fecha límite y luego prioridad, sin fecha al final); redimensionar (borde derecho), reordenar (arrastrar la cabecera) y ocultar/mostrar («☰ Columnas»; «Nombre» es fija). Ancho, ocultas y orden de filas se guardan en la cuenta **por ámbito** (un proyecto o Mis tareas); el orden de columnas es **único y global**. Etiquetas tiene columna propia. La cabecera queda fija al desplazar y hay scroll horizontal si no caben.
- **Al entrar:** vuelves a la última sección (y vista) visitada, por navegador (por defecto «Mis tareas»); una pantalla de carga evita el parpadeo del login con sesión iniciada.
- **Apariencia** (Mi cuenta, se guarda en la cuenta): Oscuro (de serie), Claro y Clásico (fondo claro, barra lateral oscura `#2A2C2E`, acento coral `#FF584A`).
- **Barra lateral minimizable** (por navegador; no aparece en móvil). **Archivo:** proyectos archivados, que no se borran.

### 3.3 Línea de tiempo (Gantt)

- **Dos formas:** por proyecto (pestaña, agrupada por sección) y global (botón fijo, agrupada por proyecto). Inicio y límite = barra; una sola fecha = bloque de un día; hito = rombo; línea dorada = hoy. Zoom Días / Semanas / Meses (semanas ISO: S29, S30…). «🏖️ Vacaciones inhábiles» sombrea agosto y del 22 de diciembre al 6 de enero (fechas fijas en el código).
- **Modo Tareas / Secciones:** «Secciones» colapsa cada sección en una fila-bloque: inicio y fin = la fecha más temprana y la más tardía de sus tareas, título «· completadas/total», color de la prioridad más urgente que contenga, y un filo de color a la izquierda por sección (automático en ciclo de 6 tonos o fijado a mano en «🗂 Secciones»). Los hitos salen como rombos pequeños y abren la tarea. Un clic en la fila-bloque la expande (▸/▾) sin salir del modo. En la global se mantiene la cabecera de cada proyecto y sus filas pasan a una por sección. Modo y zoom se comparten entre las dos líneas de tiempo y no se recuerdan al recargar.
- **Arrastrar barras** (solo ratón, solo zoom Días/Semanas, solo tareas reales, nunca la barra agregada de una sección): borde izquierdo → inicio; borde derecho → límite (el ancho cambia en directo); cuerpo o hito → mover sin cambiar la duración. Con **una sola fecha** los dos bordes están activos: tirar hacia fuera crea el rango («Rango de fechas creado.»), hacia dentro mueve esa fecha. Al pasar el ratón se ven las marcas de los bordes (franja de 9 px); mientras se arrastra, un aviso muestra las fechas y se bloquea la selección de texto; al soltar no recentra en «Hoy». Usa `updateTask()` (mismos permisos que el modal).
- **Fechas clave** (solo en la línea de tiempo de un proyecto): filas arriba con Aprobación (verde), Envío (azul) y Entrega (violeta) —solo las rellenas, en ese orden—, con un círculo concéntrico y una línea vertical discontinua. La escala las incluye. No son tareas: se editan en «Propiedades» o arrastrando el círculo (zoom Días/Semanas; guarda solo esa fecha; no valida el orden entre ellas). Salen en el PDF; no en el Excel ni en la línea global.
- **Exportar** («⬇ Exportar»): Excel o PDF de lo que esté filtrado y visible, incluido el modo Secciones. *Excel de un proyecto* = plantilla real de la empresa (`assets/gantt-template-martech.xlsm`, con macros y botones; hasta 50 tareas con fecha, 40 semanas y un año natural; si no cabe, Excel genérico con aviso). *Línea global* = siempre genérico. *PDF* apaisado, barras por prioridad, paginado. SheetJS, JSZip y jsPDF se cargan bajo demanda desde cdnjs.

### 3.4 Notificaciones

- **Campana 🔔** con las últimas 20; cada una abre la tarea (o el proyecto, si es el resumen de «Insertar producto»). Al cerrar el panel (clic fuera, Escape, la campana o abrir una) se marcan como leídas las que enseñaba.
- **Cuándo avisa:** solo a quien pasa a ser responsable de una tarea, nunca a uno mismo ni a cuentas ficticias. Dos tipos: `task_assigned` (una tarea: desde el modal, o a quien le toca solo una de «Insertar producto») y `tasks_assigned_bulk` (resumen con `count`: «Insertar producto», y «Asignar» / «Añadir colaboradores» de la selección múltiple, un aviso por persona **y proyecto**).
- **Con la app abierta** sale un aviso grande centrado, con fondo oscurecido. No se cierra solo: botón principal («Abrir tarea», «Ir al proyecto», «Ver notificaciones») o «Entendido»; Escape también; un clic en el fondo no. Si llegan más, se actualiza en el sitio. «Entendido» no marca nada como leído.
- **Avisos del navegador** (Mi cuenta → casillero, por navegador): notificación del sistema cuando no estás mirando Chusy. Solo con Chusy abierto en alguna pestaña (Chrome/Edge pueden «dormirla» con el Ahorro de memoria: añadir la web a las excepciones). No funciona en Chrome de Android ni en Safari de iPhone sin instalar la web.
- **Autolimpieza:** máximo 20 por persona (las sin leer sobrantes se marcan leídas y se borran las leídas más antiguas).

### 3.5 Cuenta, roles y administración

- **Menú del nombre** (pie de la barra lateral): *Mi cuenta* (correo, rol, nombre, contraseña, apariencia, avisos del navegador); *Métricas* (admin y Revisor); *Administrar equipo*, *Accesos por departamento*, *Importar desde Asana*, *Creación Rápida* y *Conexión con Outlook* (solo admin). El pie muestra rol y departamento («Admin · Diseño - Industria»).
- **Administrar equipo:** rol (Miembro / Revisor / Admin; no se puede quitar admin a la única persona admin), departamento, dominios de correo permitidos, y eliminar 🗑 / reactivar ↩ cuentas. Eliminar quita el acceso al instante pero conserva la cuenta en «Cuentas eliminadas»: sus tareas y comentarios se siguen viendo («· Eliminado») y no se ofrece al asignar. No puedes eliminarte a ti mismo.
- **Departamentos** (fijos en `js/departments.js`): Diseño - Industria, Diseño - Automoción, Técnicos y Producción. El acceso va por **grupos**: los dos Diseño son el grupo `diseno` (una sola casilla «Diseño» en «Accesos por departamento»). Lo único que los distingue es el **Sector por defecto** de las ofertas que crean. El valor antiguo `diseno` sigue dando acceso (sin Sector por defecto; aparece como «Diseño (sin sector)») hasta que un admin lo cambie persona a persona.
- **Accesos por departamento:** una casilla por grupo y por sección exclusiva (Ofertas, con Diseño marcado de fábrica); se guarda al marcar. Un admin entra siempre.
- **Métricas:** total, completadas (con %), pendientes y vencidas; carga por persona; lista de vencidas clicable. Solo tareas de proyecto (nunca las personales), en tiempo real.
- **Contraseña olvidada:** enlace bajo el campo de contraseña; el mensaje es el mismo exista o no la cuenta.
- **Registro y perfil:** una cuenta son dos cosas, la de Firebase Auth y su perfil `users/{uid}`; sin perfil no se entra. Si falta, se crea solo al iniciar sesión (nombre de Auth o lo anterior a la `@`, rol Miembro; necesita las reglas actuales publicadas). «No se pudo cargar tu perfil» tiene tres causas: falta el perfil y las reglas no están republicadas, la cuenta fue eliminada, o un fallo de red/reglas; el código real sale en la consola (F12, prefijo `[Chusy]`). **Desbloqueo manual:** Authentication → Usuarios → copiar el UID → Firestore → `users` → nuevo documento con ese UID y los campos `name`, `email`, `role: "miembro"` y `createdAt` (timestamp).

### 3.6 Ofertas (sección exclusiva)

- **Qué es:** un proyecto «exclusivo» (`exclusive: true`, `exclusiveKey: "ofertas"`, icono 💼) con botón fijo propio en la barra lateral, junto a Mis tareas / Línea de tiempo / Archivo. Lo ve quien sea admin o tenga un departamento con acceso; para el resto no existe (ni en la barra, ni en el buscador, ni en la línea global, ni en los filtros por proyecto). Se crea sola la primera vez que un admin entra, y se pone al día sola cuando una versión trae algo nuevo (`seedVersion`). Se comporta como un proyecto normal (Lista, Tablero, Calendario, Línea de tiempo) pero en su barra superior pone «+ Nueva oferta» y no hay «Insertar producto».
- **Secciones de fábrica:** Nuevas, Revisiones, Entregadas y Cerradas (ids `nuevas`, `revisiones`, `entregadas`, `cerradas`). **Campos:** Comercial, Versión, Ubicación (texto libre) y Sector (lista Automoción / Industria).
- **Flujo de revisiones:** una oferta nace en «Nuevas» con versión **A1** (también si se crea desde «Revisiones»). En una oferta ya guardada, **«+ Nueva versión»** la descompleta, la pasa a «Revisiones», sube la versión (A1 → A2, B7 → B8, respeta el prefijo) y añade una fila al histórico con el foco en «Cambios»; nada se guarda hasta «Aceptar». El **histórico de revisiones** es una tabla (versión editable, cambios, fecha, quitar fila) que arranca con la fila **A1 «Versión original»**. Si se guarda una versión nueva sin explicar, se pregunta (sin bloquear).
- **Sección según el estado:** completar una oferta (círculo, clic derecho, selección múltiple o modal) → «Entregadas»; reabrir desde «Entregadas» → «Nuevas» (o «Revisiones» si ya tuvo revisiones); convertirla en proyecto → «Cerradas» (manda sobre completar/reabrir). Todo lo demás es a mano: arrastrar una tarjeta o elegir otra sección no completa ni convierte.
- **Sector por defecto:** una oferta nueva nace con el Sector del departamento de quien la crea (Diseño - Industria → Industria; Diseño - Automoción → Automoción; otro departamento o ninguno → vacío), con «+ Nueva oferta», con la macro de Outlook y al convertir una tarea en oferta (en ese caso, el de quien convierte). Se puede cambiar o vaciar. Es solo el valor de partida: no se vuelve a aplicar al editar, ni al duplicar (la copia conserva el de la original), ni al cambiar el departamento de alguien.
- **Comercial con sugerencias:** desplegable propio (`text-suggest.js`, no `<datalist>`) bajo el campo Comercial de una oferta y de las Propiedades de un proyecto. Los valores salen de las ofertas y de las propiedades de los proyectos activos (quien no tiene acceso a Ofertas solo recibe los de las propiedades); si lo escrito solo difiere de uno existente en mayúsculas, tildes o espacios, se ajusta a esa forma. Se maneja con ↑/↓, Enter y Esc.
- **Propiedades de un proyecto** (clic derecho → «Propiedades»; no en secciones exclusivas): Comercial, Ubicación, Sector, Versión aprobada, fechas de **Aprobación → Envío → Entrega** (el orden de la vida real, que manda en el formulario, la línea de tiempo y el PDF) e **Histórico del proyecto** (su «+ Nueva versión» solo añade una fila). Si el proyecto nació de una oferta, lo dice arriba. Se guardan enteras en `projects/{id}.properties` al pulsar «Guardar».
- **Convertir una tarea en oferta** (clic derecho de una tarea → «💼 Convertir en oferta», o «···» → «Convertir en ofertas» en la selección múltiple; solo para quien tiene acceso a Ofertas, y no sobre tareas que ya son ofertas): es un **traslado completo**, como «Cambiar de proyecto» —la tarea queda en Ofertas y en ningún otro proyecto— y pide confirmación (no hay «deshacer»). Pasa a «Nuevas» (si ya estaba completada, a «Entregadas»), con versión A1, la fila «A1 · Versión original» en el histórico (fechada con el día en que se creó la tarea) y el **Sector del departamento de quien convierte** (la misma regla de «Sector por defecto»: sin Sector si ese departamento no tiene uno). **Ubicación:** si la descripción de la tarea trae escrita una ruta de carpeta (`Z:\…`, `\\servidor\recurso\…` o un enlace `file:///…`, con o sin un rótulo como «Ubicación:» delante y con o sin comillas), la primera que encuentre pasa a ser la Ubicación de la oferta; la descripción no se toca y la confirmación muestra qué ruta se tomará. No recoge direcciones web (`https://…`). Si la tarea ya tenía versión, Sector, Ubicación o histórico, los conserva. El resto (título, descripción, responsables, fechas, etiquetas, subtareas, comentarios…) no se toca; una tarea personal deja de serlo. En una selección, las que ya son ofertas se saltan. Código: `canBecomeOffer()` y `planTaskToOffer()` (`js/offers.js`), `bulkConvertToOffers()` (`js/data/tasks.js`) y `js/components/convert-to-offers.js` (quién lo ve, confirmación y aviso).
- **Convertir en proyecto** («✅ Convertir en proyecto» en el modal de una oferta guardada): abre «Convertir oferta en proyecto», el formulario de Propiedades ya relleno (nombre ← título sin negritas; Comercial, Ubicación y Sector ← sus campos; Versión aprobada ← la versión de la oferta, o la última del histórico, o A1; Entrega ← fecha límite; Envío vacío; Aprobación ← hoy; Histórico ← el de la oferta). «Crear proyecto» crea un proyecto normal (📁, color por defecto, las tres secciones de siempre) con enlace de vuelta (`sourceOfferId`), deja la oferta enlazada (`convertedProjectId`, `convertedAt`), completada y en «Cerradas», y abre el proyecto. **No se traslada nada más** (descripción, subtareas, responsables…). Una oferta convertida muestra «Convertida en el proyecto…» y «📁 Abrir proyecto» (si el proyecto sigue activo; si no, «Convertir de nuevo»).
- **Filtros recordados:** los de Ofertas se guardan por persona en este navegador (`chusy:offersFilters:<uid>`). «Ubicación» no se ofrece como filtro.

### 3.7 Abrir Ubicación

- **Dónde está:** botón «📂 Abrir Ubicación» junto al campo Ubicación en la ficha de una oferta y en las Propiedades de un proyecto (también al convertir una oferta), en la **barra superior** de un proyecto con la Ubicación rellena, y en el **clic derecho** de una oferta, de un proyecto de la barra lateral y de uno archivado. En el modal actúa sobre lo escrito aunque no esté guardado, y se deshabilita con la casilla vacía. La barra superior va justa de ancho: el botón lleva texto desde 1500 px de ventana, solo el icono entre 1160 y 1499 px y se oculta por debajo (cuenta la barra lateral abierta; los cortes están en `css/styles.css`).
- **Qué hace:** un navegador no puede abrir carpetas del ordenador, así que el botón **siempre copia la ruta** («Ruta copiada: pégala en la barra del Explorador») y, en Windows con el ayudante instalado, además **abre la carpeta**. Una dirección web (`https://…`, SharePoint/OneDrive) se abre en pestaña nueva y no se copia. `normalizeLocation()` (`js/location.js`) quita espacios y las comillas que envuelven todo el texto, y convierte `file:///…` en ruta de Windows. Para saber si se abrió algo espera 1,2 s a que el navegador pierda el foco; si no, enseña el aviso de «Ruta copiada».
- **Ayudante de Windows** (`assets/abrir-ubicacion/`: `Instalar-AbrirUbicacion.bat`, `abrir-ubicacion.ps1`, `Desinstalar-AbrirUbicacion.bat`, `LEEME.txt`): se instala **una vez por ordenador y usuario de Windows**, sin administrador (copia el script a `%LOCALAPPDATA%\Chusy` y registra el protocolo `chusy-open:` en `HKCU\Software\Classes`). La primera vez Chrome/Edge piden permiso para abrir «Chusy - Abrir ubicacion»: marcar recordar y aceptar. Para repartirlo basta la carpeta entera. El script **solo abre carpetas que existen** (nunca archivos ni programas); si no la encuentra, avisa en un cuadro. En Mac y Linux solo se copia la ruta.
- **Código:** `js/location.js` (`normalizeLocation`, `hasLocation`, `protocolUrl`, `projectLocation`), `js/components/open-location.js` (`openLocation()` y `createOpenLocationButton()`), `topbar.js`, `task-modal.js` (`renderCustomFields()` pinta el campo Ubicación con un `<div class="field">` y no un `<label>`, para que el botón no sea el control de la etiqueta), `project-properties-modal.js` y `offerLocationOfTask()` (`offers.js`). No guarda nada nuevo en Firestore.

### 3.8 Oferta desde Outlook

- **Qué hace:** la macro `assets/outlook/CrearCarpetaProyecto.bas` (crea la carpeta del proyecto en el servidor, extrae las plantillas y archiva el correo con sus adjuntos) **crea además la oferta en Chusy al terminar**, si Chusy está abierto con la sesión iniciada de quien la lanza. La oferta lleva: *Nombre* = el de la macro; *Ubicación* = la carpeta creada; *Comercial* = la carpeta del comercial elegida (si es de `INTERNACIONAL`, la subcarpeta), ajustado a la forma ya usada en Chusy; *Descripción* = texto plano del correo (lo que Outlook devuelva en `Body`, hasta 30 000 caracteres, sin formato ni imágenes; escapado: un correo con etiquetas HTML las muestra, no las ejecuta); sección «Nuevas», versión A1 con su histórico; *Sector* según el departamento de quien la lanza. Sin responsables ni fechas. Si ya existe una oferta con ese nombre (sin mirar mayúsculas, tildes, espacios ni negritas; incluye Entregadas y Cerradas) se le añade la fecha, `PROYECTO X (02/10/2026)`, y si aun así choca, la hora y luego un número (`uniqueOfferName()`).
- **Cómo funciona (buzón `offerInbox`):** Chusy no tiene servidor, así que: (1) la macro deja una petición en Firestore por su API REST, **sin iniciar sesión** (`key`, `targetEmail`, `name`, `location`, `commercial`, `description`, `status: "pending"`); (2) la pestaña de Chusy de esa persona (`outlook-listener.js`, escuchando `offerInbox` con `where("targetEmail","==",su correo)`) la ve y se la queda con una transacción (`pending` → `processing`; con varias pestañas, solo una la crea); (3) crea la oferta con `createTask()` y anota el resultado (`created` + `taskId`, `finalName`, `message`, o `error`); (4) la macro lee el resultado hasta 10 s (cada 0,6 s), lo cuenta en su mensaje final y **borra la petición**. Sin respuesta en 10 s la borra y avisa de que Chusy no estaba abierto: la oferta **no se crea y no hay cola** (a propósito: aparecería horas después, cuando ya se habría creado a mano). La pestaña borra la petición a los 60 s si la macro no lo hizo, y las que ya están al abrir una sesión no se atienden. `startOutlookListener()` es idempotente (`bootstrap()` se repite con cada cambio de perfil) pero atiende cada petición con el **perfil más reciente**, porque su departamento decide el Sector.
- **Seguridad:** `offerInbox` es la única colección donde se escribe sin sesión. `firestore.rules` solo deja **crear** una petición con la **clave compartida** (`meta/outlookBridge.key`, que solo un admin lee o cambia) y exactamente esos campos y tamaños (nombre ≤ 300, ubicación ≤ 1000, comercial ≤ 200, descripción ≤ 100 000). Listar y anotar resultados: solo su destinatario con sesión. Leer una por su id y borrarla: quien conozca el id (al azar, no listable; lo usa la macro). Con la clave solo se pueden dejar peticiones, nunca leer ni borrar datos. «Conexión con Outlook» → «Cambiar la clave» o apagarla inutiliza al momento las macros anteriores.
- **Puesta en marcha (una vez):**
  1. Publicar `firestore.rules`.
  2. Subir los archivos a GitHub y Ctrl+F5.
  3. Un admin: menú del nombre → **«Conexión con Outlook»** → «Generar clave y activar» → «Copiar las tres líneas» (`CHUSY_PROJECT_ID`, `CHUSY_API_KEY` —la de `firebase-config.js`, que no es secreta— y `CHUSY_CLAVE`).
  4. En Outlook (Alt+F11): importar `assets/outlook/CrearCarpetaProyecto.bas` (quitando antes el módulo antiguo) y pegar las tres líneas al principio. Ese `.bas` ya con las líneas es el que se reparte al equipo (instrucciones en `assets/outlook/LEEME.txt`). Sin `CHUSY_CLAVE`, la macro funciona como siempre y no avisa a Chusy.
  5. Probar con Chusy abierto: Alt+F8 → `ProbarConexionConChusy` crea la oferta «PRUEBA OUTLOOK hh:mm:ss» (borrarla a mano).
- **Mensajes de la macro:** añade al final una línea «Chusy: …» (creada; Chusy no abierto con esa sesión; error al crear, p. ej. la cuenta no tiene acceso a Ofertas; tarda más de lo normal; permisos rechazados —reglas sin publicar o clave distinta—; o no se pudo conectar —Outlook no llega a `firestore.googleapis.com`—). Ningún error de esta parte deshace la carpeta ni el archivado, y solo avisa a Chusy si todo lo anterior salió bien.
- **Código:** `js/outlook-offer.js` (helpers puros), `js/outlook-listener.js` (lo arranca `bootstrap()` de `app.js` y lo para `cleanup()`), `js/data/outlook-inbox.js`, `js/components/outlook-bridge-modal.js`. En la macro, el bloque `CONEXIÓN CON CHUSY` (`AvisarAChusy()`, `ProbarConexionConChusy()`, JSON mínimo con `JsonEscapar()` en ASCII puro, peticiones con `MSXML2.XMLHTTP.6.0` y tope de 15 s).

### 3.9 Creación Rápida («Insertar producto»)

- **Panel «⚡ Creación Rápida»** (solo admin): interruptor «Activar «Insertar producto» para todo el equipo» (se aplica al momento; `meta/quickCreate`) y lista de **productos**, reordenables arrastrando el tirador ⠿. Un producto (nombre, icono, color) lleva **tareas base** (se crean siempre) y **grupos de opciones** («Una opción» con radio o «Varias opciones» con casillas); cada opción lleva sus propias tareas, que solo se crean si se elige. Cada tarea tiene título, descripción, «días necesarios» opcional y prioridad (Media de entrada). Grupos y opciones también se reordenan arrastrando. Nada se guarda hasta «Guardar producto» (las filas con nombre o título vacío se descartan). El panel y el selector **solo se cierran con la X, «Cancelar» o al confirmar**, nunca con un clic fuera ni con Escape, a propósito.
- **Botón «⚡ Insertar producto»** arriba de cualquier proyecto (salvo Ofertas): se ve siempre, pero solo lo pulsa un admin hasta que se activa el interruptor. Pasos: (1) marcar uno o varios productos; (2) configurar cada uno («Producto 1 de 3», con Atrás/Siguiente): sus opciones (con vista previa de las tareas), el **nombre de esa cabina** (obligatorio; con él se crea una **tarea principal** contenedora), la **fecha de entrega** (obligatoria; la tarea principal va de hoy a esa fecha, y el resto empieza hoy y vence según sus «días necesarios», sin pasarse de la entrega, o en la entrega si no los tienen) y la sección de destino (existente, sin sección o una nueva con el nombre de la cabina); (3) **asignación rápida** opcional, única para todas las tareas de todos los productos, agrupadas por producto con «Marcar todas» / «Desmarcar todas»; y «Crear tareas», que crea todo y avisa con un resumen por persona.
- Las tareas creadas son normales, sin vínculo con el producto; borrar un producto no las afecta. Datos: `quickCreateProducts/{id}` y `meta/quickCreate`.

### 3.10 Importador de Asana (solo admin)

- Se carga un `.json` de export (formato `asana-api-export`) y se ve un resumen de lo que trae y lo que es nuevo frente a lo ya importado. **Repetir una importación es seguro:** no duplica, añade las secciones que falten y corrige tareas que apuntaban a una sección inexistente (por eso «confirmar» sigue activo aunque diga «nada nuevo»).
- **Personas:** cada persona de Asana se lista con un desplegable para equivaler a una cuenta real (solo cuentas ya registradas). Sin equivalencia queda como **usuario ficticio** (`asana:<gid>`): sus tareas y comentarios se ven, pero no puede entrar ni se ofrece al asignar. Al aplicar una equivalencia se reescriben sus tareas y comentarios importados; la tabla está siempre disponible en el panel.
- Las **subtareas** de Asana entran como tareas normales (con una referencia a la tarea de origen en la descripción); los **adjuntos no se importan**. La «zona de riesgo» borra todo lo importado (también el archivo cargado y la tabla de equivalencias) sin tocar lo creado a mano.

---
## 4. Estructura del proyecto

```
index.html                Login/registro + armazón de la app (carga el CSS con ?v=N)
firestore.rules           Reglas de seguridad de Firestore (hay que pegarlas en la consola al cambiar)
css/styles.css            Todo el diseño; los temas son bloques de variables CSS
assets/
  chusy-badge.png, martech-badge.png, favicon-*.png     Logos e iconos
  gantt-template-martech.xlsm                           Plantilla Excel real de la empresa (macros y botones)
  abrir-ubicacion/                                      Ayudante de Windows de «Abrir Ubicación»
  outlook/                                              Macro CrearCarpetaProyecto.bas + LEEME.txt
js/
  app.js                  Orquestador: sesión, estado en memoria, enrutado simple, suscripciones, avisos,
                          Propiedades/conversión de ofertas, filtros recordados (Mis tareas, Ofertas)
  firebase-config.js      Configuración de Firebase (NO sobrescribir) · firebase-init.js: inicializa auth y db
  auth.js                 Registro, login, roles y perfil (createMissingProfile, whileWritingOwnProfile)
  theme.js                Tema claro/oscuro/clásico (data-theme en <html>; la cuenta manda, localStorage evita el parpadeo)
  browser-notifications.js  Avisos del sistema (Notification API; permiso y preferencia por navegador)
  utils.js                Fechas, avatares, contraste de color, toasts, setListHtml (reconstruye una tabla conservando su scroll)
  departments.js          Departamentos y grupos de acceso (DEPARTMENTS, DEPARTMENT_GROUPS, LEGACY_DEPARTMENT,
                          findDepartment, accessGroupOf, departmentHasAccess, defaultSectorOf, departmentOptionsFor)
  offers.js               Reglas puras de Ofertas: reconocer proyecto/secciones/campos aunque se renombren,
                          versión siguiente, fila A1, Sector, Entregadas/Cerradas, sugerencias de Comercial,
                          filterableCustomFields, offerLocationOfTask, canBecomeOffer, planTaskToOffer,
                          offerLocationFromDescription
  project-properties.js   Helpers puros de Propiedades: normalizar, PROPERTY_DATE_FIELDS, projectKeyDates,
                          propertiesFromOffer
  location.js             Helpers puros de «Abrir Ubicación» (normalizeLocation, hasLocation, protocolUrl, projectLocation)
                          y findLocationInDescription (la ruta escrita en una descripción, para «Convertir en oferta»)
  outlook-offer.js        Helpers puros de «Oferta desde Outlook» (texto → HTML, nombre único, planOfferFromRequest…)
  outlook-listener.js     Atiende las peticiones de la macro de Outlook (offerInbox) mientras hay sesión
  task-filters.js         Filtrado y ordenación compartidos por todas las vistas (+ filtros ↔ formato guardable)
  data/                   Acceso a Firestore
    projects.js           CRUD de proyectos (borrado en cascada, archivado, secciones), visibilidad por departamento
                          (isProjectVisibleToUser), seeds exclusivos (EXCLUSIVE_PROJECT_SEEDS, ensureExclusiveProjectsSeeded,
                          migrateSeededProject), getOffersProject
    tasks.js              CRUD de tareas (proyecto, personales, multiproyecto) y operaciones en lote de la selección
                          múltiple; nextPersonalOwnerId; toggleTaskComplete/bulkSetComplete (reciben la tarea entera); bulkConvertToOffers
    tags.js · comments.js · users.js     Etiquetas, comentarios, perfil/departamento/equipo/eliminar-reactivar cuentas
    notifications.js      Crear (por tarea o resumen), marcar leídas, suscripción y autolimpieza
    quick-create.js       Productos de Creación Rápida y creación en lote de tareas ya resueltas
    offer-conversion.js   De oferta a proyecto (dos escrituras, ver apartado 7)
    outlook-inbox.js      Firestore de «Oferta desde Outlook» (offerInbox, clave compartida)
    asana-import.js       Importador de Asana
  views/                  list-view (Lista) · board-view (Tablero) · calendar-view · timeline-view (Gantt)
                          · my-tasks-view · archive-view · metrics-view
  components/
    sidebar.js · topbar.js · filter-bar.js · context-menu.js · search-modal.js · notification-bell.js
    task-modal.js         Formulario único de tarea/oferta (histórico de revisiones, «Nueva versión», «Convertir en proyecto»)
    rich-text-editor.js · text-suggest.js · celebration.js
    table-columns.js      Ancho, visibilidad, orden de filas y de columnas (por arrastre)
    bulk-selection.js · bulk-toolbar.js    Selección múltiple y su barra de acciones
    convert-to-offers.js  «Convertir en oferta»: quién lo ve, confirmación y aviso (clic derecho y barra de selección)
    sections-modal.js · custom-fields-modal.js · project-modal.js · edit-project-modal.js · project-appearance-picker.js
    project-properties-modal.js    Propiedades de un proyecto y «Convertir oferta en proyecto»
    open-location.js      openLocation() y el botón reutilizable «Abrir Ubicación»
    gantt-export.js       Exportar el Gantt a Excel (plantilla real o genérico) o PDF; librerías bajo demanda
    account-modal.js · team-admin-modal.js · department-access-modal.js · outlook-bridge-modal.js
    quick-create-admin-modal.js · quick-create-modal.js · asana-import-modal.js · reset-password-modal.js
```

---

## 5. Modelo de datos y reglas de acceso

**Colecciones de Firestore**

- **`users/{uid}`** — `name`, `email`, `role` (`admin` | `revisor` | `miembro`), `department` (`"diseno-industria"` | `"diseno-automocion"` | `"tecnicos"` | `"produccion"`, o ausente/`null`; `"diseno"` es el valor anterior y se sigue aceptando), `deleted` (`true` si un admin la eliminó), `theme` (`"dark"` | `"light"` | `"classic"`; sin definir = oscuro), `personalCustomFieldDefs[]` (solo para «Mis tareas»), `columnPrefs` (`{[scopeKey]: {widths, hidden[], sort:{column,direction}}}`, con `scopeKey` = `project:<id>` o `mytasks`), `columnOrder[]` (orden de columnas, único y global), `createdAt`. Un usuario ficticio del importador de Asana tiene uid `asana:<gid>` y además `isImported`, `asanaGid` y `mergedInto` (uid real una vez equivalido, o `null`).
- **`projects/{id}`** — `name`, `description`, `color`, `icon` (emoji; `📁` por defecto), `sections[]` (`{id,name,order,color}`; `color` opcional), `memberIds[]` (informativo), `customFieldDefs[]` (`{id,name,type:'lista'|'numero'|'texto',options[]}`), `archived`, `createdBy`. Una **sección exclusiva** añade `exclusive: true`, `exclusiveKey` (`"ofertas"`), `allowedDepartments[]` (grupos de acceso: `"diseno"` | `"tecnicos"` | `"produccion"`) y `seedVersion` (qué versión de su seed tiene aplicada; ausente = 1). `properties` (solo si alguien guardó «Propiedades» o nació de una oferta): `{comercial, ubicacion, sector, approvedVersion, approvalDate, sentDate, deliveryDate, history[], sourceOfferId?, sourceOfferTitle?}` — fechas `"YYYY-MM-DD"` o `null`; `sector` solo `"Automoción"`, `"Industria"` o `""`; `history[]` con el formato de `revisions[]`. Importado: `asanaGid`.
- **`tasks/{id}`** — `projectId` (proyecto **principal**, `null` si no tiene), `sectionId`, `extraProjectIds[]` y `extraSections` (`{[projectId]: sectionId}`; solo tienen sentido con `projectId` relleno), `ownerId` (quien la llevó como personal; sigue a quien conste como responsable), `title` (texto plano; `**negrita**`), `description` (HTML saneado del editor, o texto plano en tareas antiguas), `assigneeIds[]`, `startDate`, `dueDate`, `priority`, `tags[]` (nombres; el color vive en `tags/`), `subtasks[]`, `attachments[]` (`{id,name,url}`), `customFields` (`{[fieldId]: valor}`), `isComplete`, `isMilestone`, `order` (único y global por tarea, no por proyecto), `dependsOn[]` (heredado, no se edita). Solo en **ofertas**: `revisions[]` (`{id,version,changes,createdAt}`), y en una oferta convertida `convertedProjectId` y `convertedAt`. Importado: `asanaGid`.
- **`tasks/{id}/comments/{id}`** — `authorId`, `authorName`, `text`; `asanaGid` si viene de importación, `mergedFrom` si llegó al combinar duplicadas.
- **`tags/{slug}`** — `name`, `color`.
- **`notifications/{id}`** — `userId` (destinataria, la única que la lee), `fromUserId`, `fromName`, `type` (`"task_assigned"` | `"tasks_assigned_bulk"`), `taskId`, `taskTitle` (copia), `count` (solo en el bulk), `projectId` y `projectName` (copias; `null` si es personal), `read`, `createdAt`.
- **`quickCreateProducts/{id}`** — `name`, `icon`, `color`, `order`, `baseTasks[]` (`{id,title,description,durationDays,priority}`), `groups[]` (`{id,name,selectionType:'single'|'multiple',options:[{id,name,tasks[]}]}`), `createdBy`.
- **`offerInbox/{id}`** — la petición que deja la macro de Outlook (vive segundos). La crea la macro **sin sesión** con exactamente `key`, `targetEmail` (minúsculas), `name`, `location`, `commercial`, `description` y `status: "pending"`; después solo su destinatario puede tocar `status` (`processing` → `created` | `error`), `claimedBy`, `taskId`, `finalName` y `message`.
- **`meta/…`** — `config` (`allowedEmailDomains[]`), `bootstrap` (marca inmutable que crea la primera cuenta registrada, la que nace admin), `quickCreate` (`{enabled}`), `outlookBridge` (`{key, updatedBy, updatedAt}`; solo admin; si no existe, el puente está apagado), `asanaUserMap` (`{[gid]: uidReal}`) y `asanaImportIndex` (`{projects, tasks, comments}`: qué se importó ya).

**Reglas de acceso (`firestore.rules`)**

- Una cuenta eliminada (`deleted: true`) pierde lectura **y** escritura de todo (`isActiveUser()`).
- Nadie puede asignarse un rol ni un departamento a sí mismo: solo un admin cambia el de cualquiera.
- Un usuario puede leer su propio perfil aunque aún no exista (para poder crearlo).
- **Borrar una tarea:** quien la creó, su `ownerId`, quien creó el proyecto al que pertenece, o un admin. Ser solo responsable de una tarea de proyecto no basta; en una personal, sí, porque `ownerId` sigue al responsable.
- Una tarea sin proyecto la leen y editan su dueño, sus responsables y los admins. Las notificaciones solo las lee y gestiona su destinataria (cualquiera puede crear una a nombre de otra, identificándose con `fromUserId`).
- `meta/outlookBridge` solo lo lee y escribe un admin; `offerInbox` es la única colección con escritura sin sesión (ver apartado 3.8).
- **Revisor, Métricas y los accesos por departamento son comprobaciones de interfaz, no de datos:** cualquier cuenta activa puede leer los mismos documentos. Revisor no desbloquea nada fuera de Métricas (por ejemplo, «Insertar producto» sigue siendo solo de admin mientras el interruptor de equipo esté apagado).

---
## 6. Pendiente e ideas

**Funciones que no existen todavía**

- Vistas guardadas de verdad (nombrar y guardar una combinación de filtros; el buscador trae unas pocas ya hechas, no personalizables).
- Selección múltiple y barra de acciones masivas en Tablero (ya está en Lista y Mis tareas).
- Más tipos de notificación además de «te asignaron una tarea» (comentario nuevo, fecha próxima a vencer…); `notifications/{id}.type` ya deja sitio.
- Convertir texto de la descripción en una subtarea enlazada (como «Crear tarea» en Asana).
- Automatizaciones, formularios de solicitud, revisión de archivos, metas/OKRs, integraciones.
- Una pantalla para gestionar los departamentos (hoy están fijos en `js/departments.js`).

**Lo que exigiría un servidor (y por tanto salir del plan gratuito Spark)**

- Avisos con el navegador **cerrado** (Web Push): Firebase Cloud Messaging con Cloud Functions, que pide el plan Blaze.
- Borrar una cuenta de Firebase Authentication por completo: hace falta el SDK de administración. Para quien deja el equipo basta con quitarle el acceso (🗑 en «Administrar equipo»).

**Ofertas, Propiedades y departamentos**

- Diseño - Industria y Diseño - Automoción solo se distinguen en el Sector por defecto. Si una sección debería ser solo de uno, `departmentHasAccess()` ya acepta un departamento suelto en `allowedDepartments`; falta ofrecer esa casilla en «Accesos por departamento».
- No hay un botón para pasar de golpe a todas las personas con el «Diseño» antiguo a uno de los dos nuevos (se hace persona a persona).
- La Ubicación tomada de la descripción no quita la ruta de la descripción (queda repetida) ni recoge direcciones web de SharePoint/OneDrive; si la empresa las usa como carpeta de oferta, habría que ampliar `findLocationInDescription()`.
- «Convertir en oferta» solo está en el clic derecho y en la selección múltiple (no en el modal de la tarea), y «Cambiar de proyecto» hacia Ofertas sigue moviendo la tarea sin versión, Sector ni histórico: para eso está «Convertir en oferta».
- Una oferta convertida solo se ve como convertida dentro de su modal (en Lista/Tablero no hay marca, columna ni filtro propios, más allá de estar en «Cerradas»), y no se puede convertir desde el clic derecho.
- La conversión traslada solo las propiedades (no descripción, subtareas, enlaces ni responsables), y no deja elegir icono y color del proyecto nuevo (se cambian con «Editar proyecto»).
- Las Propiedades solo se ven y editan en su ventana (sin columnas, filtros ni buscador), y «Propiedades» no está en el menú de la vista Archivo.
- Las sugerencias son solo para Comercial (`attachTextSuggest()` ya vale para otros campos, falta decidir de dónde saldrían sus valores). No hay pantalla para fusionar valores ya escritos de formas distintas.
- El histórico (de oferta o de proyecto) no tiene un botón suelto de «añadir fila», ni plantilla de «motivo de cambio», ni límite de filas.
- Las fechas clave del proyecto no se marcan en el Excel, en el Calendario ni en la línea de tiempo global.
- «Entregadas» y «Cerradas» se rellenan solas al completar, reabrir o convertir, pero no al revés (arrastrar una tarjeta a esas secciones no completa ni convierte).

**Abrir Ubicación y Outlook**

- El ayudante de «Abrir Ubicación» es solo para Windows y se instala a mano, un PC cada vez; no hay versión Mac/Linux ni forma de bajarlo desde Chusy (por ejemplo desde «Mi cuenta»).
- «Abrir Ubicación» no está en la Lista, donde la columna Ubicación sigue siendo texto.
- «Oferta desde Outlook» no tiene cola (decisión consciente) y la macro no manda responsables, fechas ni adjuntos del correo (esos ya se archivan en la carpeta del proyecto).

---

## 7. Limitaciones y trampas conocidas

### 7.1 Trampas técnicas (para quien toque el código)

- **Índices compuestos de Firestore:** cada combinación exacta de campos necesita el suyo (el de `assigneeIds` + `projectId` no sirve para `extraProjectIds` + `projectId`, aunque la consulta tenga la misma forma). El error de la consola trae un enlace que lo crea. Mientras no esté «Habilitado», esa consulta falla; la vista no se queda en blanco, pero faltan esos resultados. Si dos listeners en paralelo se fusionan en un solo resultado, el callback de error de cada uno también debe marcar su mitad como cargada, o un fallo bloquea al otro para siempre.
- **«Mis tareas» usa dos consultas** (`projectId != null` y `ownerId == uid`), calcadas a las ramas de la regla de lectura. Firestore exige poder demostrar que la consulta cumple la regla a partir de sus propios filtros; una sola consulta `array-contains` sin acotar solo funcionaba para admins.
- **CSS:** subir `?v=N` en `index.html` en cada entrega que lo toque (apartado 2). En los temas, arreglar colores con selectores directos y valores literales: re-declarar variables en un ancestro y confiar en la herencia no funcionó en el modo Clásico. `.tag-pill` necesita `width: max-content; justify-self: start` dentro de una celda de grid.
- **Arrastres propios** (mousedown/mousemove/mouseup, no HTML5 DnD): hace falta `preventDefault()` y `stopPropagation()` en el `mousedown` y una clase en `body` que bloquee la selección de texto (como `wireColumnResize()` y `body.tl-dragging-bar`); sin eso el navegador compite con su selección de texto y el arrastre acaba haciendo otra cosa.
- **Scroll:** Lista y Mis tareas hacen scroll en un `div` interno (`.list-table-scroll`), así que al reconstruir la tabla hay que conservar su posición (`setListHtml()`). La línea de tiempo guarda y restaura `scrollLeft` salvo que cambie el proyecto o el zoom.
- **Notificaciones:** el primer snapshot de Firestore trae todo lo existente como `added`: hay que descartarlo (`isFirstSnapshot`) o cada inicio de sesión lanzaría un aviso por notificación. La autolimpieza solo puede ejecutarla su dueña (lo exige la regla), por eso vive en `subscribeToNotifications`.
- **`String.replace(patrón, texto)`** interpreta `$1`, `$&`, `$$`… dentro del texto de reemplazo (una fórmula con `$D$10` salió corrompida): al hacer cirugía de XML/texto (`gantt-export.js`) pasar siempre una **función** como reemplazo.
- **Plantilla Excel Martech:** se edita tocando el XML del `.xlsm` (nunca con SheetJS/openpyxl sin conservar el VBA, que pierde macros y botones). El código conserva el estilo de cada celda, vacía los huecos nativos (filas 13-23, 25 y 27-33; salta la fila 24 «OBSERVACIONES» y la 26, hueco fijo), clona la fila 27 más allá de esas 19, sincroniza `F10` («AÑO») con `D9` y calcula en JS los valores cacheados de la cabecera de fechas. Se descarga como `.xlsm`. Ampliar las 40 columnas de semana exigiría reescribir a mano la cadena de fórmulas de fecha. La fuente base de jsPDF no tiene el glifo ◆: en el PDF se usa •.
- **`attachTextSuggest()`** debe llamarse **antes** de añadir el listener `change` propio del campo (el ajuste automático depende de ese orden).
- **Seeds exclusivos:** la comprobación de «ya existe» solo mira proyectos **no archivados**: si se archiva o se borra Ofertas, la próxima vez que un admin entre se crea una copia nueva y vacía. Archivarla o borrarla, por tanto, solo a conciencia.

### 7.2 Datos y permisos

- **Preferencias en la cuenta** (viajan entre dispositivos): tema, columnas (ancho, ocultas, orden de filas y de columnas) y `personalCustomFieldDefs`. **En el navegador** (`localStorage`, no viajan): barra lateral minimizada, filtros de Mis tareas y de Ofertas, última sección visitada, contador de completadas del día y avisos del navegador. Quien entre desde otro navegador empieza sin ellos.
- `order` es único y global por tarea, no por proyecto: arrastrar una tarea que está en varios proyectos puede desplazar ligeramente su posición en el otro (nunca se mezcla con tareas de otra sección). No se hizo un `order` por proyecto para no complicar el modelo por un efecto apenas visible a este tamaño. Además, el Tablero reordena con valores numéricos intermedios: a gran escala habría que «renormalizarlos» de vez en cuando (no es un problema al tamaño de un departamento).
- Cambiar una equivalencia de Asana ya aplicada por otra cuenta no se puede desde el panel (solo el paso «ficticio → cuenta real» reescribe tareas y comentarios).
- El importador de Asana no trae adjuntos, campos personalizados ni dependencias como dato estructurado; los adjuntos se añaden aparte. Una tarea personal importada sin responsable en Asana llega con `assigneeIds` vacío hasta que se edite y guarde una vez.
- **Combinar duplicadas** traslada los comentarios, pero mover un comentario ajeno exige ser admin: si no lo eres, esos quedan colgando en la tarea que se borra. **El borrado masivo** no es atómico: borra una a una y avisa de cuántas pudo (las que no son tuyas ni eres admin, no).
- Las **Propiedades** de un proyecto, el modal de tarea y el histórico se guardan **enteros, sin fusionar campo a campo**: si dos personas tienen abierto lo mismo y las dos guardan, gana la última. Convertir una oferta en proyecto son **dos escrituras no atómicas**: si falla la segunda (enlazar y completar la oferta), el proyecto queda creado, sale un aviso y la oferta sigue como estaba; no se reintenta (repetir crearía un duplicado): hay que completarla a mano para enlazarla, o borrar el proyecto y volver a convertir. «Convertir de nuevo» con el proyecto archivado crea otro, no recupera el archivado.
- La fila **A1 «Versión original»** reaparece si se quita y se guarda: `lacksOriginalRevision()` mira el histórico guardado cada vez que se abre y no distingue «se borró a propósito» de «nunca se apuntó». Guardar un dato aparte de «ya comprobada» lo resolvería.
- La **sección de una oferta** solo cambia sola desde la interfaz de Chusy y en cuatro casos (completar, reabrir desde «Entregadas», «Nueva versión», convertir); completar por otro camino (el importador de Asana, por ejemplo) no la mueve, y si se completa en los primeros instantes tras entrar, antes de que lleguen los proyectos, tampoco. **Duplicar** una oferta copia su sección: la copia de una entregada o cerrada nace sin completar pero en esa misma sección. Una sección creada a mano con otro nombre («Hechas», «Enviadas») no se reconoce como «Entregadas»/«Cerradas».
- Si dos admins entran a la vez justo cuando una versión trae algo nuevo para una sección exclusiva, la puesta al día se ejecuta dos veces: no rompe nada (es idempotente), pero se escribe dos veces.
- **La Ubicación que se toma de la descripción** es la **primera** ruta que aparezca. Si va entre comillas llega hasta la de cierre; si no, hasta el final de su línea (una ruta puede llevar espacios, así que no se puede cortar en el primero), quitando el punto, la coma o el punto y coma finales: una ruta seguida de más texto en la misma línea («Z:\Ofertas\X y el correo») se toma entera, con el texto. Solo se busca al convertir: no al guardar una descripción ni en las ofertas que ya existen. Si la ruta apunta a un archivo y no a una carpeta, se guarda tal cual y «Abrir Ubicación» avisará de que no la encuentra.
- **Convertir en oferta** es un traslado completo y sin «deshacer»: la tarea sale de todos sus proyectos (para devolverla hay que moverla a mano con «Cambiar de proyecto»), y los campos personalizados de su proyecto de origen se quedan guardados en ella aunque Ofertas no los muestre. El Sector sale del departamento de **quien convierte**, no de quien creó la tarea, y solo se pone si el campo Sector de Ofertas tiene esa opción. Se escribe en lotes de 450: con más tareas de golpe, un fallo en un lote posterior dejaría ya convertidas las anteriores. No hace falta tocar `firestore.rules` (actualizar una tarea ya estaba permitido a quien la ve).
- **Creación Rápida:** el aviso a las personas asignadas se manda después de crear todas las tareas; si falla (sin conexión justo entonces), las tareas quedan creadas, sale un aviso y no se reintenta. Con más de 450 tareas de golpe (más de un lote de Firestore), un fallo en un lote posterior dejaría los anteriores ya escritos. Dentro de un producto, todas las tareas van a **una sola** sección de destino.
- Las **notificaciones** tienen hoy un único disparador (que te asignen una tarea), y el panel no ve las más antiguas que las 20 visibles (ni hace falta: se marcan leídas y se borran solas).

### 7.3 Interfaz y exportación

- **Gantt:** arrastrar barras o fechas clave es solo con ratón y solo con zoom Días/Semanas; no hay scroll automático al arrastrar cerca del borde (hay que soltar, desplazarse y volver a arrastrar, o escribir la fecha en el modal). Expandir una sección (modo Secciones) no se refleja en la exportación, que siempre exporta la vista colapsada. Las fechas clave se dibujan por columna, no por día exacto, en Semanas y Meses. El zoom por trimestre/año se probó y se retiró a petición del equipo (no encajaba con la duración real de los proyectos).
- **PDF del Gantt:** si el salto de página cae a mitad de una sección o proyecto largo, su etiqueta no se repite arriba de la página siguiente. Y el hueco entre la última tarea de un grupo y la cabecera del siguiente sale más apretado que el resto (viene desde que existe la exportación; ajustarlo afecta a todos los PDF y merece un repaso aparte). El Excel no tiene estos problemas.
- **Plantilla Excel Martech:** hasta 50 tareas con fecha y 40 semanas dentro de un mismo año natural (los límites de la plantilla original); si no cabe, se avisa y sale el Excel genérico. La línea global siempre usa el genérico.
- **Negrita del título:** un `**` sin pareja se ve tal cual; con tres seguidos (`***así***`) puede colarse algún asterisco de más. Sin ningún riesgo de seguridad (no es HTML).
- **Descripción:** el editor usa `document.execCommand`, marcado como obsoleto pero soportado por todos los navegadores actuales; si algún día falla, ahí está la pista.
- **Avisos del navegador:** solo con Chusy abierto en alguna pestaña (ver 3.4). La preferencia es de cada navegador, no de la cuenta, porque el permiso lo concede cada navegador.
- **Anchos de columna de serie** son valores fijos pensados para el contenido habitual; para eso están el arrastre y ocultar/mostrar.
- **Abrir Ubicación:** sin ayudante solo copia la ruta; un PC gestionado por la empresa puede impedir instalarlo (escribir en el registro o ejecutar PowerShell: pedírselo a Informática). Como `chusy-open:` queda registrado en Windows para el navegador, cualquier web podría lanzarlo; el script solo abre carpetas que existen. Chusy no comprueba que la carpeta exista ni que se tenga acceso (lo hace el ayudante, y si no la encuentra —VPN apagada, unidad de red sin conectar— avisa en un cuadro). Una ruta con letra de unidad (`Z:\Ofertas\…`) solo vale en los PC donde esa letra apunte al mismo sitio; las rutas de red completas (`\\servidor\recurso\…`) valen en todos. El aviso «Ruta copiada» se decide por una señal indirecta (pérdida de foco en 1,2 s): si el Explorador tarda más, sale el aviso aunque la carpeta se abra; en los dos casos la ruta queda en el portapapeles. Al abrir puede verse parpadear un instante una ventana de PowerShell.

### 7.4 Oferta desde Outlook

- Solo se crea con **Chusy abierto y la sesión iniciada** de quien lanza la macro. La macro espera hasta 10 s a que alguna pestaña responda: una pestaña «dormida» (Ahorro de memoria de Chrome/Edge) o un navegador cerrado no responden, y la macro avisa de que no se creó. Si Chusy se abre justo en el segundo en que se lanza la macro, la petición ya estará al abrir la sesión y se descartará: se avisa igual y se crea a mano.
- El destinatario se busca por el **correo de la cuenta de Outlook**. Si el correo con el que se entra en Chusy es otro, hay que escribirlo en la constante `CHUSY_CORREO` de la macro.
- **La clave está dentro de la macro:** quien la tenga puede dejar peticiones de oferta a nombre de cualquier correo (nada más; no lee ni borra datos). Si se pierde o se filtra: «Conexión con Outlook» → «Cambiar la clave» y repartir la macro de nuevo. Mientras una petición está en Firestore (normalmente un par de segundos; como mucho un minuto si nadie la recoge) lleva el texto del correo, y quien conozca su id —solo la macro— podría leerla: es la contrapartida de que la macro no inicie sesión.
- El PC con Outlook necesita llegar a `firestore.googleapis.com` (usa los ajustes de proxy de Windows). Si Informática lo bloquea, la macro dice «no se pudo conectar» y la oferta no se crea; la carpeta sí.
- El nombre repetido se compara con las ofertas que haya en ese instante; dos macros lanzadas a la vez con el mismo nombre desde PC distintos podrían crearse sin enterarse la una de la otra (caso teórico).
- Si algún día se cambia de proyecto de Firebase, hay que actualizar `CHUSY_PROJECT_ID` (y regenerar la clave) en la macro de todo el equipo.

### 7.5 Registro y perfil

- El arreglo del registro tiene **dos mitades**: la de `js/auth.js` (no cortarse la sesión a sí mismo durante el alta) arregla los registros nuevos aunque `firestore.rules` no esté republicada; la que repara una cuenta que **ya** está sin perfil necesita la regla nueva (`get` del perfil propio mientras no existe). Sin ella, esa persona sigue viendo «No se pudo cargar tu perfil» y hay que crearle el documento a mano (apartado 3.5).
- La reparación del perfil pone el nombre de la cuenta de Auth, no el que la persona tecleó si el registro se cortó antes de guardarlo: es lo anterior a la `@` (se cambia desde «Mi cuenta»). Se intenta **una vez por sesión** y **nunca con un «no existe» que venga de la caché**: sin red no se repara nada y la app espera al servidor (en un arranque sin conexión se queda en la pantalla de carga hasta que vuelva).
- Una cuenta **eliminada** no ve el aviso «Esta cuenta ha sido desactivada…» (las reglas le deniegan leer su perfil, así que ve el mensaje genérico); se dejó así para no ampliar lo que puede leer.

---
## 8. Historial de cambios

Cada número es un ZIP completo (`Chusy-N.zip`); el último es la fuente de la verdad. Esta lista resume qué cambió en cada salto desde la v18, para quien retome el proyecto sin contexto. Las trampas que dejó cada arreglo están en el apartado 7.1; el detalle fino, en los comentarios del código. Hubo ramas paralelas en conversaciones distintas (por eso hay dos entradas **v23 → v24**) que se fusionaron a mano en la v29, la v36 y la v46. Las entradas nuevas van **al final**, de una a cuatro líneas: qué se pidió, qué se hizo y dónde, y qué hay que hacer al publicar.

- **v18 → v19 — Scroll fijo.** `.app-shell { height: 100vh; height: 100dvh; overflow: hidden }` (antes `min-height`) y `min-height: 0` en la cadena flex: solo las tareas se desplazan; topbar, filtros, barra de selección y pie de la barra lateral quedan fijos. Solo CSS.
- **v19 → v20 — «Mover a mis tareas»** en las acciones masivas: saca las tareas del proyecto y las deja personales de quien pulsa, sustituyendo los responsables (pide confirmación; `bulkMoveToMyTasks()`).
- **v20 → v21** — «🗂 Secciones» (`sections-modal.js`: crear, renombrar, eliminar, colorear); cabecera de tabla fija en Lista y Mis tareas (el scroll pasa a `.list-table-scroll`); `.tag-pill` con `width: max-content` para que el fondo abrace nombres largos.
- **v21 → v22** — Círculo de completar en Mis tareas; desarchivar/eliminar proyectos archivados por clic derecho; confeti al completar (`celebration.js`, solo CSS y DOM).
- **v22 → v23** (fusión de dos conversaciones paralelas sobre la v18) — Editor de descripción enriquecido (`rich-text-editor.js`); responsables solo con cuentas reales; se retira «Bloqueada por»; filtros de Mis tareas recordados (`localStorage` por uid, «Pendiente» de serie).
- **v23 → v24 (rama 1)** — Recordar la última sección visitada (`restoreLastLocation()`); reordenar columnas arrastrando; orden por defecto fecha + prioridad y Mis tareas agrupada por urgencia; columna Etiquetas propia.
- **v23 → v24 (rama 2) → v28** — Modo claro/oscuro (variables CSS bajo `:root[data-theme]`, `theme.js`, elegible en «Mi cuenta»); rachas de la recompensa (rápida y del día); selección múltiple en Mis tareas; icono descentrado con la barra lateral colapsada. *v25:* Lista y Mis tareas perdían el scroll al completar o seleccionar. *v26–v27:* paleta del modo claro (dorado vivo, fondo casi blanco `#FCFCFB`). *v28:* `--color-dim` para los días fuera de mes del Calendario; el topbar no actualizaba la pestaña activa.
- **v28 → v29** — Fusión a mano de las dos ramas (sin funciones nuevas).
- **v29 → v30** — Buscador por texto en la barra de filtros; tema «Clásico» (colores de Asana); tareas en varios proyectos a la vez (`extraProjectIds`, `extraSections`) y responsables en las personales.
- **v30 → v31** — Arreglos de la v30: «+ Añadir a un proyecto» salía vacío (se había reutilizado `.tag-suggest`, que es `position: absolute`); ningún proyecto mostraba tareas (consulta nueva sin índice compuesto + un callback de error que no marcaba su mitad como cargada; ver 7.1).
- **v31 → v32** — El cursor de redimensionar columna vuelve a avisar al posar el ratón (revierte un cambio de la v30); modo Clásico con jerarquía de texto propia en la barra lateral oscura.
- **v32 → v33** — Clásico con selectores directos (la herencia de variables no se aplicó); `css/styles.css?v=N` en `index.html` contra la caché; las tareas sin sección no salían en la línea de tiempo; panel de Métricas.
- **v33 → v34** — «Sin sección» sale arriba en Lista, Tablero y línea de tiempo; exportar la línea de tiempo a Excel o PDF (`gantt-export.js`).
- **v34 → v35** — Orden de filas recordado por persona y ámbito; eliminar y reactivar cuentas (`deleted`, `isActiveUser()` en las reglas); negrita parcial en el título.
- **v35 → v36** — Fusión de dos v35 paralelas: la anterior más el Excel con la plantilla real de la empresa y las notificaciones al asignar. `firestore.rules` tenía dos bloques `match /notifications` a la vez: se unificaron.
- **v36 → v37** — La campana ya no se solapa con «+ Nueva tarea»; icono SVG recoloreable.
- **v37 → v38** — Excel con la plantilla Martech reparado de raíz (cuatro fallos a la vez: formato condicional sin las reglas de color, tareas de ejemplo de un cliente real horneadas en la plantilla, macros y botones perdidos al guardarla sin conservar el VBA, cabecera de fechas sin valores recalculados). Plantilla rehecha a partir del `CRONOGRAMA.xlsm` real, editando su XML; la descarga pasa a `.xlsm`.
- **v38 → v39** — Estilo de las filas 23/25/27-33 de la plantilla corregido (un color por fila se probó y se descartó: se queda por sección); notificaciones: 20 visibles, leídas y sin leer distinguibles, `projectName`, las cuentas ficticias no reciben, autolimpieza.
- **v39 → v40** — Aviso emergente al asignar con la app abierta; bug: «Tarea eliminada» aunque no se hubiera eliminado (no esperaba el resultado de `deleteTask`).
- **v40 → v41** — El dueño de una tarea personal sigue a quien la lleve (`nextPersonalOwnerId()`, usado en los tres sitios que cambian responsables).
- **v41 → v42** — **Creación Rápida**: panel admin (`quick-create-admin-modal.js`), selector «Nueva cabina», `meta/quickCreate` y `quickCreateProducts`. Métricas y Creación Rápida pasan al menú del nombre. Requiere republicar las reglas.
- **v42 → v43** — Creación Rápida: cabina con nombre propio y tarea principal, fechas por «días necesarios», sección nueva con el nombre de la cabina, asignación rápida. Arreglos: los modales ya no se cierran con clic fuera/Escape (se perdía trabajo), el selector se colgaba tras crear, crear un proyecto sin secciones las recreaba.
- **v43 → v44** (dos ramas) — Gantt en modo Secciones/Tareas (`aggregateBucket()`, la exportación respeta el modo); Creación Rápida: reordenar arrastrando y prioridad por tarea.
- **v44 → v45** (rama Creación Rápida) — Varios productos por pasada.
- **v45 → v46** — Fusión de las dos ramas, más cuatro mejoras del Gantt: color por sección, expandir una sección, zoom por trimestre/año (retirado en la v48), arrastrar barras para cambiar fechas.
- **v46 → v47** — Asas de redimensionar visibles y más anchas (9 px); color de sección elegible a mano en «🗂 Secciones».
- **v47 → v48** — «🗂 Secciones» también en la línea de tiempo; se retira el zoom por trimestre/año; investigación del redimensionado que «no funcionaba».
- **v48 → v49** — Causa real del redimensionado: faltaba `preventDefault()` y el bloqueo de selección en el `mousedown` (ver 7.1); las tareas de una sola fecha se pueden estirar; la línea de tiempo ya no vuelve a «Hoy» tras cada arrastre; botón «Secciones» a la derecha.
- **v49 → v50** — El ancho cambia en directo al arrastrar un borde; los dos bordes de una tarea de una fecha, activos desde el principio.
- **v50 → v51** — Tarea de una sola fecha: tirar hacia fuera crea el rango, hacia dentro mueve la fecha.
- **v51 → v52** — «Marcar todas» por producto en la asignación rápida; «Nueva cabina» avisa a las personas asignadas (antes no notificaba); el panel marca leídas al cerrarse; aviso grande centrado; avisos del navegador (`browser-notifications.js`); tipo `tasks_assigned_bulk`.
- **v52 → v53** — «Asignar» y «Añadir colaboradores» de la selección múltiple avisan una vez por persona y proyecto (`notifyBulkAssignment`).
- **v53 → v54** — Rol **Revisor** (Miembro + Métricas; solo interfaz, sin tocar las reglas).
- **v54 → v55** — **Departamentos** (`department`) y **secciones exclusivas**; la primera, **Ofertas** (Nuevas / Revisiones; Comercial y Versión); «Accesos por departamento». Regla nueva: nadie se asigna su propio departamento. Requiere republicar las reglas.
- **v55 → v56** — Departamento en el pie de la barra lateral; «Nueva cabina» pasa a «Insertar producto»; campo Ubicación (mecanismo `seedVersion` / `fieldsAddedIn`); Ofertas con «+ Nueva oferta» y sin Insertar producto; **versión y histórico de revisiones** con «+ Nueva versión» (`offers.js`).
- **v56 → v57** — Fila A1 «Versión original»; sugerencias de Comercial (`text-suggest.js`); **Propiedades** de un proyecto (`projects.properties`); **«Convertir en proyecto»** (`offer-conversion.js`).
- **v57 → v58** — Campo Sector; secciones Entregadas y Cerradas (reglas en `offers.js`; `toggleTaskComplete()` y `bulkSetComplete()` reciben la tarea entera; `sectionsAddedIn`); fechas clave en la línea de tiempo del proyecto.
- **v58 → v59** — Fechas en el orden aprobación → envío → entrega; arrastrar las fechas clave; filtros de Ofertas recordados; Ubicación no filtrable; fechas clave en el PDF.
- **v59 → v60** — **Abrir Ubicación**: botón que copia la ruta y, con el ayudante de Windows, abre la carpeta.
- **v60 → v61** — «Abrir Ubicación» en el clic derecho; **Oferta desde Outlook** (`offerInbox`, `meta/outlookBridge`, «Conexión con Outlook», bloque `CONEXIÓN CON CHUSY` en la macro). Requiere republicar las reglas y el alta de la clave (3.8).
- **v61 → v62** — Arreglo del registro («No se pudo cargar tu perfil»): `signUp()` ya no se pisa a sí mismo, un perfil que falta se crea solo al entrar, nueva regla `get` del perfil propio inexistente, sin perfil provisional con mala conexión. Requiere republicar las reglas.
- **v62 → v63** — «Diseño» pasa a «Diseño - Industria» y «Diseño - Automoción» (`departments.js`, grupos de acceso, `LEGACY_DEPARTMENT`); Sector por defecto al crear ofertas (formulario y macro); el oyente de Outlook usa siempre el perfil más reciente. Sin cambios en reglas ni macro. Tras publicar: un admin pasa a cada persona de «Diseño (sin sector)» a uno de los dos nuevos.
- **README reorganizado (sin cambios de código, tras la v63)** — De 477 KB y 1 438 líneas a 69 KB y 391 líneas. Se quitaron las anotaciones de versión dentro de cada función, los avisos de «no probado» de cosas que luego se usaron sin problema, los recuentos de pruebas y la prosa de justificación; se añadió el apartado 2 (flujo de entrega y «Dónde tocar para…»); las trampas técnicas, que estaban repartidas por el historial, pasan al apartado 7.1; y este historial queda en una a cuatro líneas por versión. No cambia ningún archivo de código: la v64 será la siguiente entrega con cambios.
- **v63 → v64** — **«Convertir en oferta»**: opción nueva en el clic derecho de una tarea (Lista, Tablero, Mis tareas y línea de tiempo) y en el «···» de la selección múltiple («Convertir en ofertas»), solo para quien tiene acceso a Ofertas. Traslada la tarea a Ofertas («Nuevas», o «Entregadas» si ya estaba completada) con versión A1, histórico «A1 · Versión original» y el Sector según el departamento de quien convierte (la misma regla que al crear una oferta a mano o desde Outlook). Archivo nuevo `js/components/convert-to-offers.js`; `canBecomeOffer()` y `planTaskToOffer()` en `offers.js`; `bulkConvertToOffers()` en `data/tasks.js`; `openTaskContextMenu()` recibe ahora `currentUser` (Tablero y línea de tiempo lo reciben desde `app.js`). Sin cambios en `firestore.rules`, CSS ni macro: al publicar, subir los archivos y Ctrl+F5.
- **v64 → v65** — **«Convertir en oferta» toma la Ubicación de la descripción**: si la descripción de la tarea trae una ruta de carpeta (letra de unidad, ruta de red o `file:///`), la primera pasa a ser la Ubicación de la oferta (solo si el campo estaba vacío; la descripción no se modifica). La confirmación muestra la ruta y el aviso final lo dice. Nuevo `findLocationInDescription()` en `location.js` (puro, sin DOM: pasa el HTML del editor a texto con un salto por bloque y busca la ruta), `offerLocationFromDescription()` en `offers.js` y cambios en `convert-to-offers.js`. Sin cambios en reglas, CSS ni macro: al publicar, subir los archivos y Ctrl+F5.
