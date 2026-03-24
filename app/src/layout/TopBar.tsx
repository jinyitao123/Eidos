import styles from './TopBar.module.css'

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span className={styles.symbol}>&#10022;</span>
        <span className={styles.name}>inocube</span>
        <span className={styles.separator}>·</span>
        <span className={styles.appName}>本体工具</span>
      </div>
      <div className={styles.right}>
        <div className={styles.user}>
          <div className={styles.avatar}>管</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>管理员</div>
            <div className={styles.userRole}>本体编辑者</div>
          </div>
        </div>
      </div>
    </header>
  )
}
