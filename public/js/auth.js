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
  onSnapshot,
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
const userPointsLabel = document.getElementById("user-points");

const providersView = document.getElementById("providers-view");
const cpxListView = document.getElementById("cpx-list-view");
const cpxList = document.getElementById("cpx-list");
const cpxStatus = document.getElementById("cpx-status");
const cpxBackBtn = document.getElementById("cpx-back-btn");
const cpxRefreshBtn = document.getElementById("cpx-refresh-btn");

const surveyView = document.getElementById("survey-view");
const surveyFrame = document.getElementById("survey-frame");
const openExternal = document.getElementById("open-external");
const backBtn = document.getElementById("back-btn");
const toast = document.getElementById("toast");

let currentUserId = null;
let unsubscribePoints = null;
let pointsBeforeSurvey = null;

// ---------- Vistas ----------
function showView(view) {
  providersView.classList.add("hidden");
  cpxListView.classList.add("hidden");
  surveyView.classList.add("hidden");
  view.classList.remove("hidden");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ---------- CPX: lista propia de encuestas ----------
async function loadCpxSurveys() {
  cpxStatus.textContent = "Buscando encuestas…";
  cpxList.innerHTML = "";
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/.netlify/functions/cpx-surveys", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data.surveys) {
      cpxStatus.textContent =
        "No pudimos cargar las encuestas ahora. Probá de nuevo en un momento.";
      return;
    }

    if (data.surveys.length === 0) {
      cpxStatus.textContent =
        "No hay encuestas disponibles para tu perfil en este momento. Volvé a intentar más tarde.";
      return;
    }

    cpxStatus.textContent = `${data.surveys.length} encuestas disponibles`;
    data.surveys.forEach((s) => {
      const card = document.createElement("div");
      card.className = "survey-card";
      card.innerHTML = `
        <h3>${s.top ? "⭐ " : ""}Encuesta</h3>
        <div class="survey-row"><span>Duración</span><strong>${s.minutes} min</strong></div>
        <div class="survey-row"><span>Puntos</span><strong>${s.points} pts</strong></div>
        <button data-href="${s.href}">Empezar</button>
      `;
      card.querySelector("button").addEventListener("click", (e) => {
        openSurvey(e.currentTarget.dataset.href);
      });
      cpxList.appendChild(card);
    });
  } catch (err) {
    cpxStatus.textContent = "Error de conexión. Probá de nuevo.";
  }
}

// ---------- Abrir una encuesta y volver solo a Vocea ----------
function openSurvey(url) {
  pointsBeforeSurvey = Number(userPointsLabel.textContent) || 0;
  surveyFrame.src = url;
  openExternal.href = url;
  showView(surveyView);
  watchForPointsChange();
}

// Como CPX/TheoremReach no siempre pueden redirigir de vuelta a Vocea,
// detectamos que la encuesta terminó cuando cambian los puntos del usuario
// (el postback ya corrió) y volvemos solos a la pantalla anterior.
function watchForPointsChange() {
  if (unsubscribePoints) unsubscribePoints();
  unsubscribePoints = onSnapshot(doc(db, "users", currentUserId), (snap) => {
    const points = snap.exists() ? snap.data().points ?? 0 : 0;
    userPointsLabel.textContent = points;
    if (pointsBeforeSurvey !== null && points !== pointsBeforeSurvey && !surveyView.classList.contains("hidden")) {
      const gained = points - pointsBeforeSurvey;
      pointsBeforeSurvey = null;
      surveyFrame.src = "";
      showToast(gained > 0 ? `¡Ganaste ${gained} pts!` : "La encuesta no se acreditó esta vez.");
      returnToVocea();
    }
  });
}

function returnToVocea() {
  showView(providersView);
}

// ---------- Tarjetas de proveedores ----------
document.querySelectorAll(".provider-card").forEach((card) => {
  card.addEventListener("click", () => {
    if (!currentUserId) return;
    const provider = card.dataset.provider;

    if (provider === "cpx") {
      showView(cpxListView);
      loadCpxSurveys();
      return;
    }

    if (provider === "theoremreach") {
      const url = `https://theoremreach.com/respondent_entry/direct?api_key=bf177bbe5bb261f308aed4e323d9&user_id=${currentUserId}`;
      openSurvey(url);
    }
  });
});

cpxBackBtn?.addEventListener("click", () => showView(providersView));
cpxRefreshBtn?.addEventListener("click", loadCpxSurveys);

// Botón "Volver" manual (por si el usuario no quiere esperar el cambio de puntos)
backBtn?.addEventListener("click", () => {
  if (unsubscribePoints) unsubscribePoints();
  surveyFrame.src = "";
  pointsBeforeSurvey = null;
  returnToVocea();
});

// ---------- Auth ----------
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
    userPointsLabel.textContent = snap.exists() ? snap.data().points ?? 0 : 0;
    showView(providersView);
  } else {
    if (unsubscribePoints) unsubscribePoints();
    currentUserId = null;
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    showView(providersView);
  }
});
