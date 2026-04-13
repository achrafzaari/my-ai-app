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

    const hasImg = imgB64 && imgB64.length > 100;

    // ══════════════════════════════════════════════════════════════
    // STEP 1: فهم المنتج من الصورة (BLIP captioning)
    // ══════════════════════════════════════════════════════════════
    let productDesc = 'professional product';

    if (hasImg) {
      try {
        const r = await fetch(
          'https://router.huggingface.co/hf-inference/models/Salesforce/blip-image-captioning-large',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: { image: imgB64 } }),
          }
        );
        if (r.ok) {
          const d = await r.json();
          productDesc = d?.[0]?.generated_text || productDesc;
          console.log('📸 Product caption:', productDesc);
        } else {
          console.warn('⚠️ Caption skipped:', r.status);
        }
      } catch (e) {
        console.error('Caption error:', e.message);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 2: توليد HTML بـ Qwen2.5-72B (أقوى من Mistral-7B)
    // ══════════════════════════════════════════════════════════════
    const generateHTML = async () => {
      const imageNote = hasImg
        ? '\n\nتعليمات الصورة: لا تضع أي <img> tag — الصور ستُحقن تلقائياً بعد التوليد. ركز فقط على النص والتصميم.'
        : '';

      const systemPrompt =
        'أنت مطور ويب ومصمم UI/UX خبير. مهمتك الوحيدة إرجاع كود HTML كامل بدون أي شرح أو markdown أو backticks. ' +
        'يجب أن يبدأ ردك مباشرة بـ <!DOCTYPE html> وينتهي بـ </html>. ' +
        'الصفحة يجب أن تكون مبهرة بصرياً مع gradients وanimations وbox-shadows.';

      const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'Qwen/Qwen2.5-72B-Instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt + imageNote },
          ],
          max_tokens: 8192,
          temperature: 0.7,
          stream: false,
        }),
      });

      console.log('🤖 HF text status:', r.status);
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`HF text ${r.status}: ${err.slice(0, 200)}`);
      }
      const d = await r.json();
      return d.choices?.[0]?.message?.content || '';
    };

    // ══════════════════════════════════════════════════════════════
    // STEP 3: توليد صورتين بـ FLUX.1-schnell بالتوازي
    // ══════════════════════════════════════════════════════════════
    const generateImage = async (imgPrompt, index) => {
      try {
        const r = await fetch(
          'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputs: imgPrompt,
              parameters: {
                width: 512,
                height: 512,
                num_inference_steps: 4,
                guidance_scale: 0,
              },
            }),
          }
        );
        console.log(`🖼️  Image ${index} status:`, r.status);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return { index, b64: Buffer.from(buf).toString('base64'), type: 'image/webp' };
      } catch (e) {
        console.error(`Image ${index} error:`, e.message);
        return null;
      }
    };

    // ── شغّل الثلاثة بالتوازي لتوفير الوقت ──────────────────────
    const [rawText, img1, img2] = await Promise.all([
      generateHTML(),
      hasImg
        ? generateImage(
            `professional product photography, ${productDesc}, pure white background, studio lighting, sharp focus, commercial quality, 4k`,
            1
          )
        : Promise.resolve(null),
      hasImg
        ? generateImage(
            `${productDesc}, elegant lifestyle shot, natural lighting, bokeh background, high quality`,
            2
          )
        : Promise.resolve(null),
    ]);

    if (!rawText) return res.status(502).json({ error: 'Empty response from AI' });

    // ── تنظيف الكود ──────────────────────────────────────────────
    let html = rawText
      .replace(/```html\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    // تأكد أن الكود يبدأ من <!DOCTYPE
    const docStart = html.indexOf('<!DOCTYPE');
    if (docStart > 0) html = html.slice(docStart);

    const generatedImages = [img1, img2].filter(Boolean);
    console.log(`✅ Generated ${generatedImages.length} images`);

    // ══════════════════════════════════════════════════════════════
    // STEP 4: حقن الصور في الصفحة
    // ══════════════════════════════════════════════════════════════
    const makeImgTag = (src, mimeType, label) =>
      `<div style="max-width:480px;margin:28px auto;padding:0 16px;text-align:center;">` +
      `<img src="data:${mimeType};base64,${src}" alt="${label || 'صورة المنتج'}" ` +
      `style="width:100%;height:auto;border-radius:18px;` +
      `box-shadow:0 12px 40px rgba(0,0,0,0.18);display:block;transition:transform .3s;" ` +
      `onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">` +
      `</div>`;

    if (generatedImages.length > 0) {
      // الصورة الأولى: بعد أول H1
      const heroImg = makeImgTag(generatedImages[0].b64, generatedImages[0].type, 'صورة المنتج');
      if (html.includes('</h1>')) {
        html = html.replace(/(<\/h1>)/i, `$1\n${heroImg}`);
      } else {
        html = html.replace(/(<\/section>)/i, `${heroImg}\n$1`);
      }

      // الصورة الثانية: قبل الـ footer
      if (generatedImages[1]) {
        const secondImg = makeImgTag(generatedImages[1].b64, generatedImages[1].type, 'صورة تفصيلية');
        if (html.includes('<footer')) {
          html = html.replace(/(<footer)/i, `${secondImg}\n$1`);
        } else {
          html = html.replace('</body>', `${secondImg}\n</body>`);
        }
      }
    } else if (hasImg) {
      // فشل FLUX → استخدم صورة المستخدم مباشرة
      const userImg = makeImgTag(imgB64, imgType || 'image/jpeg', 'صورة المنتج');
      if (html.includes('</h1>')) {
        html = html.replace(/(<\/h1>)/i, `$1\n${userImg}`);
      } else {
        html = html.replace('</body>', `${userImg}\n</body>`);
      }
    }

    // تأكد الكود مكتمل
    if (!html.includes('</html>')) html += '\n</body>\n</html>';

    return res.status(200).json({
      html,
      imagesGenerated: generatedImages.length,
      productDesc,
    });

  } catch (err) {
    console.error('❌ ERROR:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
