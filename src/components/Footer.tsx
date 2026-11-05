import React from 'react';

interface FooterProps {
  onOpenAbout: () => void;
  onOpenDisclaimer: () => void;
  onOpenLil?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenAbout, onOpenDisclaimer, onOpenLil }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <span>© <span id="copyright-year">{currentYear}</span> <span className="site-footer-brand">littlables</span></span>
      <nav aria-label="About littlables">
        {onOpenLil && (
          <button
            type="button"
            data-umami-event="Open-Lil-Footer"
            onClick={onOpenLil}
          >
            Meet Lil <img className="footer-lil-avatar" src="/img/lil-avatar.svg" alt="" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          data-umami-event="Open-About"
          onClick={onOpenAbout}
        >
          About us
        </button>
        <button
          type="button"
          data-umami-event="Open-Disclaimer"
          onClick={onOpenDisclaimer}
        >
          A quick note
        </button>
      </nav>
    </footer>
  );
};
