// ============================================================================
// Modo claro/oscuro/clásico.
//
// El valor "de verdad" vive en la cuenta (users/{uid}.theme, vía
// updateUserProfile) para que la preferencia viaje entre dispositivos —
// igual que columnPrefs. Además se cachea en este navegador (localStorage)
// solo para poder pintar el tema correcto desde el primer fotograma, antes
// de que Firebase resuelva la sesión: el script embebido al principio de
// <head> en index.html lee esa misma clave de forma síncrona, para que no
// se vea ni un parpadeo del tema equivocado mientras carga la app (esa
// pantalla de carga ya cubre toda la ventana entre medias, así que el
// único requisito es que YA esté pintada con el tema correcto).
//
// applyTheme() no toca Firestore — eso lo hace quien la llama (de momento
// solo account-modal.js) después, para poder aplicar el cambio al momento
// sin esperar al viaje de ida y vuelta a la base de datos.
// ============================================================================
const STORAGE_KEY = "chusy:theme";

function normalize(theme) {
  if (theme === "light") return "light";
  if (theme === "classic") return "classic";
  return "dark";
}

/** Tema cacheado en este navegador (o "dark" si no hay nada guardado todavía). */
export function getCachedTheme() {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return "dark";
  }
}

/** Pinta el tema en <html> y actualiza la caché de este navegador. */
export function applyTheme(theme) {
  const normalized = normalize(theme);
  document.documentElement.dataset.theme = normalized;
  try { localStorage.setItem(STORAGE_KEY, normalized); } catch (e) { /* localStorage no disponible (modo privado, etc.) */ }
  return normalized;
}
