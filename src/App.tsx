import React, { useState, useEffect, useCallback } from 'react';
import { NewsCategory, NewsItem, AdItem, ReactionType, ReactionCounts } from './types';
import { SAVED_CATEGORY_KEY, CATEGORIES, SITE_TITLE_BASE } from './constants/config';
import { useTheme } from './hooks/useTheme';
import { useSystemFont } from './hooks/useSystemFont';
import { useLockBodyScroll } from './hooks/useLockBodyScroll';
import { Header } from './components/Header';
import { CategoryNav, scrollActiveCategoryIntoView, getPillTopicId, resolvePillSearchQuery } from './components/CategoryNav';
import { NewsCard } from './components/NewsCard';
import { StoryEditView } from './components/StoryEditView';
import { useAdminStatus } from './hooks/useAdminStatus';
import { AdCard } from './components/AdCard';
import { StoryModal } from './components/StoryModal';
import { Footer } from './components/Footer';
import { InfoDialog } from './components/InfoDialog';
import { AboutPage } from './components/AboutPage';
import { TasteReaderPage } from './components/TasteReaderPage';
import { SettingsDialog } from './components/SettingsDialog';
import { SignInDialog, getSavedPendingOtpEmail } from './components/SignInDialog';
import { ProfileDialog, ProfileDialogTab } from './components/ProfileDialog';
import { PublicProfilePage } from './components/PublicProfilePage';
import { SpacePage } from './components/SpacePage';
import { SpaceRoutePage } from './components/SpaceRoutePage';
import { WorksheetsPanel } from './components/WorksheetsPanel';
import { FallingEmojis } from './components/FallingEmojis';
import { LilPage } from './components/LilPage';
import { LilAvatar } from './components/LilAvatar';
import type { OpenProfileTarget } from './components/PlayroomPage';
import { useAuth } from './contexts/AuthContext';
import type { PillConfig } from './contexts/AuthContext';
import { fetchNewsFeed, getCachedNewsFeed, prefetchCategoriesInBackground } from './services/newsService';
import { fetchAdsForCategory, getCachedAdsForCategory, fetchMatchedAdIds } from './services/adsService';
import {
  fetchReactionsForStories,
  toggleStoryReaction,
  subscribeToReactions,
  getStoryId
} from './services/supabaseService';
import { trackStoryDwell } from './services/trackingService';
import {
  parseTopicFromUrl,
  parseStoryFromUrl,
  parseActivityFromUrl,
  getTopicHref,
  getStoryHref,
  matchesStoryParam,
  isCustomTopic,
  isValidCategory,
  formatCustomTopicLabel,
  parseLilFromUrl
} from './services/urlService';
import { t, TranslationStrings, getDetectedLocale } from './constants/translations';
import { getCategoryDescription } from './constants/categoryDescriptions';

/** Extracts a `@username` profile route from the URL path, e.g. `/@katie`. */
function parseProfileFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/@([a-z0-9_]{3,30})\/?$/i);
  return match ? match[1].toLowerCase() : null;
}

/** Extracts a `@username/slug` playroom-or-space route, e.g. `/@katie/my-playroom`. */
function parsePlayroomOrSpaceFromUrl(): { username: string; slug: string } | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/@([a-z0-9_]{3,30})\/([a-z0-9-_]{1,50})\/?$/i);
  return match ? { username: match[1].toLowerCase(), slug: match[2].toLowerCase() } : null;
}

/** Extracts a `@username/spaces/spaceslug` direct space route, e.g. `/@katie/spaces/cozy-reads`. */
function parseSpaceFromUrl(): { username: string; slug: string } | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/@([a-z0-9_]{3,30})\/spaces\/([a-z0-9-_]{1,50})\/?$/i);
  return match ? { username: match[1].toLowerCase(), slug: match[2].toLowerCase() } : null;
}

/** Extracts a `@username/playroomslug/spaceslug` playroom-context space route. */
function parsePlayroomSpaceFromUrl(): { username: string; playroom: string; space: string } | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/@([a-z0-9_]{3,30})\/([a-z0-9-_]{1,50})\/([a-z0-9-_]{1,50})\/?$/i);
  if (!match) return null;
  if (match[2].toLowerCase() === 'spaces') return null; // reserved for the direct space route
  return {
    username: match[1].toLowerCase(),
    playroom: match[2].toLowerCase(),
    space: match[3].toLowerCase(),
  };
}

/** True when on the standalone `/about` landing page. */
function parseAboutFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return /^\/about\/?$/i.test(window.location.pathname);
}

/** True when on the standalone `/taste-reader` page. */
function parseTasteReaderFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return /^\/taste-reader\/?$/i.test(window.location.pathname);
}

/**
 * Prioritizes stories matching the user's interests (from their profile).
 * Stories matching an interest come first (preserving their relative order),
 * followed by non-matching stories. Used on the homepage for signed-in users.
 */
