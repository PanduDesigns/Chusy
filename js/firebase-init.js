// ============================================================================
// Inicialización de Firebase. El resto de la app importa `auth` y `db`
// desde aquí en lugar de inicializar Firebase varias veces.
//
// v72 — CACHÉ LOCAL PERSISTENTE de Firestore. La base de datos se abre con
// `persistentLocalCache` (los documentos leídos se guardan en IndexedDB) y
// `persistentMultipleTabManager` (varias pestañas de Chusy abiertas a la vez
// comparten esa caché y UNA sola conexión con el servidor, en vez de que cada
// pestaña lea por su cuenta).
//
// Lo que SÍ hace:
//   · Al abrir una escucha (`onSnapshot`) los documentos que ya están en la
//     caché se entregan al instante (con `snapshot.metadata.fromCache === true`)
//     y el servidor solo manda lo que ha cambiado desde la última vez.
//   · Eso solo es así mientras la escucha anterior de la MISMA consulta tenga
//     menos de ~30 minutos: pasado ese tiempo el servidor ya no puede continuar
//     desde donde se quedó, vuelve a mandar la consulta entera y Firestore la
//     cobra otra vez. Es decir: ayuda sobre todo con las recargas seguidas
//     (Ctrl+F5 al actualizar la web) y con cortes cortos de red; NO evita la
//     primera carga del día de cada persona.
//   · Con conexión intermitente la app sigue mostrando lo último que vio.
//
// Lo que NO hace:
//   · No reduce lecturas por sí sola dentro de una sesión: eso lo da no abrir
//     la misma escucha dos veces (ver js/store.js y js/task-loader.js).
//   · La caché es del NAVEGADOR, no de la cuenta: en un PC compartido quedan
//     datos de la empresa de quien lo usó antes. Para eso está
//     `clearLocalCache()` (más abajo; de momento sin enchufar al cierre de sesión).
//
// Dos trampas de la API:
//   · `initializeFirestore()` tiene que ejecutarse ANTES de cualquier otro uso
//     de Firestore. Si algún archivo llamara antes a `getFirestore(app)`, esto
//     lanzaría `failed-precondition` (se captura: se queda sin caché y avisa en
//     consola). Hoy solo este archivo llama a `getFirestore`/`initializeFirestore`;
//     el resto de la app importa `db` de aquí. Mantenerlo así.
//   · Si IndexedDB no se puede usar (modo privado de Firefox, cuota llena…) el
//     propio SDK lo detecta más tarde, escribe un aviso en consola («Falling back
//     to memory cache») y sigue con caché en memoria: la app funciona igual, sin
//     persistencia. Por eso `LOCAL_CACHE` dice lo que se PIDIÓ, no lo que ya
//     funciona con seguridad.
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const isPlaceholderConfig = firebaseConfig.apiKey === "TU_API_KEY";

if (isPlaceholderConfig) {
  // Aviso visible en pantalla además de en consola, para que no cueste
  // encontrar el motivo si alguien abre el proyecto sin haber configurado
  // Firebase todavía.
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#17181A;color:#ECEDED;font-family:system-ui,sans-serif;padding:24px;text-align:center;">
        <div style="max-width:480px;">
          <h1 style="font-size:20px;margin-bottom:12px;">Falta configurar Firebase</h1>
          <p style="color:#8B959C;font-size:14px;line-height:1.6;">
            Edita <code style="color:#FCD000;">js/firebase-config.js</code> con las claves de tu
            proyecto de Firebase (Firebase Console → Configuración del proyecto → Tus apps).
            Consulta el README.md incluido para el paso a paso.
          </p>
        </div>
      </div>`;
  });
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Abre Firestore con caché persistente multipestaña. Si no se puede (ya se
 * había usado `getFirestore` antes, o el navegador no soporta la API), vuelve
 * al Firestore de siempre —caché en memoria— en vez de dejar la app sin base
 * de datos: la caché es una mejora, nunca una condición para arrancar.
 */
function openFirestore() {
  if (isPlaceholderConfig) return { db: getFirestore(app), cache: "memory" };
  try {
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    return { db, cache: "persistent" };
  } catch (e) {
    console.warn("[Chusy] No se pudo activar la caché local de Firestore; se sigue con caché en memoria:", e);
    return { db: getFirestore(app), cache: "memory" };
  }
}

const opened = openFirestore();

export const db = opened.db;

/** «persistent» = se pidió la caché en IndexedDB; «memory» = no (ver el aviso de arriba sobre el plan B del SDK). */
export const LOCAL_CACHE = opened.cache;

/**
 * Borra TODO lo que Firestore guarda en este navegador (documentos en caché y
 * escrituras pendientes de enviar). Pensado para el cierre de sesión en un PC
 * compartido. De momento NO se llama desde ningún sitio.
 *
 * Detiene Firestore antes de borrar (lo exige la API), así que después `db` ya
 * no sirve: quien la llame debe recargar la página (`location.reload()`).
 * Si hay otra pestaña de Chusy abierta, el borrado puede fallar con
 * `failed-precondition`; no es un borrado seguro en el sentido criptográfico
 * (la propia documentación de Firebase lo avisa).
 */
export async function clearLocalCache() {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}
