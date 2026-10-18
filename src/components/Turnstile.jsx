import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget (feature-detected): renders nothing when no site
 * key is configured, which is the default. The token is handed back via
 * onToken and sent with registration.
 */
export default function Turnstile({ siteKey, onToken }) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!siteKey || !container) return undefined;

    let widgetId = null;
    const render = () => {
      if (!window.turnstile || !container) return;
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        'error-callback': () => onToken(null),
        'expired-callback': () => onToken(null),
      });
    };

    const script =
      document.querySelector('script[data-turnstile]') || document.createElement('script');
    if (!script.dataset.turnstile) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = 'true';
      document.head.appendChild(script);
    }

    if (window.turnstile) render();
    else script.addEventListener('load', render);

    return () => {
      script.removeEventListener('load', render);
      if (window.turnstile && widgetId != null) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div className="turnstile" ref={ref} />;
}
