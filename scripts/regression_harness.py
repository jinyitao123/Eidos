#!/usr/bin/env python3
"""
本体编辑器全流程回归测试 Harness
基于《AI Agent 人格扮演测试》方法论

完整业务流程：
  创建项目 → 上传文档 → S1 场景分析 → S2 本体架构 → S3 规则设计 → S4 审核 → 检查

多行业人格覆盖：
  制造业备件管理 / 医院设备管理 / 电商库存 / 物业能耗

用法：
  python3 regression_harness.py existing                    # 快速检查已有项目
  python3 regression_harness.py full <行业>                  # 完整流程（慢，需要 LLM）
  python3 regression_harness.py all                         # 全行业全流程
"""

import json
import time
import sys
import hashlib
import hmac
import base64
import requests
import yaml

# ─── Config ──────────────────────────────────────────────
MCP_URL = "http://localhost:9091/"
WEAVE_URL = "http://localhost:8080"
JWT_SECRET = "dev-secret-change-in-prod"

# ─── Auth ────────────────────────────────────────────────
def make_jwt():
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload_data = {"sub": "admin", "tenant_id": "default", "exp": int(time.time()) + 86400, "iat": int(time.time())}
    payload = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).rstrip(b"=").decode()
    sig = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header}.{payload}.{sig_b64}"

TOKEN = make_jwt()

# ─── API Helpers ─────────────────────────────────────────
def mcp_call(tool_name, arguments):
    r = requests.post(MCP_URL, json={
        "jsonrpc": "2.0", "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments}, "id": 1
    }, timeout=30)
    result = r.json()["result"]
    return result["content"][0]["text"], result["isError"]

def chat_agent(agent, message, profile="", timeout=600):
    r = requests.post(f"{WEAVE_URL}/v1/chat",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={"agent": agent, "message": message, "profile": profile},
        stream=True, timeout=timeout)
    text_chunks, tool_calls, tool_results = [], [], []
    current_event_type = ""
    for line in r.iter_lines(decode_unicode=True):
        if not line:
            current_event_type = ""
            continue
        # SSE format: "event: <type>\ndata: <json>\n\n"
        if line.startswith("event: "):
            current_event_type = line[7:]
            continue
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]": break
        try:
            evt = json.loads(data)
            # Use SSE event type if available, fall back to data.event
            et = current_event_type or evt.get("event", "")
            if et == "chunk":
                text_chunks.append(evt.get("content", "") or evt.get("data", {}).get("content", ""))
            elif et == "tool_call":
                tool_calls.append(evt)
            elif et == "tool_result":
                tool_results.append(evt)
            elif et == "done":
                break
        except: pass
    return "".join(text_chunks), tool_calls, tool_results

# ═══════════════════════════════════════════════════════════
#  行业场景定义
# ═══════════════════════════════════════════════════════════

