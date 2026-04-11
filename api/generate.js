export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, imgB64, imgType } = req.body;

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    // ── Build parts ──
    const parts = [];

    // إذا كانت الصورة موجودة أضفها أولاً
    if (imgB64 && imgB64.length > 0) {
      parts.push({
        inlineData: {
          mimeType: imgType || 'image/jpeg',
          data: imgB64,
        },
      });
    }

    // أضف الـ prompt النصي
    parts.push({ text: prompt });

    // ── Call Gemini API ──
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return res.status(502).json({
        error: `Gemini API error: ${response.status}`,
        details: errText,
      });
    }

    const data = await response.json();

    // ── Extract text from Gemini response ──
    const rawText = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('') || '';

    if (!rawText) {
      console.error('Empty Gemini response:', JSON.stringify(data));
      return res.status(502).json({ error: 'Empty response from Gemini' });
    }

    // نظف markdown fences إن وجدت
    const html = rawText
      .replace(/```html\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    return res.status(200).json({ html });

  } catch (err) {
    console.error('generate.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
