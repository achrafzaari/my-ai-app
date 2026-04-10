export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

  const { prompt, imgB64, imgType } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

  const parts = [];
  if (imgB64 && imgType) {
    parts.push({ inlineData: { mimeType: imgType, data: imgB64 } });
  }
  parts.push({ text: prompt });

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }] })
    });

    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    res.status(200).json({ html: text, result: text });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
