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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/**
 * Da de alta una cuenta nueva y crea su perfil en Firestore.
 * Lanza un Error con un mensaje en español listo para mostrar si algo falla.
 */
export async function signUp({ name, email, password }) {
  await checkAllowedDomain(email);

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new Error(translateAuthError(e));
  }

  await updateProfile(cred.user, { displayName: name });

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
    throw new Error(translateAuthError(e));
  }

  return cred.user;
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
 *  - null si no hay nadie autenticado
 *  - { uid, email, name, role, ... } con el perfil de Firestore si hay sesión
 * Devuelve una función para cancelar la suscripción.
 */
export function onAuthChange(callback) {
  let unsubProfile = null;
  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
    if (!user) {
      callback(null);
      return;
    }
    unsubProfile = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) {
        callback({ uid: user.uid, email: user.email, name: user.displayName || user.email, role: "miembro" });
        return;
      }
      callback({ uid: user.uid, ...snap.data() });
    });
  });
  return () => { unsubAuth(); if (unsubProfile) unsubProfile(); };
}

function translateAuthError(e) {
  const code = e && e.code ? e.code : "";
  const map = {
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
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
