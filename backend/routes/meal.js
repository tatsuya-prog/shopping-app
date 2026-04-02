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

必ずJSON形式のみで返してください（マークダウン・コードブロック不要）：
{"meals":[{"day":1,"name":"メニュー名","mood":"時短など","ingredients_stock":["在庫食材"],"ingredients_buy":["購入食材"],"steps":["手順1","手順2"]}]}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const raw = await response.text();
    console.log('Gemini status:', response.status, '/ preview:', raw.substring(0, 150));

    if (!response.ok) {
      return res.status(500).json({ error: `Gemini APIエラー: ${response.status}` });
    }

    const data = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      console.error('Gemini empty:', JSON.stringify(data).substring(0, 200));
      return res.status(500).json({ error: '献立の取得に失敗しました（空レスポンス）' });
    }
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (e) {
    console.error('Gemini error:', e.message);
    res.status(500).json({ error: '献立の取得に失敗しました: ' + e.message });
  }
});

module.exports = router;
