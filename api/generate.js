module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, imgB64, imgType } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const hfKey = process.env.HF_API_KEY;
    if (!hfKey) return res.status(500).json({ error: 'HF_API_KEY not configured' });

    const hasImg = imgB64 && imgB64.length > 0;
    let productDesc = 'professional product';
    let generatedImages = [];

    // ══════════════════════════════════════════
    // STEP 1: فهم المنتج من الصورة
    // ══════════════════════════════════════════
    if (hasImg) {
      try {
        const r = await fetch(
          'https://router.huggingface.co/hf-inference/models/Salesforce/blip-image-captioning-large',
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: { image: imgB64 } })
          }
        );
        console.log('Caption status:', r.status);
        if (r.ok) {
          const d = await r.json();
          productDesc = d?.[0]?.generated_text || productDesc;
          console.log('Product:', productDesc);
        }
      } catch(e) { console.error('Caption error:', e.message); }
    }

    // ══════════════════════════════════════════
    // STEP 2: توليد HTML + صورتين بالتوازي
    // ══════════════════════════════════════════
    const generateHTML = async () => {
      const note = hasImg ? '\n\nمهم: لا تضع أي img tag — الصور ستُحقن تلقائياً.' : '';
      const fullPrompt = prompt + note;

      const r = await fetch(
        'https://router.huggingface.co/hf-inference/models/mistralai/Mistral-7B-Instruct-v0.3/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'mistralai/Mistral-7B-Instruct-v0.3',
            messages: [{ role: 'user', content: fullPrompt }],
            max_tokens: 8192,
            stream: false
          })
        }
      );
      console.log('HF text status:', r.status);
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`HF text ${r.status}: ${err}`);
      }
      const d = await r.json();
      return d.choices?.[0]?.message?.content || '';
    };

    const generateImage = async (imgPrompt, index) => {
      try {
        const r = await fetch(
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
        console.log(`Image ${index} HF status:`, r.status);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return { index, b64: Buffer.from(buf).toString('base64'), type: 'image/jpeg' };
      } catch(e) { console.error(`Image ${index} error:`, e.message); return null; }
    };

    const [rawText, img1, img2] = await Promise.all([
      generateHTML(),
      hasImg ? generateImage(`professional product photography of ${productDesc}, white background, studio lighting, sharp focus, 4k`, 1) : Promise.resolve(null),
      hasImg ? generateImage(`${productDesc}, lifestyle shot, elegant setting, natural lighting`, 2) : Promise.resolve(null),
    ]);

    if (!rawText) return res.status(502).json({ error: 'Empty response from HF' });

    let html = rawText.replace(/```html\s*/gi, '').replace(/```\s*/g, '').trim();

    generatedImages = [img1, img2].filter(Boolean);
    console.log(`Generated ${generatedImages.length} images`);

    // ══════════════════════════════════════════
    // STEP 3: حقن الصور
    // ══════════════════════════════════════════
    const makeImg = (img) =>
      `<div style="max-width:460px;margin:24px auto;padding:0 16px;"><img src="data:${img.type};base64,${img.b64}" alt="صورة المنتج" style="width:100%;height:auto;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:block;"></div>`;

    if (generatedImages.length > 0) {
      html = html.replace(/(<\/h1>)/i, `$1\n${makeImg(generatedImages[0])}`);
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
