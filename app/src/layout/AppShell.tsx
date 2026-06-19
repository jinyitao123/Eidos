import { Outlet, useLocation } from 'react-router-dom'
import { TopBar } from './TopBar'
import { SideNav } from './SideNav'
import styles from './AppShell.module.css'

export function AppShell() {
  const { pathname } = useLocation()
  // Studio 是全幅分屏页,不要 .content 的 960 限宽/居中/内边距。
  const fullBleed = pathname.includes('/studio')

  return (
    <div className={styles.shell}>
      <TopBar />
      <SideNav />
      <main className={fullBleed ? styles.mainFull : styles.main}>
        {fullBleed ? <Outlet /> : <div className={styles.content}><Outlet /></div>}
      </main>
    </div>
  )
}
