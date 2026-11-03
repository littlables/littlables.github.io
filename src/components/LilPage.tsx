import React, { useState, useEffect, useRef } from 'react';
import { getSupabaseClient } from '../services/supabaseService';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { LIL_CONFIG, NEWS_CONFIG } from '../constants/config';

export interface LilSource {
  title: string;
  url: string;
  domain?: string;
}

export interface LilSearchResult {
  query: string;
  answer: string;
  searchQueries: string[];
  sources: LilSource[];
  apiKeyNotice?: string;
  provider?: string;
  model?: string;
  timestamp: number;
}

interface LilChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type LilView = 'search' | 'chat' | 'code' | 'games' | 'admin';
type LilChatMode = 'chat' | 'code';

interface LilPageProps {
  onHome: () => void;
}

const STARTER_CODE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My little project</title>
  <style>
    body {
      display: grid;
      min-height: 100vh;
      place-content: center;
      margin: 0;
      background: #f5eaff;
      color: #38105f;
      font: 1.2rem system-ui, sans-serif;
      text-align: center;
    }
    button {
      padding: .8rem 1rem;
      border: 0;
      border-radius: 999px;
      background: #9333ea;
      color: white;
      font: inherit;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main>
    <h1>Hello, world! ✨</h1>
    <p>Change this page, then press Run to see what happens.</p>
    <button onclick="this.textContent = 'You made this work! 🎉'">Click me</button>
  </main>
</body>
</html>`;

const GAME_SYMBOLS = ['🐱', '🌈', '⭐', '🦋', '🍓', '🚀'];

function makeMemoryDeck(): string[] {
  const cards = [...GAME_SYMBOLS, ...GAME_SYMBOLS];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
}

const SUGGESTED_PROMPTS = [
  { icon: '🚀', query: 'What new space discoveries happened recently from the James Webb telescope?' },
  { icon: '🐾', query: 'Tell me about fascinating newly discovered animal species in 2026' },
  { icon: '🤖', query: 'How are friendly robots being used in schools and libraries today?' },
  { icon: '🌿', query: 'What are the most inspiring positive environmental and nature news stories lately?' },
  { icon: '🎨', query: 'What are creative hands-on arts and science experiments kids can do at home?' },
  { icon: '🦕', query: 'What recent dinosaur or ancient fossil discoveries were made this year?' },
];

const LIL_SEARCH_URL = import.meta.env.DEV
  ? '/api/lil/search'
  : `${NEWS_CONFIG.workerUrl.replace(/\/$/, '')}/api/lil/search`;
const LIL_CHAT_URL = import.meta.env.DEV
  ? '/api/lil/chat'
  : `${NEWS_CONFIG.workerUrl.replace(/\/$/, '')}/api/lil/chat`;

async function requestLilChat(messages: LilChatMessage[], sessionId: string, mode: LilChatMode) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const client = getSupabaseClient();
  if (client) {
    const { data: { session } } = await client.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(LIL_CHAT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, sessionId, mode }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Lil request failed with status ${response.status}`);
  const answer = data.reply || data.answer;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Lil returned an empty reply.');
  return answer.trim();
}

const isLocalHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.localhost') ||
    window.location.hostname === '127.0.0.1');
const OPEN_WEBUI_URL =
  import.meta.env.DEV || isLocalHost
    ? 'http://127.0.0.1:3011/'
    : LIL_CONFIG.openWebUIUrl;

