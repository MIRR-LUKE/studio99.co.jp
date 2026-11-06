'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {worldFromPath} from '@/lib/world';

// Any address that isn't a known world is an unknown one, with its own URL.
export default function NotFound(){
  const world=worldFromPath(usePathname()??'/');
  return <main className="world-content unknown-content"><section className="scene">
    <p className="eyebrow">UNKNOWN WORLD</p>
    <h1>{world.word}<span>_</span></h1>
    <p className="unknown-line">THIS WORLD DOESN’T EXIST. YET.</p>
    <Link className="text-link" href={`/contact?world=${encodeURIComponent(world.word)}`}>MAKE IT WITH US</Link>
  </section></main>;
}