INDUSTRIES = {
    "备件管理": {
        "doc": """
备件管理业务研究报告

核心业务对象：库存头寸（一种备件在一个库房的持有状态）是管理的原子单位。
主要实体：库存头寸、备件、库房、出入库记录、设备、采购单、库存快照、决策日志。
关系：头寸跟踪备件、头寸位于库房、出入库影响头寸、设备使用备件、采购单采购备件。
核心指标：库存周转率、呆滞库存占比、安全库存覆盖率。
设备会持续产生振动、温度等物联网数据。
安全库存不足时触发预警，月度扫描呆滞库存。
""",
        "s2_message": "请根据场景分析设计完整本体 YAML，包含 classes、relationships、metrics、telemetry。",
        "s3_message": "请根据场景分析和本体结构设计业务规则和动作。",
        "expected_classes": ["inventory_position", "spare_part", "warehouse"],
        "expected_first_citizen": "inventory_position",
    },
    "医院设备": {
        "doc": """
医院设备管理业务研究报告

核心业务对象：设备台账（一台设备在一个科室的使用状态）是管理的原子单位。
主要实体：设备台账、设备型号、科室、维修工单、保养计划、巡检记录、备件库存、供应商。
关系：台账属于科室、台账对应设备型号、工单关联台账、保养计划覆盖台账、巡检针对台账。
核心指标：设备完好率、平均故障间隔（MTBF）、维修及时率、保养覆盖率。
设备传感器持续采集运行时长、温度、压力等数据。
设备故障时自动生成工单，保养到期前 7 天提醒。
重要设备（A类）巡检频率高于一般设备。
""",
        "s2_message": "请根据场景分析设计完整本体 YAML，包含 classes、relationships、metrics、telemetry。",
        "s3_message": "请根据场景分析和本体结构设计业务规则和动作。",
        "expected_classes": ["device_ledger", "device_model", "department"],
        "expected_first_citizen": "device_ledger",
    },
    "电商库存": {
        "doc": """
电商库存管理业务研究报告

核心业务对象：SKU库位（一个SKU在一个仓库库位的库存状态）是管理的原子单位。
主要实体：SKU库位、SKU商品、仓库、库位、入库单、出库单、调拨单、盘点记录、促销活动。
关系：库位属于仓库、SKU库位对应SKU商品、入库单写入SKU库位、出库单消耗SKU库位、促销活动关联SKU。
核心指标：库存准确率、发货及时率、缺货率、库龄分布。
大促期间库存变动频繁，需要实时监控。
库存不足时自动触发采购建议，滞销超过90天标记为呆滞。
ABC分类：A类商品（高销量）占比20%但贡献80%销售额。
""",
        "s2_message": "请根据场景分析设计完整本体 YAML，包含 classes、relationships、metrics、telemetry。",
        "s3_message": "请根据场景分析和本体结构设计业务规则和动作。",
        "expected_classes": ["sku_position", "sku", "warehouse"],
        "expected_first_citizen": "sku_position",
    },
    "物业能耗": {
        "doc": """
物业能耗管理业务研究报告

核心业务对象：计量点（一个能耗计量表在一个区域的读数状态）是管理的原子单位。
主要实体：计量点、能耗表具、楼栋、区域、能耗读数、异常事件、节能措施、费用账单。
关系：计量点安装在区域、区域属于楼栋、能耗读数来自计量点、异常事件关联计量点、费用账单对应区域。
核心指标：单位面积能耗、同比环比变化率、峰谷比、碳排放强度。
表具持续采集电量、水量、气量等数据，采样间隔 15 分钟。
单日用量超过均值 3 倍时触发异常告警。
月度对比分析各楼栋能耗趋势。
""",
        "s2_message": "请根据场景分析设计完整本体 YAML，包含 classes、relationships、metrics、telemetry。",
        "s3_message": "请根据场景分析和本体结构设计业务规则和动作。",
        "expected_classes": ["meter_point", "meter", "building"],
        "expected_first_citizen": "meter_point",
    },
}

# ═══════════════════════════════════════════════════════════
#  CHECK FUNCTIONS — S1 场景分析
# ═══════════════════════════════════════════════════════════

def check_s1_has_first_citizen(s1_text):
    """S1 输出包含 first_citizen"""
    if "first_citizen" not in s1_text:
        return False, "缺少 first_citizen 定义"
    return True, ""

def check_s1_has_entities(s1_text):
    """S1 输出包含 entities 列表"""
    if "entities" not in s1_text:
        return False, "缺少 entities 列表"
    return True, ""

def check_s1_has_relationships(s1_text):
    """S1 输出包含 relationships"""
    if "relationships" not in s1_text or "relation" not in s1_text.lower():
        return False, "缺少 relationships 定义"
    return True, ""

def check_s1_no_invented_entities(s1_text, doc_text):
    """S1 没有编造文档中未提及的实体"""
    # 简单检查：S1 提到的类名是否在原文中有对应
    return True, ""  # 需要更复杂的检查

# ═══════════════════════════════════════════════════════════
#  CHECK FUNCTIONS — S2 本体结构
# ═══════════════════════════════════════════════════════════

import re

