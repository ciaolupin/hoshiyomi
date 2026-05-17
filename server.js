const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());

// CORS許可
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 静的ファイル配信
app.use(express.static('.'));

// 動作確認
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    nodeVersion: process.version,
    time: new Date().toISOString()
  });
});

// Node.js標準のhttpsモジュールでGemini APIを呼ぶ（fetchの代わり）
function callGeminiAPI(apiKey, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res2) => {
      let data = '';
      res2.on('data', chunk => data += chunk);
      res2.on('end', () => {
        try {
          resolve({ status: res2.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('JSONパースエラー: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// AIエンドポイント
app.post('/api/ai', async (req, res) => {
  const { prompt, system } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーが未設定です' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'promptが必要です' });
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
  };
  if (system) {
    body.system_instruction = { parts: [{ text: system }] };
  }

  try {
    console.log('Gemini API呼び出し中...');
    const result = await callGeminiAPI(apiKey, body);
    console.log('ステータス:', result.status);

    if (result.body.error) {
      console.error('Geminiエラー:', result.body.error.message);
      return res.status(500).json({ error: result.body.error.message });
    }

    const text = result.body.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      return res.status(500).json({ error: 'AIの応答が空でした' });
    }

    console.log('成功。文字数:', text.length);
    res.json({ text });

  } catch (err) {
    console.error('エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`星詠みサーバー起動 port:${PORT}`);
  console.log('APIキー:', process.env.GEMINI_API_KEY ? '設定済み ✓' : '未設定 ✗');
});
