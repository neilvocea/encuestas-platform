const crypto = require("crypto");
const { admin, db } = require("./_firebaseAdmin");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { userid, txid, revenue, currency, hash, type } = params;

  if (!userid || !txid || !revenue || !hash) {
    return { statusCode: 400, body: "Faltan parámetros" };
  }

  // TimeWall pide usar el valor de "revenue" TAL CUAL llega (sin redondear
  // ni reformatear), porque así lo usaron ellos para calcular el hash.
  const expectedHash = crypto
    .createHash("sha256")
    .update(`${userid}${revenue}${process.env.TIMEWALL_SECRET_KEY}`)
    .digest("hex");

  if (expectedHash !== hash) {
    return { statusCode: 403, body: "Firma inválida" };
  }

  const userRef = db.collection("users").doc(userid);
  const txRef = db.collection("transactions").doc(`timewall_${txid}`);

  await db.runTransaction(async (t) => {
    const txDoc = await t.get(txRef);
    if (txDoc.exists) return; // evita sumar el mismo postback dos veces

    // "currency" ya viene convertido a tu moneda interna (Puntos), según la
    // tasa que configuraste en el panel de TimeWall (50 Puntos = $1).
    // Si en algún momento TimeWall no manda "currency", usamos revenue * 50
    // como respaldo.
    const points = currency
      ? Math.round(parseFloat(currency))
      : Math.round(parseFloat(revenue) * 50);

    t.set(txRef, {
      provider: "timewall",
      txid,
      userid,
      type: type || null,
      points,
      createdAt: new Date().toISOString(),
    });

    t.set(
      userRef,
      { points: admin.firestore.FieldValue.increment(points) },
      { merge: true }
    );
  });

  return { statusCode: 200, body: "1" };
};