def check_yaml_parseable(yaml_text):
    try:
        yaml.safe_load(yaml_text)
        return True, ""
    except Exception as e:
        return False, f"YAML 解析失败: {e}"

def check_has_classes(doc):
    classes = doc.get("classes", [])
    if len(classes) < 3:
        return False, f"只有 {len(classes)} 个类，期望 >= 3"
    return True, f"{len(classes)} 个类"

def check_first_citizen_exists(doc):
    fc = [c for c in doc.get("classes", []) if c.get("first_citizen")]
    if len(fc) == 0: return False, "没有 first_citizen 类"
    if len(fc) > 1: return False, f"有 {len(fc)} 个 first_citizen"
    return True, f"first_citizen: {fc[0]['id']}"

def check_first_citizen_rich(doc):
    """第一公民属性 >= 10"""
    fc = [c for c in doc.get("classes", []) if c.get("first_citizen")]
    if not fc: return False, "没有 first_citizen"
    attrs = len(fc[0].get("attributes", []))
    if attrs < 10: return False, f"first_citizen 只有 {attrs} 个属性，期望 >= 10"
    return True, f"{attrs} 个属性"

def check_class_ids_snake_case(doc):
    pattern = re.compile(r'^[a-z][a-z0-9]*(_[a-z0-9]+)*$')
    bad = [c["id"] for c in doc.get("classes", []) if not pattern.match(c.get("id", ""))]
    if bad: return False, f"非 snake_case: {bad}"
    return True, ""

def check_relationships_valid(doc):
    class_ids = {c["id"] for c in doc.get("classes", [])}
    bad = []
    for r in doc.get("relationships", []):
        if r.get("from") not in class_ids: bad.append(f"{r.get('id','?')}.from={r.get('from')}")
        if r.get("to") not in class_ids: bad.append(f"{r.get('id','?')}.to={r.get('to')}")
    if bad: return False, f"幽灵引用: {bad}"
    return True, f"{len(doc.get('relationships', []))} 个关系"

def check_metrics_have_kind(doc):
    valid = {"aggregate", "composite", "classification"}
    bad = [f"{m['id']}: kind={m.get('kind','')!r}" for m in doc.get("metrics", []) if m.get("kind", "") not in valid]
    if bad: return False, f"无效 kind: {bad[:3]}"
    return True, ""

def check_metrics_have_status(doc):
    valid = {"implemented", "designed", "undefined"}
    bad = [f"{m['id']}: status={m.get('status','')!r}" for m in doc.get("metrics", []) if m.get("status", "") not in valid]
    if bad: return False, f"无效 status: {bad[:3]}"
    return True, ""

def check_metrics_have_source_entities(doc):
    bad = [f"{m['id']}" for m in doc.get("metrics", []) if not m.get("source_entities") or not isinstance(m.get("source_entities"), list)]
    if bad: return False, f"缺少 source_entities: {bad[:3]}"
    return True, ""

def check_telemetry_have_source_class(doc):
    bad = [f"{t['id']}" for t in doc.get("telemetry", []) if not t.get("source_class")]
    if bad: return False, f"缺少 source_class: {bad[:3]}"
    return True, ""

def check_telemetry_have_value_type(doc):
    valid = {"decimal", "integer", "boolean", "string"}
    bad = [f"{t['id']}: {t.get('value_type','')!r}" for t in doc.get("telemetry", []) if t.get("value_type", "") not in valid]
    if bad: return False, f"无效 value_type: {bad[:3]}"
    return True, ""

def check_telemetry_have_context_strategy(doc):
    bad = [t["id"] for t in doc.get("telemetry", []) if not t.get("context_strategy") or not isinstance(t.get("context_strategy"), dict)]
    if bad: return False, f"缺少 context_strategy: {bad[:3]}"
    return True, ""

def check_no_fabricated_standard(doc):
    yaml_text = yaml.dump(doc, allow_unicode=True)
    for match in re.finditer(r'GB/T\s*(\d{4,})', yaml_text):
        if len(set(match.group(1))) == 1: return False, f"疑似编造标准号: GB/T {match.group(1)}"
    return True, ""

