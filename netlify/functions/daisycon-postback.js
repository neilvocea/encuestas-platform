const crypto = require("crypto");
const { admin, db } = require("./_firebaseAdmin");

// Solo aceptamos avisos de tu medio principal (el de la landing aprobada).
const MEDIA_ID = "431759";

// Cuántos puntos de Vocea se dan por cada 1 EUR que Daisycon te paga.
// Misma lógica que CPX y TimeWall: el usuario recibe la mitad del valor.
const POINTS_PER_EUR = 50;

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const { secret, ti, ws, ta, st, wi, sr } = p;

  // 1) Daisycon no manda firma, así que usamos una clave secreta nuestra
  //    puesta en la URL del webhook y guardada en Netlify.
  if (!process.env.DAISYCON_SECRET || !safeEqual(secret, process.env.DAISYCON_SECRET)) {
    return { statusCode: 403, body: "Forbidden" };
  }

  // 2) Ignorar avisos de otros medios (y el aviso de prueba de Daisycon).
  if (wi !== MEDIA_ID) {
    return { statusCode: 200, body: "ignored" };
  }

  if (!ti || !ws) {
    return { statusCode: 400, body: "Faltan parámetros" };
  }

  const commission = parseFloat(String(ta || "").replace(",", "."));
  if (Number.isNaN(commission)) {
    return { statusCode: 400, body: "Comisión inválida" };
  }

  const userRef = db.collection("users").doc(ws);
  const txRef = db.collection("transactions").doc(`daisycon_${ti}`);

  await db.runTransaction(async (t) => {
    const [txSnap, userSnap] = await Promise.all([t.get(txRef), t.get(userRef)]);

    // Si el Sub ID no corresponde a un usuario real, no tocamos nada.
    if (!userSnap.exists) return;

    // Caso A: primera vez que vemos esta transacción -> sumar puntos.
    if (!txSnap.exists) {
      const disapproved = st === "A";
      const points = disapproved ? 0 : Math.round(commission * POINTS_PER_EUR);

      t.set(txRef, {
        provider: "daisycon",
        ti,
        userid: ws,
        status: st || null,
        points,
        credited: !disapproved,
        createdAt: new Date().toISOString(),
      });

      if (points > 0) {
        t.set(userRef, { points: admin.firestore.FieldValue.increment(points) }, { merge: true });
      }
      return;
    }

    // Caso B: ya la conocíamos -> es una actualización de estado.
    const tx = txSnap.data();

    // Daisycon la desaprobó después de haber dado los puntos: los quitamos (una sola vez).
    if (st === "A" && tx.credited) {
      t.update(txRef, {
        status: "A",
        credited: false,
        reason: sr || null,
        reversedAt: new Date().toISOString(),
      });
      t.set(userRef, { points: admin.firestore.FieldValue.increment(-tx.points) }, { merge: true });
      return;
    }

    // Cualquier otro cambio (por ejemplo pasó a "G" aprobado): solo registramos el estado.
    t.update(txRef, { status: st || tx.status });
  });

  return { statusCode: 200, body: "OK" };
};
