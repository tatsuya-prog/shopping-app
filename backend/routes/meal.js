const express = require('express');
const router = express.Router();

router.post('/suggest', async (req, res) => {
  const { days, moods, source, inventory } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });

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
- ${stockInfo}
- ${moodInfo}
- 日本の家庭料理を中心に
- 各日1つのメインメニュー

以下のJSON形式のみで返してください。マークダウン不要、JSONだけ返してください：
{"meals":[{"day":1,"name":"メニュー名","mood":"時短など","ingredients_stock":["在庫食材"],"ingredients_buy":["購入食材"],"steps":["手順1","手順2","手順3"]}]}`;

  // 試すモデルのリスト（順番に試す）
  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-latest',
    'gemini-pro'
  ];

  let lastError = '';
  for (const model of models) {
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
      console.log(`Gemini model=${model} status=${response.status} preview=${raw.substring(0, 100)}`);

      if (!response.ok) {
        lastError = `${model}: ${response.status}`;
        continue; // 次のモデルを試す
      }

      const data = JSON.parse(raw);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `${model}: empty response`;
        continue;
      }

      // JSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = `${model}: no JSON found`;
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`✅ Gemini success with model: ${model}`);
      return res.json(parsed);

    } catch (e) {
      lastError = `${model}: ${e.message}`;
      console.error(`Gemini error (${model}):`, e.message);
    }
  }

  // 全モデル失敗
  console.error('All Gemini models failed. Last error:', lastError);
  res.status(500).json({ error: '献立の取得に失敗しました。しばらく後で再試行してください。' });
});

module.exports = router;