# ═══════════════════════════════════════════════════════════
#  CHECK FUNCTIONS — S3 规则
# ═══════════════════════════════════════════════════════════

def check_s3_has_rules(s3_text):
    doc = yaml.safe_load(s3_text) if isinstance(s3_text, str) else s3_text
    rules = doc.get("rules", [])
    if len(rules) == 0: return False, "没有规则"
    return True, f"{len(rules)} 个规则"

def check_s3_rules_have_trigger(s3_doc):
    bad = [r["id"] for r in s3_doc.get("rules", []) if not r.get("trigger")]
    if bad: return False, f"规则缺少 trigger: {bad[:3]}"
    return True, ""

def check_s3_rules_have_condition(s3_doc):
    bad = [r["id"] for r in s3_doc.get("rules", []) if not r.get("condition")]
    if bad: return False, f"规则缺少 condition: {bad[:3]}"
    return True, ""

def check_s3_has_actions(s3_doc):
    actions = s3_doc.get("actions", [])
    if len(actions) == 0: return False, "没有动作"
    return True, f"{len(actions)} 个动作"

def check_s3_rule_refs_valid_entities(s3_doc, s2_doc):
    """规则引用的实体在本体中存在"""
    class_ids = {c["id"] for c in s2_doc.get("classes", [])}
    bad = []
    for r in s3_doc.get("rules", []):
        cond = r.get("condition", {})
        entity = cond.get("entity", "") if isinstance(cond, dict) else ""
        if entity and entity not in class_ids:
            bad.append(f"{r['id']}: entity={entity}")
    if bad: return False, f"规则引用不存在的类: {bad[:3]}"
    return True, ""

# ═══════════════════════════════════════════════════════════
#  CHECK FUNCTIONS — S4 审核报告
# ═══════════════════════════════════════════════════════════

def check_s4_has_summary(s4_text):
    doc = yaml.safe_load(s4_text) if isinstance(s4_text, str) else s4_text
    if not doc.get("summary"): return False, "审核报告缺少 summary"
    return True, ""

def check_s4_no_blocking_issues(s4_doc):
    """没有阻断性问题"""
    summary = s4_doc.get("summary", {})
    blocking = summary.get("blocking", 0)
    if blocking > 0:
        issues = [i for i in s4_doc.get("issues", []) if i.get("severity") == "C"]
        return False, f"{blocking} 个阻断性问题: {[i.get('id') for i in issues[:5]]}"
    return True, f"通过 {summary.get('passed', 0)} 项检查"

# ═══════════════════════════════════════════════════════════
#  CHECK FUNCTIONS — Guard 系统
# ═══════════════════════════════════════════════════════════

def check_guard_blocks_bad_metric(project_id):
    """Guard 能拦住 implemented 但没 formula 的指标"""
    bad_yaml = "id: guard_test\nname: T\nversion: '1.0'\nclasses:\n  - id: x\n    name: X\n    phase: alpha\n    first_citizen: true\n    attributes:\n      - {id: a, name: A, type: string}\nmetrics:\n  - id: m\n    name: M\n    description: t\n    phase: alpha\n    kind: aggregate\n    source_entities: [x]\n    status: implemented"
    text, is_error = mcp_call("save_output", {"project_id": project_id, "stage": "ontology_structure", "content": bad_yaml})
    if not is_error: return False, "Guard 未拦住 implemented metric without formula"
    if "formula" not in text: return False, f"Error 不含 formula 引导"
    return True, "Guard 正确拦截"

def check_guard_blocks_bad_telemetry(project_id):
    """Guard 能拦住没有 source_class 的遥测"""
    bad_yaml = "id: guard_test\nname: T\nversion: '1.0'\nclasses:\n  - id: x\n    name: X\n    phase: alpha\n    first_citizen: true\n    attributes:\n      - {id: a, name: A, type: string}\ntelemetry:\n  - id: t1\n    name: T1\n    description: t\n    phase: alpha\n    source: x\n    value_type: decimal\n    sampling: 1min\n    aggregations: [avg]"
    text, is_error = mcp_call("save_output", {"project_id": project_id, "stage": "ontology_structure", "content": bad_yaml})
    if not is_error: return False, "Guard 未拦住 telemetry without source_class"
    if "source_class" not in text: return False, f"Error 不含 source_class 引导"
    return True, "Guard 正确拦截"

