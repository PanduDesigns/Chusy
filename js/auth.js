// ============================================================================
// Autenticación: registro, inicio de sesión y perfil del usuario en Firestore.
//
// Reparto de roles: el primer documento que se crea en `users` se convierte
// en "admin" (se controla con el documento centinela meta/bootstrap, ver
// firestore.rules). El resto de personas que se registran quedan como
// "miembro". Un admin puede ascender a otras personas más adelante editando
// su documento en users/{uid} desde la consola de Firebase, o desde la
// pantalla de equipo cuando la construyamos.
// ============================================================================
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ----------------------------------------------------------------------------
// Escribir el perfil propio sin que la app se entere a medias (v62).
//
// El perfil (users/{uid}) lo escribe la propia persona, y las reglas de
// Firestore solo dejan leer algo a quien YA tiene perfil (`isActiveUser()`).
// Al registrarse hay por tanto un hueco: la cuenta de Auth se crea y la
// sesión empieza AL MOMENTO (onAuthChange ya está escuchando), pero el
// perfil se escribe unos instantes después. Hasta la v61, la escucha del
// perfil se adelantaba, Firestore se la denegaba (aún no había perfil), la
// app lo tomaba por un fallo y cerraba la sesión («No se pudo cargar tu
// perfil») — y con la sesión ya cerrada el perfil ni llegaba a escribirse:
// la cuenta de Auth quedaba SIN perfil y esa persona ya no podía entrar
// nunca (registrarse otra vez daba «Ya existe una cuenta con ese correo»).
//
// Ahora, mientras se escribe el perfil propio (alta o reparación), se
// ignora lo que diga esa escucha —datos y errores— y, al terminar, se
// vuelve a suscribir: ya con el perfil escrito y confirmado por el servidor.
// ----------------------------------------------------------------------------
let ownProfileWrites = 0;
let onOwnProfileWritesDone = null;

async function whileWritingOwnProfile(fn) {
  ownProfileWrites++;
  try {
    return await fn();
  } finally {
    ownProfileWrites--;
    if (ownProfileWrites === 0 && onOwnProfileWritesDone) onOwnProfileWritesDone();
  }
}

/**
 * Da de alta una cuenta nueva y crea su perfil en Firestore.
 * Lanza un Error con un mensaje en español listo para mostrar si algo falla.
 */
export async function signUp({ name, email, password }) {
  await checkAllowedDomain(email);

  // Todo lo que sigue (crear la cuenta de Auth Y escribir el perfil) va
  // dentro del «hueco» de arriba: la escucha del perfil ya está viva desde
  // que se crea la cuenta, así que el aviso tiene que empezar ANTES.
  return whileWritingOwnProfile(async () => {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      throw new Error(translateAuthError(e));
    }

    try {
      await updateProfile(cred.user, { displayName: name });
    } catch (e) {
      // El nombre visible de Auth es secundario (el de verdad es el del
      // perfil de Firestore): que esto falle no debe dejar la cuenta sin
      // perfil. Si hiciera falta, `onAuthChange` lo recompone del correo.
      console.warn("No se pudo guardar el nombre en Firebase Auth:", e);
    }

    try {
      // ¿Es la primera persona en registrarse? Si el documento centinela
      // meta/bootstrap no existe todavía, esta persona se convierte en admin.
      // Importante: creamos primero el documento en `users` (con role admin)
      // y SOLO DESPUÉS el centinela — las reglas de Firestore exigen que
      // meta/bootstrap todavía no exista en el momento de crear un admin, así
      // que si lo creáramos antes, la propia comprobación se bloquearía a sí
      // misma.
      const bootstrapRef = doc(db, "meta", "bootstrap");
      const bootstrapSnap = await getDoc(bootstrapRef);
      const iAmFirst = !bootstrapSnap.exists();
      const role = iAmFirst ? "admin" : "miembro";

      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        email,
        role,
        createdAt: serverTimestamp(),
      });

      if (iAmFirst) {
        try {
          await setDoc(bootstrapRef, {
            createdAt: serverTimestamp(),
            firstAdminUid: cred.user.uid,
          });
        } catch (e) {
          // Alguien se adelantó por una fracción de segundo creando el
          // centinela primero: no pasa nada, mi documento de usuario ya
          // quedó creado como admin en el paso anterior.
        }
      }
    } catch (e) {
      // La cuenta de Auth YA existe y sigue con sesión; solo falta el perfil.
      // No es un callejón sin salida (v62): al entrar de nuevo —o ahora
      // mismo, si lo que falló era pasajero— `onAuthChange` crea el perfil
      // que falte. Lo decimos claro para que quien se registra no piense
      // que tiene que volver a registrarse.
      throw new Error(
        "Tu cuenta se ha creado, pero no se ha podido guardar tu perfil. " +
        "Inicia sesión con tu correo y tu contraseña para completarlo; si se repite, avisa a un administrador. " +
        `(${translateAuthError(e)})`
      );
    }

    return cred.user;
  });
}

