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
    // STEP 1: توليد صورة احترافية بـ Hugging Face
    // ══════════════════════════════════════════
    let generatedImgB64 = null;

    if (hasImg && hfKey) {
      try {
        console.log('Generating product image with HF...');

        // أولاً: نستخدم OpenRouter لفهم المنتج من الصورة
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
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
                { type: 'text', text: 'Describe this product in 1 sentence in English for image generation. Focus on: type, color, style. Example: "white modern running shoe with blue stripes". Only the description, nothing else.' }
              ]
            }]
          })
        });

        let productDesc = 'professional product photo on white background';
        if (descRes.ok) {
          const descData = await descRes.json();
          productDesc = descData.choices?.[0]?.message?.content?.trim() || productDesc;
          console.log('Product description:', productDesc);
        }

        // ثانياً: نولد صورة احترافية بـ Hugging Face FLUX
        const hfRes = await fetch(
          'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hfKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              inputs: `professional product photography of ${productDesc}, clean white background, studio lighting, high quality, commercial photo, 4k`,
              parameters: {
                width: 512,
                height: 512,
                num_inference_steps: 4,
                guidance_scale: 0
              }
            })
          }
        );

        console.log('HF status:', hfRes.status);

        if (hfRes.ok) {
          const imgBuffer = await hfRes.arrayBuffer();
          generatedImgB64 = Buffer.from(imgBuffer).toString('base64');
          console.log('HF image generated successfully, size:', generatedImgB64.length);
        } else {
          const hfErr = await hfRes.text();
          console.error('HF error:', hfRes.status, hfErr);
          // fallback للصورة الأصلية
          generatedImgB64 = null;
        }

      } catch (imgErr) {
        console.error('Image generation error:', imgErr.message);
        generatedImgB64 = null;
      }
    }

    // الصورة النهائية: المولدة أو الأصلية
    const finalImgB64 = generatedImgB64 || imgB64 || null;
    const finalImgType = generatedImgB64 ? 'image/jpeg' : (imgType || 'image/jpeg');

    // ══════════════════════════════════════════
    // STEP 2: بناء الـ messages لـ OpenRouter
    // ══════════════════════════════════════════
    const messages = [];

    if (hasImg) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
          { type: 'text', text: prompt }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    // ══════════════════════════════════════════
    // STEP 3: توليد الـ HTML بـ OpenRouter
    // ══════════════════════════════════════════
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://my-ai-app-five-nu.vercel.app',
        'X-Title': 'ForYouPage'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        max_tokens: 8192,
        messages
      })
    });

    console.log('OpenRouter status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenRouter error:', errText);
      return res.status(502).json({ error: `OpenRouter error: ${response.status}`, details: errText });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    if (!rawText) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    let html = rawText.replace(/```html\s*/gi, '').replace(/```\s*/g, '').trim();

    // ══════════════════════════════════════════
    // STEP 4: استبدال placeholder بالصورة
    // الصورة المولدة بـ HF أو الأصلية كـ fallback
    // ══════════════════════════════════════════
    if (finalImgB64) {
      html = html.replace(
        'PRODUCT_IMAGE_BASE64',
        `data:${finalImgType};base64,${finalImgB64}`
      );
    }

    return res.status(200).json({
      html,
      imageGenerated: !!generatedImgB64
    });

  } catch (err) {
    console.error('ERROR:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