# ═══════════════════════════════════════════════════════════
#  HARNESS RUNNER
# ═══════════════════════════════════════════════════════════

S2_CHECKS = [
    ("yaml_parseable", lambda doc, _: check_yaml_parseable(yaml.dump(doc, allow_unicode=True))),
    ("has_classes", lambda doc, _: check_has_classes(doc)),
    ("first_citizen_exists", lambda doc, _: check_first_citizen_exists(doc)),
    ("first_citizen_rich", lambda doc, _: check_first_citizen_rich(doc)),
    ("class_ids_snake_case", lambda doc, _: check_class_ids_snake_case(doc)),
    ("relationships_valid", lambda doc, _: check_relationships_valid(doc)),
    ("metrics_have_kind", lambda doc, _: check_metrics_have_kind(doc)),
    ("metrics_have_status", lambda doc, _: check_metrics_have_status(doc)),
    ("metrics_have_source_entities", lambda doc, _: check_metrics_have_source_entities(doc)),
    ("telemetry_have_source_class", lambda doc, _: check_telemetry_have_source_class(doc)),
    ("telemetry_have_value_type", lambda doc, _: check_telemetry_have_value_type(doc)),
    ("telemetry_have_context_strategy", lambda doc, _: check_telemetry_have_context_strategy(doc)),
    ("no_fabricated_standard", lambda doc, _: check_no_fabricated_standard(doc)),
]

def run_s2_checks(yaml_text, project_id):
    results = []
    p, d = check_yaml_parseable(yaml_text)
    results.append(("yaml_parseable", p, d))
    if not p: return results

    doc = yaml.safe_load(yaml_text)
    for name, fn in S2_CHECKS[1:]:
        try: p, d = fn(doc, project_id)
        except Exception as e: p, d = False, f"异常: {e}"
        results.append((name, p, d))

    # Guard checks
    for check_fn in [check_guard_blocks_bad_metric, check_guard_blocks_bad_telemetry]:
        try: p, d = check_fn(project_id)
        except Exception as e: p, d = False, f"异常: {e}"
        results.append((check_fn.__name__, p, d))

    return results

