import React, { useEffect, useState } from 'react';
import { NEWS_CONFIG } from '../constants/config';

interface LilAvatarProps {
  isLilPage: boolean;
}

const STATUS_URL = `${NEWS_CONFIG.workerUrl.replace(/\/$/, '')}/api/lil/status`;

export const LilAvatar: React.FC<LilAvatarProps> = ({ isLilPage }) => {
  const [isOnline, setIsOnline] = useState(false);
  const isLilSubdomain =
    typeof window !== 'undefined' &&
    window.location.hostname.toLowerCase() === 'lil.littlables.com';

  useEffect(() => {
    if (isLilPage || isLilSubdomain) {
      setIsOnline(false);
      return;
    }

    let active = true;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;

    const checkStatus = async () => {
      controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch(STATUS_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const status = response.ok ? await response.json() : null;
        if (active) setIsOnline(status?.online === true);
      } catch {
        if (active) setIsOnline(false);
      } finally {
        window.clearTimeout(requestTimeout);
        if (active) timeoutId = window.setTimeout(checkStatus, 30_000);
      }
    };

    void checkStatus();
    return () => {
      active = false;
      controller?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [isLilPage, isLilSubdomain]);

  if (isLilPage || isLilSubdomain || !isOnline) return null;

  return (
    <a className="lil-floating-avatar" href="/lil" aria-label="Go to Lil, who is online">
      <img src="/img/lil-avatar.svg" alt="" aria-hidden="true" />
      <span className="lil-floating-avatar-status" aria-hidden="true" />
    </a>
  );
};
