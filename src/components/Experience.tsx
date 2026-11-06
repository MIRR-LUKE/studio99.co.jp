'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// The poster: small type at the corners, a two-tone title, a thin circle, and a
// single floating glass key that says "world". (The keyboard world is paused;
// see KeyboardExperience.tsx.) The key is ray traced live (WorldKey.tsx); its
// Cycles reference frame is plain markup underneath, so the key is there before
// scripts, without them and without WebGL.
const WorldKey = dynamic(() => import('./WorldKey'), { ssr: false });
const WORLD_KEY_STILL = '/models/world-key/still.webp';

const TICKS = [-150, -30, 30, 150];

export default function Experience({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const hero = pathname === '/';
  const [motion, setMotion] = useState<'full' | 'reduced' | null>(null);
  const [webgl, setWebgl] = useState(false);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  const statement = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setWebgl(!!document.createElement('canvas').getContext('webgl2'));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setMotion(media.matches ? 'reduced' : 'full'); change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const current = (path: string) => (pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined);

  return <div className={`poster ${hero ? 'is-hero' : 'is-page'}`} data-testid="poster">
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="poster-top">
      <Link className="brand" href="/" aria-label="Studio99 home">Studio99®</Link>
      <span>Creative Capital Company</span>
      <span>Tokyo / Nagano</span>
    </header>

    {hero && <>
      <div className="poster-lines" aria-hidden="true">
        <span className="circle" />
        {TICKS.map(a => <span key={a} className="tick" style={{ '--a': `${a}deg` } as CSSProperties} />)}
        <span className="rule left" /><span className="rule right" />
      </div>
      {/* The statement behind the key: the glass refracts these very lines. */}
      <h1 className="poster-statement" ref={statement}>
        <span data-statement-line>WE MAKE</span>
        <span data-statement-line>WORLDS</span>
        <span data-statement-line>WITH YOU.</span>
      </h1>
      <p className="poster-sub"><span>a world begins with a word.</span><span>セカイをつくる、クリエイティブパートナー。</span></p>
      <div className="world-key" aria-hidden="true" data-testid="world-key" data-ready={ready}>
        <div className="world-key-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="world-key-still" src={WORLD_KEY_STILL} alt="" width={960} height={960} fetchPriority="high" />
          {motion && webgl && <WorldKey reducedMotion={motion === 'reduced'} onReady={markReady} statement={statement} />}
        </div>
      </div>
    </>}

    <div id="content" className="poster-body">{children}</div>

    <footer className="poster-bottom">
      <div><strong>Studio99合同会社</strong><p>言葉から、まだない世界へ。<br />Creative Capital Company.</p></div>
      <div><Link className="label" href="/about" aria-current={current('/about')}>About</Link><p>可能性に投資する、<br />クリエイティブ・キャピタル・カンパニー。</p></div>
      <div><Link className="label" href="/works" aria-current={current('/works')}>Works</Link><p>Rubicon, Beauty Institute, ON.<br />Worlds in the making.</p></div>
      <div><Link className="label" href="/contact" aria-current={current('/contact')}>Contact</Link></div>
    </footer>
  </div>;
}