def run_full_flow(industry_name, industry, timeout_per_agent=600):
    """运行完整 S1→S2→S3→S4 流程"""
    print(f"\n{'='*60}")
    print(f"  {industry_name}")
    print(f"{'='*60}")

    # Step 1: 创建项目
    project_id = None
    text, err = mcp_call("create_project", {"name": f"回归-{industry_name}-{int(time.time())}", "description": f"回归测试: {industry_name}"})
    if err:
        print(f"  ✗ 创建项目失败: {text}")
        return None
    project_id = json.loads(text).get("project_id") or json.loads(text).get("id")
    print(f"  项目: {project_id}")

    # Step 2: 上传文档（模拟）
    text, err = mcp_call("upload_document", {"project_id": project_id, "filename": "research.txt", "content": industry["doc"]})
    if err:
        print(f"  ⚠ 上传文档失败（跳过）: {text[:100]}")

    all_results = {}

    # Step 3: S1 场景分析
    print(f"\n  --- S1 场景分析 ---")
    t0 = time.time()
    try:
        s1_text, s1_tc, s1_tr = chat_agent("scene-analyst",
            f"请分析以下业务研究报告，提取场景分析。\n\n{industry['doc']}",
            profile=f"project_id={project_id}", timeout=timeout_per_agent)
        elapsed = time.time() - t0
        print(f"  完成 ({elapsed:.0f}s), tools={len(s1_tc)}, text={len(s1_text)} chars")

        # 读取 S1 保存的输出
        s1_saved, _ = mcp_call("read_scene_analysis", {"project_id": project_id})
        s1_data = json.loads(s1_saved).get("content", "")

        s1_checks = []
        for name, fn in [("has_first_citizen", check_s1_has_first_citizen),
                         ("has_entities", check_s1_has_entities),
                         ("has_relationships", check_s1_has_relationships)]:
            p, d = fn(s1_data)
            s1_checks.append((name, p, d))
            marker = "✓" if p else "✗"
            print(f"    {marker} {name} {d}")

        # 检查工具调用纪律
        guard_blocks = sum(1 for tr in s1_tr if tr.get("status") == "error" and "integrity guard" in tr.get("content", ""))
        if guard_blocks: print(f"    🛡️ Guard 拦截 {guard_blocks} 次")

        all_results["S1"] = s1_checks

    except Exception as e:
        print(f"  S1 失败: {e}")
        # 注入场景分析以继续
        print(f"  注入默认场景分析...")
        mcp_call("save_output", {"project_id": project_id, "stage": "scene_analysis", "content": industry["doc"]})
        all_results["S1"] = [("fallback", False, str(e))]

    # Step 4: S2 本体架构
    print(f"\n  --- S2 本体架构 ---")
    t0 = time.time()
    try:
        s2_text, s2_tc, s2_tr = chat_agent("ontology-architect",
            industry["s2_message"],
            profile=f"project_id={project_id}", timeout=timeout_per_agent)
        elapsed = time.time() - t0
        print(f"  完成 ({elapsed:.0f}s), tools={len(s2_tc)}")

        guard_blocks = sum(1 for tr in s2_tr if tr.get("status") == "error" and "integrity guard" in tr.get("content", ""))
        if guard_blocks:
            print(f"    🛡️ Guard 拦截 {guard_blocks} 次 → Agent 自愈")
            for tr in s2_tr:
                if tr.get("status") == "error" and "integrity guard" in tr.get("content", ""):
                    print(f"      {tr['content'][:120]}")

        # 读取 S2 输出
        s2_saved, _ = mcp_call("read_ontology_structure", {"project_id": project_id})
        s2_yaml = json.loads(s2_saved).get("content", "")
        s2_checks = run_s2_checks(s2_yaml, project_id)

        for name, p, d in s2_checks:
            marker = "✓" if p else "✗"
            print(f"    {marker} {name} {d}")

        all_results["S2"] = s2_checks

    except Exception as e:
        print(f"  S2 失败: {e}")
        all_results["S2"] = [("timeout", False, str(e))]

    # Step 5: S3 规则设计
    print(f"\n  --- S3 规则设计 ---")
    t0 = time.time()
    try:
        s3_text, s3_tc, s3_tr = chat_agent("rule-designer",
            industry["s3_message"],
            profile=f"project_id={project_id}", timeout=timeout_per_agent)
        elapsed = time.time() - t0
        print(f"  完成 ({elapsed:.0f}s), tools={len(s3_tc)}")

        # 读取 S3 输出
        s3_saved, _ = mcp_call("read_rules_actions", {"project_id": project_id})
        s3_yaml = json.loads(s3_saved).get("content", "")
        s3_doc = yaml.safe_load(s3_yaml) if s3_yaml else {}

        s3_checks = []
        for name, fn in [("has_rules", lambda: check_s3_has_rules(s3_doc)),
                         ("rules_have_trigger", lambda: check_s3_rules_have_trigger(s3_doc)),
                         ("has_actions", lambda: check_s3_has_actions(s3_doc))]:
            try: p, d = fn()
            except Exception as e: p, d = False, str(e)
            s3_checks.append((name, p, d))
            marker = "✓" if p else "✗"
            print(f"    {marker} {name} {d}")

        all_results["S3"] = s3_checks

    except Exception as e:
        print(f"  S3 失败: {e}")
        all_results["S3"] = [("timeout", False, str(e))]

    # Step 6: S4 审核
    print(f"\n  --- S4 审核 ---")
    t0 = time.time()
    try:
        s4_text, s4_tc, s4_tr = chat_agent("ontology-reviewer",
            "请对当前本体进行完整审核。",
            profile=f"project_id={project_id}", timeout=timeout_per_agent)
        elapsed = time.time() - t0
        print(f"  完成 ({elapsed:.0f}s), tools={len(s4_tc)}")

        s4_saved, _ = mcp_call("read_review_report", {"project_id": project_id})
        s4_yaml = json.loads(s4_saved).get("content", "")
        s4_doc = yaml.safe_load(s4_yaml) if s4_yaml else {}

        s4_checks = []
        for name, fn in [("has_summary", lambda: check_s4_has_summary(s4_doc)),
                         ("no_blocking", lambda: check_s4_no_blocking_issues(s4_doc))]:
            try: p, d = fn()
            except Exception as e: p, d = False, str(e)
            s4_checks.append((name, p, d))
            marker = "✓" if p else "✗"
            print(f"    {marker} {name} {d}")

        all_results["S4"] = s4_checks

    except Exception as e:
        print(f"  S4 失败: {e}")
        all_results["S4"] = [("timeout", False, str(e))]

    # Summary
    print(f"\n  {'='*50}")
    print(f"  SUMMARY: {industry_name}")
    print(f"  {'='*50}")
    total_passed = 0
    total_checks = 0
    for agent, checks in all_results.items():
        passed = sum(1 for _, p, _ in checks if p)
        total = len(checks)
        total_passed += passed
        total_checks += total
        pct = passed / total * 100 if total else 0
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        print(f"  {agent:4s} {bar} {passed}/{total} ({pct:.0f}%)")

    overall_pct = total_passed / total_checks * 100 if total_checks else 0
    print(f"  {'─'*50}")
    print(f"  总计: {total_passed}/{total_checks} ({overall_pct:.1f}%)")

    return {"industry": industry_name, "project_id": project_id, "results": all_results,
            "passed": total_passed, "total": total_checks}


# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "existing"

    if mode == "existing":
        project_id = sys.argv[2] if len(sys.argv) > 2 else "bc288052-2372-4029-bc5b-37cd857e60b1"
        print(f"{'='*60}")
        print(f"  快速模式：检查已有项目 {project_id}")
        print(f"{'='*60}")

        text, err = mcp_call("read_ontology_structure", {"project_id": project_id})
        if err:
            print(f"读取失败: {text}")
            sys.exit(1)
        yaml_text = json.loads(text).get("content", "")
        checks = run_s2_checks(yaml_text, project_id)

        passed = sum(1 for _, p, _ in checks if p)
        total = len(checks)
        for name, p, d in checks:
            marker = "✓" if p else "✗"
            print(f"  {marker} {name} {d}")
        print(f"\n  TOTAL: {passed}/{total} ({passed/total*100:.1f}%)")
        sys.exit(0 if passed == total else 1)

    elif mode == "full":
        industry = sys.argv[2] if len(sys.argv) > 2 else "备件管理"
        if industry not in INDUSTRIES:
            print(f"未知行业: {industry}. 可用: {list(INDUSTRIES.keys())}")
            sys.exit(1)
        timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 600
        result = run_full_flow(industry, INDUSTRIES[industry], timeout_per_agent=timeout)
        sys.exit(0 if result and result["passed"] == result["total"] else 1)

    elif mode == "all":
        timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 600
        results = []
        for name, industry in INDUSTRIES.items():
            result = run_full_flow(name, industry, timeout_per_agent=timeout)
            if result: results.append(result)

        print(f"\n{'='*60}")
        print(f"  ALL INDUSTRIES")
        print(f"{'='*60}")
        for r in results:
            pct = r["passed"] / r["total"] * 100 if r["total"] else 0
            bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
            print(f"  {r['industry']:10s} {bar} {r['passed']}/{r['total']} ({pct:.0f}%)")

    else:
        print(f"Usage: {sys.argv[0]} [existing [project_id] | full <行业> [timeout] | all [timeout]]")
        print(f"行业: {list(INDUSTRIES.keys())}")
        sys.exit(1)

if __name__ == "__main__":
    main()
