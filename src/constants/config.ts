import { NewsCategory, ThemeId, NewsItem } from '../types';

export const SAVED_CATEGORY_KEY = 'selected_category';
export const SAVED_THEME_KEY = 'selected_theme';
export const DEFAULT_THEME: ThemeId = 'dark-purple';

/** Browser tab title base; page-specific names append as ` | <name>`. */
export const SITE_TITLE_BASE = 'littlables | discovery playroom';

export const CATEGORIES: { id: NewsCategory; icon: string; i18nKey: string }[] = [
  { id: 'all', icon: '⚡', i18nKey: 'catAll' },
  { id: 'childcare', icon: '👨‍👩‍👧', i18nKey: 'catChildcare' },
  { id: 'animals', icon: '🐾', i18nKey: 'catAnimals' },
  { id: 'arts', icon: '🎨', i18nKey: 'catArts' },
  { id: 'tech', icon: '🤖', i18nKey: 'catTech' },
  { id: 'world', icon: '🌍', i18nKey: 'catWorld' },
  { id: 'uplifting', icon: '✨', i18nKey: 'catUplifting' }
];

export const THEMES: { id: ThemeId; name: string; icon: string }[] = [
  { id: 'dark-purple', name: 'Dark Purple', icon: '🔮' },
  { id: 'dark', name: 'Dark Mode', icon: '🌙' },
  { id: 'light', name: 'Light Mode', icon: '☀️' },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈' },
  { id: 'pastel-rainbow', name: 'Pastel Rainbow', icon: '🦄' },
  { id: 'pink', name: 'Pretty Pink', icon: '💖' }
];

export const CATEGORY_STOCK_IMAGES: Record<NewsCategory, string[]> = {
  animals: Array.from({ length: 10 }, (_, i) => `/img/animals_${i + 1}.jpg`),
  childcare: Array.from({ length: 10 }, (_, i) => `/img/animals_${i + 1}.jpg`),
  tech: Array.from({ length: 10 }, (_, i) => `/img/tech_${i + 1}.jpg`),
  arts: Array.from({ length: 10 }, (_, i) => `/img/arts_${i + 1}.jpg`),
  world: Array.from({ length: 10 }, (_, i) => `/img/world_${i + 1}.jpg`),
  uplifting: Array.from({ length: 10 }, (_, i) => `/img/uplifting_${i + 1}.jpg`),
  all: Array.from({ length: 10 }, (_, i) => `/img/all_${i + 1}.jpg`)
};

export const NEWS_CONFIG = {
  maxStories: 10,
  workerUrl: 'https://hello-ai.cryptokatiee.workers.dev/'
};

export const LIL_CONFIG = {
  openWebUIUrl: 'https://lil.littlables.com/'
};

export const SUPABASE_CONFIG = Object.freeze({
  url: 'https://vehbstectghtqqyiitmi.supabase.co',
  publishableKey: 'sb_publishable_NNWeMzQK6GCcsAl4Ij1iiw_1sT0v44k',
  tableName: 'article_reactions'
});

export const FALLBACK_STORIES: Record<NewsCategory, NewsItem[]> = {
  all: [
    {
      title: "Community Gardens Bloom Across Cities, Fostering Intergenerational Connection",
      link: "https://news.google.com",
      image: "img/all_1.jpg",
      description: "Neighborhood initiatives are bringing families together to cultivate organic produce, pollinator-friendly flowers, and shared green spaces.",
      aiSummary: "Urban gardening projects are surging in popularity, creating vibrant educational outdoor hubs for children and grandparents alike.",
      pubDate: new Date().toISOString(),
      approved: true
    },
    {
      title: "Breakthrough Solar Tile Technologies Power Sustainable Family Homes",
      link: "https://news.google.com",
      image: "img/tech_2.jpg",
      description: "Modern architectural innovations integrate efficient clean energy solutions directly into aesthetic building materials.",
      aiSummary: "New solar integrations allow residences to generate clean power reliably while blending into traditional home designs.",
      pubDate: new Date(Date.now() - 3600000).toISOString(),
      approved: true
    }
  ],
  childcare: [
    {
      title: "Play-Based Learning Proven to Boost Cognitive and Social Resilience in Early Childhood",
      link: "https://news.google.com",
      image: "img/animals_2.jpg",
      description: "Pediatric researchers emphasize the long-term emotional benefits of open-ended sensory play, creative storytelling, and outdoor discovery.",
      aiSummary: "Studies confirm that child-led unstructured exploration fosters collaborative problem-solving and emotional regulation.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ],
  animals: [
    {
      title: "Wildlife Sanctuaries Report Milestone Recoveries for Endangered River Otters",
      link: "https://news.google.com",
      image: "img/animals_1.jpg",
      description: "Conservation partnerships and freshwater protection acts have enabled river otter populations to thrive across historical habitats.",
      aiSummary: "River otter numbers have doubled across restored river basins thanks to community cleanups and wetland protection.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ],
  arts: [
    {
      title: "Youth Makerspaces Revive Traditional Bookbinding and Botanical Watercolors",
      link: "https://news.google.com",
      image: "img/arts_1.jpg",
      description: "Hands-on creative workshops offer young artists an opportunity to combine tactile craft traditions with contemporary digital illustration.",
      aiSummary: "Makerspaces are reporting record engagement as teens and families embrace tactile art-making and natural pigments.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ],
  tech: [
    {
      title: "Friendly Assistive Robots Designed to Encourage Reading in Early Education",
      link: "https://news.google.com",
      image: "img/tech_1.jpg",
      description: "Gentle interactive companions provide adaptive pacing and encouraging audio cues for emerging young readers.",
      aiSummary: "Educational robotic buddies engage young readers with personalized stories, voice prompts, and expressive animated eyes.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ],
  world: [
    {
      title: "International Clean Coast Initiative Gathers Record Youth Volunteers Globally",
      link: "https://news.google.com",
      image: "img/world_1.jpg",
      description: "Tens of thousands of volunteers collected marine debris along coastal stretches spanning six continents.",
      aiSummary: "Coordinated beach cleanups and microplastic research by citizen scientists achieved historical community participation.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ],
  uplifting: [
    {
      title: "Neighborhood Library Box Program Reaches Millionth Book Donated",
      link: "https://news.google.com",
      image: "img/uplifting_1.jpg",
      description: "The grassroots 'take a book, share a book' movement celebrates a remarkable milestone in literacy and kindness.",
      aiSummary: "Community-driven micro-libraries across suburban and rural towns reached over one million shared children's and family books.",
      pubDate: new Date().toISOString(),
      approved: true
    }
  ]
};
