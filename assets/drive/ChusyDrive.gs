/**
 * ============================================================================
 * Chusy · Puente con Google Drive  (versión 1)
 * ============================================================================
 * Este script corre en Google Apps Script con TU cuenta de Google (la que tiene
 * el espacio de Drive que quieres usar). Hace una sola cosa: cuando Chusy le
 * enseña una sesión válida, le entrega un permiso temporal (1 hora) para que el
 * navegador suba y descargue archivos DIRECTAMENTE de/a la carpeta
 * «Chusy - archivos» de tu Drive. Los archivos nunca pasan por este script, así
 * que sus límites de tamaño y de velocidad no importan, y quien usa Chusy no
 * necesita cuenta de Google.
 *
 * Seguridad, en corto:
 *  - Solo da permiso a quien presente un token de sesión de Firebase válido de
 *    ESTE proyecto de Chusy (FIREBASE_PROJECT_ID, abajo) y con perfil activo en
 *    Chusy (se comprueba leyendo su perfil en Firestore con ese mismo token: si
 *    las reglas de Firestore no le dejan, no hay permiso). Si el equipo tiene
 *    configurados «dominios permitidos» en Chusy, también se exige que su
 *    correo sea de uno de ellos.
 *  - El permiso que entrega es de tipo «drive.file»: solo permite tocar los
 *    archivos que ha creado este mismo script/Chusy, NO el resto de tu Drive.
 *  - Para cambiar de proyecto de Firebase, cambia la constante de abajo.
 *
 * Pasos para ponerlo en marcha (con más detalle en assets/drive/LEEME.txt y en
 * el apartado 3.13 del README):
 *  1. En script.google.com crea un proyecto y pega aquí este archivo.
 *  2. Ajustes del proyecto → «Mostrar el archivo de manifiesto appsscript.json»
 *     y pega el contenido de appsscript.json (los permisos).
 *  3. Servicios (+) → añade «Drive API» (v3).
 *  4. Ejecuta la función `autorizar` y acepta los permisos.
 *  5. Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo ·
 *     Quién tiene acceso: Cualquier usuario. Copia la URL (acaba en /exec) y
 *     pégala en Chusy → menú de tu nombre → «Archivos en Google Drive».
 *  Cada vez que cambies este código: Implementar → Administrar implementaciones
 *  → ✏️ → Versión: «Nueva versión» (la URL no cambia).
 * ============================================================================
 */

// El proyecto de Firebase de Chusy (el de js/firebase-config.js → projectId).
const FIREBASE_PROJECT_ID = 'asano-martech';

// La carpeta que se crea (una sola vez) en el Drive de esta cuenta.
const NOMBRE_CARPETA = 'Chusy - archivos';

const VERSION_PUENTE = 1;
const SEGUNDOS_RECUERDO_SESION = 300; // cuánto se recuerda que una sesión ya se comprobó
const SEGUNDOS_PERMISO = 900; // cuánto le dice a Chusy que puede reutilizar el permiso

// ---------------------------------------------------------------------------
// Entradas de la aplicación web
// ---------------------------------------------------------------------------

function doGet() {
  return respuesta_({ ok: true, servicio: 'chusy-drive', version: VERSION_PUENTE });
}

function doPost(e) {
  try {
    const texto = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (texto.length > 8000) return respuesta_({ ok: false, error: 'peticion_demasiado_grande' });
    let peticion;
    try {
      peticion = JSON.parse(texto);
    } catch (x) {
      return respuesta_({ ok: false, error: 'peticion_invalida' });
    }
    const accion = peticion && peticion.accion;

    if (accion === 'ping') {
      return respuesta_({ ok: true, servicio: 'chusy-drive', version: VERSION_PUENTE });
    }
    if (accion !== 'token') {
      return respuesta_({ ok: false, error: 'accion_desconocida' });
    }

    const sesion = comprobarSesion_(peticion.idToken);
    if (!sesion.ok) {
      return respuesta_({ ok: false, error: sesion.error, detalle: sesion.detalle });
    }

    const carpetaId = carpetaDeChusy_();
    return respuesta_({
      ok: true,
      token: ScriptApp.getOAuthToken(),
      carpetaId: carpetaId,
      expiraEnSegundos: SEGUNDOS_PERMISO,
      version: VERSION_PUENTE,
    });
  } catch (err) {
    // Nunca se deja escapar una excepción: Apps Script la devolvería como una
    // página de error SIN cabeceras CORS y el navegador solo vería «Failed to
    // fetch». Así al menos Chusy puede enseñar qué ha pasado.
    return respuesta_({ ok: false, error: 'error_interno', detalle: String(err && err.message ? err.message : err) });
  }
}

/**
 * Ejecútala UNA vez a mano desde el editor (menú «Ejecutar»): Google te pedirá
 * los permisos, y se crea la carpeta de Chusy en tu Drive. Si algo falla (por
 * ejemplo, falta añadir «Drive API» en Servicios), el error sale aquí, en el
 * registro de ejecución, con el motivo.
 */