export const LilPage: React.FC<LilPageProps> = ({ onHome }) => {
  const { isAdmin } = useAdminStatus();
  const [query, setQuery] = useState('');
  const [activeView, setActiveView] = useState<LilView>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('openWebUI') === '1'
      ? 'admin'
      : 'search'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<LilSearchResult | null>(null);
  const [searchHistory, setSearchHistory] = useState<LilSearchResult[]>(() => {
    try {
      const saved = localStorage.getItem('littlables_lil_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item) => item && typeof item.query === 'string')
            .map((item) => ({ ...item, answer: item.answer || item.reply || '' }))
            .slice(0, 10);
        }
      }
    } catch {}
    return [];
  });
  const [copied, setCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState<LilChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [codePrompt, setCodePrompt] = useState('');
  const [code, setCode] = useState(STARTER_CODE);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeRunVersion, setCodeRunVersion] = useState(0);
  const [gameDeck, setGameDeck] = useState(makeMemoryDeck);
  const [flippedCards, setFlippedCards] = useState<number[]>([]);
  const [matchedCards, setMatchedCards] = useState<number[]>([]);
  const [gameMoves, setGameMoves] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const openWebUIFrameRef = useRef<HTMLIFrameElement>(null);
  const gameLockRef = useRef(false);
  const gameTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    try {
      localStorage.setItem('littlables_lil_history', JSON.stringify(searchHistory));
    } catch {}
  }, [searchHistory]);

  useEffect(() => {
    if (activeView !== 'admin' || isLocalHost || !isAdmin) return;

    const frame = openWebUIFrameRef.current;
    const frameOrigin = new URL(OPEN_WEBUI_URL).origin;
    let active = true;

    const onMessage = async (event: MessageEvent) => {
      if (
        event.origin !== frameOrigin ||
        event.source !== frame?.contentWindow ||
        event.data?.type !== 'LITTLABLES_OPENWEBUI_AUTH_REQUIRED'
      ) return;

      const client = getSupabaseClient();
      if (!client) return;
      const { data: { session } } = await client.auth.getSession();
      if (!active || !session?.access_token) return;

      frame?.contentWindow?.postMessage({
        type: 'LITTLABLES_OPENWEBUI_ADMIN_SESSION',
        accessToken: session.access_token
      }, frameOrigin);
    };

    window.addEventListener('message', onMessage);
    return () => {
      active = false;
      window.removeEventListener('message', onMessage);
    };
  }, [activeView, isAdmin]);

  useEffect(() => {
    if (activeView !== 'chat') return;
    chatMessagesRef.current?.scrollTo({ top: chatMessagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatLoading, activeView]);

  useEffect(() => () => {
    if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
  }, []);

  const handleSendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text || chatLoading) return;

    const nextMessages = [...chatMessages, { role: 'user' as const, content: text }];
    const requestMessages = nextMessages.slice(-12);
    while (
      requestMessages.length > 1 &&
      requestMessages.reduce((total, message) => total + new TextEncoder().encode(message.content).byteLength, 0) > 12_000
    ) {
      requestMessages.shift();
    }

    setChatMessages(nextMessages);
    setChatDraft('');
    setChatError(null);
    setChatLoading(true);
    try {
      const answer = await requestLilChat(requestMessages, sessionIdRef.current, 'chat');
      setChatMessages((current) => [...current, { role: 'assistant', content: answer }]);
    } catch (error) {
      setChatMessages((current) => current.slice(0, -1));
      setChatDraft(text);
      setChatError(error instanceof Error ? error.message : 'Lil could not reply. Please try again.');
    } finally {
      setChatLoading(false);
    }
  };

  const handleGenerateCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = codePrompt.trim();
    if (!prompt || codeLoading) return;

    setCodeLoading(true);
    setCodeError(null);
    try {
      const answer = await requestLilChat([
        {
          role: 'user',
          content: `Create a beginner-friendly, self-contained HTML page for this idea: ${prompt}. Reply with only the complete HTML document, including any CSS and JavaScript inside it. Keep the project playful and age-appropriate. Do not include external scripts, imports, network requests, or links to external resources.`
        }
      ], sessionIdRef.current, 'code');
      const html = answer.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
        throw new Error('Lil’s reply was not a complete HTML page. Try describing the project another way.');
      }
      setCode(html);
      setCodePrompt('');
      setCodeRunVersion((version) => version + 1);
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Lil could not create the project. Please try again.');
    } finally {
      setCodeLoading(false);
    }
  };

  const resetMemoryGame = () => {
    if (gameTimerRef.current !== null) window.clearTimeout(gameTimerRef.current);
    gameTimerRef.current = null;
    gameLockRef.current = false;
    setGameDeck(makeMemoryDeck());
    setFlippedCards([]);
    setMatchedCards([]);
    setGameMoves(0);
  };

  const handleFlipCard = (index: number) => {
    if (gameLockRef.current || matchedCards.includes(index) || flippedCards.includes(index)) return;
    const nextFlipped = [...flippedCards, index];
    setFlippedCards(nextFlipped);
    if (nextFlipped.length === 2) {
      setGameMoves((moves) => moves + 1);
      if (gameDeck[nextFlipped[0]] === gameDeck[nextFlipped[1]]) {
        setMatchedCards((matched) => [...matched, ...nextFlipped]);
        setFlippedCards([]);
      } else {
        gameLockRef.current = true;
        gameTimerRef.current = window.setTimeout(() => {
          setFlippedCards([]);
          gameLockRef.current = false;
          gameTimerRef.current = null;
        }, 800);
      }
    }
  };

  const handleSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);
    setQuery(trimmed);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const sb = getSupabaseClient();
      if (sb) {
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }

      const response = await fetch(LIL_SEARCH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: trimmed, sessionId: sessionIdRef.current }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Search request failed with status ${response.status}`);
      }

      const data = await response.json();
      const answer = data.reply || data.answer || 'No answer generated.';
      const result: LilSearchResult = {
        query: trimmed,
        answer,
        searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
        apiKeyNotice: data.apiKeyNotice || undefined,
        provider: data.provider || 'local-ollama',
        model: data.model || 'llama3.2:3b',
        timestamp: Date.now(),
      };

      setCurrentResult(result);
      setSearchHistory((prev) => [result, ...prev.filter((item) => item.query.toLowerCase() !== trimmed.toLowerCase())].slice(0, 10));

      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err: any) {
      setError(err?.message || 'Lil could not complete the search. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  const handleCopyAnswer = async () => {
    if (!currentResult?.answer) return;
    try {
      await navigator.clipboard.writeText(currentResult.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSelectHistory = (item: LilSearchResult) => {
    setCurrentResult(item);
    setQuery(item.query);
    setError(null);
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /**
   * Helper to format text into markdown-style paragraphs and bullets safely
   */
  const renderFormattedAnswer = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let currentList: string[] = [];

    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className="lil-answer-list">
            {currentList.map((item, i) => (
              <li key={i}>{formatInline(item)}</li>
            ))}
          </ul>
        );
        currentList = [];
      }
    };

    const formatInline = (str: string): React.ReactNode => {
      // Bold **text**
      const parts = str.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={idx}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }

      // Headers (### or ## or #)
      if (trimmed.startsWith('### ')) {
        flushList();
        elements.push(
          <h4 key={`h4-${index}`} className="lil-answer-heading-sm">
            {trimmed.replace(/^###\s+/, '')}
          </h4>
        );
      } else if (trimmed.startsWith('## ')) {
        flushList();
        elements.push(
          <h3 key={`h3-${index}`} className="lil-answer-heading-md">
            {trimmed.replace(/^##\s+/, '')}
          </h3>
        );
      } else if (trimmed.startsWith('# ')) {
        flushList();
        elements.push(
          <h2 key={`h2-${index}`} className="lil-answer-heading-lg">
            {trimmed.replace(/^#\s+/, '')}
          </h2>
        );
      } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
        // Bullet or numbered list item
        const itemContent = trimmed.replace(/^(\*|-|\d+\.)\s+/, '');
        currentList.push(itemContent);
      } else {
        flushList();
        elements.push(
          <p key={`p-${index}`} className="lil-answer-paragraph">
            {formatInline(trimmed)}
          </p>
        );
      }
    });

    flushList();
    return elements;
  };

  return (
    <div className="lil-page-container">
      {/* Top Breadcrumb & Navigation */}
      <nav className="lil-nav-bar" aria-label="Lil page navigation">
        <button
          type="button"
          className="lil-back-btn"
          onClick={onHome}
          title="Return to Littlables Feed"
        >
          ← Back to Discovery Feed
        </button>
        <div className="lil-nav-badge">
          <span className="lil-nav-badge-dot" />
          <span>Lil AI • Curiosity and discovery</span>
        </div>
      </nav>

      {/* Hero Header */}
      <header className="lil-hero-header">
        <div className="lil-avatar-wrap">
          <span className="lil-avatar-emoji" role="img" aria-label="Lil Mascot">✨</span>
          <span className="lil-avatar-sparkle">🔍</span>
        </div>
        <h1 className="lil-hero-title">Meet Lil</h1>
        <p className="lil-hero-subtitle">
          Ask about curiosities, science, news, and learning with Lil, your friendly discovery guide.
        </p>
      </header>

      <div className="lil-view-toggle" role="group" aria-label="Choose Lil view">
        {([
          ['search', 'Search'],
          ['chat', 'Chat'],
          ['code', 'Code'],
          ['games', 'Games'],
          ['admin', 'Admin'],
        ] as const).map(([view, label]) => (
          <button
            key={view}
            type="button"
            className={`lil-view-toggle-button ${activeView === view ? 'active' : ''}`}
            aria-pressed={activeView === view}
            onClick={() => setActiveView(view)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeView === 'admin' ? (
        <section className="lil-openwebui-view" aria-label="Open WebUI chat">
          <div className="lil-openwebui-toolbar">
            <p>Sign in to Open WebUI. If the sign-in page does not load here, open it in a new tab first.</p>
            <a href={OPEN_WEBUI_URL} target="_blank" rel="noopener noreferrer">
              Open in new tab ↗
            </a>
          </div>
          <iframe
            ref={openWebUIFrameRef}
            className="lil-openwebui-frame"
            src={OPEN_WEBUI_URL}
            title="Open WebUI chat"
            loading="lazy"
          />
        </section>
      ) : activeView === 'chat' ? (
        <section className="lil-chat-view" aria-label="Chat with Lil">
          <header className="lil-chat-header">
            <div>
              <h2>Chat with Lil</h2>
              <p>Keep asking questions—Lil will remember what you said in this conversation.</p>
            </div>
            {chatMessages.length > 0 && (
              <button
                type="button"
                className="lil-chat-new"
                onClick={() => {
                  setChatMessages([]);
                  setChatError(null);
                }}
                disabled={chatLoading}
              >
                New chat
              </button>
            )}
          </header>
          <div className="lil-chat-messages" ref={chatMessagesRef} role="log" aria-live="polite" aria-label="Chat messages">
            {chatMessages.length === 0 ? (
              <div className="lil-chat-welcome">
                <span aria-hidden="true">✨</span>
                <p>Hi, I’m Lil! What are you curious about?</p>
              </div>
            ) : chatMessages.map((message, index) => (
              <article className={`lil-chat-message lil-chat-message-${message.role}`} key={`${index}-${message.role}`}>
                <span className="lil-chat-message-label">{message.role === 'user' ? 'You' : 'Lil'}</span>
                <div className="lil-chat-message-content">
                  {message.role === 'assistant'
                    ? renderFormattedAnswer(message.content)
                    : <p>{message.content}</p>}
                </div>
              </article>
            ))}
            {chatLoading && (
              <div className="lil-chat-thinking" role="status">
                <span className="lil-spinner" aria-hidden="true" />
                <span>Lil is thinking…</span>
              </div>
            )}
          </div>
          {chatError && <p className="lil-chat-error" role="alert">{chatError}</p>}
          <form className="lil-chat-form" onSubmit={handleSendChat}>
            <textarea
              id="lil-chat-input"
              aria-label="Message Lil"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="Write a message to Lil…"
              maxLength={2_000}
              rows={2}
              disabled={chatLoading}
            />
            <button type="submit" className="lil-submit-btn" disabled={!chatDraft.trim() || chatLoading}>
              {chatLoading ? 'Sending…' : 'Send'}
              <span aria-hidden="true">➤</span>
            </button>
          </form>
          <p className="lil-chat-note">Lil’s replies use a local AI model and may not always be accurate.</p>
        </section>
      ) : activeView === 'code' ? (
        <section className="lil-code-view" aria-label="Create code with Lil">
          <header className="lil-code-header">
            <div>
              <h2>Make something with code</h2>
              <p>Describe a little project and Lil will create a page you can edit and run.</p>
            </div>
          </header>
          <form className="lil-code-prompt" onSubmit={handleGenerateCode}>
            <label htmlFor="lil-code-prompt">What would you like to make?</label>
            <div>
              <input
                id="lil-code-prompt"
                value={codePrompt}
                onChange={(event) => setCodePrompt(event.target.value)}
                maxLength={500}
                placeholder="A colorful page with a button that changes the background"
                disabled={codeLoading}
              />
              <button type="submit" className="lil-submit-btn" disabled={!codePrompt.trim() || codeLoading}>
                {codeLoading ? 'Creating…' : 'Ask Lil'}
              </button>
            </div>
          </form>
          {codeError && <p className="lil-chat-error" role="alert">{codeError}</p>}
          {codeLoading && (
            <p className="lil-code-status" role="status">
              <span className="lil-spinner" aria-hidden="true" /> Lil is creating your project…
            </p>
          )}
          <div className="lil-code-workspace">
            <section className="lil-code-editor-panel" aria-label="HTML code editor">
              <div className="lil-code-panel-heading">
                <h3>HTML</h3>
                <button type="button" className="lil-chat-new" onClick={() => setCodeRunVersion((version) => version + 1)}>
                  Run
                </button>
              </div>
              <textarea
                aria-label="Edit your HTML code"
                className="lil-code-editor"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
              />
            </section>
            <section className="lil-code-preview-panel" aria-label="Project preview">
              <h3>Preview</h3>
              <iframe
                key={codeRunVersion}
                className="lil-code-preview"
                title="Your code project preview"
                sandbox="allow-scripts"
                srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">${code}`}
              />
            </section>
          </div>
          <p className="lil-chat-note">Your project runs in a restricted preview. Keep personal information out of code.</p>
        </section>
      ) : activeView === 'games' ? (
        <section className="lil-games-view" aria-label="Play games with Lil">
          <header className="lil-games-header">
            <div>
              <h2>Lil’s Memory Match</h2>
              <p>Find all six matching pairs. Take your time and see how few moves you need!</p>
            </div>
            <div className="lil-game-score" aria-live="polite">
              <span>Moves</span>
              <strong>{gameMoves}</strong>
            </div>
          </header>
          {matchedCards.length === gameDeck.length ? (
            <div className="lil-game-complete" role="status">
              <span aria-hidden="true">🎉</span>
              <h3>You found them all!</h3>
              <p>You matched every pair in {gameMoves} {gameMoves === 1 ? 'move' : 'moves'}.</p>
              <button type="button" className="lil-submit-btn" onClick={resetMemoryGame}>Play again</button>
            </div>
          ) : (
            <>
              <div className="lil-memory-grid" role="group" aria-label="Memory match cards">
                {gameDeck.map((symbol, index) => {
                  const isRevealed = flippedCards.includes(index) || matchedCards.includes(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`lil-memory-card${isRevealed ? ' is-revealed' : ''}${matchedCards.includes(index) ? ' is-matched' : ''}`}
                      onClick={() => handleFlipCard(index)}
                      aria-label={isRevealed ? `Card ${index + 1}: ${symbol}${matchedCards.includes(index) ? ', matched' : ''}` : `Reveal card ${index + 1}`}
                      aria-pressed={isRevealed}
                      disabled={matchedCards.includes(index) || gameLockRef.current}
                    >
                      <span aria-hidden="true">{isRevealed ? symbol : '✦'}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="lil-chat-new lil-game-reset" onClick={resetMemoryGame}>Restart game</button>
            </>
          )}
        </section>
      ) : (
        <>
      {/* Search Input Box */}
      <section className="lil-search-section" aria-label="Search with Lil">
        <form className="lil-search-form" onSubmit={handleSubmit}>
          <div className="lil-search-input-wrapper">
            <span className="lil-search-icon" aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="lil-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything (e.g., 'What are the newest space discoveries this week?')..."
              aria-label="Search topic or question for Lil"
              disabled={isLoading}
              autoFocus
            />
            {query.length > 0 && !isLoading && (
              <button
                type="button"
                className="lil-clear-btn"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear query text"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            className="lil-submit-btn"
            disabled={!query.trim() || isLoading}
            data-umami-event="Lil-Search-Submit"
          >
            {isLoading ? (
              <>
                <span className="lil-spinner" aria-hidden="true" />
                <span>Searching…</span>
              </>
            ) : (
              <>
                <span>Search</span>
                <span aria-hidden="true">🚀</span>
              </>
            )}
          </button>
        </form>

        {/* Suggestion Prompts */}
        <div className="lil-suggestions-container">
          <span className="lil-suggestions-label">Try a curiosity question:</span>
          <div className="lil-suggestions-grid">
            {SUGGESTED_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="lil-suggestion-chip"
                onClick={() => handleSearch(prompt.query)}
                disabled={isLoading}
              >
                <span className="lil-suggestion-icon">{prompt.icon}</span>
                <span className="lil-suggestion-text">{prompt.query}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Loading Shimmer State */}
      {isLoading && (
        <section className="lil-loading-card" role="status" aria-live="polite">
          <div className="lil-loading-header">
            <span className="lil-loading-pulse-ring" />
            <span className="lil-loading-text">
              Lil is thinking…
            </span>
          </div>
          <div className="lil-loading-shimmer-bar short" />
          <div className="lil-loading-shimmer-bar title" />
          <div className="lil-loading-shimmer-bar" />
          <div className="lil-loading-shimmer-bar medium" />
        </section>
      )}

      {/* Error View */}
      {error && !isLoading && (
        <div className="lil-error-card" role="alert">
          <div className="lil-error-icon">⚠️</div>
          <div className="lil-error-content">
            <h3>Could not finish search</h3>
            <p>{error}</p>
            <button
              type="button"
              className="refresh-news-button lil-retry-btn"
              onClick={() => handleSearch(query)}
            >
              🔄 Try Again
            </button>
          </div>
        </div>
      )}

      {/* Search Result */}
      {currentResult && !isLoading && (
        <section ref={resultsRef} className="lil-result-card" aria-label="Search Answer">
          <header className="lil-result-header">
            <div className="lil-result-meta-top">
              <span className="lil-result-badge">
                <span className="lil-result-badge-icon">🖥️</span>
                {currentResult.provider === 'openwebui'
                  ? 'Open WebUI'
                  : currentResult.provider === 'ollama'
                    ? 'Local Ollama'
                    : currentResult.provider || 'Ollama'}
              </span>
              <span className="lil-result-model-badge">{currentResult.model || 'llama3.2:3b'}</span>
            </div>
            <h2 className="lil-result-query">"{currentResult.query}"</h2>
          </header>

          {currentResult.apiKeyNotice && (
            <div className="lil-api-notice" role="status">
              <span className="lil-api-notice-icon" aria-hidden="true">💡</span>
              <div className="lil-api-notice-text">
                {currentResult.apiKeyNotice}
              </div>
            </div>
          )}

          {/* Web Search Queries Used */}
          {currentResult.searchQueries && currentResult.searchQueries.length > 0 && (
            <div className="lil-web-queries-box">
              <span className="lil-web-queries-title">🔍 Web Searches Executed:</span>
              <div className="lil-web-queries-pills">
                {currentResult.searchQueries.map((q, idx) => (
                  <span key={idx} className="lil-web-query-pill">
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Answer Body */}
          <article className="lil-result-answer">
            {renderFormattedAnswer(currentResult.answer)}
          </article>

          {/* Verified Web Sources from Google Search */}
          {currentResult.sources && currentResult.sources.length > 0 && (
            <aside className="lil-sources-section">
              <h3 className="lil-sources-heading">
                <span>📚 Sources ({currentResult.sources.length})</span>
              </h3>
              <div className="lil-sources-grid">
                {currentResult.sources.map((source, idx) => (
                  <a
                    key={idx}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lil-source-card"
                    title={`Open source: ${source.title}`}
                  >
                    <div className="lil-source-top">
                      <span className="lil-source-domain-icon">🌐</span>
                      <span className="lil-source-domain">{source.domain || 'External source'}</span>
                      <span className="lil-source-external-icon">↗</span>
                    </div>
                    <div className="lil-source-title">{source.title}</div>
                  </a>
                ))}
              </div>
            </aside>
          )}

          {/* Footer Actions */}
          <footer className="lil-result-footer">
            <button
              type="button"
              className={`reaction-pill lil-copy-btn ${copied ? 'voted' : ''}`}
              onClick={handleCopyAnswer}
              title="Copy answer text"
            >
              <span>{copied ? '✓' : '📋'}</span>
              <span>{copied ? 'Copied!' : 'Copy Answer'}</span>
            </button>
            <button
              type="button"
              className="refresh-news-button lil-new-btn"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              ✨ Ask Another Question
            </button>
          </footer>
        </section>
      )}

      {/* Recent Inquiries History */}
      {searchHistory.length > 0 && (
        <section className="lil-history-section" aria-label="Recent inquiries">
          <div className="lil-history-header">
            <h3>Recent Inquiries</h3>
            <button
              type="button"
              className="lil-history-clear"
              onClick={() => setSearchHistory([])}
              title="Clear search history"
            >
              Clear History
            </button>
          </div>
          <div className="lil-history-list">
            {searchHistory.map((item, idx) => (
              <button
                key={idx}
                type="button"
                className={`lil-history-item ${currentResult?.query === item.query ? 'active' : ''}`}
                onClick={() => handleSelectHistory(item)}
              >
                <span className="lil-history-icon">💬</span>
                <span className="lil-history-query">{item.query}</span>
                <span className="lil-history-sources-count">
                  {item.sources.length} {item.sources.length === 1 ? 'source' : 'sources'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
};
