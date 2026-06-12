import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCABcbEj4PxgNkkF8dHTfsxFqLU-12jy4o",
  authDomain: "health-os-610f6.firebaseapp.com",
  projectId: "health-os-610f6",
  storageBucket: "health-os-610f6.firebasestorage.app",
  messagingSenderId: "469926436240",
  appId: "1:469926436240:web:de038212e2e361447a2715",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export async function registerUser(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await initUserData(cred.user.uid);
  return cred.user;
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

export async function updateUserName(name) {
  await updateProfile(auth.currentUser, { displayName: name });
}

export { onAuthStateChanged };

// ─── Firestore helpers ────────────────────────────────────────────────────────
function userRef(uid) {
  return doc(db, "users", uid);
}

async function initUserData(uid) {
  const ref = userRef(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      metrics: defaultMetrics(),
      logs: {},
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getUserData(uid) {
  const snap = await getDoc(userRef(uid));
  if (snap.exists()) return snap.data();
  await initUserData(uid);
  return getUserData(uid);
}

export function subscribeUserData(uid, callback) {
  return onSnapshot(userRef(uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

export async function saveUserData(uid, data) {
  await setDoc(userRef(uid), data, { merge: true });
}

export async function patchUserData(uid, partial) {
  await updateDoc(userRef(uid), partial);
}

// ─── Default metrics ──────────────────────────────────────────────────────────
function defaultMetrics() {
  return [
    { id: "agua", name: "Agua", icon: "ti-droplet", type: "quantity", unit: "ml", goal: 3000, weight: 20, color: "blue", archived: false },
    { id: "cepillado", name: "Cepillado", icon: "ti-tooth", type: "counter", goal: 3, weight: 15, color: "teal", archived: false },
    { id: "ejercicio", name: "Ejercicio", icon: "ti-run", type: "check", weight: 20, color: "coral", archived: false },
    { id: "sueno", name: "Sueño", icon: "ti-moon", type: "time", goal: 420, unit: "min", weight: 20, color: "purple", archived: false },
    { id: "vitaminas", name: "Vitaminas", icon: "ti-pill", type: "check", weight: 10, color: "green", archived: false },
    { id: "pasos", name: "Pasos", icon: "ti-shoe", type: "number", goal: 10000, weight: 10, color: "amber", archived: false },
    { id: "energia", name: "Energía", icon: "ti-bolt", type: "scale", min: 1, max: 10, weight: 5, color: "pink", archived: false },
  ];
}
