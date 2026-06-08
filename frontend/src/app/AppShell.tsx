import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Bell, Bot, Boxes, CircleDollarSign, House, LogOut, Menu, MessageCircle, PackageCheck, QrCode, ShieldCheck, ShoppingBasket, Store, Truck, UserRound, Users, X } from 'lucide-react'
import { useAuth } from '../features/auth/auth-context'
import { useUnreadNotifications } from '../features/shared/useUnreadNotifications'

type LinkItem = readonly [string, string, typeof House]

const customerLinks: LinkItem[] = [
  ['/', 'Home', House], ['/products', 'Products', Store], ['/rescue', 'Rescue', PackageCheck],
  ['/cart', 'Cart', ShoppingBasket], ['/orders', 'Orders', Boxes], ['/trace', 'Trace', QrCode],
  ['/reports', 'Reports', ShieldCheck], ['/assistant', 'Assistant', Bot], ['/chat', 'Chat', MessageCircle],
  ['/notifications', 'Alerts', Bell], ['/profile', 'Profile', UserRound],
]
const shipperLinks: LinkItem[] = [
  ['/shipper', 'Deliveries', Truck], ['/chat', 'Chat', MessageCircle],
  ['/notifications', 'Alerts', Bell], ['/profile', 'Profile', UserRound],
]
const managerLinks: LinkItem[] = [
  ['/manager', 'Dashboard', House], ['/manager/catalog', 'Catalog', Boxes],
  ['/manager/orders', 'Operations', Truck], ['/chat', 'Chat', MessageCircle],
  ['/notifications', 'Alerts', Bell], ['/profile', 'Profile', UserRound],
]
const adminLinks: LinkItem[] = [
  ['/admin', 'Dashboard', ShieldCheck], ['/admin/users', 'Users', Users],
  ['/admin/reports', 'Governance', PackageCheck], ['/admin/monitoring', 'Monitoring', Boxes],
  ['/admin/finance', 'Finance', CircleDollarSign],
  ['/assistant', 'Assistant', Bot], ['/chat', 'Chat', MessageCircle],
  ['/notifications', 'Alerts', Bell], ['/profile', 'Profile', UserRound],
]

function DesktopSidebar({ links, unreadCount }: { links: LinkItem[]; unreadCount: number }) {
  const { profile, role, signOut } = useAuth()
  return <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 bg-[#102b1c] text-white lg:block">
    <div className="flex items-center gap-3 px-5 py-5"><img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="h-12 w-12 rounded-xl object-contain"/><div><div className="text-xl font-black">FreshTrace</div><div className="text-xs text-white/55">{role === 'customer' ? 'Clean food. Clear origin.' : 'Operations workspace'}</div></div></div>
    <nav className="space-y-1 px-3">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/' || to === '/manager' || to === '/admin'} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? 'bg-white text-[#102b1c]' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}><Icon size={18}/><span>{label}</span>{to === '/notifications' && unreadCount > 0 && <span className="ml-auto rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}</NavLink>)}</nav>
    <div className="absolute bottom-0 w-full border-t border-white/10 p-5"><b className="block text-sm">{profile?.name}</b><span className="text-xs capitalize text-white/50">{role}</span><button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-white/70"><LogOut size={16}/> Sign out</button></div>
  </aside>
}

function MobileTopBar({ links, unreadCount }: { links: LinkItem[]; unreadCount: number }) {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  return <><header className="sticky top-0 z-30 flex items-center justify-between border-b border-black/5 bg-[#102b1c] px-4 py-2.5 text-white lg:hidden"><div className="flex items-center gap-2.5"><img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="h-10 w-10 rounded-lg object-contain"/><div><b>FreshTrace</b><p className="max-w-52 truncate text-xs text-white/55">{profile?.name}</p></div></div><button onClick={() => setOpen(true)} aria-label="Open navigation" className="relative rounded-xl p-2 hover:bg-white/10"><Menu size={21}/>{unreadCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-400"/>}</button></header>
    {open && <div className="fixed inset-0 z-50 bg-[#102b1c] p-4 text-white lg:hidden"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><img src="/Logo-FreshTrace.png" alt="" className="h-11 w-11 rounded-xl object-contain"/><div><b className="block">FreshTrace</b><span className="text-xs text-white/55">All features</span></div></div><button onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded-xl p-2 hover:bg-white/10"><X size={22}/></button></div><nav className="mt-6 grid grid-cols-2 gap-3">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `relative flex items-center gap-3 rounded-2xl p-4 font-semibold ${isActive ? 'bg-white text-[#102b1c]' : 'bg-white/10 text-white'}`}><Icon size={20}/><span>{label}</span>{to === '/notifications' && unreadCount > 0 && <span className="ml-auto rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}</NavLink>)}</nav><button onClick={signOut} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 p-4 font-semibold text-white/75"><LogOut size={18}/> Sign out</button></div>}
  </>
}

function MobileBottomNav({ links, unreadCount }: { links: LinkItem[]; unreadCount: number }) {
  const customerPrimary = ['/', '/products', '/cart', '/orders', '/profile']
  const isCustomerNav = links.some(([to]) => to === '/cart') && links.some(([to]) => to === '/profile')
  const primary = isCustomerNav
    ? customerPrimary.map(to => links.find(([linkTo]) => linkTo === to)).filter(Boolean) as LinkItem[]
    : links.slice(0, 5)
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t border-black/10 bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,.08)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}>{primary.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `relative flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-semibold ${isActive ? 'text-brand-700' : 'text-black/45'}`}><Icon size={20}/>{to === '/notifications' && unreadCount > 0 && <span className="absolute left-1/2 top-0 ml-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[9px] font-black text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}<span className="truncate">{label}</span></NavLink>)}</nav>
}

export function AppShell() {
  const { role } = useAuth()
  const unreadCount = useUnreadNotifications()
  const links = role === 'employee' ? shipperLinks : role === 'manager' ? managerLinks : role === 'admin' ? adminLinks : customerLinks
  const desktopOnly = role === 'manager' || role === 'admin'
  return <div className={`${desktopOnly ? 'min-w-[1080px]' : ''} min-h-screen lg:flex`}>
    <DesktopSidebar links={links} unreadCount={unreadCount}/>
    {!desktopOnly && <MobileTopBar links={links} unreadCount={unreadCount}/>}
    {desktopOnly && <div className="fixed inset-x-0 top-0 z-50 bg-amber-100 p-3 text-center text-sm font-semibold text-amber-900 lg:hidden">Open this workspace on a desktop screen.</div>}
    <main className={`min-w-0 flex-1 ${desktopOnly ? 'pt-12 lg:pt-0' : ''}`}><div className={`mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 ${desktopOnly ? '' : 'pb-24 lg:pb-8'}`}><Outlet/></div></main>
    {!desktopOnly && <MobileBottomNav links={links} unreadCount={unreadCount}/>}
  </div>
}
