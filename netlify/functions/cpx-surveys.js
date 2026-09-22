const crypto = require("crypto");
const { admin } = require("./_firebaseAdmin");

const CPX_APP_ID = "36281";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // 1) Verificar quién es el usuario con su token de Firebase
  const authHeader = event.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: "No autenticado" });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(token)).uid;
  } catch (err) {
    return json(401, { error: "Token inválido" });
  }

  // 2) CPX exige la IP y el navegador reales del usuario
  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    (event.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const userAgent = event.headers["user-agent"] || "";

  // 3) Firma de seguridad: md5(ext_user_id-CPX_SECURE_HASH)
  const secureHash = crypto
    .createHash("md5")
    .update(`${uid}-${process.env.CPX_SECURE_HASH}`)
    .digest("hex");

  const params = new URLSearchParams({
    app_id: CPX_APP_ID,
    ext_user_id: uid,
    output_method: "api",
    ip_user: ip,
    user_agent: userAgent,
    limit: "12",
    secure_hash: secureHash,
  });

  // 4) Pedir la lista a CPX
  let data;
  try {
    const res = await fetch(
      `https://live-api.cpx-research.com/api/get-surveys.php?${params.toString()}`
    );
    if (!res.ok) return json(502, { error: "CPX no respondió" });
    data = await res.json();
  } catch (err) {
    return json(502, { error: "Error al consultar CPX" });
  }

  if (!data || data.status !== "success") {
    return json(502, { error: "Respuesta inválida de CPX" });
  }

  // 5) Devolver solo lo necesario, con los puntos calculados igual que en el postback (x100)
  const surveys = (data.surveys || [])
    .filter((s) => String(s.webcam) !== "1") // sin encuestas que pidan cámara
    .map((s) => ({
      id: s.id,
      minutes: Number(s.loi) || 0,
      points: Math.round(parseFloat(s.payout || "0") * 100),
      href: s.href_new || s.href,
      top: s.top === 1,
    }));

  return json(200, { surveys });
};
