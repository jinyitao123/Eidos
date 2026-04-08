# 本体工具 — 手动测试需求文档

> 版本: 2026-03-24 | 环境: Docker (http://localhost:8089)

---

## 前置条件

```bash
# 确保 Docker 环境已启动（包含 Weave API、MCP Server、PostgreSQL、Neo4j）
cd ~/Desktop/weave && docker compose up -d

# 验证服务可达
curl -s http://localhost:8089/          # 前端 UI → 200
curl -s http://localhost:9091/ -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 100  # MCP → 工具列表
```

---

## 一、项目列表页（`/`）

### TC-1.1 页面加载
| 步骤 | 预期 |
|------|------|
| 浏览器访问 `http://localhost:8089/` | 页面加载成功 |
| 观察顶栏 | 显示 "inocube · 本体工具" 品牌标识，右侧显示用户头像"管"和角色"本体编辑者" |
| 观察主标题 | 页面标题为 "本体管理" |
| 观察左侧导航 | 高亮"项目列表" |

### TC-1.2 创建项目
| 步骤 | 预期 |
|------|------|
| 点击右上角"+ 新建本体"按钮 | 弹出"新建本体项目"对话框，包含输入框 |
| 输入项目名称（如"测试项目A"），点击"创建" | 对话框关闭，浏览器自动跳转到 `/project/<id>/build` |
| 点击左侧"项目列表"回到首页 | 项目列表中出现"测试项目A"卡片 |

### TC-1.3 项目卡片信息
| 步骤 | 预期 |
|------|------|
| 观察任一项目卡片 | 显示项目名称 |
| | 显示状态标签：已发布（绿色）/ 构建中（蓝色）/ 待启动（灰色） |
| | 显示创建时间 |
| 如果项目有 YAML 数据 | 显示统计信息：类数、关系数、规则数、动作数 |
| | 显示第一公民类名称标签 |

### TC-1.4 项目导航
| 步骤 | 预期 |
|------|------|
| 单击项目卡片 | 跳转到该项目的构建页 `/project/<id>/build` 或图谱页 `/project/<id>/graph` |
| 观察左侧导航 | 出现项目名称，下方出现子菜单：Agent 构建、图谱审查、规则编辑、审查报告、发布管道 |

### TC-1.5 删除项目
| 步骤 | 预期 |
|------|------|
| 鼠标悬停在项目卡片上 | 出现删除按钮 |
| 点击删除按钮 | 弹出确认对话框，显示"确定删除项目'xxx'？此操作不可恢复。" |
| 点击"取消" | 对话框关闭，项目仍在列表中 |
| 再次点击删除，点击"确认删除" | 对话框关闭，项目从列表中消失 |

### TC-1.6 创建空名称项目
| 步骤 | 预期 |
|------|------|
| 点击"+ 新建本体"，不输入名称直接点"创建" | 提示错误或按钮不可点击（不应创建空名称项目） |

---

## 二、Agent 构建页（`/project/:id/build`）

### TC-2.1 页面加载
| 步骤 | 预期 |
|------|------|
| 通过侧边栏点击"Agent 构建" | 页面加载，显示项目名称 |
| 观察顶部进度条 | 显示 4 个阶段：场景分析 → 本体架构 → 规则设计 → 审核 |
| 观察聊天区域 | 底部有消息输入框和发送按钮 |

### TC-2.2 阶段进度显示
| 步骤 | 预期 |
|------|------|
| 新项目首次进入 | 当前阶段停在"场景分析"（第一个高亮） |
| 如果项目已有已保存的阶段输出 | 已完成阶段显示为已完成状态，消息列表中显示"xxx已完成。输出已保存。" |

### TC-2.3 发送消息（需要 Weave API 可用）
| 步骤 | 预期 |
|------|------|
| 在输入框输入文本，点击发送 | 消息出现在聊天区域，角色显示为"user" |
| 等待 Agent 响应 | Agent 回复出现在聊天区域，显示 Agent 名称（如"场景分析"） |
| 发送过程中 | 输入框禁用，显示加载状态 |

### TC-2.4 文件上传
| 步骤 | 预期 |
|------|------|
| 点击上传文件按钮/图标 | 弹出文件选择器 |
| 选择 .md / .txt 文件 | 文件名出现在聊天中或被处理 |

### TC-2.5 返回按钮
| 步骤 | 预期 |
|------|------|
| 点击顶部"← 返回"按钮 | 返回项目列表页 `/` |

---

## 三、图谱审查页（`/project/:id/graph`）

> **前置**：需要项目已有本体 YAML 数据（至少 `ontology_structure` 阶段已保存）。
> 可通过 MCP 直接注入测试数据：
> ```bash
> # 注入 ontology_structure
> curl -s http://localhost:9091/ -X POST \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "jsonrpc":"2.0","id":1,"method":"tools/call",
>     "params":{"name":"save_output","arguments":{
>       "project_id":"<PROJECT_ID>",
>       "stage":"ontology_structure",
>       "content":"classes:\n  - id: product\n    name: 产品\n    first_citizen: true\n    attributes:\n      - id: name\n        name: 名称\n        type: string\n        required: true\n        graph_sync: true\n      - id: price\n        name: 价格\n        type: decimal\n  - id: category\n    name: 分类\n    attributes:\n      - id: title\n        name: 标题\n        type: string\n        required: true\nrelationships:\n  - id: belongs_to\n    name: 属于\n    from: product\n    to: category\n    cardinality: many_to_one"
>     }}
>   }'
> ```

### TC-3.1 Schema 视图加载
| 步骤 | 预期 |
|------|------|
| 侧边栏点击"图谱审查" | 页面加载，默认显示"结构视图"（Schema）Tab |
| 观察 SVG 画布 | 显示类节点（圆形或矩形），节点上有类名称 |
| 如果有关系 | 节点间有连线，连线上显示关系名称 |
| 第一公民类节点 | 颜色区分于普通类（如铁锈色） |

### TC-3.2 图谱交互
| 步骤 | 预期 |
|------|------|
| 鼠标悬停在节点上 | 节点高亮，可能显示类信息 |
| 拖拽节点 | 节点跟随鼠标移动，松开后保持位置 |
| 滚轮缩放 | 画布缩放 |
| 拖拽空白区域 | 画布平移 |
| 点击类节点 | 跳转到类编辑页 `/project/<id>/class/<classId>` |

### TC-3.3 左侧边栏
| 步骤 | 预期 |
|------|------|
| 观察左侧边栏 | 列出所有类，第一公民类有 ★ 标记 |
| 显示统计 | 规则数、动作数 |
| 点击"+ 新增类"按钮 | 弹出输入对话框，输入类名和 ID 后可添加新类 |

### TC-3.4 Tab 切换 — 实例视图
| 步骤 | 预期 |
|------|------|
| 点击"实例视图"Tab | 切换到实例视图 |
| 如果 Neo4j 有数据 | 显示实例节点和关系边 |
| 如果 Neo4j 无数据 | 显示空状态或加载状态（不应报错） |
| 底部统计栏 | 显示总节点数和总关系数 |

### TC-3.5 顶部操作按钮
| 步骤 | 预期 |
|------|------|
| 点击"← 返回"按钮 | 返回项目列表 |
| 点击"审核报告"按钮（如果存在） | 跳转到 `/project/<id>/report` |
| 点击"发布"按钮（如果存在） | 跳转到 `/project/<id>/publish` |

### TC-3.6 创建关系（拖拽连线）
| 步骤 | 预期 |
|------|------|
| 从一个类节点按住 Alt/Option 拖拽到另一个类节点 | 出现虚线连线跟随鼠标 |
| 松开到目标节点 | 弹出关系创建对话框，填写关系 ID、名称、基数后保存 |
| 保存后 | 新关系连线出现在图谱中 |

---

## 四、类编辑器（`/project/:id/class/:classId`）

> **前置**：需要项目有本体 YAML 数据，且包含目标类。从图谱页点击类节点进入。

### TC-4.1 页面加载
| 步骤 | 预期 |
|------|------|
| 进入类编辑页 | 显示类名称（如"产品"）、类 ID（如"product"）|
| 默认 Tab | "属性"Tab 高亮 |
| 属性表格 | 列出该类所有属性，每行显示：名称、ID、类型、是否必填、是否图谱同步 |

### TC-4.2 属性表格显示
| 步骤 | 预期 |
|------|------|
| 观察表格列 | 包含：名称、ID、类型、必填、图谱同步等列 |
| 类型列 | 显示类型标签（string / integer / decimal / enum / boolean / date / datetime） |
| 必填列 | 显示勾选状态 |
| 图谱同步列 | 标记为 graph_sync 的属性显示勾选 |

### TC-4.3 添加属性
| 步骤 | 预期 |
|------|------|
| 点击"+ 新增属性"按钮 | 表格底部出现新行/表单 |
| 输入属性名称、ID、选择类型 | 字段可正常填写 |
| 保存 | 新属性出现在列表中 |

### TC-4.4 删除属性
| 步骤 | 预期 |
|------|------|
| 鼠标悬停在某属性行 | 出现删除按钮 |
| 点击删除 | 弹出确认对话框 |
| 确认删除 | 属性从列表中移除 |

### TC-4.5 拖拽排序
| 步骤 | 预期 |
|------|------|
| 观察属性行左侧 | 有拖拽手柄（⠿ 图标）|
| 拖拽某属性到另一行的位置 | 属性顺序改变 |

### TC-4.6 Tab 切换
| 步骤 | 预期 |
|------|------|
| 点击"关系"Tab | 显示该类作为 from 端的关系列表 |
| 点击"被引用"Tab | 显示该类作为 to 端的关系列表（只读） |
| 点击"属性"Tab | 切回属性表格 |

### TC-4.7 保存和返回
| 步骤 | 预期 |
|------|------|
| 修改属性后点击"保存修改" | 通过 MCP 保存到后端，显示成功提示 |
| 点击返回按钮 | 返回图谱审查页 |

### TC-4.8 AI 辅助编辑
| 步骤 | 预期 |
|------|------|
| 点击"AI辅助编辑"按钮 | 出现 AI 输入区域 |
| 输入描述（如"添加一个状态字段"）并提交 | AI 返回建议（需要 Weave API 可用） |

---

## 五、规则编辑器（`/project/:id/rules`）

> **前置**：需要项目有规则和动作数据（`rules_actions` 阶段已保存）。
> 可通过 MCP 注入：
> ```bash
> curl -s http://localhost:9091/ -X POST \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "jsonrpc":"2.0","id":1,"method":"tools/call",
>     "params":{"name":"save_output","arguments":{
>       "project_id":"<PROJECT_ID>",
>       "stage":"rules_actions",
>       "content":"rules:\n  - id: R01\n    name: 超期任务提醒\n    severity: warning\n    trigger:\n      type: schedule\n      cron: \"0 9 * * *\"\n    condition:\n      entity: task\n      expression: \"due_date < NOW() AND status != done\"\n    action:\n      type: notify_agent\n      notify: task-manager\n    params:\n      - name: remind_days\n        type: integer\n        default: 7\n        configurable: true\nactions:\n  - id: A01\n    name: 完成任务\n    writes:\n      - target: task\n        set:\n          status: done\n          completed_at: NOW()\n    triggers_after: [R01]\n    execute_permissions: [member, admin]"
>     }}
>   }'
> ```

### TC-5.1 规则列表加载
| 步骤 | 预期 |
|------|------|
| 侧边栏点击"规则编辑" | 页面加载，标题为"规则与动作" |
| 默认 Tab | "规则"Tab 高亮 |
| 规则卡片 | 显示规则 ID（如 R01）、名称（如"超期任务提醒"） |
| 严重度标签 | 根据 severity 显示颜色标签：critical(红) / warning(黄) / info(蓝) |

### TC-5.2 规则详情
| 步骤 | 预期 |
|------|------|
| 观察规则卡片内容 | 显示触发类型（定时触发 / 动作执行前 / 动作执行后） |
| | 显示触发条件表达式 |
| | 显示执行动作（通知 Agent / 更新属性等） |
| 如果有 configurable 参数 | 显示"← 客户可调"标签 |

### TC-5.3 切换到动作列表
| 步骤 | 预期 |
|------|------|
| 点击"动作"Tab | 切换到动作列表 |
| 动作卡片 | 显示动作 ID（如 A01）、名称（如"完成任务"） |
| | 显示写入目标和字段 |
| | 显示触发的规则（前置/后置） |
| | 显示执行权限（member, admin 等） |

### TC-5.4 切回规则列表
| 步骤 | 预期 |
|------|------|
| 点击"规则"Tab | 切回规则列表，内容不变 |

---

## 六、审查报告页（`/project/:id/report`）

> **前置**：需要项目有完整的本体数据（ontology_structure + rules_actions + review_report 已保存）。

### TC-6.1 页面加载
| 步骤 | 预期 |
|------|------|
| 侧边栏点击"审查报告" | 页面加载，标题为"审核报告" |
| 摘要卡片 | 顶部显示 4 个统计卡片：通过（绿）、一致性（红）、完整性（黄）、建议（蓝） |
| 每个卡片 | 显示对应数量 |

### TC-6.2 验证逻辑
| 条件 | 检查项 | 预期 |
|------|--------|------|
| 本体有且仅有一个 first_citizen | 第一公民检查 | 出现在"通过项"中 |
| 本体没有 first_citizen | 第一公民检查 | 出现在"一致性问题"中 |
| 关系引用了不存在的 class ID | 关系引用检查 | 出现在"一致性问题"中 |
| 规则引用了不存在的 entity | 规则引用检查 | 出现在"一致性问题"中 |
| 类缺少 description | 完整性检查 | 出现在"完整性问题"中 |
| 类属性少于 2 个 | 完整性检查 | 出现在"完整性问题"中 |

### TC-6.3 通过项展示
| 步骤 | 预期 |
|------|------|
| 查看"通过项"区域 | 列出所有通过的检查项，每项前有 ✓ 标记 |

### TC-6.4 底部操作按钮
| 步骤 | 预期 |
|------|------|
| 观察页面底部 | 显示"重新审核"按钮 |
| 点击"重新审核" | 重新运行验证逻辑，刷新报告数据 |
| 如果有阻断性问题（一致性） | 发布按钮显示"存在阻断性问题"或类似文案 |
| 如果无阻断性问题 | 发布按钮可点击，跳转到发布管道页 |

---

## 七、发布管道页（`/project/:id/publish`）

### TC-7.1 页面加载
| 步骤 | 预期 |
|------|------|
| 侧边栏点击"发布管道" | 页面加载，标题为"发布管道" |
| 管道步骤列表 | 显示 7 个步骤（每个步骤有 `data-testid="pipeline-step"`）|

### TC-7.2 七个步骤名称
| 序号 | 步骤名称 | 说明 |
|------|----------|------|
| 1 | PG Schema 生成 | PostgreSQL 表结构 DDL |
| 2 | MCP 工具生成 | MCP 工具注册和 Go 代码骨架 |
| 3 | Neo4j Schema 同步 | 图数据库节点和关系同步 |
| 4 | Agent 配置更新 | Agent 工具绑定配置 |
| 5 | 规则引擎更新 | 规则引擎配置和评估函数 |
| 6 | 前端类型生成 | TypeScript 接口定义 |
| 7 | 连接器映射模板 | 数据映射配置骨架 |

### TC-7.3 执行管道
| 步骤 | 预期 |
|------|------|
| 观察"执行管道"按钮 | 按钮可见且可点击 |
| 点击"执行管道" | 步骤依次从 pending → running → done |
| 运行中 | 当前步骤显示"运行中"状态 |
| 完成后 | 所有步骤显示"完成"标签，底部显示耗时 |

### TC-7.4 查看生成文件
| 步骤 | 预期 |
|------|------|
| 管道执行完成后 | 部分步骤出现"查看文件"按钮 |
| 点击"查看文件" | 弹出模态框，显示生成的代码内容（SQL / Go / TypeScript / YAML） |
| 观察代码内容 | 代码结构合理，表名/类型名与本体 YAML 对应 |

### TC-7.5 管道步骤预览信息
| 步骤 | 预期 |
|------|------|
| 执行前观察每个步骤 | 显示预估信息（如"X 张表待生成 · Y 个字段"） |
| 执行后观察每个步骤 | 显示实际统计（如"CREATE TABLE × X"） |

---

## 八、跨页面导航

### TC-8.1 侧边栏导航
| 步骤 | 预期 |
|------|------|
| 在任意项目子页面 | 左侧导航显示项目名称和所有子菜单 |
| 依次点击每个子菜单 | 页面切换正确，当前菜单项高亮 |
| 点击"项目列表" | 返回首页，子菜单消失 |

### TC-8.2 导航菜单项
| 菜单项 | 路由 |
|--------|------|
| 项目列表 | `/` |
| Agent 构建 | `/project/:id/build` |
| 图谱审查 | `/project/:id/graph` |
| 规则编辑 | `/project/:id/rules` |
| 审查报告 | `/project/:id/report` |
| 发布管道 | `/project/:id/publish` |

### TC-8.3 URL 直接访问
| 步骤 | 预期 |
|------|------|
| 直接在地址栏输入 `/project/<有效ID>/graph` | 页面正确加载 |
| 输入不存在的路由（如 `/abc`） | 自动重定向到首页 `/` |

---

## 九、MCP 后端联通性

### TC-9.1 项目 CRUD
| 操作 | curl 命令 | 预期 |
|------|-----------|------|
| 列出项目 | `curl -s localhost:9091/ -X POST -H 'Content-Type:application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'` | 返回项目数组 |
| 创建项目 | `...params:{"name":"create_project","arguments":{"name":"curl测试"}}` | 返回新项目 ID |
| 获取项目 | `...params:{"name":"get_project","arguments":{"project_id":"<ID>"}}` | 返回项目详情 |
| 删除项目 | `...params:{"name":"delete_project","arguments":{"project_id":"<ID>"}}` | 返回成功 |

### TC-9.2 保存和读取阶段输出
| 操作 | 预期 |
|------|------|
| save_output (stage=scene_analysis, content=有效YAML) | 保存成功，project.current_stage 更新 |
| save_output (stage=ontology_structure, content=含classes/relationships的YAML) | 保存成功，project.yaml_content 合并更新 |
| read_scene_analysis / read_ontology_structure / read_full_ontology_yaml | 返回已保存的内容 |

### TC-9.3 YAML 验证
| 操作 | 预期 |
|------|------|
| validate_yaml (有效 YAML) | 返回 valid: true |
| validate_yaml (含重复 ID 的 YAML) | 返回语义错误 |

---

## 十、完整工作流 E2E

### TC-10.1 创建 → 注入数据 → 浏览所有页面 → 执行管道 → 清理

| # | 步骤 | 预期 |
|---|------|------|
| 1 | 在项目列表页创建新项目"完整流程测试" | 跳转到 Agent 构建页 |
| 2 | 通过 MCP 注入 scene_analysis 数据 | 保存成功 |
| 3 | 通过 MCP 注入 ontology_structure 数据（含 2+ 类、1+ 关系） | 保存成功 |
| 4 | 通过 MCP 注入 rules_actions 数据（含 1+ 规则、1+ 动作） | 保存成功 |
| 5 | 通过 MCP 注入 review_report 数据 | 保存成功 |
| 6 | 访问 Agent 构建页 | 正常加载，显示已完成的阶段 |
| 7 | 访问图谱审查页 | SVG 画布显示类节点和关系边 |
| 8 | 点击某个类节点进入类编辑器 | 属性表格正常显示 |
| 9 | 返回图谱，访问规则编辑页 | 显示规则和动作列表 |
| 10 | 访问审查报告页 | 显示摘要卡片和检查结果 |
| 11 | 访问发布管道页 | 显示 7 个步骤 |
| 12 | 点击"执行管道" | 步骤依次完成 |
| 13 | 返回项目列表页 | 项目仍在列表中 |
| 14 | 删除项目 | 项目从列表消失 |

---

## 附录 A：测试数据注入脚本

以下脚本可一键创建测试项目并注入完整数据：

```bash
#!/bin/bash
MCP="http://localhost:9091/"

# 创建项目
RESULT=$(curl -s $MCP -X POST -H 'Content-Type:application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_project","arguments":{"name":"手动测试项目","description":"用于手动测试的项目"}}}')
PROJECT_ID=$(echo $RESULT | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.loads(r['result']['content'][0]['text'])['project_id'])")
echo "Created project: $PROJECT_ID"

# 注入场景分析
curl -s $MCP -X POST -H 'Content-Type:application/json' \
  -d "$(python3 -c "
import json
content = '''scene: 产品管理
first_citizen: product
core_classes:
  - product
  - category
  - supplier
'''
print(json.dumps({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'save_output','arguments':{'project_id':'$PROJECT_ID','stage':'scene_analysis','content':content}}}))
")" > /dev/null

# 注入本体结构
curl -s $MCP -X POST -H 'Content-Type:application/json' \
  -d "$(python3 -c "
import json
content = '''classes:
  - id: product
    name: 产品
    first_citizen: true
    phase: alpha
    attributes:
      - id: name
        name: 名称
        type: string
        required: true
        graph_sync: true
      - id: price
        name: 价格
        type: decimal
        required: true
      - id: status
        name: 状态
        type: enum
        enum_values: [ACTIVE, INACTIVE, DISCONTINUED]
        graph_sync: true
      - id: created_at
        name: 创建时间
        type: datetime
  - id: category
    name: 分类
    phase: alpha
    attributes:
      - id: title
        name: 标题
        type: string
        required: true
      - id: description
        name: 描述
        type: text
  - id: supplier
    name: 供应商
    phase: alpha
    attributes:
      - id: company_name
        name: 公司名称
        type: string
        required: true
      - id: contact
        name: 联系人
        type: string
      - id: is_active
        name: 是否启用
        type: boolean
        default: true
relationships:
  - id: belongs_to
    name: 属于
    from: product
    to: category
    cardinality: many_to_one
  - id: supplied_by
    name: 供应于
    from: product
    to: supplier
    cardinality: many_to_one
'''
print(json.dumps({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'save_output','arguments':{'project_id':'$PROJECT_ID','stage':'ontology_structure','content':content}}}))
")" > /dev/null

# 注入规则和动作
curl -s $MCP -X POST -H 'Content-Type:application/json' \
  -d "$(python3 -c "
import json
content = '''rules:
  - id: R01
    name: 低库存提醒
    severity: warning
    trigger:
      type: schedule
      cron: '0 9 * * *'
    condition:
      entity: product
      expression: 'status == ACTIVE AND stock < safety_stock'
    action:
      type: notify_agent
      notify: inventory-manager
    params:
      - name: safety_stock
        type: integer
        default: 10
        configurable: true
  - id: R02
    name: 价格变更审批
    severity: critical
    trigger:
      type: before_action
      source: [A02]
    condition:
      entity: product
      expression: 'ABS(new_price - price) / price > threshold'
    action:
      type: require_approval
      target: admin
    params:
      - name: threshold
        type: decimal
        default: 0.2
        configurable: true
actions:
  - id: A01
    name: 停产产品
    writes:
      - target: product
        set:
          status: DISCONTINUED
    triggers_after: [R01]
    execute_permissions: [admin]
    decision_log: true
  - id: A02
    name: 更新价格
    writes:
      - target: product
        set:
          price: new_price
    triggers_before: [R02]
    execute_permissions: [member, admin]
'''
print(json.dumps({'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'save_output','arguments':{'project_id':'$PROJECT_ID','stage':'rules_actions','content':content}}}))
")" > /dev/null

# 注入审查报告
curl -s $MCP -X POST -H 'Content-Type:application/json' \
  -d "$(python3 -c "
import json
content = '''result: pass
summary: 本体结构完整，通过审查
'''
print(json.dumps({'jsonrpc':'2.0','id':5,'method':'tools/call','params':{'name':'save_output','arguments':{'project_id':'$PROJECT_ID','stage':'review_report','content':content}}}))
")" > /dev/null

echo "Done! Project $PROJECT_ID ready for testing."
echo "Open: http://localhost:8089/project/$PROJECT_ID/graph"
```

## 附录 B：清理脚本

```bash
# 删除测试项目
curl -s http://localhost:9091/ -X POST -H 'Content-Type:application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_project\",\"arguments\":{\"project_id\":\"$PROJECT_ID\"}}}"
```
