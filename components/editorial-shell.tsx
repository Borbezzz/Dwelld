import Link from 'next/link';
import type {ReactNode} from 'react';
export default function EditorialShell({children}:{children:ReactNode}){return <main className="landing editorial-page"><header className="landing-header"><Link className="landing-wordmark" href="/">dwelld.</Link><nav aria-label="Main navigation"><Link href="/#spaces">Your spaces</Link><Link href="/live">New inspection</Link></nav></header>{children}<footer className="landing-footer"><span className="landing-wordmark">dwelld.</span><p>Your room remembers.</p></footer></main>;}
