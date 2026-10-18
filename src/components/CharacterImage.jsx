import { useEffect, useState } from 'react';

/**
 * Character head icon with a graceful name-tile fallback when the image has
 * not been downloaded yet (npm run fetch-images) or is missing.
 */
export default function CharacterImage({ slug, name, size = 64, className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/images/${slug}.png`;

  useEffect(() => {
    setFailed(false);
  }, [slug]);

  if (failed) {
    return (
      <div
        className={`char-fallback ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size / 7)) }}
        title={name}
      >
        <span>{name}</span>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
