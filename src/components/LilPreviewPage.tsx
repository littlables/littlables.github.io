import React from 'react';

interface LilPreviewPageProps {
  onAdminSignIn: () => void;
}

const FEATURES = [
  {
    icon: '🔭',
    title: 'Curious search',
    description: 'Ask a question and explore clear, kid-friendly answers with helpful sources.',
    className: 'search',
  },
  {
    icon: '💌',
    title: 'Chat with Lil',
    description: 'Keep the conversation going with a friendly AI companion made for discovery.',
    className: 'chat',
  },
  {
    icon: '🧩',
    title: 'Create with code',
    description: 'Turn ideas into little programs, creative projects, and playful experiments.',
    className: 'code',
  },
  {
    icon: '🎲',
    title: 'Learn through games',
    description: 'Play, solve puzzles, and discover something new one level at a time.',
    className: 'games',
  },
];

export const LilPreviewPage: React.FC<LilPreviewPageProps> = ({ onAdminSignIn }) => (
  <main className="news-grid lil-main-grid">
    <div className="lil-preview-page">
      <section className="lil-preview-hero">
        <div className="lil-preview-orbit lil-preview-orbit-one" aria-hidden="true" />
        <div className="lil-preview-orbit lil-preview-orbit-two" aria-hidden="true" />
        <img className="lil-preview-avatar" src="/img/lil-avatar.svg" alt="" />
        <p className="lil-preview-eyebrow">A new adventure is growing</p>
        <h1>Meet Lil</h1>
        <p className="lil-preview-intro">
          A curious little AI friend for big questions, creative ideas, and playful discoveries.
        </p>
        <span className="lil-preview-coming-soon">Coming soon</span>
      </section>

      <section className="lil-preview-features" aria-label="What Lil is bringing">
        {FEATURES.map((feature) => (
          <article className={`lil-preview-feature lil-preview-feature-${feature.className}`} key={feature.title}>
            <span className="lil-preview-feature-icon" aria-hidden="true">{feature.icon}</span>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
            <span className="lil-preview-feature-soon">Coming soon</span>
          </article>
        ))}
      </section>

      <section className="lil-preview-admin">
        <div>
          <h2>Are you a Littlables admin?</h2>
          <p>Sign in with your admin account to open Lil’s current workspace.</p>
        </div>
        <button type="button" onClick={onAdminSignIn}>Admin sign in</button>
      </section>
    </div>
  </main>
);
