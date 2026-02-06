const fs = require('fs');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Configuration
const CONFIG = {
  username: 'yebeai',
  reposToShow: 999, // All repos - no limit
  apiDelay: 3000, // 3 seconds between AI requests (rotating models)
  models: {
    endpoint: 'https://models.inference.ai.azure.com/chat/completions',
    // Rotate between models to maximize rate limits (50/day each)
    available: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    maxTokens: 2000,
    temperature: 0.7
  }
};

// Track rate limits per model
const modelRateLimits = {};
let currentModelIndex = 0;

function getNextModel() {
  // Try to find a model that hasn't hit rate limit
  for (let i = 0; i < CONFIG.models.available.length; i++) {
    const model = CONFIG.models.available[(currentModelIndex + i) % CONFIG.models.available.length];
    if (!modelRateLimits[model]) {
      currentModelIndex = (currentModelIndex + i + 1) % CONFIG.models.available.length;
      return model;
    }
  }
  return null; // All models rate limited
}

// Curated Unsplash photo IDs for tech/coding themes
const unsplashPhotos = [
  '1461749280684-dccba630e2f6', '1555066931-4365d14bab8c', '1504639725590-34d0984388bd',
  '1526374965328-7f61d4dc18c5', '1518770660439-4636190af475', '1451187580459-43490279c0fa',
  '1550751827-4bd374c3f58b', '1558494949-ef010cbdcc31', '1485827404703-89b55fcc595e',
  '1531482615713-2afd69097998', '1542831371-29b0f74f9713', '1607799279861-4dd421887fb3',
];

function getRandomUnsplashUrl(index) {
  const photoId = unsplashPhotos[index % unsplashPhotos.length];
  return `https://images.unsplash.com/photo-${photoId}?w=800&h=400&fit=crop&q=80`;
}

// Load existing forks.json to check for existing articles
function loadExistingArticles() {
  try {
    if (fs.existsSync('forks.json')) {
      const data = JSON.parse(fs.readFileSync('forks.json', 'utf8'));
      const existing = new Map();
      for (const fork of (data.forks || [])) {
        existing.set(fork.id, fork);
      }
      console.log(`Loaded ${existing.size} existing articles from forks.json`);
      return existing;
    }
  } catch (e) {
    console.log('No existing forks.json found, starting fresh');
  }
  return new Map();
}

// Check if article is a fallback (not AI-generated)
function isFallbackArticle(article) {
  if (!article || article.length < 400) return true;

  const fallbackPhrases = [
    'demonstrates thoughtful software design',
    'caught my attention for its practical approach',
    'Worth investigating if you\'re working with',
    'patterns and implementations that could accelerate'
  ];

  return fallbackPhrases.some(phrase => article.includes(phrase));
}

// Fetch README content from repo
async function fetchReadme(repo) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${CONFIG.username}/${repo.name}/readme`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3.raw',
          'User-Agent': 'GitHub-Pages-Blog-Generator',
          ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
        }
      }
    );
    if (response.ok) {
      const readme = await response.text();
      return readme.slice(0, 4000);
    }
  } catch (e) {}
  return null;
}

// Fetch repo file structure
async function fetchRepoTree(repo) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${CONFIG.username}/${repo.name}/git/trees/HEAD?recursive=1`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'GitHub-Pages-Blog-Generator',
          ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
        }
      }
    );
    if (response.ok) {
      const data = await response.json();
      return (data.tree || []).filter(f => f.type === 'blob').map(f => f.path).slice(0, 30);
    }
  } catch (e) {}
  return [];
}

