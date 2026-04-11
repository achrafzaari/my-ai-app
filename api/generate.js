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
                { type: 'text', text: 'Describe this product in 1 short sentence in English. Only type, color, style. Example: "white Nike running shoe". Nothing else.' }
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
        // STEP 2: توليد 3 صور مختلفة بـ HF
        // ══════════════════════════════════════════
        const imagePrompts = [
          `professional product photography of ${productDesc}, clean white background, studio lighting, sharp focus, commercial photo, 4k`,
          `${productDesc}, lifestyle photography, beautiful background, natural lighting, elegant, high quality`,
          `${productDesc}, flat lay photography, minimalist aesthetic, top view, clean background, professional`
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
    // STEP 4: حقن الصور في الـ HTML
    // ══════════════════════════════════════════
    if (generatedImages.length > 0) {

      // بناء gallery HTML للصور المولدة
      const galleryHtml = `
<section id="product-gallery" style="padding:40px 20px;background:#f8f9fa;text-align:center;">
  <h2 style="font-family:'Cairo',sans-serif;font-size:1.5rem;font-weight:700;margin-bottom:30px;color:#1a1a2e;">صور المنتج</h2>
  <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:900px;margin:0 auto;">
    ${generatedImages.map((img, i) => `
    <div style="flex:1;min-width:200px;max-width:280px;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.12);background:#fff;transition:transform 0.3s;" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
      <img src="data:${img.type};base64,${img.b64}" alt="صورة المنتج ${i + 1}" style="width:100%;height:250px;object-fit:cover;display:block;">
    </div>`).join('')}
  </div>
</section>`;

      // استبدال placeholder أو إضافة gallery بعد Hero
      if (html.includes('PRODUCT_IMAGE_BASE64')) {
        // استبدل أول صورة في placeholder
        html = html.replace('PRODUCT_IMAGE_BASE64', `data:${generatedImages[0].type};base64,${generatedImages[0].b64}`);
        // أضف gallery بعد Hero
        html = html.replace('</section>', `</section>${galleryHtml}`);
      } else {
        // أضف gallery بعد أول h1
        html = html.replace(/(<\/h1>)/i, `$1${galleryHtml}`);
      }

    } else if (hasImg) {
      // fallback: استخدم الصورة الأصلية
      const imgDataUrl = `data:${imgType};base64,${imgB64}`;
      const fallbackImg = `<img src="${imgDataUrl}" alt="صورة المنتج" style="max-width:100%;width:420px;height:auto;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);display:block;margin:20px auto;">`;

      if (html.includes('PRODUCT_IMAGE_BASE64')) {
        html = html.replace(/src="[^"]*PRODUCT_IMAGE_BASE64[^"]*"/g, `src="${imgDataUrl}"`);
      } else {
        html = html.replace(/(<\/h[12][^>]*>)/i, `$1\n${fallbackImg}`);
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
