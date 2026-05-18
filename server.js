const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static('.'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.GEMINI_API_KEY, nodeVersion: process.version, time: new Date().toISOString() });
});

// Geminiを直接テストするGETエンドポイント（ブラウザで開ける）
app.get('/api/test', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.json({ error: 'APIキー未設定' });

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'テスト。「接続成功」とだけ答えてください。' }] }],
    generationConfig: { maxOutputTokens: 50 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  let raw = '';
  const req2 = https.request(options, (r) => {
    r.on('data', c => raw += c);
    r.on('end', () => {
      try {
        const d = JSON.parse(raw);
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.json({ status: r.statusCode, text, error: d.error || null });
      } catch(e) {
        res.json({ parseError: e.message, raw: raw.substring(0, 300) });
      }
    });
  });
  req2.on('error', e => res.json({ connectionError: e.message }));
  req2.write(body);
  req2.end();
});

function callGemini(apiKey, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    };
    let raw = '';
    const req = https.request(options, (r) => {
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(raw) }); }
        catch(e) { reject(new Error('parse error: ' + raw.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

app.post('/api/ai', async (req, res) => {
  const { prompt, system } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });
  if (!prompt) return res.status(400).json({ error: 'promptが必要' });

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 400 }
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  try {
    const result = await callGemini(apiKey, body);
    if (result.body.error) return res.status(500).json({ error: result.body.error.message });
    const text = result.body.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(500).json({ error: '応答が空' });
    res.json({ text });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`起動 port:${PORT} APIキー:${process.env.GEMINI_API_KEY ? '設定済み' : '未設定'}`);
});
