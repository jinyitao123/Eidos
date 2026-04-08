import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { mcpCall } from '../../api/mcp'
import styles from './StrategySetup.module.css'

interface StrategyParams {
  primary_strategy: string
  high_value_threshold: number
  stale_threshold_days: number
  service_level_vital: number
  service_level_essential: number
  service_level_desirable: number
  safety_stock_method: string
  safety_days_vital: number
  safety_days_essential: number
  safety_days_desirable: number
  capital_pressure_level: string
  import_part_buffer_multiplier: number
}

const DEFAULT_PARAMS: StrategyParams = {
  primary_strategy: 'service_level_first',
  high_value_threshold: 2000,
  stale_threshold_days: 180,
  service_level_vital: 0.99,
  service_level_essential: 0.95,
  service_level_desirable: 0.90,
  safety_stock_method: 'hybrid',
  safety_days_vital: 45,
  safety_days_essential: 30,
  safety_days_desirable: 14,
  capital_pressure_level: 'medium',
  import_part_buffer_multiplier: 1.5,
}

export function StrategySetup() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [params, setParams] = useState<StrategyParams>({ ...DEFAULT_PARAMS })

  useEffect(() => {
    if (!projectId) return
    mcpCall<{ parameters: StrategyParams }>('get_strategy_profile', { project_id: projectId })
      .then(res => {
        if (res.parameters) setParams(p => ({ ...p, ...res.parameters }))
      })
      .catch(() => { /* no profile yet, use defaults */ })
      .finally(() => setLoading(false))
  }, [projectId])

  const set = <K extends keyof StrategyParams>(key: K, value: StrategyParams[K]) => {
    setParams(p => ({ ...p, [key]: value }))
    setStatus(null)
  }

  const handleSave = async () => {
    if (!projectId) return
    setSaving(true)
    setStatus(null)
    try {
      await mcpCall('update_strategy_profile', {
        project_id: projectId,
        template_id: 'spare_parts_manufacturing_v1',
        parameters: params,
      })
      setStatus({ ok: true, msg: '策略配置已保存' })
    } catch (err: any) {
      setStatus({ ok: false, msg: err.message || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className={styles.loading}>加载策略配置...</div>

  return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/build`)}>
        &larr; 返回构建对话
      </div>

      <div className={styles.header}>
        <h2 className={styles.title}>策略配置</h2>
        <p className={styles.subtitle}>
          配置该项目的管理策略参数，驱动规则引擎和 AI 建议行为。
        </p>
      </div>

      {/* 核心策略方向 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>管理核心策略</h3>
        <div className={styles.radioGroup}>
          <label className={`${styles.radioLabel} ${params.primary_strategy === 'service_level_first' ? styles.radioLabelSelected : ''}`}>
            <input
              type="radio" className={styles.radioInput}
              checked={params.primary_strategy === 'service_level_first'}
              onChange={() => set('primary_strategy', 'service_level_first')}
            />
            <div className={styles.radioText}>
              <div className={styles.radioName}>服务水平优先</div>
              <div className={styles.radioDesc}>
                以保障设备可用性为第一目标。接受较高库存水平换取更高服务水平。
                适合停机成本高、设备关键度高的场景。
              </div>
            </div>
          </label>
          <label className={`${styles.radioLabel} ${params.primary_strategy === 'capital_efficiency_first' ? styles.radioLabelSelected : ''}`}>
            <input
              type="radio" className={styles.radioInput}
              checked={params.primary_strategy === 'capital_efficiency_first'}
              onChange={() => set('primary_strategy', 'capital_efficiency_first')}
            />
            <div className={styles.radioText}>
              <div className={styles.radioName}>资本效率优先</div>
              <div className={styles.radioDesc}>
                以降低库存占用资金为第一目标。接受偶尔缺货风险换取更低库存成本。
                适合资金紧张、备件标准化、有备用设备的场景。
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 服务水平目标 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>服务水平目标</h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>V 类（关键）备件服务水平</label>
          <div className={styles.fieldHint}>设备停机直接影响生产，缺货不可接受。推荐 0.97-0.99</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="0.01" min="0.90" max="0.999"
              value={params.service_level_vital}
              onChange={e => set('service_level_vital', Number(e.target.value))}
            />
            <span className={styles.unit}>（Z={zValue(params.service_level_vital)}）</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>E 类（重要）备件服务水平</label>
          <div className={styles.fieldHint}>有影响但可短暂容忍。推荐 0.93-0.97</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="0.01" min="0.80" max="0.99"
              value={params.service_level_essential}
              onChange={e => set('service_level_essential', Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>D 类（一般）备件服务水平</label>
          <div className={styles.fieldHint}>缺货影响小，有替代方案。推荐 0.85-0.93</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="0.01" min="0.70" max="0.95"
              value={params.service_level_desirable}
              onChange={e => set('service_level_desirable', Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* 库存管理参数 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>库存管理参数</h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>高价值备件阈值</label>
          <div className={styles.fieldHint}>单价超过此值的备件触发特殊管控流程</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="100" min="500" max="50000"
              value={params.high_value_threshold}
              onChange={e => set('high_value_threshold', Number(e.target.value))}
            />
            <span className={styles.unit}>元/件</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>呆滞判定天数</label>
          <div className={styles.fieldHint}>超过此天数未使用的库存标记为呆滞</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="30" min="90" max="730"
              value={params.stale_threshold_days}
              onChange={e => set('stale_threshold_days', Number(e.target.value))}
            />
            <span className={styles.unit}>天</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>安全库存计算方法</label>
          <div className={styles.radioGroup}>
            {[
              { v: 'statistical', n: '统计法', d: '正态/泊松分布，需要12个月以上历史数据' },
              { v: 'fixed_days', n: '固定天数法', d: '安全库存 = 日均消耗 x 天数，数据不足时使用' },
              { v: 'hybrid', n: '混合法（推荐）', d: '数据充分用统计法，不足时自动降级为固定天数法' },
            ].map(opt => (
              <label key={opt.v} className={`${styles.radioLabel} ${params.safety_stock_method === opt.v ? styles.radioLabelSelected : ''}`}>
                <input
                  type="radio" className={styles.radioInput}
                  checked={params.safety_stock_method === opt.v}
                  onChange={() => set('safety_stock_method', opt.v)}
                />
                <div className={styles.radioText}>
                  <div className={styles.radioName}>{opt.n}</div>
                  <div className={styles.radioDesc}>{opt.d}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 固定天数参数 */}
      {(params.safety_stock_method === 'fixed_days' || params.safety_stock_method === 'hybrid') && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>固定天数安全库存（降级时使用）</h3>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>V 类安全天数</label>
            <div className={styles.fieldRow}>
              <input type="number" className={styles.input} min="7" max="90"
                value={params.safety_days_vital}
                onChange={e => set('safety_days_vital', Number(e.target.value))}
              />
              <span className={styles.unit}>天</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>E 类安全天数</label>
            <div className={styles.fieldRow}>
              <input type="number" className={styles.input} min="3" max="60"
                value={params.safety_days_essential}
                onChange={e => set('safety_days_essential', Number(e.target.value))}
              />
              <span className={styles.unit}>天</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>D 类安全天数</label>
            <div className={styles.fieldRow}>
              <input type="number" className={styles.input} min="1" max="30"
                value={params.safety_days_desirable}
                onChange={e => set('safety_days_desirable', Number(e.target.value))}
              />
              <span className={styles.unit}>天</span>
            </div>
          </div>
        </div>
      )}

      {/* 资金压力 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>企业环境</h3>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>资金压力等级</label>
          <div className={styles.fieldHint}>影响 AI 建议的激进程度</div>
          <div className={styles.radioGroup}>
            {[
              { v: 'low', n: '充裕', d: '可接受更高安全库存以保障服务水平' },
              { v: 'medium', n: '一般', d: '平衡库存与资金' },
              { v: 'high', n: '紧张', d: 'AI 会更积极地建议削减非关键库存' },
            ].map(opt => (
              <label key={opt.v} className={`${styles.radioLabel} ${params.capital_pressure_level === opt.v ? styles.radioLabelSelected : ''}`}>
                <input
                  type="radio" className={styles.radioInput}
                  checked={params.capital_pressure_level === opt.v}
                  onChange={() => set('capital_pressure_level', opt.v)}
                />
                <div className={styles.radioText}>
                  <div className={styles.radioName}>{opt.n}</div>
                  <div className={styles.radioDesc}>{opt.d}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>进口备件安全库存倍数</label>
          <div className={styles.fieldHint}>进口备件交期更长，安全库存在计算基础上乘以此倍数</div>
          <div className={styles.fieldRow}>
            <input
              type="number" className={styles.input} step="0.1" min="1.0" max="3.0"
              value={params.import_part_buffer_multiplier}
              onChange={e => set('import_part_buffer_multiplier', Number(e.target.value))}
            />
            <span className={styles.unit}>倍</span>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存策略配置'}
        </button>
      </div>

      {status && (
        <div className={`${styles.status} ${status.ok ? styles.statusOk : styles.statusErr}`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}

function zValue(sl: number): string {
  // Approximate Z-value for common service levels
  const table: Record<string, string> = {
    '0.85': '1.04', '0.9': '1.28', '0.93': '1.48', '0.95': '1.65',
    '0.97': '1.88', '0.98': '2.05', '0.99': '2.33', '0.999': '3.09',
  }
  const key = String(Math.round(sl * 1000) / 1000)
  return table[key] || '~' + (sl > 0.5 ? (2.3 + (sl - 0.99) * 10).toFixed(1) : '?')
}
