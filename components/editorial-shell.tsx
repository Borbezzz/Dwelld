import BrandLogo from "./brand-logo";
import Link from 'next/link';
import type {ReactNode} from 'react';
export default function EditorialShell({children}:{children:ReactNode}){return <main className="landing editorial-page"><header className="landing-header"><BrandLogo linked /><nav aria-label="Main navigation"><Link href="/#spaces">Your spaces</Link><Link href="/live">New inspection</Link></nav></header>{children}<footer className="landing-footer"><BrandLogo compact /><p>Your room remembers.</p></footer></main>;}
