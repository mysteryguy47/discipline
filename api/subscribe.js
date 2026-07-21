const { checkAuth, writeBlobJson } = require("./_lib");

const SUB_PATH = "discipline/subscription.json";

module.exports = async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "invalid push subscription" });

  await writeBlobJson(SUB_PATH, sub);
  return res.status(200).json({ ok: true });
};
