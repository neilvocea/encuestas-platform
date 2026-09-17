const crypto = require("crypto");
const { admin, db } = require("./_firebaseAdmin");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { status, trans_id, user_id, amount_local, hash } = params;

  if (!status || !trans_id || !user_id || !hash) {
    return { statusCode: 400, body: "Faltan parámetros" };
  }

  const expectedHash = crypto
    .createHash("md5")
    .update(`${trans_id}-${process.env.CPX_SECURE_HASH}`)
    .digest("hex");

  if (expectedHash !== hash) {
    return { statusCode: 403, body: "Firma inválida" };
  }

  const userRef = db.collection("users").doc(user_id);
  const txRef = db.collection("transactions").doc(`cpx_${trans_id}`);

  await db.runTransaction(async (t) => {
    const txDoc = await t.get(txRef);
    if (txDoc.exists) return;

    const points = Math.round(parseFloat(amount_local || "0") * 100);
    const delta = status === "1" ? points : -points;

    t.set(txRef, {
      provider: "cpx",
      trans_id,
      user_id,
      status,
      points: delta,
      createdAt: new Date().toISOString(),
    });

    t.set(
      userRef,
      { points: admin.firestore.FieldValue.increment(delta) },
      { merge: true }
    );
  });

  return { statusCode: 200, body: "1" };
};
