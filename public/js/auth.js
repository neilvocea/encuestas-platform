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
const surveyWaiting = document.getElementById("survey-waiting");
const openExternal = document.getElementById("open-external");
const backBtn = document.getElementById("back-btn");
const toast = document.getElementById("toast");

let currentUserId = null;
let unsubscribePoints = null;
let pointsBeforeSurvey = null;
let surveyWindow = null; // referencia a la pestaña de la encuesta, para poder cerrarla sola

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

// ---------- Abrir una encuesta en pestaña nueva y volver solo a Vocea ----------
// Algunos proveedores (TimeSurveys dentro de TimeWall, por ejemplo) rompen el
// iframe y se apoderan de toda la pantalla. Por eso abrimos la encuesta en una
// PESTAÑA NUEVA: la pestaña de Vocea queda viva de fondo, esperando.
//
// IMPORTANTE: ni CPX ni TheoremReach ni TimeWall avisan de forma confiable
// cuando un usuario es DESCALIFICADO (solo avisan cuando hay pago de por
// medio). Por eso NO podemos depender solo del postback para saber que la
// encuesta terminó. En cambio, detectamos que el usuario volvió a mirar la
// pestaña de Vocea (la tocó o le volvió el foco) y ahí damos la encuesta por
// terminada, haya sumado puntos o no.
let surveyPollId = null;

function openSurvey(url) {
  pointsBeforeSurvey = Number(userPointsLabel.textContent) || 0;
  openExternal.href = url;
  surveyWindow = window.open(url, "_blank");
  showView(surveyView);
  watchForPointsChange();
  watchForUserReturn();
}

// Vía 1 (la "buena noticia" si llega a tiempo): si el postback suma puntos
// mientras seguimos esperando, mostramos cuánto ganó.
function watchForPointsChange() {
  if (unsubscribePoints) unsubscribePoints();
  unsubscribePoints = onSnapshot(doc(db, "users", currentUserId), (snap) => {
    const points = snap.exists() ? snap.data().points ?? 0 : 0;
    userPointsLabel.textContent = points;
    if (pointsBeforeSurvey !== null && points !== pointsBeforeSurvey && !surveyView.classList.contains("hidden")) {
      const gained = points - pointsBeforeSurvey;
      finishSurvey(gained > 0 ? `¡Ganaste ${gained} pts!` : null);
    }
  });
}

// Vía 2 (la que SIEMPRE funciona, incluso con descalificaciones): en cuanto
// el usuario vuelve a esta pestaña, o la pestaña que abrimos se cerró sola,
// damos la encuesta por terminada.
function watchForUserReturn() {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleWindowFocus);
  // Respaldo: si el usuario cierra la pestaña de la encuesta en vez de volver
  // a esta, lo detectamos igual revisando cada segundo.
  surveyPollId = setInterval(() => {
    if (surveyWindow && surveyWindow.closed) {
      finishSurvey(null);
    }
  }, 1000);
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible" && !surveyView.classList.contains("hidden")) {
    finishSurvey(null);
  }
}

function handleWindowFocus() {
  if (!surveyView.classList.contains("hidden")) {
    finishSurvey(null);
  }
}

// Se llama una sola vez, venga por donde venga (puntos, cierre de pestaña o
// regreso del usuario). Limpia todo y vuelve a la pantalla de proveedores.
function finishSurvey(successMessage) {
  if (surveyView.classList.contains("hidden")) return; // ya se procesó
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("focus", handleWindowFocus);
  if (surveyPollId) {
    clearInterval(surveyPollId);
    surveyPollId = null;
  }
  if (unsubscribePoints) {
    unsubscribePoints();
    unsubscribePoints = null;
  }
  pointsBeforeSurvey = null;
  closeSurveyWindow();
  showToast(successMessage || "De vuelta en Vocea.");
  returnToVocea();
}

function closeSurveyWindow() {
  // Solo podemos cerrar la pestaña que nosotros mismos abrimos con window.open.
  if (surveyWindow && !surveyWindow.closed) {
    surveyWindow.close();
  }
  surveyWindow = null;
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

    if (provider === "timewall") {
      const url = `https://timewall.io/users/login?oid=cd51d14390ace069&uid=${currentUserId}`;
      openSurvey(url);
    }
  });
});

cpxBackBtn?.addEventListener("click", () => showView(providersView));
cpxRefreshBtn?.addEventListener("click", loadCpxSurveys);

// Botón "Volver" manual (por si el usuario quiere volver ya mismo)
backBtn?.addEventListener("click", () => finishSurvey(null));

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
