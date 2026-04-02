const express = require('express');
const router = express.Router();

// デバッグ用：使えるモデル一覧
router.get('/models', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await r.json();
    const models = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name);
    console.log('Available Gemini models:', models.join(', '));
    res.json({ models });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/suggest', async (req, res) => {
  const { days, moods, source, inventory, adults = 2, children = 0 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });

  const peopleInfo = `大人${adults}人${children > 0 ? `・子供${children}人` : ''}`;

  let stockInfo = '';
  if (source === 'stock' && inventory && inventory.length) {
    stockInfo = `現在の在庫：${inventory.map(i => `${i.name}(${i.stage})`).join('、')}`;
  } else if (source === 'both' && inventory && inventory.length) {
    stockInfo = `在庫あり：${inventory.map(i => i.name).join('、')}。在庫にない食材も使ってOK。`;
  } else {
    stockInfo = '在庫は気にせず自由に提案してください。';
  }

  const moodInfo = moods && moods.length ? `気分：${moods.join('・')}` : '特になし';

  const prompt = `あなたは料理の専門家です。以下の条件で${days}日分の夕食献立を提案してください。

条件：
- 人数：${peopleInfo}（この人数分の量で記載）
- ${stockInfo}
- ${moodInfo}
- 日本の家庭料理を中心に
- 各日1つのメインメニュー
- 食材の量は${peopleInfo}分の具体的な量（g・ml・個など）で必ず記載
- カロリーは大人1人分の目安を記載

以下のJSON形式のみで返してください。マークダウン不要：
{"meals":[{"day":1,"name":"メニュー名","mood":"時短など","people":"大人2人分","calories_adult":"約500kcal","ingredients_stock":[{"name":"食材名","amount":"200g"}],"ingredients_buy":[{"name":"食材名","amount":"1パック"}],"steps":["手順1","手順2","手順3"]}]}`;

  // 利用可能なモデルを取得
  let models = [];
  try {
    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const modelsData = await modelsRes.json();
    models = (modelsData.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    // flash系を優先
    models.sort((a, b) => {
      if (a.includes('flash') && !b.includes('flash')) return -1;
      if (!a.includes('flash') && b.includes('flash')) return 1;
      return 0;
    });
    console.log('Available models:', models.slice(0,5).join(', '));
  } catch(e) {
    models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001'];
  }

  let lastError = '';
  for (const model of models.slice(0, 5)) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          })
        }
      );
      const raw = await response.text();
      console.log(`Gemini model=${model} status=${response.status} len=${raw.length}`);
      if (!response.ok) { lastError = `${model}:${response.status}`; continue; }
      const data = JSON.parse(raw);
      // finish_reason が MAX_TOKENS や SAFETY の場合もテキストを取得
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || '';
      console.log(`Gemini text preview: ${text.substring(0, 100)}`);
      if (!text) {
        console.log('Gemini full response:', JSON.stringify(data).substring(0, 500));
        lastError = `${model}:empty`;
        continue;
      }
      // JSONを抽出（前後のテキストや改行を除去）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('No JSON found in:', text.substring(0, 200));
        lastError = `${model}:no-json`;
        continue;
      }
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`✅ Gemini success: ${model}`);
        return res.json(parsed);
      } catch(parseErr) {
        console.log('JSON parse error:', parseErr.message, 'text:', jsonMatch[0].substring(0, 100));
        lastError = `${model}:parse-error`;
        continue;
      }
    } catch(e) {
      lastError = `${model}:${e.message}`;
      console.error(`Gemini error (${model}):`, e.message);
    }
  }

  console.error('All Gemini models failed:', lastError);
  res.status(500).json({ error: '献立の取得に失敗しました: ' + lastError });
});

module.exports = router;