export async function logIn({ email, password }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  } catch (e) {
    throw new Error(translateAuthError(e));
  }
}

export function logOut() {
  return signOut(auth);
}

/**
 * Envía un correo con un enlace para elegir una contraseña nueva. Por
 * seguridad (no revelar qué correos tienen cuenta), si el correo no
 * corresponde a ninguna cuenta se trata igualmente como un envío
 * correcto de cara a quien lo pide.
 */
export async function sendPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (e) {
    if (e && e.code === "auth/user-not-found") return;
    throw new Error(translateAuthError(e));
  }
}

/** Cambia el nombre visible del perfil de Firebase Auth de quien tiene sesión iniciada. */
export async function updateDisplayName(name) {
  if (!auth.currentUser) throw new Error("No hay sesión iniciada.");
  try {
    await updateProfile(auth.currentUser, { displayName: name });
  } catch (e) {
    throw new Error(translateAuthError(e));
  }
}

/**
 * Cambia la contraseña de la cuenta con sesión iniciada. Firebase exige
 * haber iniciado sesión "recientemente" para esta operación, así que
 * primero se reautentica con la contraseña actual.
 */
export async function changePassword({ currentPassword, newPassword }) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("No hay sesión iniciada.");
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  } catch (e) {
    throw new Error(translateAuthError(e));
  }
}

async function checkAllowedDomain(email) {
  let allowed = [];
  try {
    const configSnap = await getDoc(doc(db, "meta", "config"));
    allowed = configSnap.exists() ? (configSnap.data().allowedEmailDomains || []) : [];
  } catch (e) {
    // Si esta lectura falla por lo que sea (reglas aún no publicadas, red,
    // etc.) no queremos bloquear el registro por completo: la lista de
    // dominios permitidos es una comodidad, no el control de seguridad
    // real (ese lo dan las reglas de Firestore sobre los datos en sí).
    console.warn("No se pudo comprobar meta/config, se permite el registro:", e);
    return;
  }
  if (allowed.length === 0) return; // sin restricción configurada
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (!allowed.includes(domain)) {
    throw new Error(`Solo se admiten correos de: ${allowed.join(", ")}`);
  }
}

/**
 * Se suscribe al estado de sesión. `callback` recibe:
 *  - (null) si no hay nadie autenticado
 *  - (null, mensaje) si había sesión pero se ha cerrado sola por algo que
 *    conviene explicar (cuenta eliminada, o un error leyendo el perfil)
 *  - ({ uid, email, name, role, ... }) con el perfil de Firestore si hay
 *    sesión válida
 * Devuelve una función para cancelar la suscripción.
 *
 * Desde la v62, una cuenta con sesión pero SIN perfil (un registro que se
 * cortó a medias, ver más arriba) ya no es un callejón sin salida: se crea
 * el perfil que falta, una sola vez por sesión, y se entra con normalidad.
 */
