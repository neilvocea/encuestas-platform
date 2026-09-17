const crypto = require("crypto");
const { admin, db } = require("./_firebaseAdmin");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { user_id, transaction_id, reward, hash } = params;

  if (!user_id || !transaction_id || !reward || !hash) {
    return { statusCode: 400, body: "Faltan parámetros" };
  }

  const expectedHash = crypto
    .createHash("md5")
    .update(`${transaction_id}${user_id}${process.env.THEOREMREACH_SECRET_KEY}`)
    .digest("hex");

  if (expectedHash !== hash) {
    return { statusCode: 403, body: "Firma inválida" };
  }

  const userRef = db.collection("users").doc(user_id);
  const txRef = db.collection("transactions").doc(`tr_${transaction_id}`);

  await db.runTransaction(async (t) => {
    const txDoc = await t.get(txRef);
    if (txDoc.exists) return;

    const points = Math.round(parseFloat(reward || "0"));

    t.set(txRef, {
      provider: "theoremreach",
      transaction_id,
      user_id,
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
