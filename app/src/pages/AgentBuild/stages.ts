import type { StageInfo } from './types'

export const STAGES: StageInfo[] = [
  { id: 'scene_analysis', name: '场景分析', agent: 'scene-analyst', color: '#993C1D' },
  { id: 'ontology_structure', name: '本体架构', agent: 'ontology-architect', color: '#0F6E56' },
  { id: 'rules_actions', name: '规则设计', agent: 'rule-designer', color: '#534AB7' },
  { id: 'review_report', name: '审核', agent: 'ontology-reviewer', color: '#6B6560' },
]

export const TOOL_LABELS: Record<string, string> = {
  list_documents: '获取文档列表',
  read_document: '读取调研文档',
  read_scene_analysis: '读取场景分析',
  read_ontology_structure: '读取本体结构',
  read_full_ontology_yaml: '读取完整本体',
  query_published_ontologies: '查询已发布本体',
  validate_yaml: '验证 YAML',
  validate_rule_references: '验证规则引用',
  save_output: '保存输出',
  import_class: '导入共享类',
  delegate: '委托任务',
}

/**
 * Generate stage prompts based on iteration state.
 * When stageVersion > 0, prompts instruct the agent to read existing output
 * and perform incremental updates instead of starting from scratch.
 */
export function getStagePrompt(
  stageId: string,
  projectId: string,
  stageVersions: number[],
  newDocCount: number,
): string {
  switch (stageId) {
    case 'scene_analysis':
      if (stageVersions[0] > 0 && newDocCount > 0) {
        return (
          `本项目已有场景分析(v${stageVersions[0]})，现在有 ${newDocCount} 份新文档需要补充分析。\n` +
          `请先调用 read_scene_analysis(project_id="${projectId}") 读取已有分析，` +
          `然后调用 list_documents(project_id="${projectId}") 获取所有文档列表，` +
          `读取新上传的文档，在已有分析基础上进行增量补充。\n` +
          `保留已有的分析内容，只增改新文档带来的变化。` +
          `完成后调用 save_output 保存合并后的完整分析。`
        )
      }
      return `请调用 list_documents(project_id="${projectId}") 获取文档列表，然后用 read_document 读取文档全文，再按六步框架分析并保存。`

    case 'ontology_structure':
      // S2 uses multi-step (handled separately in runS2MultiStep)
      return ''

    case 'rules_actions':
      if (stageVersions[2] > 0) {
        return (
          `本项目已有规则设计(v${stageVersions[2]})，场景分析和本体架构已更新。\n` +
          `请调用 read_scene_analysis(project_id="${projectId}") 和 read_ontology_structure(project_id="${projectId}") 读取最新内容，` +
          `然后在已有规则基础上进行增量修改：新增缺少的规则，修正与最新本体不一致的引用。` +
          `完成后 save_output(project_id="${projectId}", stage="rules_actions", content=YAML)。`
        )
      }
      return `调用 read_scene_analysis(project_id="${projectId}") 和 read_ontology_structure(project_id="${projectId}")，然后设计规则和动作。完成后 save_output(project_id="${projectId}", stage="rules_actions", content=YAML)。`

    case 'review_report':
      if (stageVersions[3] > 0) {
        return (
          `本项目本体已更新，请重新审核。` +
          `调用 read_full_ontology_yaml(project_id="${projectId}")，对比上次审核意见，重点关注变更部分。` +
          `完成后 save_output(project_id="${projectId}", stage="review_report", content=YAML)。`
        )
      }
      return `调用 read_full_ontology_yaml(project_id="${projectId}")，审核本体并生成报告。完成后 save_output(project_id="${projectId}", stage="review_report", content=YAML)。`

    default:
      return `开始${stageId}。`
  }
}

/** S2 incremental prompts for multi-step orchestration */
export function getS2Prompts(projectId: string, stageVersions: number[]) {
  const isIncremental = stageVersions[1] > 0

  const round1 = isIncremental
    ? `本项目已有本体结构(v${stageVersions[1]})，场景分析已更新。\n` +
      `请先调用 read_ontology_structure(project_id="${projectId}") 读取当前本体，` +
      `再调用 read_scene_analysis(project_id="${projectId}") 读取最新场景分析，` +
      `在已有本体基础上增量修改 classes 和 relationships：\n` +
      `- 新增场景分析中提到但本体中缺少的类和关系\n` +
      `- 修正与最新分析不一致的地方\n` +
      `- 保留未受影响的已有内容\n` +
      `完成后调用 save_output(project_id="${projectId}", stage="ontology_structure", content=YAML)`
    : `请根据场景分析设计本体的 classes 和 relationships。\n` +
      `要求：\n` +
      `- 只设计 classes（含完整 attributes）和 relationships\n` +
      `- 不要添加 metrics 和 telemetry（后续步骤会单独添加）\n` +
      `- 第一公民类的属性要最丰富（>=15个），包含基础属性、派生属性和状态属性\n` +
      `- 派生属性的 formula 只能引用同类中已定义的属性\n` +
      `- 完成后调用 save_output(project_id="${projectId}", stage="ontology_structure", content=YAML)`

  const round2 =
    `请在已有的本体结构上${isIncremental ? '检查并更新' : '添加'} metrics（指标）。\n` +
    `先调用 read_ontology_structure(project_id="${projectId}") 读取当前结构，然后在其基础上${isIncremental ? '增改' : '添加'} metrics 部分。\n\n` +
    `每个 metric 必须包含：\n` +
    `- kind: aggregate（聚合）/ composite（复合）/ classification（分类）\n` +
    `- status: designed / implemented / undefined\n` +
    `- source_entities: 列表格式如 [class_id1, class_id2]\n` +
    `- formula: 计算公式\n` +
    `- description: 业务含义\n\n` +
    `注意：kind 不能用 gauge/counter/kpi/ratio 等非标准值，status 不能用 active/enabled/live 等非标准值。\n` +
    `完成后调用 save_output 保存完整的 YAML（包含已有的 classes + relationships + 新增的 metrics）。`

  const round3 =
    `请在已有的本体结构上${isIncremental ? '检查并更新' : '添加'} telemetry（遥测数据流）。\n` +
    `先调用 read_ontology_structure(project_id="${projectId}") 读取当前结构，然后在其基础上${isIncremental ? '增改' : '添加'} telemetry 部分。\n\n` +
    `每个 telemetry 必须包含：\n` +
    `- source_class: 数据来源类（注意：字段名是 source_class 不是 source）\n` +
    `- value_type: decimal / integer / boolean / string（不能用 float/gauge/percentage 等）\n` +
    `- sampling: 采样频率如 1s / 10s / 1min（注意：字段名是 sampling 不是 interval）\n` +
    `- aggregations: 列表格式如 [avg, max, min]（注意：字段名是 aggregations 复数，不是 aggregation）\n` +
    `- status: designed / implemented / undefined\n` +
    `- context_strategy: 必须是对象格式，包含 default_window / max_window / default_aggregation / default_granularity\n\n` +
    `完成后调用 save_output 保存完整的 YAML（包含已有的 classes + relationships + metrics + 新增的 telemetry）。`

  return { round1, round2, round3 }
}
