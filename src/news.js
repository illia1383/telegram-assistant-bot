import axios from 'axios';

// ─── NewsAPI (newsapi.org) ────────────────────────────────────────────────────

async function fetchFromNewsAPI(apiKey) {
  const res = await axios.get('https://newsapi.org/v2/top-headlines', {
    params: {
      language: 'en',
      category: 'technology',
      pageSize: 15,
      apiKey,
    },
    timeout: 10_000,
  });
  return (res.data.articles || []).map(a => ({
    title: a.title,
    description: a.description,
    url: a.url,
    source: a.source?.name,
  }));
}

// ─── GNews (gnews.io) ────────────────────────────────────────────────────────

async function fetchFromGNews(apiKey) {
  const res = await axios.get('https://gnews.io/api/v4/top-headlines', {
    params: {
      lang: 'en',
      topic: 'technology',
      max: 15,
      token: apiKey,
    },
    timeout: 10_000,
  });
  return (res.data.articles || []).map(a => ({
    title: a.title,
    description: a.description,
    url: a.url,
    source: a.source?.name,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchTopArticles() {
  const provider = (process.env.NEWS_API_PROVIDER || 'newsapi').toLowerCase();
  const key = process.env.NEWS_API_KEY;

  if (!key) throw new Error('NEWS_API_KEY is not set');

  console.log(`[news] Fetching articles from provider: ${provider}`);

  if (provider === 'gnews') return fetchFromGNews(key);
  if (provider === 'newsapi') return fetchFromNewsAPI(key);

  throw new Error(`Unknown NEWS_API_PROVIDER: "${provider}". Use "newsapi" or "gnews".`);
}
