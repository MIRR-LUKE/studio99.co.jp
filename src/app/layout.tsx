import type { Metadata } from 'next';
import Experience from '@/components/Experience';
import './globals.css';
export const metadata:Metadata={
  metadataBase:new URL('https://studio99.co.jp'),
  title:{default:'Studio99® — TYPE YOUR WORLD.',template:'%s — Studio99®'},
  description:'Studio99合同会社。言葉から、まだない世界へ。Creative Capital Company / Tokyo & Nagano.',
  icons:{icon:'/icon.svg'},
  robots:{index:false,follow:false},
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ja"><body><Experience>{children}</Experience></body></html>;
}
