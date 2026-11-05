'use client';
import {useState} from 'react';
import {CONTACT_EMAIL} from '@/lib/content';
export default function ContactForm(){
  const [status,setStatus]=useState('');
  return <form className="contact-form" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);
    const body=`お名前: ${data.get('name')}\nメール: ${data.get('email')}\n\n${data.get('message')}`;
    window.location.href=`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Studio99 / Let’s make a world')}&body=${encodeURIComponent(body)}`;
    setStatus('メールアプリで下書きを開きます。この画面からは送信されません。');
  }}>
    <div className="form-pair"><label>YOUR NAME<input name="name" autoComplete="name" placeholder="お名前" required maxLength={100}/></label><label>EMAIL<input name="email" type="email" autoComplete="email" placeholder="メールアドレス" required/></label></div>
    <label>YOUR WORLD<textarea name="message" placeholder="どんな世界を、一緒につくりましょう。" required rows={3} maxLength={4000}/></label>
    <div className="form-bottom"><span>PREVIEW — 仮の問い合わせ先です</span><button className="text-link" type="submit">OPEN EMAIL DRAFT <span>↗</span></button></div>
    <p role="status" className="form-status">{status}</p>
  </form>;
}