function autorizar() {
  const id = carpetaDeChusy_();
  Logger.log('Todo listo. Carpeta de Chusy en tu Drive: https://drive.google.com/drive/folders/' + id);
  Logger.log('Siguiente paso: Implementar → Nueva implementación → Aplicación web.');
}

// ---------------------------------------------------------------------------
// Comprobación de la sesión de Chusy
// ---------------------------------------------------------------------------

function comprobarSesion_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 6000) {
    return { ok: false, error: 'token_invalido' };
  }
  const partes = idToken.split('.');
  if (partes.length !== 3) return { ok: false, error: 'token_invalido' };

  let datos;
  try {
    datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(rellenar_(partes[1]))).getDataAsString());
  } catch (x) {
    return { ok: false, error: 'token_invalido' };
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (
    !datos ||
    datos.aud !== FIREBASE_PROJECT_ID ||
    datos.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID ||
    !datos.sub ||
    !(datos.exp > ahora)
  ) {
    return { ok: false, error: 'token_invalido' };
  }

  const cache = CacheService.getScriptCache();
  const clave = 'sesion:' + huella_(idToken);
  if (cache.get(clave)) return { ok: true, uid: datos.sub };

  // La firma del token no se comprueba aquí (Apps Script no sabe): la comprueba
  // Firestore al leer el perfil con ese token — con un token falso devuelve 401.
  const respuestaPerfil = UrlFetchApp.fetch(urlFirestore_('users/' + encodeURIComponent(datos.sub)), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + idToken },
    muteHttpExceptions: true,
  });
  if (respuestaPerfil.getResponseCode() !== 200) {
    return { ok: false, error: 'sin_acceso', detalle: 'HTTP ' + respuestaPerfil.getResponseCode() };
  }

  const dominios = dominiosPermitidos_();
  if (dominios.length) {
    const correo = String(datos.email || '').toLowerCase();
    const dominio = correo.indexOf('@') >= 0 ? correo.split('@').pop() : '';
    if (dominios.indexOf(dominio) < 0) return { ok: false, error: 'dominio_no_permitido' };
  }

  cache.put(clave, '1', SEGUNDOS_RECUERDO_SESION);
  return { ok: true, uid: datos.sub };
}

/** Los dominios de correo permitidos que haya configurado el equipo en Chusy (meta/config); vacío = sin restricción. */
function dominiosPermitidos_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('dominios');
  if (guardado !== null) {
    try {
      return JSON.parse(guardado);
    } catch (x) {
      /* se vuelve a pedir */
    }
  }
  let lista = [];
  try {
    const r = UrlFetchApp.fetch(urlFirestore_('meta/config'), { method: 'get', muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const doc = JSON.parse(r.getContentText());
      const valores = (doc.fields && doc.fields.allowedEmailDomains && doc.fields.allowedEmailDomains.arrayValue && doc.fields.allowedEmailDomains.arrayValue.values) || [];
      lista = valores
        .map(function (v) { return String(v.stringValue || '').toLowerCase().replace(/^@/, '').trim(); })
        .filter(function (d) { return d; });
    }
  } catch (x) {
    lista = []; // si no se puede leer, no se bloquea a nadie por ello
  }
  cache.put('dominios', JSON.stringify(lista), 300);
  return lista;
}

// ---------------------------------------------------------------------------
// La carpeta de Chusy en Drive
// ---------------------------------------------------------------------------

/** El id de la carpeta «Chusy - archivos»: se crea la primera vez y se vuelve a crear si alguien la borra. */
function carpetaDeChusy_() {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const guardada = props.getProperty('CARPETA_ID');
  if (guardada && cache.get('carpeta_ok:' + guardada)) return guardada;

  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000); // dos peticiones a la vez no crean dos carpetas
  try {
    let id = props.getProperty('CARPETA_ID');
    if (id && carpetaValida_(id)) {
      cache.put('carpeta_ok:' + id, '1', 600);
      return id;
    }
    id = crearCarpeta_();
    props.setProperty('CARPETA_ID', id);
    cache.put('carpeta_ok:' + id, '1', 600);
    return id;
  } finally {
    bloqueo.releaseLock();
  }
}

function carpetaValida_(id) {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,trashed', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return false;
  return !JSON.parse(r.getContentText()).trashed;
}

function crearCarpeta_() {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      name: NOMBRE_CARPETA,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Archivos adjuntos de Chusy. Chusy los gestiona: no cambies los nombres ni muevas lo de dentro a mano.',
    }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) {
    throw new Error('Drive no dejó crear la carpeta (HTTP ' + r.getResponseCode() + '): ' + mensajeDrive_(r.getContentText()));
  }
  return JSON.parse(r.getContentText()).id;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function respuesta_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function urlFirestore_(ruta) {
  return 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + ruta;
}

function mensajeDrive_(texto) {
  try {
    const e = JSON.parse(texto);
    return (e.error && e.error.message) || String(texto).slice(0, 300);
  } catch (x) {
    return String(texto).slice(0, 300);
  }
}

/** Los trozos de un JWT vienen sin el relleno «=» del final; Utilities lo necesita. */
function rellenar_(b64) {
  let s = b64;
  while (s.length % 4) s += '=';
  return s;
}

function huella_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto));
}
