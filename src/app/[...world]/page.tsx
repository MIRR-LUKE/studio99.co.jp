import Link from 'next/link';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {PROJECTS,CONTACT_EMAIL} from '@/lib/content';
import ContactForm from '@/components/ContactForm';
const routes=['about','works','contact',...PROJECTS.map(p=>`works/${p.slug}`)];
export function generateStaticParams(){return routes.map(r=>({world:r.split('/')}));}
export async function generateMetadata({params}:{params:Promise<{world:string[]}>}):Promise<Metadata>{const {world}=await params;return {title:world.at(-1)?.toUpperCase()};}
export default async function World({params}:{params:Promise<{world:string[]}>}){
  const {world}=await params;const route=world.join('/');
  if(!routes.includes(route))notFound();
  // Each world is a short sequence of scenes, one thing at a time, shown inside the ice.
  if(route==='about')return <main className="world-content about-content">
    <section className="scene"><p className="eyebrow">01 / ABOUT — WHO WE ARE</p><h1>We turn possibility<br/>into <em>reality.</em></h1><p className="japanese-lead">言葉から、まだない世界へ。</p></section>
    <section className="scene"><p>アイデアに、境界線はいらない。<br/>デザインとテクノロジー、感性と事業。<br/>そのあいだを自由に行き来しながら、<br/>まだ存在しない価値をつくる。</p><p>Studio99は、可能性に投資する<br/>クリエイティブ・キャピタル・カンパニーです。</p></section>
    <section className="scene"><dl className="company-details"><div><dt>COMPANY</dt><dd>Studio99合同会社</dd></div><div><dt>BASED IN</dt><dd>TOKYO / NAGANO</dd></div><div><dt>WEBSITE</dt><dd>studio99.co.jp</dd></div></dl><p className="preview-note">PREVIEW COPY — 掲載内容は確認・調整予定</p></section>
  </main>;
  if(route==='works')return <main className="world-content works-content">
    <section className="scene"><p className="eyebrow">02 / WORKS — WHAT WE CREATE</p><h1>Worlds in <em>the making.</em></h1>
    <div className="project-list">{PROJECTS.map(p=><Link href={`/works/${p.slug}`} key={p.slug}><small>{p.number}</small><strong>{p.name}</strong><span>{p.category}</span></Link>)}</div>
    <p className="preview-note">PROJECT PREVIEW — 名称以外の紹介文は仮原稿です</p></section>
  </main>;
  if(route==='contact')return <main className="world-content contact-content">
    <section className="scene"><p className="eyebrow">03 / CONTACT — MAKE ONE WITH US</p><h1>What’s your<br/><em>next world?</em></h1>
    <div className="contact-intro"><p>まだ言葉にならないアイデアも。ここから、一緒に。</p><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></div></section>
    <section className="scene"><ContactForm/></section>
  </main>;
  const p=PROJECTS.find(p=>route===`works/${p.slug}`)!;
  return <main className="world-content project-content">
    <section className="scene"><p className="eyebrow">WORKS / {p.number} — {p.category}</p><h1>{p.name}<span className="project-period">.</span></h1><p className="project-tagline">{p.line}</p></section>
    <section className="scene"><p className="project-description">{p.description}</p><div className={`project-art project-art-${p.slug}`} aria-hidden="true">{p.slug==='rubicon'?<><span/><span/><span/></>:p.slug==='bi'?<i>bi</i>:<i>on<span/></i>}</div><p className="preview-note">CONCEPT PREVIEW — 紹介文・ビジュアルは仮制作です</p><Link className="text-link" href="/works">ALL WORLDS</Link></section>
  </main>;
}
