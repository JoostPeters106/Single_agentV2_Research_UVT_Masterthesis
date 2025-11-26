const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const DEFAULT_GEMINI_API_KEY = 'API';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

function normalizeBaseUrl(url) {
  if (!url) {
    return url;
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/v1beta\d*$/i, '').replace(/\/v1$/i, '');
}

const apiKey = process.env.GEMINI_API_KEY || DEFAULT_GEMINI_API_KEY;
const baseUrl = normalizeBaseUrl(process.env.BASE_URL || DEFAULT_BASE_URL);
const model = process.env.MODEL || DEFAULT_MODEL;

// The client gets the API key from the environment variable `GEMINI_API_KEY`
// (falling back to the Brightwave experiment key if none is provided).
const geminiClient = apiKey && baseUrl
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        baseUrl,
      },
    })
  : null;
const SYSTEM_CONTEXT = "you are assisting in an academic experiment. the user is a sales employee at brightwave solutions. your outputs must be short (Around 80 words), strictly about which customers to contact first using only the provided dataset. justify briefly using concrete fields from the data (e.g., ‘last sale=1 mo’, ‘ytd=€400k’, ‘freq=8/yr’, notes etc.). Do not mention the customerID. avoid unrelated topics. ensure fairness; do not rely on stereotypes. be transparent and cite which fields informed your choice.";
const TARGET_QUERY = "Based on the data, determine which customers have the most potential and should be contacted first.";

const app = express();
app.use(express.json());
app.use(cors({ origin: /localhost/, methods: ['GET', 'POST'] }));
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    console.warn(`Request timed out: ${req.method} ${req.originalUrl}`);
  });
  next();
});
const limiter = rateLimit({ windowMs: 60 * 1000, max: 3000 });
app.use(limiter);

const dataPath = path.join(__dirname, 'data', 'Customer_List_with_YTD_Purchases.csv');
let customers = [];
let customerColumns = [];
let datasetText = '';

try {
  datasetText = fs.readFileSync(dataPath, 'utf8');
  datasetText = datasetText.replace(/^\uFEFF/, '');
  customers = parse(datasetText, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ';',
    bom: true
  });
  customerColumns = customers.length > 0 ? Object.keys(customers[0]) : [];
} catch (err) {
  console.error('Failed to load dataset', err);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/customers', (req, res) => {
  res.json({ columns: customerColumns, records: customers });
});

function buildPrompt({ role, instruction, body }) {
  return `${SYSTEM_CONTEXT}\nRole: ${role}.\nInstruction: ${instruction}\n\n${body}`;
}

async function callGemini(prompt) {
  if (!geminiClient || !model) {
    throw new Error('Model configuration missing. Check environment variables.');
  }
  await new Promise(resolve => setTimeout(resolve, 750));
  console.log('Prompt sent to model:\n', prompt);

  const response = await geminiClient.models.generateContent({
    model,
    contents: prompt,
    // --- HIER VOEG JE DE LIMIET TOE ---
    config: {
      maxOutputTokens: 250, // Ruim genoeg voor 100 woorden + JSON syntax
      temperature: 0.0,     // Zorgt voor consistente, maar niet robotische antwoorden
    }
    // ----------------------------------
  });

  const text = (response.text || '').trim();

  console.log('Model response:\n', text);

  return text;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Model response did not contain JSON.');
  }
  return JSON.parse(match[0]);
}

function normalizeFields(fields) {
  const unique = new Set();
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    if (!field) return;
    const cleaned = field.replace(/[`*]/g, '').trim();
    if (cleaned) {
      unique.add(cleaned);
    }
  });
  return Array.from(unique);
}

app.post('/api/validate', async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ allowed: false, message: 'Question is required.' });
  }

  const body = `You are the prompt gatekeeper. Determine if the user’s query is semantically similar to the target. The language is allowed to be different. \nTarget query: "${TARGET_QUERY}"\nUser query: "${question}"\nReturn json {"similar":true|false,"score":number,"reason":"..."}. Similar if cosine ≥ 0.75. Reply with JSON only.`;

  try {
    const responseText = await callGemini(buildPrompt({
      role: 'prompt gatekeeper',
      instruction: 'determine semantic similarity to the provided target question. respond in JSON only.',
      body
    }));

    const result = extractJson(responseText);
    const allowed = result.similar === true && Number(result.score) >= 0.75;

    if (!allowed) {
      return res.json({
        allowed: false,
        message: 'Not able to reply to your question, please only ask questions related to the case.',
        score: result.score || 0,
        reason: result.reason || 'not similar'
      });
    }

    return res.json({ allowed: true, score: result.score, reason: result.reason });
  } catch (error) {
    console.error('Validation error', error);
    return res.status(500).json({ allowed: false, message: 'Validation failed.' });
  }
});

app.post('/api/agent1', async (req, res) => {
  const { question } = req.body || {};
  if (!question) {
    return res.status(400).json({ message: 'Question is required.' });
  }

  const body = `Dataset (CSV):\n${datasetText}\n\nUser request: ${question}\n\nRespond ONLY in valid JSON with key "summary" (around 80 words). Provide a single concise reaction about which customers to contact first, referencing dataset fields inline without bullet points.  Do not mention the customerID.`;

  try {
    const responseText = await callGemini(buildPrompt({
      role: 'data-driven sales recommender',
      instruction: 'select the top 3 customers to contact first using the dataset. emphasise briefly the data used.',
      body
    }));

    const result = extractJson(responseText);
    const payload = {
      summary: result.summary || '',
      fields: normalizeFields(result.fields)
    };

    return res.json(payload);
  } catch (error) {
    console.error('Agent 1 error', error);
    return res.status(500).json({ message: 'Agent 1 failed.' });
  }
});

app.post('/api/agent1/revisit', async (req, res) => {
  const { question, recommendation } = req.body || {};
  const summary = (recommendation && recommendation.summary) || '';

  if (!question) {
    return res.status(400).json({ message: 'Question is required.' });
  }

  const body = `Dataset (CSV):\n${datasetText}\n\nUser request: ${question}\n\nInitial recommendation summary: ${summary}\n\nRevisit the advice and provide a single, ≤90-word reaction starting with: Revisiting my earlier recommendation. Mention and substantiate any key changes inline, without bullet points. Do not mention the customerID. Respond ONLY in valid JSON with key "summary".`;

  try {
    const responseText = await callGemini(buildPrompt({
      role: 'data-driven sales recommender',
      instruction: 'Revisit the initial plan and refine it using the dataset and user question. IMPORTANT: At least remove one customer or add one. Do no more than adding one and removing one. Explicitly state which customer you removed and or added (use the words: removed or/and added). Shortly substentiate why you removed or/and added a customer. Make sure you adhere to what is said at: "IMPORTANT:"',
      body
    }));

    const result = extractJson(responseText);
    const payload = {
      summary: result.summary || '',
      fields: normalizeFields(result.fields)
    };

    return res.json(payload);
  } catch (error) {
    console.error('Agent 1 revisit error', error);
    return res.status(500).json({ message: 'Agent 1 revisit failed.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
