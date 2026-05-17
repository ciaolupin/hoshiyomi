const express = require('express');
const app = express();
app.use(express.json());

// CORS許可
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 静的ファイル配信
app.use(express.static('.'));

// 動作確認用エンドポイント
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: 'ok',
    hasApiKey: hasKey,
    keyPrefix: hasKey ? process.env.GEMINI_API_KEY.substring(0, 8) + '...' : 'なし',
    nodeVersion: process.version,
    time: new Date().toISOString()
  });
});

// AI エンドポイント
app.post('/api/ai', async (req, res) => {
  const { prompt, system } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY が設定されていません');
    return res.status(500).json({ error: 'APIキーが設定されていません。Renderの環境変数を確認してください。' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'promptが必要です' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
  };
  if (system) {
    body.system_instruction = { parts: [{ text: system }] };
  }

  try {
    console.log('Gemini APIを呼び出し中...');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('Gemini APIレスポンス status:', response.status);

    if (!response.ok || data.error) {
      const errMsg = data.error?.message || `HTTP ${response.status}`;
      console.error('Gemini APIエラー:', errMsg);
      return res.status(500).json({ error: errMsg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      console.warn('テキストが空でした。レスポンス:', JSON.stringify(data).substring(0, 200));
      return res.status(500).json({ error: 'AIからの応答が空でした' });
    }

    console.log('成功。テキスト長:', text.length);
    res.json({ text });

  } catch (err) {
    console.error('fetch エラー:', err.message);
    res.status(500).json({ error: '通信エラー: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`星詠みサーバー起動 port:${PORT}`);
  console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '設定済み ✓' : '未設定 ✗');
});
