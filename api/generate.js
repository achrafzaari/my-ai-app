module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, imgB64, imgType } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const hfKey = process.env.HF_API_KEY;
    if (!openrouterKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

    const hasImg = imgB64 && imgB64.length > 0;

    // ══════════════════════════════════════════
    // STEP 1: فهم المنتج (سريع)
    // ══════════════════════════════════════════
    let productDesc = 'professional product';

    if (hasImg && hfKey) {
      try {
        const descRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openrouterKey}`,
            'HTTP-Referer': 'https://my-ai-app-five-nu.vercel.app',
            'X-Title': 'ForYouPage'
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            max_tokens: 80,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
                { type: 'text', text: 'Describe this product precisely in English: brand, type, color, shape, packaging. One sentence only.' }
              ]
            }]
          })
        });
        if (descRes.ok) {
          const d = await descRes.json();
          productDesc = d.choices?.[0]?.message?.content?.trim() || productDesc;
          console.log('Product:', productDesc);
        }
      } catch(e) { console.error('Desc error:', e.message); }
    }

    // ══════════════════════════════════════════
    // STEP 2: توليد الصور و HTML بالتوازي
    // ══════════════════════════════════════════
    const generateImage = async (imgPrompt, index) => {
      if (!hfKey) return null;
      try {
        const hfRes = await fetch(
          'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputs: imgPrompt,
              parameters: { width: 512, height: 512, num_inference_steps: 4, guidance_scale: 0 }
            })
          }
        );
        console.log(`Image ${index} HF status:`, hfRes.status);
        if (!hfRes.ok) return null;
        const buf = await hfRes.arrayBuffer();
        return { index, b64: Buffer.from(buf).toString('base64'), type: 'image/jpeg' };
      } catch(e) { console.error(`Image ${index} error:`, e.message); return null; }
    };

    const generateHTML = async () => {
      const imagesNote = hasImg
        ? '\n\nمهم: لا تضع أي img tag في الكود — الصور ستُحقن تلقائياً.'
        : '';
      const messages = hasImg ? [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
          { type: 'text', text: prompt + imagesNote }
        ]
      }] : [{ role: 'user', content: prompt + imagesNote }];

      const res2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://my-ai-app-five-nu.vercel.app',
          'X-Title': 'ForYouPage'
        },
        body: JSON.stringify({ model: 'openrouter/auto', max_tokens: 12000, messages })
      });
      console.log('OpenRouter status:', res2.status);
      if (!res2.ok) throw new Error(`OpenRouter ${res2.status}`);
      const d = await res2.json();
      return d.choices?.[0]?.message?.content || '';
    };

    // تشغيل الصور و HTML بالتوازي
    const [rawText, img1, img2] = await Promise.all([
      generateHTML(),
      hasImg && hfKey ? generateImage(`professional product photography of ${productDesc}, white background, studio lighting, sharp focus, 4k`, 1) : Promise.resolve(null),
      hasImg && hfKey ? generateImage(`${productDesc}, lifestyle shot, elegant setting, natural lighting, beautiful`, 2) : Promise.resolve(null),
    ]);

    if (!rawText) return res.status(502).json({ error: 'Empty response from AI' });

    let html = rawText.replace(/```html\s*/gi, '').replace(/```\s*/g, '').trim();

    const generatedImages = [img1, img2].filter(Boolean);
    console.log(`Generated ${generatedImages.length} images`);

    // ══════════════════════════════════════════
    // STEP 3: حقن الصور في الصفحة
    // ══════════════════════════════════════════
    const makeImg = (img) =>
      `<div style="max-width:460px;margin:24px auto;padding:0 16px;"><img src="data:${img.type};base64,${img.b64}" alt="صورة المنتج" style="width:100%;height:auto;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:block;"></div>`;

    if (generatedImages.length > 0) {
      // صورة 1 بعد h1
      html = html.replace(/(<\/h1>)/i, `$1\n${makeImg(generatedImages[0])}`);
      // صورة 2 قبل footer أو نهاية body
      if (generatedImages[1]) {
        if (html.includes('<footer')) {
          html = html.replace(/(<footer)/i, `${makeImg(generatedImages[1])}\n$1`);
        } else {
          html = html.replace('</body>', `${makeImg(generatedImages[1])}\n</body>`);
        }
      }
    } else if (hasImg) {
      const imgDataUrl = `data:${imgType};base64,${imgB64}`;
      html = html.replace(/(<\/h1>)/i, `$1\n<div style="max-width:460px;margin:24px auto;padding:0 16px;"><img src="${imgDataUrl}" alt="صورة المنتج" style="width:100%;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);display:block;"></div>`);
    }

    if (!html.includes('</html>')) html += '\n</body></html>';

    return res.status(200).json({ html, imagesGenerated: generatedImages.length });

  } catch (err) {
    console.error('ERROR:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
