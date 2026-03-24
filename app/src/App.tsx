import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { ProjectList } from './pages/ProjectList'
import { AgentBuild } from './pages/AgentBuild'
import { GraphReview } from './pages/GraphReview'
import { ClassEditor } from './pages/ClassEditor'
import { RuleEditor } from './pages/RuleEditor'
import { ReviewReport } from './pages/ReviewReport'
import { PublishPipeline } from './pages/PublishPipeline'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ProjectList />} />
        <Route path="/project/:projectId/build" element={<AgentBuild />} />
        <Route path="/project/:projectId/graph" element={<GraphReview />} />
        <Route path="/project/:projectId/class/:classId" element={<ClassEditor />} />
        <Route path="/project/:projectId/rules" element={<RuleEditor />} />
        <Route path="/project/:projectId/report" element={<ReviewReport />} />
        <Route path="/project/:projectId/publish" element={<PublishPipeline />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
