module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── DEBUG: log everything ──
    console.log('=== generate.js called ===');
    console.log('body keys:', Object.keys(req.body || {}));

    const { prompt, userEmail, imgB64, imgType } = req.body || {};

    if (!prompt) {
      console.log('ERROR: no prompt');
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    console.log('apiKey exists:', !!apiKey);
    console.log('apiKey length:', apiKey ? apiKey.length : 0);

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const parts = [];
    if (imgB64 && imgB64.length > 0) {
      parts.push({ inlineData: { mimeType: imgType || 'image/jpeg', data: imgB64 } });
    }
    parts.push({ text: prompt });

    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log('calling Gemini model:', model);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 8192 },
      }),
    });

    console.log('Gemini response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini error body:', errText);
      return res.status(502).json({
        error: `Gemini API error: ${response.status}`,
        model,
        details: errText,
      });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    if (!rawText) {
      console.error('Empty response:', JSON.stringify(data));
      return res.status(502).json({ error: 'Empty response from Gemini' });
    }

    const html = rawText.replace(/```html\s*/gi, '').replace(/```\s*/g, '').trim();
    console.log('Success! html length:', html.length);

    return res.status(200).json({ html });

  } catch (err) {
    console.error('CATCH ERROR:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
