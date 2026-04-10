export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  const { prompt, imgB64, imgType } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }

  // ✅ هذا هو الصحيح (مهم)
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${key}`;

  const parts = [];

  // صورة (اختياري)
  if (imgB64 && imgType) {
    parts.push({
      inlineData: {
        mimeType: imgType,
        data: imgB64
      }
    });
  }

  // النص
  parts.push({ text: prompt });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: parts
          }
        ]
      })
    });

    const data = await response.json();

    // Debug إذا كان خطأ
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return res.status(200).json({
      html: text,
      result: text
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