export function onAuthChange(callback) {
  let unsubProfile = null;
  let authUser = null;     // la cuenta con sesión ahora mismo (o null)
  let repairTried = false; // ¿ya se intentó crear el perfil que faltaba en esta sesión?
  let generation = 0;      // para ignorar lo que llegue de una suscripción ya sustituida

  function stopProfile() {
    generation++;
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
  }

  function subscribeProfile(user) {
    stopProfile();
    const mine = generation;
    unsubProfile = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => { if (mine === generation) onProfileSnapshot(user, snap); },
      (err) => { if (mine === generation) onProfileError(user, err); }
    );
  }

  function giveUp(message) {
    // Cerrar la sesión sin más antes que dejar la app colgada en la
    // pantalla de carga.
    stopProfile();
    signOut(auth);
    callback(null, message);
  }

  function onProfileSnapshot(user, snap) {
    // Se está escribiendo el perfil propio (alta o reparación): lo que diga
    // esta escucha todavía no vale. Al terminar se vuelve a suscribir.
    if (ownProfileWrites > 0) return;

    if (!snap.exists()) {
      // Sin conexión, «no existe» solo significa «no lo tengo en memoria»:
      // no es motivo para escribir nada. Se espera a la respuesta del
      // servidor (escribir encima de un perfil que sí existe lo pisaría).
      if (snap.metadata && snap.metadata.fromCache) return;
      if (repairTried) {
        giveUp("No se pudo completar tu perfil. Vuelve a iniciar sesión; si se repite, avisa a un administrador.");
        return;
      }
      repairTried = true;
      repairMissingProfile(user);
      return;
    }

    const profile = snap.data();
    if (profile.deleted) {
      // Un admin te ha eliminado (ver "Eliminar usuario" en el panel de
      // administración): se cierra la sesión al momento, tanto si esto
      // se nota por este camino (la propia app ve el campo) como por
      // el de abajo (las reglas de Firestore ya bloquean la lectura
      // para quien tuviera una sesión abierta desde antes).
      signOut(auth);
      callback(null, "Esta cuenta ha sido desactivada por un administrador.");
      return;
    }
    callback({ uid: user.uid, ...profile });
  }

  function onProfileError(user, err) {
    // Durante el alta o la reparación del propio perfil un error de lectura
    // es esperable (aún no hay perfil que leer): se ignora y, al terminar,
    // la escucha se renueva.
    if (ownProfileWrites > 0) return;
    // Lectura denegada (p.ej. las reglas ya bloquean a esta cuenta por
    // estar eliminada) o cualquier otro error. El código queda en la consola
    // del navegador para poder diagnosticarlo (F12 → Consola).
    console.error(`[Chusy] No se pudo leer users/${user.uid}:`, err && err.code, err && err.message);
    giveUp("No se pudo cargar tu perfil. Vuelve a iniciar sesión; si se repite, avisa a un administrador.");
  }

  function repairMissingProfile(user) {
    const name = (user.displayName || "").trim() || (user.email || "").split("@")[0] || "Sin nombre";
    whileWritingOwnProfile(() => createMissingProfile(user, name)).catch((e) => {
      // No se hace nada más aquí: al terminar, la escucha se renueva y, si el
      // perfil sigue sin existir, `onProfileSnapshot` cierra la sesión con su aviso.
      console.error("[Chusy] No se pudo crear el perfil que faltaba:", e && e.code, e && e.message);
    });
  }

  // Al acabar de escribir el perfil propio, escuchar de nuevo (ver arriba).
  const renew = () => { if (authUser) subscribeProfile(authUser); };
  onOwnProfileWritesDone = renew;

  const unsubAuth = onAuthStateChanged(auth, (user) => {
    stopProfile();
    authUser = user || null;
    repairTried = false;
    if (!user) {
      callback(null);
      return;
    }
    subscribeProfile(user);
  });

  return () => {
    unsubAuth();
    stopProfile();
    if (onOwnProfileWritesDone === renew) onOwnProfileWritesDone = null;
  };
}

/**
 * Crea el perfil que le falta a una cuenta con sesión (ver arriba). Va en una
 * transacción para que NUNCA pise un perfil que ya exista (otra pestaña
 * puede haberlo creado entre medias) y para que, sin conexión, falle en vez
 * de quedarse esperando a escribir más tarde. Mismo reparto de roles que el
 * registro: solo si aún no existe meta/bootstrap sería admin; en la práctica,
 * miembro.
 */
async function createMissingProfile(user, name) {
  const profileRef = doc(db, "users", user.uid);
  const bootstrapRef = doc(db, "meta", "bootstrap");
  await runTransaction(db, async (tx) => {
    const mine = await tx.get(profileRef);
    if (mine.exists()) return;
    const boot = await tx.get(bootstrapRef);
    const iAmFirst = !boot.exists();
    tx.set(profileRef, {
      name,
      email: user.email,
      role: iAmFirst ? "admin" : "miembro",
      createdAt: serverTimestamp(),
    });
    if (iAmFirst) {
      tx.set(bootstrapRef, { createdAt: serverTimestamp(), firstAdminUid: user.uid });
    }
  });
}

function translateAuthError(e) {
  const code = e && e.code ? e.code : "";
  const map = {
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo: inicia sesión en vez de registrarte (si te quedaste sin acceso al registrarte, al entrar se completa sola).",
    "auth/invalid-email": "El correo no parece válido.",
    "auth/weak-password": "La contraseña necesita al menos 6 caracteres.",
    "auth/user-not-found": "No hay ninguna cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
    "auth/requires-recent-login": "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña.",
    "permission-denied": "La base de datos rechazó la operación por permisos. Comprueba que el contenido de firestore.rules esté publicado en Firebase Console → Firestore Database → Reglas.",
  };
  return map[code] || (e && e.message) || "Ha ocurrido un error inesperado.";
}