async function generateBlogArticle(repo, readme, fileTree) {
  if (!GITHUB_TOKEN) {
    return generateFallbackSummary(repo);
  }

  const model = getNextModel();
  if (!model) {
    console.log(`  All models rate limited`);
    return null;
  }

  try {
    const context = `
REPOSITORY: ${repo.name}
DESCRIPTION: ${repo.description || 'No description'}
PRIMARY LANGUAGE: ${repo.language || 'Not specified'}
TOPICS/TAGS: ${(repo.topics || []).join(', ') || 'None'}
STARS: ${repo.stargazers_count || 0}
${repo.parent ? `FORKED FROM: ${repo.parent.name} (${repo.parent.stars} stars)` : 'ORIGINAL PROJECT'}

FILE STRUCTURE:
${fileTree.length > 0 ? fileTree.join('\n') : 'Not available'}

README EXCERPT:
${readme || 'No README available'}
`.trim();

    const prompt = `You are a tech blogger writing an insightful article about a GitHub repository.

${context}

Write an in-depth technical blog article (4-5 paragraphs) that:
1. HOOK: Start with a compelling problem statement or use case
2. WHAT IT IS: Explain the project's purpose and what makes it unique
3. TECHNICAL DEEP DIVE: Analyze architecture, technologies, patterns from the file structure
4. USE CASES: 2-3 specific scenarios where developers would benefit
5. TAKEAWAY: Insight about why this matters

Style: Senior engineer sharing insights. Reference specific files/patterns. No emojis, no fluff. Be opinionated.

Write the full article, no title or headers:`;

    console.log(`  Using model: ${model}`);
    const response = await fetch(CONFIG.models.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a senior developer and tech writer creating insightful blog content about open source projects.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: CONFIG.models.maxTokens,
        temperature: CONFIG.models.temperature
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  ${model} returned ${response.status}: ${errorText.slice(0, 80)}`);

      // Mark model as rate limited if 429
      if (response.status === 429) {
        modelRateLimits[model] = true;
        console.log(`  Model ${model} rate limited, trying next...`);
        // Retry with next model
        return generateBlogArticle(repo, readme, fileTree);
      }
      return null;
    }

    const data = await response.json();
    const article = data.choices?.[0]?.message?.content?.trim();

    if (article && article.length > 400) {
      return article;
    }
    return null;
  } catch (error) {
    console.log(`AI generation failed for ${repo.name}:`, error.message);
    return null;
  }
}

function generateFallbackSummary(repo) {
  const desc = repo.description || '';
  const lang = repo.language || 'various technologies';
  const name = repo.name.replace(/-/g, ' ').replace(/_/g, ' ');

  if (desc.length > 100) {
    return `${desc}\n\nThis ${lang} project caught my attention for its practical approach to solving real developer problems. The codebase offers patterns worth studying for anyone working in this space.`;
  }

  return `${name} is a ${lang} project that demonstrates thoughtful software design. While exploring the codebase, I found patterns and implementations that could accelerate similar projects. Worth investigating if you're working with ${lang} or interested in clean, maintainable code architecture.`;
}

async function fetchRepos() {
  let allRepos = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/users/${CONFIG.username}/repos?sort=updated&per_page=100&page=${page}`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'GitHub-Pages-Blog-Generator',
          ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
        }
      }
    );

    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const repos = await response.json();
    if (repos.length === 0) break;

    allRepos = allRepos.concat(repos);
    console.log(`Fetched page ${page}: ${repos.length} repos (total: ${allRepos.length})`);

    if (repos.length < 100) break;
    page++;
  }

  allRepos.forEach(r => { r._type = r.fork ? 'fork' : 'original'; });

  return allRepos
    .filter(r => !r.name.includes('.github.io') && !r.archived)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

async function fetchRepoDetails(repo) {
  try {
    const response = await fetch(repo.url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitHub-Pages-Blog-Generator',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
      }
    });

    if (response.ok) {
      const data = await response.json();
      return {
        ...repo,
        topics: data.topics || [],
        parent: data.parent ? {
          name: data.parent.full_name,
          url: data.parent.html_url,
          stars: data.parent.stargazers_count
        } : null
      };
    }
  } catch (e) {}
  return repo;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function estimateReadTime(content) {
  const words = (content || '').split(/\s+/).length;
  return Math.max(2, Math.ceil(words / 200));
}

async function main() {
  console.log('=== Incremental Blog Generator ===\n');

  // Load existing articles
  const existingArticles = loadExistingArticles();

  console.log('Fetching repositories...');
  const repos = await fetchRepos();
  const forkCount = repos.filter(r => r._type === 'fork').length;
  const ownedCount = repos.filter(r => r._type === 'original').length;
  console.log(`Found ${repos.length} repos (${forkCount} forks, ${ownedCount} original)\n`);

  const recentRepos = repos.slice(0, CONFIG.reposToShow);

  // Separate repos into: needs generation vs already has article
  const needsGeneration = [];
  const hasArticle = [];

  for (const repo of recentRepos) {
    const existing = existingArticles.get(repo.id);
    if (existing && !isFallbackArticle(existing.summary)) {
      hasArticle.push({ repo, existing });
    } else {
      needsGeneration.push(repo);
    }
  }

  console.log(`Articles status:`);
  console.log(`  - Already have good articles: ${hasArticle.length}`);
  console.log(`  - Need AI generation: ${needsGeneration.length}\n`);

  const forks = [];
  let aiCallCount = 0;

  // First, add repos that already have good articles (no AI call needed)
  for (const { repo, existing } of hasArticle) {
    const detailed = await fetchRepoDetails(repo);
    forks.push({
      ...existing,
      // Update metadata but keep the article
      description: repo.description || existing.description,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      topics: detailed.topics || existing.topics || [],
      parent: detailed.parent || existing.parent,
      type: repo._type,
      updatedAt: formatDate(repo.updated_at),
    });
  }
  console.log(`Preserved ${hasArticle.length} existing articles\n`);

  // Generate articles only for repos that need it
  if (needsGeneration.length > 0) {
    console.log(`Generating articles for ${needsGeneration.length} repos (7s delay between AI calls)...\n`);

    let consecutiveRateLimits = 0;
    let aiSuccessCount = 0;
    let rateLimitHit = false;

    for (let i = 0; i < needsGeneration.length; i++) {
      const repo = needsGeneration[i];
      console.log(`Processing ${i + 1}/${needsGeneration.length}: ${repo.name}`);

      const [detailed, readme, fileTree] = await Promise.all([
        fetchRepoDetails(repo),
        fetchReadme(repo),
        fetchRepoTree(repo)
      ]);

      console.log(`  - README: ${readme ? `${readme.length} chars` : 'not found'}`);
      console.log(`  - Files: ${fileTree.length} discovered`);

      // Try to generate AI article (skip if rate limited)
      let article = null;
      if (!rateLimitHit) {
        article = await generateBlogArticle(detailed, readme, fileTree);
        aiCallCount++;

        if (article) {
          consecutiveRateLimits = 0;
          aiSuccessCount++;
        } else {
          consecutiveRateLimits++;
          // Stop trying AI after 3 consecutive failures (likely rate limited)
          if (consecutiveRateLimits >= 3) {
            console.log(`\n⚠️  Rate limit detected. Skipping AI for remaining ${needsGeneration.length - i - 1} repos.`);
            console.log(`   Successfully generated ${aiSuccessCount} AI articles before limit.\n`);
            rateLimitHit = true;
          }
        }
      }

      // Prefer: AI article > existing article > fallback
      const existing = existingArticles.get(repo.id);
      const finalArticle = article || (existing && existing.summary) || generateFallbackSummary(repo);
      const source = article ? 'AI generated' : (existing && existing.summary) ? 'preserved' : 'fallback';
      console.log(`  - Article: ${finalArticle.length} chars (${source})`);

      forks.push({
        id: repo.id,
        name: repo.name,
        displayName: repo.name.replace(/-/g, ' ').replace(/_/g, ' '),
        description: repo.description || 'No description available',
        summary: finalArticle,
        url: repo.html_url,
        language: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        topics: detailed.topics || [],
        parent: detailed.parent || null,
        type: repo._type || 'fork',
        image: (existing && existing.image) || getRandomUnsplashUrl(i),
        forkedAt: formatDate(repo.created_at),
        updatedAt: formatDate(repo.updated_at),
        readTime: estimateReadTime(finalArticle)
      });

      // Rate limiting delay (only between AI calls, skip if rate limited)
      if (!rateLimitHit && i < needsGeneration.length - 1) {
        await new Promise(r => setTimeout(r, CONFIG.apiDelay));
      }
    }

    console.log(`\nAI generation summary: ${aiSuccessCount} successful, ${needsGeneration.length - aiSuccessCount} fallback`);
  }

  // Sort by updated date
  forks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const output = {
    lastUpdated: new Date().toISOString(),
    generatedWith: 'GitHub Models API (GPT-4o)',
    totalRepos: forks.length,
    aiGeneratedCount: aiCallCount,
    forks
  };

  fs.writeFileSync('forks.json', JSON.stringify(output, null, 2));
  console.log(`\n=== Complete ===`);
  console.log(`Total repos: ${forks.length}`);
  console.log(`AI calls made: ${aiCallCount}`);
  console.log(`Preserved existing: ${hasArticle.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
