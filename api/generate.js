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
    // STEP 1: فهم المنتج من الصورة
    // ══════════════════════════════════════════
    let productDesc = 'professional product';
    let generatedImages = [];

    if (hasImg && hfKey) {
      try {
        console.log('Understanding product from image...');

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
            max_tokens: 100,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
                { type: 'text', text: 'Describe this product very precisely in English: brand name, product type, color, shape, cap/lid/packaging details. Be specific. Example: "NIVEA Pearl Beauty roll-on deodorant, transparent cylindrical bottle, white cap, pink and white label". Only the description, nothing else.' }
              ]
            }]
          })
        });

        if (descRes.ok) {
          const descData = await descRes.json();
          productDesc = descData.choices?.[0]?.message?.content?.trim() || productDesc;
          console.log('Product:', productDesc);
        }

        // ══════════════════════════════════════════
        // STEP 2: توليد 4 صور مختلفة بـ HF
        // ══════════════════════════════════════════
        const imagePrompts = [
          `professional product photography of ${productDesc}, pure white background, studio lighting, sharp focus, centered, commercial quality, 4k`,
          `${productDesc}, close up detail shot, showing texture and quality, soft background, professional macro photography`,
          `${productDesc}, lifestyle shot, elegant real-world setting, natural lighting, beautiful composition`,
          `${productDesc}, flat lay top view, minimalist white background, clean aesthetic, professional photography`
        ];

        console.log('Generating 3 images...');

        const imagePromises = imagePrompts.map(async (imgPrompt, index) => {
          try {
            const hfRes = await fetch(
              'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${hfKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  inputs: imgPrompt,
                  parameters: {
                    width: 512,
                    height: 512,
                    num_inference_steps: 4,
                    guidance_scale: 0
                  }
                })
              }
            );

            console.log(`Image ${index + 1} HF status:`, hfRes.status);

            if (hfRes.ok) {
              const imgBuffer = await hfRes.arrayBuffer();
              const b64 = Buffer.from(imgBuffer).toString('base64');
              console.log(`Image ${index + 1} generated, size:`, b64.length);
              return { index, b64, type: 'image/jpeg' };
            } else {
              const err = await hfRes.text();
              console.error(`Image ${index + 1} error:`, err);
              return null;
            }
          } catch (e) {
            console.error(`Image ${index + 1} exception:`, e.message);
            return null;
          }
        });

        const results = await Promise.all(imagePromises);
        generatedImages = results.filter(Boolean);
        console.log(`Generated ${generatedImages.length} images successfully`);

      } catch (err) {
        console.error('Image generation error:', err.message);
      }
    }

    // ══════════════════════════════════════════
    // STEP 3: توليد الـ HTML بـ OpenRouter
    // ══════════════════════════════════════════
    const messages = [];

    // أضف معلومات الصور للـ prompt
    const imagesNote = generatedImages.length > 0
      ? `\n\nمهم: سيتم حقن ${generatedImages.length} صور احترافية للمنتج تلقائياً في قسم "صور المنتج" بعد Hero. لا تضع أي img tag في الكود — فقط ضع div بـ id="product-gallery" فارغ بعد Hero لاستقبال الصور.`
      : hasImg
      ? `\n\nمهم: ضع PRODUCT_IMAGE_BASE64 في الـ src لصورة المنتج في Hero هكذا:\n<img src="PRODUCT_IMAGE_BASE64" alt="صورة المنتج" style="max-width:100%;border-radius:16px;">`
      : '';

    const finalPrompt = prompt + imagesNote;

    if (hasImg) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imgType || 'image/jpeg'};base64,${imgB64}` } },
          { type: 'text', text: finalPrompt }
        ]
      });
    } else {
      messages.push({ role: 'user', content: finalPrompt });
    }

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
        max_tokens: 16000,
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
    // STEP 4: حقن الصور في أماكن مختلفة
    // ══════════════════════════════════════════
    if (generatedImages.length > 0) {

      const makeImg = (img, style='') =>
        `<img src="data:${img.type};base64,${img.b64}" alt="صورة المنتج" style="max-width:100%;width:100%;height:auto;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:block;margin:16px auto;${style}">`;

      if (html.includes('PRODUCT_IMAGE_BASE64')) {
        // استبدل placeholder بالصورة الأولى
        html = html.replace('PRODUCT_IMAGE_BASE64', `data:${generatedImages[0].type};base64,${generatedImages[0].b64}`);
      }

      // أضف الصور في أماكن مختلفة من الصفحة
      if (generatedImages[1]) {
        // صورة 2 بعد قسم المميزات
        html = html.replace(
          /(<\/section>)/,
          `$1\n<div style="max-width:500px;margin:30px auto;padding:0 20px;">${makeImg(generatedImages[1])}</div>`
        );
      }

      if (generatedImages[2]) {
        // صورة 3 قبل قسم السعر أو الشهادات
        const insertPoint = html.lastIndexOf('</section>');
        if (insertPoint > 0) {
          html = html.slice(0, insertPoint) +
            `<div style="max-width:500px;margin:30px auto;padding:0 20px;">${makeImg(generatedImages[2])}</div>` +
            html.slice(insertPoint);
        }
      }

      if (generatedImages[3]) {
        // صورة 4 قبل الفورم أو التذييل
        html = html.replace(
          /(<footer)/i,
          `<div style="max-width:500px;margin:30px auto;padding:0 20px;">${makeImg(generatedImages[3])}</div>\n$1`
        );
      }

    } else if (hasImg) {
      // fallback: صورة أصلية واحدة
      const imgDataUrl = `data:${imgType};base64,${imgB64}`;
      if (html.includes('PRODUCT_IMAGE_BASE64')) {
        html = html.replace(/src="[^"]*PRODUCT_IMAGE_BASE64[^"]*"/g, `src="${imgDataUrl}"`);
      } else {
        html = html.replace(
          /(<\/h[12][^>]*>)/i,
          `$1\n<img src="${imgDataUrl}" alt="صورة المنتج" style="max-width:100%;width:420px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);display:block;margin:20px auto;">`
        );
      }
    }

    if (!html.includes('</html>')) {
      html += '\n</body></html>';
    }

    return res.status(200).json({
      html,
      imagesGenerated: generatedImages.length
    });

  } catch (err) {
    console.error('ERROR:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