function prioritizeByInterests(stories: NewsItem[], interests: PillConfig[]): NewsItem[] {
  if (!interests.length) return stories;

  const matchesInterest = (story: NewsItem): boolean => {
    const haystack = `${story.title || ''} ${story.description || ''}`.toLowerCase();
    return interests.some((pill) => {
      if (pill.type === 'category') {
        return story.category === pill.id;
      }
      // Custom interest: match keywords or label in title/description
      const terms: string[] = [];
      if (pill.keywords) {
        terms.push(...pill.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean));
      }
      if (pill.label) {
        terms.push(pill.label.toLowerCase());
      }
      return terms.some((term) => term.length > 1 && haystack.includes(term));
    });
  };

  const matching: NewsItem[] = [];
  const rest: NewsItem[] = [];
  for (const story of stories) {
    (matchesInterest(story) ? matching : rest).push(story);
  }
  return [...matching, ...rest];
}

export const App: React.FC = () => {
  const { theme, setTheme } = useTheme();
  useSystemFont();
  const { profile } = useAuth();
  const { isAdmin, checking: checkingAdmin } = useAdminStatus();
  const [adminEditStory, setAdminEditStory] = useState<NewsItem | null>(null);
  const [emojiPoints, setEmojiPoints] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('littlables_emoji_points');
      const parsed = saved ? parseInt(saved, 10) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const [lastCollectedEmoji, setLastCollectedEmoji] = useState<string>('🎃');
  const [gameEnabled, setGameEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('littlables_emoji_game_enabled');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  const handleToggleGame = useCallback(() => {
    setGameEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('littlables_emoji_game_enabled', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleCollectEmoji = useCallback((emoji: string) => {
    setLastCollectedEmoji(emoji);
    setEmojiPoints((prev) => {
      const next = prev + 1;
      try {
        localStorage.setItem('littlables_emoji_points', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Apply custom background color from profile (overrides theme).
  // Setting --news-bg on :root flows into body, header, and footer,
  // which all use var(--news-bg).
  useEffect(() => {
    const bg = profile?.background_color;
    if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
      document.documentElement.style.setProperty('--news-bg', bg);
    } else {
      document.documentElement.style.removeProperty('--news-bg');
    }
  }, [profile?.background_color]);

  const [category, setCategoryState] = useState<NewsCategory>(() => {
    const urlTopic = parseTopicFromUrl();
    if (urlTopic) {
      return urlTopic;
    }
    try {
      const saved = localStorage.getItem(SAVED_CATEGORY_KEY) as NewsCategory;
      if (CATEGORIES.some(c => c.id === saved)) {
        return saved;
      }
    } catch {}
    return 'all';
  });

  const [stories, setStories] = useState<NewsItem[]>(() => getCachedNewsFeed(category) || []);
  const [ads, setAds] = useState<AdItem[]>(() => getCachedAdsForCategory(category) || []);
  // Per-story keyword-matched ads: story index -> matched AdItem (computed after load)
  const [storyAds, setStoryAds] = useState<Record<number, AdItem>>({});
  const [reactions, setReactions] = useState<Record<string, ReactionCounts>>({});
  const [isLoading, setIsLoading] = useState<boolean>(() => !getCachedNewsFeed(category));
  const [error, setError] = useState<string | null>(null);
  const [profileRoute, setProfileRoute] = useState<string | null>(() => parseProfileFromUrl());
  const [playroomOrSpaceRoute, setPlayroomOrSpaceRoute] = useState<{ username: string; slug: string } | null>(() => parsePlayroomOrSpaceFromUrl());
  const [spaceRoute, setSpaceRoute] = useState<{ username: string; slug: string } | null>(() => parseSpaceFromUrl());
  const [playroomSpaceRoute, setPlayroomSpaceRoute] = useState<{ username: string; playroom: string; space: string } | null>(() => parsePlayroomSpaceFromUrl());
  const [aboutRoute, setAboutRoute] = useState<boolean>(() => parseAboutFromUrl());
  const [lilRoute, setLilRoute] = useState<boolean>(() => parseLilFromUrl());
  const [tasteReaderRoute, setTasteReaderRoute] = useState<boolean>(() => parseTasteReaderFromUrl());

  const [activeStoryParam, setActiveStoryParam] = useState<string | null>(() => parseStoryFromUrl());
  const [selectedStory, setSelectedStory] = useState<{ item: NewsItem; index: number } | null>(null);
  const [activeDialog, setActiveDialog] = useState<'about' | 'disclaimer' | 'settings' | 'signin' | 'profile' | null>(() =>
    getSavedPendingOtpEmail() ? 'signin' : null
  );
  const [profileDialogTarget, setProfileDialogTarget] = useState<OpenProfileTarget | null>(null);

  const handleOpenProfile = useCallback((target?: OpenProfileTarget) => {
    setProfileDialogTarget(target || null);
    setActiveDialog('profile');
  }, []);

  // Lock background scrolling whenever any dialog/modal window is open,
  // so scrolling inside the window can't chain out to the page behind it.
  // The edit view is included: it must share this single lock, not manage
  // body overflow itself — two save/restore owners racing in the modal→view
  // transition left the page stuck unscrollable (footer unreachable) or
  // unlocked behind the view (flickery chained scrolling).
  useLockBodyScroll(activeDialog !== null || selectedStory !== null || adminEditStory !== null);

  // App-level toast popover: floats above everything, unaffected by layout,
  // and persists even if the dialog that triggered it is closed
  const [toast, setToast] = useState<{ key: number; message: string; kind: 'success' | 'error' } | null>(null);
  const toastTimer = React.useRef<number | null>(null);
  // Dwell tracking: when a story preview opens and in which category
  const dwellStartRef = React.useRef<{ item: NewsItem; category: string; startedAt: number } | null>(null);
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Set document title and lang from current locale and active route/story/topic.
  // Profile/playroom/space pages own their title (their names load async
  // inside the child page), so this effect leaves those routes alone.
  useEffect(() => {
    const locale = getDetectedLocale();
    document.documentElement.lang = locale.lang;
    document.documentElement.dir = locale.lang === 'ar' ? 'rtl' : 'ltr';
    if (profileRoute || playroomOrSpaceRoute || spaceRoute || playroomSpaceRoute) return;
    if (tasteReaderRoute) {
      document.title = `${SITE_TITLE_BASE} | The Reading Room (Taste Reader)`;
      return;
    }
    if (selectedStory?.item?.title) {
      document.title = `${SITE_TITLE_BASE} | ${selectedStory.item.title}`;
    } else if (lilRoute && isAdmin) {
      document.title = `${SITE_TITLE_BASE} | Ask Lil`;
    } else if (aboutRoute) {
      document.title = `${SITE_TITLE_BASE} | about`;
    } else if (category !== 'all') {
      const label = isCustomTopic(category)
        ? formatCustomTopicLabel(category)
        : t(CATEGORIES.find(c => c.id === category)?.i18nKey as keyof TranslationStrings) || category;
      document.title = `${SITE_TITLE_BASE} | ${label}`;
    } else {
      document.title = SITE_TITLE_BASE;
    }
  }, [selectedStory, category, profileRoute, playroomOrSpaceRoute, spaceRoute, playroomSpaceRoute, aboutRoute, lilRoute, tasteReaderRoute, isAdmin]);

  // Ensure initial URL reflects the active topic if not already in the address bar
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (profileRoute || playroomOrSpaceRoute || spaceRoute || playroomSpaceRoute || aboutRoute || lilRoute || tasteReaderRoute) return;
    const currentUrlTopic = parseTopicFromUrl();
    const currentStory = parseStoryFromUrl();
    const currentActivity = parseActivityFromUrl().isOpen;
    if (!currentUrlTopic && !currentStory && !currentActivity && category !== 'all') {
      const nextHref = getTopicHref(category);
      window.history.replaceState({ interest: category, balloon: null }, '', nextHref);
    }
  }, [lilRoute, tasteReaderRoute]);

  // Guard the /lil route: only accessible when logged in as admin.
  // If a non-admin directly visits /lil, return them to the home feed.
  useEffect(() => {
    if (checkingAdmin) return;
    if (lilRoute && !isAdmin) {
      setLilRoute(false);
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/lil')) {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [lilRoute, isAdmin, checkingAdmin]);

  // Listen to browser Back / Forward navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const urlLil = parseLilFromUrl();
      if (urlLil) {
        if (!isAdmin && !checkingAdmin) {
          setLilRoute(false);
        } else {
          setLilRoute(true);
          setAboutRoute(false);
          setTasteReaderRoute(false);
          setPlayroomOrSpaceRoute(null);
          setSpaceRoute(null);
          setPlayroomSpaceRoute(null);
          setProfileRoute(null);
        }
        return;
      }
      setLilRoute(false);
      const urlTasteReader = parseTasteReaderFromUrl();
      setTasteReaderRoute(urlTasteReader);
      if (urlTasteReader) {
        setAboutRoute(false);
        setLilRoute(false);
        setPlayroomOrSpaceRoute(null);
        setSpaceRoute(null);
        setPlayroomSpaceRoute(null);
        setProfileRoute(null);
        return;
      }
      const urlAbout = parseAboutFromUrl();
      setAboutRoute(urlAbout);
      if (urlAbout) {
        setPlayroomOrSpaceRoute(null);
        setSpaceRoute(null);
        setPlayroomSpaceRoute(null);
        setProfileRoute(null);
        return;
      }
      const urlPlayroomSpace = parsePlayroomSpaceFromUrl();
      setPlayroomSpaceRoute(urlPlayroomSpace);
      if (urlPlayroomSpace) {
        setTasteReaderRoute(false);
        setPlayroomOrSpaceRoute(null);
        setSpaceRoute(null);
        setProfileRoute(null);
        return;
      }
      const urlSpace = parseSpaceFromUrl();
      setSpaceRoute(urlSpace);
      if (urlSpace) {
        setTasteReaderRoute(false);
        setPlayroomOrSpaceRoute(null);
        setPlayroomSpaceRoute(null);
        setProfileRoute(null);
        return;
      }
      const urlPlayroomOrSpace = parsePlayroomOrSpaceFromUrl();
      setPlayroomOrSpaceRoute(urlPlayroomOrSpace);
      if (urlPlayroomOrSpace) {
        setTasteReaderRoute(false);
        setSpaceRoute(null);
        setPlayroomSpaceRoute(null);
        setProfileRoute(null);
        return;
      }
      setTasteReaderRoute(false);
      const urlProfile = parseProfileFromUrl();
      setProfileRoute(urlProfile);
      if (urlProfile) return;
      const urlTopic = parseTopicFromUrl();
      const urlStory = parseStoryFromUrl();
      if (urlTopic && urlTopic !== category) {
        setCategoryState(urlTopic);
      } else if (!urlTopic && window.location.pathname === '/' && !window.location.hash && category !== 'all') {
        setCategoryState('all');
      }
      setActiveStoryParam(urlStory);
      if (!urlStory) {
        setSelectedStory(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [category, isAdmin, checkingAdmin]);

  const activeCategoryRef = React.useRef<NewsCategory>(category);
  activeCategoryRef.current = category;

  const loadFeed = useCallback(async (cat: NewsCategory, options?: { forceRefresh?: boolean }) => {
    setError(null);

    const searchQuery = resolvePillSearchQuery(cat, profile?.pills);
    const adCategory = isValidCategory(searchQuery) ? searchQuery : (isValidCategory(cat) ? cat : 'all');

    // Instant cache hit: display cached stories & ads immediately without showing the loading skeleton
    const cachedStories = !options?.forceRefresh ? getCachedNewsFeed(searchQuery) : null;
    const cachedAds = !options?.forceRefresh ? getCachedAdsForCategory(adCategory) : null;

    if (cachedStories && cachedStories.length > 0) {
      const initialDisplay =
        cat === 'all' && profile?.pills && profile.pills.length > 0
          ? prioritizeByInterests(cachedStories, profile.pills)
          : cachedStories;
      setStories(initialDisplay);
      if (cachedAds && cachedAds.length > 0) {
        setAds(cachedAds);
      }
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    try {
      // Parallel fetch news and category/keyword-based ads
      const [fetched, categoryAds] = await Promise.all([
        fetchNewsFeed(searchQuery, options),
        fetchAdsForCategory(adCategory)
      ]);

      // Ignore stale responses if the user already switched to another space
      if (activeCategoryRef.current !== cat) return;

      // On the homepage, prioritize stories matching the user's interests
      let displayStories = fetched;
      if (cat === 'all' && profile?.pills && profile.pills.length > 0) {
        displayStories = prioritizeByInterests(fetched, profile.pills);
      }

      setStories(displayStories);
      setAds(categoryAds);
      setIsLoading(false);

      // Kick off background prefetch of other categories + user's custom spaces
      const extraTopics = profile?.pills
        ? profile.pills.map((p) => resolvePillSearchQuery(getPillTopicId(p), profile.pills))
        : undefined;
      prefetchCategoriesInBackground(extraTopics);

      // Keyword-match ads to stories server-side in the background (non-blocking).
      // Stories and rotational ads are already visible on screen.
      const adSlotStories = displayStories
        .map((story, index) => ({ story, index }))
        .filter(({ index }) => (index + 1) % 3 === 0)
        .map(({ story, index }) => ({ ...(story as any), _index: index }));

      if (adSlotStories.length > 0 && categoryAds.length > 0) {
        fetchMatchedAdIds(adSlotStories as any)
          .then((matches) => {
            if (activeCategoryRef.current !== cat) return;
            const adById = new Map<string, AdItem>();
            for (const ad of categoryAds) {
              if (ad.id) adById.set(ad.id, ad);
            }
            const matched: Record<number, AdItem> = {};
            for (const { index } of adSlotStories.map(s => ({ index: (s as any)._index }))) {
              const adIds = matches[index] || [];
              if (adIds.length > 0) {
                const slot = Math.floor(index / 3);
                const adId = adIds[slot % adIds.length];
                const ad = adById.get(adId);
                if (ad) matched[index] = ad;
              }
            }
            setStoryAds(matched);
          })
          .catch(() => {
            if (activeCategoryRef.current === cat) setStoryAds({});
          });
      } else {
        setStoryAds({});
      }

      // Fetch reactions for stories non-blocking
      if (displayStories.length > 0) {
        const storyIds = displayStories.map((s: NewsItem) => getStoryId(s.title, s.link));
        fetchReactionsForStories(storyIds)
          .then((reactionData) => {
            if (activeCategoryRef.current === cat) {
              setReactions(reactionData);
            }
          })
          .catch(() => {
            if (activeCategoryRef.current === cat) setReactions({});
          });
      } else {
        setReactions({});
      }
    } catch (err: any) {
      if (activeCategoryRef.current !== cat) return;
      console.error('Error loading stories:', err);
      if (!cachedStories || cachedStories.length === 0) {
        setError(err?.message || 'Unable to load stories.');
      }
    } finally {
      if (activeCategoryRef.current === cat) {
        setIsLoading(false);
      }
    }
  }, [profile?.pills]);

  useEffect(() => {
    if (aboutRoute || lilRoute || tasteReaderRoute || profileRoute || playroomOrSpaceRoute || spaceRoute || playroomSpaceRoute) return;
    loadFeed(category);
  }, [category, loadFeed, aboutRoute, lilRoute, tasteReaderRoute, profileRoute, playroomOrSpaceRoute, spaceRoute, playroomSpaceRoute]);

  // If the signed-in user customized their homepage pills and the current category
  // is no longer in their pill list (and wasn't explicitly navigated via URL ?interest=),
  // switch to the first available pill in their ordered interests.
  useEffect(() => {
    const userPills = profile?.pills;
    if (!userPills || userPills.length === 0) return;
    if (parseTopicFromUrl()) return;
    const availableTopics = userPills.map(getPillTopicId);
    if (!availableTopics.includes(category)) {
      const firstTopic = availableTopics[0];
      if (firstTopic) {
        setCategoryState(firstTopic);
      }
    }
  }, [profile?.pills, category]);

  // Resolve deep-linked story parameter when stories load or URL changes
  useEffect(() => {
    if (!activeStoryParam) {
      setSelectedStory(null);
      return;
    }

    if (stories.length > 0) {
      const matchIndex = stories.findIndex(s => matchesStoryParam(s, activeStoryParam));
      if (matchIndex !== -1) {
        setSelectedStory({ item: stories[matchIndex], index: matchIndex });
        return;
      }
    }

    // If not found in the active category feed, check the combined 'all' feed as fallback
    let cancelled = false;
    if (category !== 'all') {
      fetchNewsFeed('all')
        .then((allStories) => {
          if (cancelled) return;
          const idx = allStories.findIndex(s => matchesStoryParam(s, activeStoryParam));
          if (idx !== -1) {
            setSelectedStory({ item: allStories[idx], index: idx });
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [activeStoryParam, stories, category]);

  // Subscribe to real-time reactions
  useEffect(() => {
    const unsubscribe = subscribeToReactions((storyId, type, count) => {
      setReactions(prev => {
        const current = prev[storyId] || { love: 0, mind: 0, cozy: 0 };
        return {
          ...prev,
          [storyId]: {
            ...current,
            [type]: count
          }
        };
      });
    });

    return () => unsubscribe();
  }, []);

  const handleSelectCategory = (newCat: NewsCategory) => {
    activeCategoryRef.current = newCat;
    const searchQuery = resolvePillSearchQuery(newCat, profile?.pills);
    const adCategory = isValidCategory(searchQuery) ? searchQuery : (isValidCategory(newCat) ? newCat : 'all');
    const cached = getCachedNewsFeed(searchQuery);
    if (cached && cached.length > 0) {
      const display =
        newCat === 'all' && profile?.pills && profile.pills.length > 0
          ? prioritizeByInterests(cached, profile.pills)
          : cached;
      setStories(display);
      setIsLoading(false);
    }
    const cachedAds = getCachedAdsForCategory(adCategory);
    if (cachedAds && cachedAds.length > 0) {
      setAds(cachedAds);
    }
    setStoryAds({});
    setCategoryState(newCat);
    setSelectedStory(null);
    setActiveStoryParam(null);
    setAboutRoute(false);
    setProfileRoute(null);
    setPlayroomOrSpaceRoute(null);
    setSpaceRoute(null);
    setPlayroomSpaceRoute(null);
    if (isValidCategory(newCat)) {
      try {
        localStorage.setItem(SAVED_CATEGORY_KEY, newCat);
      } catch {}
    }
    if (typeof window !== 'undefined') {
      const nextHref = getTopicHref(newCat);
      window.history.pushState({ interest: newCat, balloon: null }, '', nextHref);
    }
  };

  // Landing page CTA: signed-in users go to their public profile ("your space"),
  // signed-out users get the sign-in dialog (account creation).
  const handleAboutCta = () => {
    if (profile?.username) {
      setActiveDialog(null);
      window.history.pushState({}, '', `/@${profile.username}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.scrollTo({ top: 0 });
    } else {
      setActiveDialog('signin');
    }
  };

  const handleHomeRefresh = () => {
    setSelectedStory(null);
    setActiveStoryParam(null);
    setProfileRoute(null);
    setPlayroomOrSpaceRoute(null);
    setSpaceRoute(null);
    setPlayroomSpaceRoute(null);
    setAboutRoute(false);
    setLilRoute(false);
    setTasteReaderRoute(false);
    const userPills = profile?.pills;
    const availableTopics = userPills && userPills.length > 0 ? userPills.map(getPillTopicId) : null;
    const defaultHomeTopic: NewsCategory =
      availableTopics && !availableTopics.includes('all') ? availableTopics[0] : 'all';
    try {
      localStorage.setItem(SAVED_CATEGORY_KEY, defaultHomeTopic);
    } catch {}
    if (typeof window !== 'undefined') {
      // Always return to the site root (clears any /@username profile path)
      const homeHref = getTopicHref(defaultHomeTopic);
      if (window.location.pathname + window.location.search !== homeHref) {
        window.history.pushState({ interest: defaultHomeTopic, balloon: null }, '', homeHref);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.requestAnimationFrame(() => {
        scrollActiveCategoryIntoView();
      });
    }
    if (category !== defaultHomeTopic) {
      handleSelectCategory(defaultHomeTopic);
    } else {
      loadFeed(defaultHomeTopic, { forceRefresh: true });
    }
  };

  const handleOpenLil = () => {
    if (!isAdmin) return;
    setSelectedStory(null);
    setActiveStoryParam(null);
    setProfileRoute(null);
    setPlayroomOrSpaceRoute(null);
    setSpaceRoute(null);
    setPlayroomSpaceRoute(null);
    setAboutRoute(false);
    setTasteReaderRoute(false);
    setLilRoute(true);
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== '/lil') {
        window.history.pushState({}, '', '/lil');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleOpenStory = (item: NewsItem, index: number) => {
    setSelectedStory({ item, index });
    // Start dwell timer for this story preview
    dwellStartRef.current = { item, category, startedAt: Date.now() };
    if (typeof window !== 'undefined') {
      const storyHref = getStoryHref(item, category);
      window.history.pushState({ interest: category, balloon: item.link }, '', storyHref);
      setActiveStoryParam(parseStoryFromUrl());
    }
  };

  const handleCloseStory = () => {
    // Send dwell time if the preview was open long enough
    const dwell = dwellStartRef.current;
    if (dwell) {
      const seconds = (Date.now() - dwell.startedAt) / 1000;
      trackStoryDwell(dwell.item, seconds, dwell.category);
      dwellStartRef.current = null;
    }
    setSelectedStory(null);
    setActiveStoryParam(null);
    if (typeof window !== 'undefined') {
      const topicHref = getTopicHref(category);
      window.history.pushState({ interest: category, balloon: null }, '', topicHref);
    }
  };

  const handleReaction = async (storyId: string, type: ReactionType) => {
    // Optimistic state update
    setReactions(prev => {
      const current = prev[storyId] || { love: 0, mind: 0, cozy: 0 };
      const currentVal = typeof current[type] === 'number' ? (current[type] as number) : 0;
      return {
        ...prev,
        [storyId]: {
          ...current,
          [type]: currentVal + 1
        }
      };
    });

    const result = await toggleStoryReaction(storyId, type);
    if (result.success && result.newCount != null) {
      setReactions(prev => {
        const current = prev[storyId] || { love: 0, mind: 0, cozy: 0 };
        return {
          ...prev,
          [storyId]: {
            ...current,
            [type]: result.newCount!
          }
        };
      });
    }
  };

  const getCategoryBadge = (storyCategory?: NewsCategory) => {
    if (isCustomTopic(category)) {
      return `🔍 ${formatCustomTopicLabel(category)}`;
    }
    const targetCat = storyCategory || category;
    const active = CATEGORIES.find(c => c.id === targetCat);
    if (active) {
      const icon = active.icon || '⚡';
      if (targetCat === 'all') return `${icon} ${t('breaking') || 'All'}`;
      return `${icon} ${t((active.i18nKey || 'catAll') as any)}`;
    }
    return `🔍 ${formatCustomTopicLabel(targetCat)}`;
  };

  const selectedStoryId = selectedStory
    ? getStoryId(selectedStory.item.title, selectedStory.item.link)
    : null;
  const selectedStoryReactions = selectedStoryId
    ? (reactions[selectedStoryId] || { love: 0, mind: 0, cozy: 0 })
    : { love: 0, mind: 0, cozy: 0 };

  const customTopicActive = isCustomTopic(category);
  const interleavedAdCount = customTopicActive
    ? Math.min(ads.length, Math.floor(stories.length / 3))
    : 0;
  const remainingCustomAds = customTopicActive
    ? ads.slice(interleavedAdCount)
    : [];

  return (
    <>
      <FallingEmojis onCollect={handleCollectEmoji} enabled={gameEnabled} />
      <LilAvatar isLilPage={lilRoute} />
      <div className="news-widget-wrapper">
        <Header
          onHomeClick={handleHomeRefresh}
          onOpenSettings={() => setActiveDialog('settings')}
          onOpenSignIn={() => setActiveDialog('signin')}
          onOpenProfile={() => handleOpenProfile()}
          isLoading={isLoading}
          isAdmin={isAdmin}
          emojiPoints={emojiPoints}
          lastCollectedEmoji={lastCollectedEmoji}
          gameEnabled={gameEnabled}
          onToggleGame={handleToggleGame}
          onOpenLil={isAdmin ? handleOpenLil : undefined}
          isLilActive={lilRoute && isAdmin}
        />

        <WorksheetsPanel />

        {/* Category nav is hidden on standalone lil/about/taste-reader/profile/playroom/space pages — those show their own views, not the main feed. */}
        {!aboutRoute && !(lilRoute && isAdmin) && !tasteReaderRoute && !profileRoute && !playroomOrSpaceRoute && !spaceRoute && !playroomSpaceRoute && (
          <CategoryNav
            currentCategory={category}
            onSelectCategory={handleSelectCategory}
            userPills={profile?.pills}
          />
        )}

        {lilRoute && isAdmin ? (
          <main className="news-grid lil-main-grid">
            <LilPage onHome={handleHomeRefresh} />
          </main>
        ) : aboutRoute ? (
          <main className="news-grid">
            <AboutPage
              onExplore={handleHomeRefresh}
              onSignIn={handleAboutCta}
              signedIn={!!profile?.username}
            />
          </main>
        ) : tasteReaderRoute ? (
          <main className="news-grid">
            <TasteReaderPage onSignIn={handleAboutCta} />
          </main>
        ) : playroomSpaceRoute ? (
          <SpacePage
            username={playroomSpaceRoute.username}
            slug={playroomSpaceRoute.space}
            playroomSlug={playroomSpaceRoute.playroom}
            onHome={handleHomeRefresh}
            onOpenProfile={handleOpenProfile}
          />
        ) : spaceRoute ? (
          <SpacePage
            username={spaceRoute.username}
            slug={spaceRoute.slug}
            onHome={handleHomeRefresh}
            onOpenProfile={handleOpenProfile}
          />
        ) : playroomOrSpaceRoute ? (
          <SpaceRoutePage
            username={playroomOrSpaceRoute.username}
            slug={playroomOrSpaceRoute.slug}
            onHome={handleHomeRefresh}
            onOpenProfile={handleOpenProfile}
          />
        ) : profileRoute ? (
          <PublicProfilePage
            username={profileRoute}
            onHome={handleHomeRefresh}
            onOpenProfile={handleOpenProfile}
          />
        ) : (
        <main id="news-grid-container" className="news-grid">
          {isLoading && stories.length === 0 && ads.length === 0 ? (
            <>
              <div className="news-loading-skeleton" id="news-loading-text" role="status">
                {t('loading') || 'Fetching the freshest stories...'}
              </div>
              {Array.from({ length: 6 }).map((_, idx) => (
                <article key={`skeleton-${idx}`} className="news-card news-skeleton-card" aria-hidden="true">
                  <div className="news-card-image-wrap" />
                  <div className="news-card-content">
                    <div className="news-skeleton-line short" />
                    <div className="news-skeleton-line title" />
                    <div className="news-skeleton-line" />
                    <div className="news-skeleton-line medium" />
                  </div>
                </article>
              ))}
            </>
          ) : error && stories.length === 0 && ads.length === 0 ? (
            <div className="news-feed-error" role="alert">
              <p>{t('error') || 'Unable to load live wire right now.'}</p>
              <button
                className="refresh-news-button"
                onClick={() => loadFeed(category)}
                style={{ marginTop: '0.75rem' }}
              >
                🔄 Try Again
              </button>
            </div>
          ) : customTopicActive && stories.length === 0 && ads.length === 0 ? (
            <div className="news-feed-error" role="status">
              <p>
                No stories or partner discoveries found for{' '}
                <strong>"{formatCustomTopicLabel(category)}"</strong>.
              </p>
              <button
                className="refresh-news-button"
                onClick={() => handleSelectCategory('all')}
                style={{ marginTop: '0.75rem' }}
              >
                ⚡ View All
              </button>
            </div>
          ) : !customTopicActive && stories.length === 0 && ads.length === 0 ? (
            <div className="news-feed-error" role="status">
              {(() => {
                const desc = getCategoryDescription(category);
                const catInfo = CATEGORIES.find(c => c.id === category);
                const label = catInfo ? t((catInfo.i18nKey || 'catAll') as any) : category;
                return (
                  <>
                    <p>
                      <strong>{catInfo?.icon} {label}</strong>
                    </p>
                    {desc && <p style={{ marginTop: '0.5rem', opacity: 0.85 }}>{desc}</p>}
                    <p style={{ marginTop: '0.5rem' }}>
                      No stories here yet — check back soon!
                    </p>
                  </>
                );
              })()}
              <button
                className="refresh-news-button"
                onClick={() => handleSelectCategory('all')}
                style={{ marginTop: '0.75rem' }}
              >
                ⚡ View All
              </button>
            </div>
          ) : (
            <>
              {stories.map((story, index) => {
                const storyId = getStoryId(story.title, story.link);
                const cardReactions = reactions[storyId] || { love: 0, mind: 0, cozy: 0 };
                const storyBadge = getCategoryBadge(story.category);

                const shouldInsertAd = (index + 1) % 3 === 0;
                const adIndex = Math.floor(index / 3);
                // Prefer keyword-matched ad for this story; fall back to rotation.
                const currentAd = storyAds[index] || (customTopicActive
                  ? (adIndex < ads.length ? ads[adIndex] : null)
                  : (ads && ads.length > 0 ? ads[adIndex % ads.length] : null));

                return (
                  <React.Fragment key={`${story.link}-${index}`}>
                    <NewsCard
                      item={story}
                      index={index}
                      category={category}
                      categoryBadge={storyBadge}
                      reactions={cardReactions}
                      onReact={handleReaction}
                      onOpenStory={handleOpenStory}
                      onAdminEdit={isAdmin ? setAdminEditStory : undefined}
                    />

                    {shouldInsertAd && currentAd && (
                      <AdCard ad={currentAd} category={category} />
                    )}
                  </React.Fragment>
                );
              })}

              {customTopicActive &&
                remainingCustomAds.map((ad, idx) => (
                  <AdCard
                    key={`custom-ad-${ad.url || ''}-${ad.title}-${idx}`}
                    ad={ad}
                    category={category}
                  />
                ))}
            </>
          )}
        </main>
        )}
      </div>

      <StoryModal
        story={selectedStory?.item || null}
        index={selectedStory?.index || 0}
        category={category}
        categoryBadge={selectedStory ? getCategoryBadge(selectedStory.item.category) : ''}
        reactions={selectedStoryReactions}
        onReact={handleReaction}
        onClose={handleCloseStory}
        onSelectCategory={handleSelectCategory}
        onAdminEdit={isAdmin ? setAdminEditStory : undefined}
      />

      {adminEditStory && (
        <StoryEditView
          story={adminEditStory}
          onClose={() => setAdminEditStory(null)}
          onSaved={() => loadFeed(category)}
        />
      )}

      <Footer
        onOpenAbout={() => setActiveDialog('about')}
        onOpenDisclaimer={() => setActiveDialog('disclaimer')}
        onOpenLil={isAdmin ? handleOpenLil : undefined}
      />

      <InfoDialog
        id="about"
        isOpen={activeDialog === 'about'}
        onClose={() => setActiveDialog(null)}
        onSignIn={handleAboutCta}
        signedIn={!!profile?.username}
      />

      <InfoDialog
        id="disclaimer"
        isOpen={activeDialog === 'disclaimer'}
        onClose={() => setActiveDialog(null)}
      />

      <SettingsDialog
        isOpen={activeDialog === 'settings'}
        onClose={() => setActiveDialog(null)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <SignInDialog
        isOpen={activeDialog === 'signin'}
        onClose={() => setActiveDialog(null)}
      />

      <ProfileDialog
        isOpen={activeDialog === 'profile'}
        onClose={() => {
          setActiveDialog(null);
          setProfileDialogTarget(null);
        }}
        notify={notify}
        initialTab={profileDialogTarget?.tab as ProfileDialogTab | undefined}
        initialEditPlayroomId={profileDialogTarget?.playroomId || null}
        initialEditPlayroom={profileDialogTarget?.playroom || null}
        initialEditPlayroomSpaces={profileDialogTarget?.playroomSpaces || null}
        initialEditSpaceId={profileDialogTarget?.spaceId || null}
        initialEditSpace={profileDialogTarget?.space || null}
      />

      {toast && (
        <div key={toast.key} className={`toast-popover toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </>
  );
};

export default App;
