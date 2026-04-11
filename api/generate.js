module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imgB64, imgType } = req.body || {};

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    const hordeKey = process.env.AI_HORDE_API_KEY;

    // ─────────────────────────────
    // 1) OPENROUTER (TEXT / HTML)
    // ─────────────────────────────
    const messages = [
      {
        role: 'user',
        content: imgB64
          ? [
              { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
              { type: 'text', text: prompt }
            ]
          : prompt
      }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://my-ai-app-five-nu.vercel.app',
        'X-Title': 'ForYouPage'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        max_tokens: 4096,
        messages
      }),
    });

    let html = '';

    if (response.ok) {
      const data = await response.json();
      html = data.choices?.[0]?.message?.content || '';
    }

    // ─────────────────────────────
    // 2) FALLBACK → AI HORDE
    // ─────────────────────────────
    if (!html || html.length < 1) {
      if (!hordeKey) {
        return res.status(500).json({ error: 'No AI response and AI_HORDE_API_KEY missing' });
      }

      const hordeRes = await fetch('https://stablehorde.net/api/v2/generate/async', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': hordeKey,
          'Client-Agent': 'vercel-app:1.0'
        },
        body: JSON.stringify({
          prompt,
          params: {
            n: 1,
            width: 768,
            height: 768,
            steps: 20
          }
        })
      });

      const hordeData = await hordeRes.json();

      return res.status(200).json({
        source: 'ai_horde',
        job_id: hordeData.id || null,
        message: 'Image generation started (AI Horde)',
        data: hordeData
      });
    }

    // ─────────────────────────────
    // 3) CLEAN HTML OUTPUT
    // ─────────────────────────────
    html = html.replace(/```html\s*/gi, '').replace(/```\s*/g, '').trim();

    if (imgB64) {
      html = html.replace('PRODUCT_IMAGE_BASE64', imgB64);
    }

    return res.status(200).json({
      source: 'openrouter',
      html
    });

  } catch (err) {
    console.error('ERROR:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
