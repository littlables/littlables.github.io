import React, { useEffect, useRef, useState } from 'react';
import { NewsItem, NewsCategory, ReactionType, ReactionCounts } from '../types';
import { resolveImageUrl } from '../services/newsService';
import { getStoryId, hasUserReacted } from '../services/supabaseService';
import {
  getStoryShareUrl,
  getTopicHref,
  getStoryGivenPubName,
  getStoryTopLevelDomain,
  shareStoryWithImage,
  updateStoryOpenGraphTags
} from '../services/urlService';
import { trackStoryClick, trackStoryEngagementClick } from '../services/trackingService';
import { t } from '../constants/translations';
import { INTEREST_KEYWORDS } from '../constants/interestKeywords';

const INTEREST_KEYWORD_MAP = new Map(
  INTEREST_KEYWORDS.map((keyword) => [keyword.id, keyword])
);

interface StoryModalProps {
  story: NewsItem | null;
  index: number;
  category: NewsCategory;
  categoryBadge: string;
  reactions: ReactionCounts;
  onReact: (storyId: string, type: ReactionType) => void;
  onClose: () => void;
  onSelectCategory?: (category: NewsCategory) => void;
  onAdminEdit?: (item: NewsItem) => void;
}

export const StoryModal: React.FC<StoryModalProps> = ({
  story,
  index,
  category,
  categoryBadge,
  reactions,
  onReact,
  onClose,
  onSelectCategory,
  onAdminEdit
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [bouncing, setBouncing] = useState<ReactionType | null>(null);
  const [copied, setCopied] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (story) {
      const effectiveCategory = story.category || category;
      const imageUrl = resolveImageUrl(story, index, category);
      const shareUrl = getStoryShareUrl(story, effectiveCategory);
      updateStoryOpenGraphTags(story, imageUrl, shareUrl);

      document.documentElement.classList.add('story-modal-open');
      document.body.classList.add('story-modal-open');
      if (!dialog.open) {
        dialog.showModal();
      }
      // The balloon content scrolls inside .story-modal-scroll (the Edit
      // button sits outside it), so reset that container, not the dialog.
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    } else {
      updateStoryOpenGraphTags(null);
      document.documentElement.classList.remove('story-modal-open');
      document.body.classList.remove('story-modal-open');
      if (dialog.open) {
        dialog.close();
      }
    }

    return () => {
      document.documentElement.classList.remove('story-modal-open');
      document.body.classList.remove('story-modal-open');
    };
  }, [story, index, category]);

  useEffect(() => {
    setCopied(false);
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setImageLoaded(true);
    } else {
      setImageLoaded(false);
    }
  }, [story?.link, story?.title, story?.image]);

  if (!story) return null;

  const storyId = getStoryId(story.title, story.link);
  const imageUrl = resolveImageUrl(story, index, category);
  const effectiveCategory = story.category || category;
  const givenPubName = getStoryGivenPubName(story);
  const topLevelDomain = getStoryTopLevelDomain(story);
  const interestTags = [...new Set(
    (story.interestKeywords || []).map((keyword) => keyword.trim()).filter(Boolean)
  )];

  const isVotedLove = hasUserReacted(storyId, 'love');
  const isVotedMind = hasUserReacted(storyId, 'mind');
  const isVotedCozy = hasUserReacted(storyId, 'cozy');

  const pubDate = new Date(story.pubDate || story.fetchedAt || Date.now()).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  const handleReactionClick = (type: ReactionType) => {
    setBouncing(type);
    setTimeout(() => setBouncing(null), 450);
    onReact(storyId, type);
  };

  const handleShareClick = async () => {
    const ok = await shareStoryWithImage(story, effectiveCategory, imageUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleCategoryBadgeClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onSelectCategory) {
      e.preventDefault();
      onClose();
      onSelectCategory(effectiveCategory);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="story-modal-dialog"
      aria-labelledby="story-modal-title"
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      {onAdminEdit && (
        <div className="story-modal-admin-bar">
          <button
            type="button"
            className="reaction-pill admin-edit-btn"
            onClick={() => {
              // Close this native dialog first: a native <dialog> sits
              // in the top layer above the edit dialog, so opening the
              // edit dialog underneath it would look like nothing happened.
              onClose();
              onAdminEdit(story);
            }}
            title="Edit story (admin)"
            aria-label="Edit story"
          >
            <span>✏️</span>
            <span>Edit</span>
          </button>
        </div>
      )}
      <div className="story-modal-scroll-wrap">
        <button
          type="button"
          className="story-modal-close-btn"
          aria-label="Close story window"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="story-modal-scroll" ref={scrollRef}>
        <article className="story-modal-card">
        <div className={`story-modal-image-wrap ${imageLoaded ? 'is-loaded' : ''}`}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt={story.title}
            className={`story-modal-image ${imageLoaded ? 'is-loaded' : ''}`}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              const fallback = `/img/${effectiveCategory}_1.jpg`;
              if (target.src !== fallback && !target.src.endsWith(fallback)) {
                target.src = fallback;
              } else {
                setImageLoaded(true);
              }
            }}
          />
          <a
            href={getTopicHref(effectiveCategory)}
            className="news-card-badge story-modal-badge-link"
            onClick={handleCategoryBadgeClick}
            title="View all stories in this topic"
          >
            {categoryBadge}
          </a>
        </div>

        <div className="story-modal-content">
          <div className="news-card-meta story-meta-grid story-modal-meta">
            <span className="story-meta-cell story-provider-badge" title={givenPubName}>📰 {givenPubName}</span>
            <span className="story-meta-cell story-date-badge" title={pubDate}>🕒 {pubDate}</span>
            <span className="story-meta-cell story-domain-badge" title={topLevelDomain}>🌐 {topLevelDomain}</span>
            {story.approved === true && (
              <span className="story-meta-cell story-scoop-badge">{t('verifiedWire') || "🧸 Littlables' Little Scoop"}</span>
            )}
          </div>

          {interestTags.length > 0 && (
            <div className="story-modal-interests" aria-label="Story interests">
              <span className="story-modal-interests-label">Interests</span>
              <div className="story-modal-interest-tags">
                {interestTags.map((tag) => {
                  const keyword = INTEREST_KEYWORD_MAP.get(tag.toLowerCase());
                  return (
                    <span className="story-modal-interest-tag" key={tag}>
                      {keyword ? `${keyword.icon} ${keyword.label}` : tag.replace(/[-_]+/g, ' ')}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <h2 id="story-modal-title" className="story-modal-title">
            {story.title}
          </h2>

          {story.aiSummary && story.aiSummary.trim().length > 0 && (
            <div className="news-card-ai-summary story-modal-ai-summary">
              <div className="news-card-ai-label">{t('aiBriefTag') || '✨ Quick AI Brief'}</div>
              <div className="ai-summary-text">{story.aiSummary}</div>
            </div>
          )}

          {story.description && (
            <p className="story-modal-desc">{story.description}</p>
          )}

          <div className="news-card-footer story-modal-footer">
            <a
              href={story.link || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="news-read-more-btn story-modal-read-btn"
              data-umami-event="Clicked-Story"
              data-umami-event-url={story.link || ''}
              data-umami-event-title={story.title}
              onClick={() => {
                trackStoryClick(story);
                trackStoryEngagementClick(story, effectiveCategory);
              }}
            >
              {t('readMore') || 'Read Full Story →'}
            </a>

            <div className="news-card-reactions">
              <button
                className={`reaction-pill ${isVotedLove ? 'voted' : ''} ${bouncing === 'love' ? 'pop-bounce' : ''}`}
                onClick={() => handleReactionClick('love')}
                title="Love it"
                type="button"
                data-umami-event="Reaction-Love"
                data-umami-event-story={story.title}
              >
                <span>❤️</span>
                <span className="reaction-count">{reactions.love}</span>
              </button>

              <button
                className={`reaction-pill ${isVotedMind ? 'voted' : ''} ${bouncing === 'mind' ? 'pop-bounce' : ''}`}
                onClick={() => handleReactionClick('mind')}
                title="Mind Blown"
                type="button"
                data-umami-event="Reaction-Mind"
                data-umami-event-story={story.title}
              >
                <span>🤯</span>
                <span className="reaction-count">{reactions.mind}</span>
              </button>

              <button
                className={`reaction-pill ${isVotedCozy ? 'voted' : ''} ${bouncing === 'cozy' ? 'pop-bounce' : ''}`}
                onClick={() => handleReactionClick('cozy')}
                title="Cozy"
                type="button"
                data-umami-event="Reaction-Cozy"
                data-umami-event-story={story.title}
              >
                <span>🧸</span>
                <span className="reaction-count">{reactions.cozy}</span>
              </button>

              <button
                type="button"
                className={`reaction-pill story-share-btn ${copied ? 'copied' : ''}`}
                onClick={handleShareClick}
                title="Share story link & image"
                aria-label="Share story"
                data-umami-event="Share-Story"
                data-umami-event-story={story.title}
              >
                <span>{copied ? '✓' : '🔗'}</span>
                <span>{copied ? 'Copied' : 'Share'}</span>
              </button>
            </div>
          </div>
        </div>
      </article>
      </div>
      </div>
    </dialog>
  );
};
