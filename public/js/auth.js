import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const logoutBtn = document.getElementById("logout-btn");
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const userEmailLabel = document.getElementById("user-email");

const providersView = document.getElementById("providers-view");
const surveyView = document.getElementById("survey-view");
const surveyFrame = document.getElementById("survey-frame");
const backBtn = document.getElementById("back-btn");

let currentUserId = null;

// Arma la URL de cada proveedor según su App ID / API Key
function buildProviderUrl(provider, userId) {
  if (provider === "cpx") {
    return `https://offers.cpx-research.com/index.php?app_id=36281&ext_user_id=${userId}`;
  }
  if (provider === "theoremreach") {
    return `https://theoremreach.com/respondent_entry/direct?api_key=bf177bbe5bb261f308aed4e323d9&user_id=${userId}`;
  }
  return "";
}

// Al tocar una tarjeta, se carga esa encuesta y se muestra la vista de encuesta
document.querySelectorAll(".provider-card").forEach((card) => {
  card.addEventListener("click", () => {
    if (!currentUserId) return;
    const provider = card.dataset.provider;
    surveyFrame.src = buildProviderUrl(provider, currentUserId);
    providersView.classList.add("hidden");
    surveyView.classList.remove("hidden");
  });
});

// Botón "Volver": oculta la encuesta y muestra las tarjetas de nuevo
backBtn?.addEventListener("click", () => {
  surveyFrame.src = "";
  surveyView.classList.add("hidden");
  providersView.classList.remove("hidden");
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      email,
      points: 0,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    alert(err.message);
  }
});

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert(err.message);
  }
});

logoutBtn?.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserId = user.uid;
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    userEmailLabel.textContent = user.email;
    const snap = await getDoc(doc(db, "users", user.uid));
    document.getElementById("user-points").textContent = snap.exists()
      ? snap.data().points ?? 0
      : 0;
  } else {
    currentUserId = null;
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    providersView.classList.remove("hidden");
    surveyView.classList.add("hidden");
  }
});
