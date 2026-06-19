import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { ProjectList } from './pages/ProjectList'
import { Studio } from './pages/Studio'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ProjectList />} />
        <Route path="/project/:projectId/studio" element={<Studio />} />
        {/* 旧页面已退役,一切收敛到工作台(Studio);其余路径回项目列表。 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
