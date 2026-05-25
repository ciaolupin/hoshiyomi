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

app.get('/api/test', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.json({ error: 'APIキー未設定' });
  try {
    const result = await callGemini(apiKey, {
      contents: [{ role: 'user', parts: [{ text: 'テスト。「接続成功」とだけ答えてください。' }] }],
      generationConfig: { maxOutputTokens: 50 }
    }, 1);
    res.json({ status: 200, text: result.body.candidates?.[0]?.content?.parts?.[0]?.text || '', error: result.body.error || null });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// Gemini API呼び出し（リトライ付き）
function callGemini(apiKey, body, maxRetries = 3) {
  return new Promise(async (resolve, reject) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await callGeminiOnce(apiKey, body);
        // 503は一定時間待ってリトライ
        if (result.status === 503 && attempt < maxRetries) {
          const wait = attempt * 3000; // 3秒、6秒と増やす
          console.log(`503エラー。${wait/1000}秒後にリトライ (${attempt}/${maxRetries})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return resolve(result);
      } catch(e) {
        if (attempt === maxRetries) return reject(e);
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  });
}

function callGeminiOnce(apiKey, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 30000
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
    req.on('timeout', () => { req.destroy(); reject(new Error('タイムアウト')); });
    req.write(bodyStr);
    req.end();
  });
}

app.post('/api/ai', async (req, res) => {
  const { prompt, history, system } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });

  // historyがある場合はそれを使う、なければpromptから単発リクエスト
  let contents;
  if (history && Array.isArray(history) && history.length > 0) {
    contents = history; // 会話履歴をそのまま渡す
  } else if (prompt) {
    contents = [{ role: 'user', parts: [{ text: prompt }] }];
  } else {
    return res.status(400).json({ error: 'promptまたはhistoryが必要' });
  }

  const body = {
    contents,
    generationConfig: { temperature: 0.9, maxOutputTokens: 2500 }
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  try {
    const result = await callGemini(apiKey, body, 3);
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
