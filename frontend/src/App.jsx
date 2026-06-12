import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Overview             from './pages/Overview'
import ProductReadiness     from './pages/ProductReadiness'
import LocalizationAnalysis from './pages/LocalizationAnalysis'
import RiskDiagnostics      from './pages/RiskDiagnostics'
import Simulator            from './pages/Simulator'
import ActionQueue          from './pages/ActionQueue'
import Forecasting          from './pages/Forecasting'
import Optimizer            from './pages/Optimizer'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"             element={<Overview />} />
        <Route path="/actions"      element={<ActionQueue />} />
        <Route path="/readiness"    element={<ProductReadiness />} />
        <Route path="/localization" element={<LocalizationAnalysis />} />
        <Route path="/risk"         element={<RiskDiagnostics />} />
        <Route path="/simulator"    element={<Simulator />} />
        <Route path="/forecasting"  element={<Forecasting />} />
        <Route path="/optimizer"    element={<Optimizer />} />
      </Routes>
    </Layout>
  )
}
