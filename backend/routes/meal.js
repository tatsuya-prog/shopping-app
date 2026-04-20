const express = require('express');
const router  = express.Router();

router.get('/models', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await r.json();
    const models = (data.models||[])
      .filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
      .map(m=>m.name);
    res.json({ models });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/suggest', async (req, res) => {
  const { days, moods, adults=2, kids=0 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });

  const total = (adults||0) + (kids||0) || 2;
  const adultsText = adults>0 ? `大人${adults}名` : '';
  const kidsText   = kids>0   ? `子供${kids}名`   : '';
  const peopleText = [adultsText, kidsText].filter(Boolean).join('・') || `${total}名`;
  const moodInfo   = moods&&moods.length ? `気分：${moods.join('・')}` : '特になし';

  const prompt = `あなたは料理の専門家です。以下の条件で${days}日分の夕食献立を提案してください。

条件：
- 人数：${peopleText}（合計${total}人分）
- ${moodInfo}
- 日本の家庭料理を中心に
- 各日1つのメインメニュー
- 食材の量は必ず${total}人分で具体的に記載（例：鶏もも肉300g、醤油大さじ2）
- カロリー目安を1人あたりで記載
${kids>0 ? '- 子供が食べやすい味付けに配慮' : ''}

以下のJSON形式のみで返してください（マークダウン不要）：
{"meals":[{"day":1,"name":"メニュー名","mood":"時短など","calories_per_person":"約500kcal","ingredients":["鶏もも肉 300g","醤油 大さじ2"],"steps":["手順1","手順2"]}]}`;

  // 利用可能モデルを取得
  let models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  try {
    const mr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const md = await mr.json();
    const available = (md.models||[])
      .filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
      .map(m=>m.name.replace('models/',''));
    const priority = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.0-flash'];
    models = priority.filter(p=>available.includes(p));
    if (!models.length) models = available.filter(m=>m.includes('flash')).slice(0,3);
  } catch {}

  for (const model of models.slice(0,3)) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
          })
        }
      );
      const raw  = await response.text();
      console.log(`Gemini model=${model} status=${response.status} len=${raw.length}`);
      if (!response.ok) continue;

      const data = await JSON.parse(raw);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) continue;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const usage  = data.usageMetadata || {};
        const inTok  = usage.promptTokenCount     || 0;
        const outTok = usage.candidatesTokenCount  || 0;
        const costUsd = (inTok*0.0000003) + (outTok*0.0000025);
        const costJpy = costUsd * 150;
        console.log(`✅ Gemini success: ${model} ¥${costJpy.toFixed(4)}`);
        return res.json({ ...parsed, tokenInfo: { inputTokens:inTok, outputTokens:outTok, costJpy:+costJpy.toFixed(4) } });
      } catch(pe) {
        // 部分JSON救済
        try {
          const partial = jsonMatch[0].match(/"meals"\s*:\s*\[([\s\S]*)/);
          if (partial) {
            const objs = [];
            let d=0, start=0;
            const s = '[' + partial[1];
            for (let i=0;i<s.length;i++) {
              if (s[i]==='{') { if(d===1) start=i; d++; }
              if (s[i]==='}') { d--; if(d===1) { try{ objs.push(JSON.parse(s.slice(start,i+1))); }catch{} } }
              if (s[i]==='[') d++;
              if (s[i]===']') d--;
            }
            if (objs.length) { console.log(`✅ Partial: ${model} ${objs.length}meals`); return res.json({ meals:objs }); }
          }
        } catch {}
        continue;
      }
    } catch(e) { console.error(`Gemini error (${model}):`, e.message); }
  }

  res.status(500).json({ error: '献立の取得に失敗しました。しばらくしてから再試行してください。' });
});

module.exports = router;
