const fs = require('fs');

const GITHUB_USERNAME = 'moses-y';
const FORKS_TO_SHOW = 9;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Topic to Unsplash keyword mapping
const topicKeywords = {
  'ai': 'artificial-intelligence,neural',
  'machine-learning': 'data-science,algorithm',
  'python': 'code,programming',
  'javascript': 'web-development,code',
  'typescript': 'software,technology',
  'react': 'interface,design',
  'data': 'analytics,visualization',
  'blockchain': 'cryptocurrency,digital',
  'web': 'website,digital',
  'mobile': 'smartphone,app',
  'game': 'gaming,controller',
  'security': 'cybersecurity,lock',
  'cloud': 'server,cloud-computing',
  'database': 'server,data',
  'api': 'connection,network',
  'automation': 'robot,technology',
  'bot': 'robot,ai',
  'agent': 'ai,futuristic',
  'llm': 'brain,artificial-intelligence',
  'gpt': 'chat,ai',
  'neural': 'brain,network',
  'deep-learning': 'neural,brain',
  'kubernetes': 'container,cloud',
  'docker': 'container,server',
  'devops': 'infrastructure,code'
};

function getImageKeyword(repo) {
  const text = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`.toLowerCase();

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (text.includes(topic)) {
      return keywords;
    }
  }

  return 'technology,code';
}

function getUnsplashUrl(keyword, seed) {
  return `https://images.unsplash.com/photo-${seed}?w=800&h=400&fit=crop&q=80`;
}

// Curated Unsplash photo IDs for tech/coding themes
const unsplashPhotos = [
  '1461749280684-dccba630e2f6', // code on screen
  '1555066931-4365d14bab8c', // laptop code
  '1504639725590-34d0984388bd', // programming
  '1526374965328-7f61d4dc18c5', // abstract tech
  '1518770660439-4636190af475', // circuit board
  '1451187580459-43490279c0fa', // earth from space
  '1550751827-4bd374c3f58b', // server room
  '1558494949-ef010cbdcc31', // AI brain
  '1485827404703-89b55fcc595e', // robot
  '1531482615713-2afd69097998', // coding workspace
  '1542831371-29b0f74f9713', // code syntax
  '1607799279861-4dd421887fb3', // dark code
];

function getRandomUnsplashUrl(index) {
  const photoId = unsplashPhotos[index % unsplashPhotos.length];
  return `https://images.unsplash.com/photo-${photoId}?w=800&h=400&fit=crop&q=80`;
}

async function generateBlogSummary(repo) {
  if (!GITHUB_TOKEN) {
    return generateFallbackSummary(repo);
  }

  try {
    const prompt = `Write a brief, engaging 2-3 sentence blog-style summary about this GitHub repository. Be insightful and highlight why a developer might find it interesting. Don't use emojis or marketing fluff.

Repository: ${repo.name}
Description: ${repo.description || 'No description provided'}
Language: ${repo.language || 'Not specified'}
Topics: ${(repo.topics || []).join(', ') || 'None'}

Write only the summary, nothing else:`;

    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.log(`AI API returned ${response.status}, using fallback`);
      return generateFallbackSummary(repo);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (summary && summary.length > 20) {
      return summary;
    }

    return generateFallbackSummary(repo);
  } catch (error) {
    console.log(`AI generation failed for ${repo.name}:`, error.message);
    return generateFallbackSummary(repo);
  }
}

function generateFallbackSummary(repo) {
  const desc = repo.description || '';
  const lang = repo.language || 'various technologies';
  const name = repo.name.replace(/-/g, ' ').replace(/_/g, ' ');

  if (desc.length > 50) {
    return desc;
  }

  const templates = [
    `A compelling ${lang} project that explores ${name}. Worth diving into for developers interested in modern software patterns and clean implementations.`,
    `${name} offers an interesting approach built with ${lang}. The codebase demonstrates practical solutions that could accelerate your next project.`,
    `Exploring ${name} — a ${lang} repository that caught my attention. It showcases techniques worth understanding for any serious developer.`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

async function fetchForks() {
  const response = await fetch(
    `https://api.github.com/users/${GITHUB_USERNAME}/repos?type=forks&sort=updated&per_page=100`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitHub-Pages-Forks-Feed',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
}

async function fetchRepoDetails(repo) {
  try {
    const response = await fetch(repo.url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitHub-Pages-Forks-Feed',
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
  } catch (e) {
    console.log(`Could not fetch details for ${repo.name}`);
  }
  return repo;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function estimateReadTime(description) {
  const words = (description || '').split(' ').length;
  return Math.max(2, Math.ceil(words / 200));
}

async function main() {
  console.log('Fetching forked repositories...');

  const repos = await fetchForks();
  console.log(`Found ${repos.length} forked repos`);

  const recentForks = repos.slice(0, FORKS_TO_SHOW);

  console.log('Fetching repo details and generating summaries...');

  const forks = [];

  for (let i = 0; i < recentForks.length; i++) {
    const repo = recentForks[i];
    console.log(`Processing ${i + 1}/${recentForks.length}: ${repo.name}`);

    const detailed = await fetchRepoDetails(repo);
    const summary = await generateBlogSummary(detailed);

    forks.push({
      id: repo.id,
      name: repo.name,
      displayName: repo.name.replace(/-/g, ' ').replace(/_/g, ' '),
      description: repo.description || 'No description available',
      summary: summary,
      url: repo.html_url,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      topics: detailed.topics || [],
      parent: detailed.parent || null,
      image: getRandomUnsplashUrl(i),
      forkedAt: formatDate(repo.created_at),
      updatedAt: formatDate(repo.updated_at),
      readTime: estimateReadTime(summary)
    });

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    generatedWith: 'GitHub Models API',
    forks
  };

  fs.writeFileSync('forks.json', JSON.stringify(output, null, 2));
  console.log(`Generated forks.json with ${forks.length} repos`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
