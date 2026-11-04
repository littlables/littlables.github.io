import React from 'react';
import { t } from '../constants/translations';
import { useAuth } from '../contexts/AuthContext';
import { CHARACTER_AVATARS } from '../constants/avatars';
import { trackHomeLogoRefresh, track3DPlayroomClick } from '../services/trackingService';
import { WORKSHEETS, toggleWorksheetsPanel } from './WorksheetsPanel';
import { SeasonalGameDialog } from './SeasonalGameDialog';

const PLAYGROUND_3D_URL = 'https://playground.google/g/viMkwl';

interface HeaderProps {
  onHomeClick: () => void;
  onOpenSettings: () => void;
  onOpenSignIn: () => void;
  onOpenProfile: () => void;
  isLoading: boolean;
  /** Board branding override: shown instead of the Littlables logo on board pages */
  brandName?: string;
  brandLogoUrl?: string | null;
  /** True when the GitHub admin session is active (enables long-press story editing) */
  isAdmin?: boolean;
  worksheetsCount?: number;
  /** Points earned by collecting falling emojis */
  emojiPoints?: number;
  /** Last collected emoji icon */
  lastCollectedEmoji?: string;
  /** Whether the falling emoji game is enabled */
  gameEnabled?: boolean;
  /** Callback to toggle the game on/off */
  onToggleGame?: () => void;
  /** Navigate to the /lil page */
  onOpenLil?: () => void;
  /** True when currently on the /lil page */
  isLilActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onHomeClick,
  onOpenSettings,
  onOpenSignIn,
  onOpenProfile,
  isLoading,
  brandName,
  brandLogoUrl,
  isAdmin,
  worksheetsCount = WORKSHEETS.length,
  emojiPoints = 0,
  lastCollectedEmoji = '🎃',
  gameEnabled = true,
  onToggleGame,
  onOpenLil,
  isLilActive,
}) => {
  const { user, profile } = useAuth();
  const [isBumping, setIsBumping] = React.useState(false);
  const [seasonalDialogOpen, setSeasonalDialogOpen] = React.useState(false);
  const prevPointsRef = React.useRef(emojiPoints);

  React.useEffect(() => {
    if (emojiPoints > prevPointsRef.current) {
      setIsBumping(true);
      const timer = window.setTimeout(() => setIsBumping(false), 260);
      prevPointsRef.current = emojiPoints;
      return () => window.clearTimeout(timer);
    }
    prevPointsRef.current = emojiPoints;
  }, [emojiPoints]);

  const character =
    profile?.avatar_type === 'character'
      ? CHARACTER_AVATARS.find((c) => c.id === profile.avatar_character) || null
      : null;

  const handleBrandClick = () => {
    if (isLoading && !isLilActive) return;
    trackHomeLogoRefresh();
    onHomeClick();
  };

  const handle3DClick = () => {
    track3DPlayroomClick(PLAYGROUND_3D_URL);
    window.open(PLAYGROUND_3D_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <header className="news-widget-header">
      <div className="news-header-brand-group">
        <button
          type="button"
          className="news-widget-title"
          id="widget-main-title"
          title="Refresh Stories"
          aria-label={`${brandName || t('headerTitle') || 'littlables'} — Refresh Stories`}
          data-umami-event="Home-Logo-Refresh"
          onClick={handleBrandClick}
        >
          {brandLogoUrl ? (
            <img
              className="widget-brand-icon board-brand-logo"
              src={brandLogoUrl}
              width="28"
              height="28"
              alt={`${brandName || 'Space'} logo`}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <img
              className="widget-brand-icon"
              src="/favicon-48x48.png"
              width="28"
              height="28"
              alt="Littlables logo"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          )}
          <span id="widget-title-text">{brandName || t('headerTitle') || 'littlables'}</span>
        </button>

        <div className="header-points-group">
          <button
            type="button"
            id="header-emoji-points"
            className={`header-points-badge${isBumping ? ' is-bumping' : ''}${!gameEnabled ? ' is-inactive' : ''}`}
            title="About the seasonal game"
            aria-label={`Seasonal game: ${emojiPoints} ${emojiPoints === 1 ? 'point' : 'points'} — learn more`}
            onClick={() => setSeasonalDialogOpen(true)}
          >
            <span className="header-points-emoji" aria-hidden="true">
              {lastCollectedEmoji || '🎃'}
            </span>
            <span className="header-points-count" aria-live="polite">{emojiPoints.toLocaleString()}</span>
          </button>

          {onToggleGame && (
            <button
              type="button"
              className={`header-game-toggle${gameEnabled ? ' is-active' : ''}`}
              role="switch"
              aria-checked={gameEnabled}
              aria-label={gameEnabled ? 'Turn off falling emoji game' : 'Turn on falling emoji game'}
              title={gameEnabled ? 'Turn game off' : 'Turn game on'}
              onClick={onToggleGame}
            >
              <span className="header-game-toggle-track">
                <span className="header-game-toggle-thumb" />
              </span>
            </button>
          )}
        </div>
        <SeasonalGameDialog
          isOpen={seasonalDialogOpen}
          onClose={() => setSeasonalDialogOpen(false)}
        />
      </div>

      <div className="news-header-controls">
        {onOpenLil && (
          <button
            id="lil-btn"
            type="button"
            className={`header-icon-button header-lil-button${isLilActive ? ' is-active' : ''}`}
            title={isAdmin ? 'Open Lil workspace' : 'Meet Lil — Coming soon'}
            aria-label={isAdmin ? 'Open Lil workspace' : 'Preview Lil, coming soon'}
            data-umami-event="Open-Lil-Page"
            onClick={onOpenLil}
          >
            <img className="header-lil-avatar" src="/img/lil-avatar.svg" alt="" aria-hidden="true" />
          </button>
        )}

        <button
          id="worksheets-btn"
          type="button"
          className="header-icon-button header-worksheets-button"
          title={`Printable Worksheets & Coloring Pages (${worksheetsCount})`}
          aria-label={`Printable Worksheets & Coloring Pages (${worksheetsCount} items)`}
          data-umami-event="Toggle-Worksheets"
          onClick={toggleWorksheetsPanel}
        >
          <span className="avatar-emoji-glyph" aria-hidden="true">📕</span>
          {worksheetsCount > 0 && (
            <span className="header-worksheets-count-badge" aria-hidden="true">
              {worksheetsCount}
            </span>
          )}
        </button>

        <button
          id="playground-3d-btn"
          type="button"
          className="header-icon-button header-3d-button"
          title="3D (Beta)"
          aria-label="Open 3D playroom (Beta)"
          data-umami-event="Open-3D-Playroom"
          data-umami-event-url={PLAYGROUND_3D_URL}
          onClick={handle3DClick}
        >
          <span>3D</span>
          <span className="header-3d-beta-stamp" aria-hidden="true">BETA</span>
        </button>

        {!user && (
          <button
            id="settings-btn"
            type="button"
            className="header-icon-button settings-cog-button"
            title="Settings"
            aria-label="Open Settings"
            data-umami-event="Open-Settings"
            onClick={onOpenSettings}
          >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="7.5" cy="7.5" r="2.5" />
            <circle cx="16.5" cy="7.5" r="2.5" />
            <circle cx="12" cy="13" r="6" />
            <circle cx="10" cy="12" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14" cy="12" r="0.9" fill="currentColor" stroke="none" />
            <ellipse cx="12" cy="15.2" rx="1.8" ry="1.2" />
          </svg>
          </button>
        )}

        {isAdmin && (
          <span
            className="header-admin-badge"
            title="Admin mode — long-press a story to edit"
            aria-label="Admin mode"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.2rem 0.4rem',
              borderRadius: '9999px',
              background: '#7c3aed',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            🛠️
          </span>
        )}
        {user ? (
          <button
            type="button"
            className="header-auth-button header-avatar-button"
            title="Your profile"
            aria-label="Open your profile"
            data-umami-event="Open-Profile"
            onClick={onOpenProfile}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="header-avatar" />
            ) : character ? (
              <span
                className="header-avatar"
                style={{ background: character.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}
              >
                <span className="avatar-emoji-glyph">{character.emoji}</span>
              </span>
            ) : (
              <span className="header-avatar-fallback">
                {(profile?.display_name || user.email || '?')[0].toUpperCase()}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="header-auth-button header-signin-button"
            data-umami-event="Open-Sign-In"
            onClick={onOpenSignIn}
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
};
