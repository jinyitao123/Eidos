package tools

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"ontologyserver/internal/assess"
	"ontologyserver/internal/mcp"
	"ontologyserver/internal/proposals"
	"ontologyserver/internal/store"
	ontoyaml "ontologyserver/internal/yaml"
)

func registerNexusTools(router *mcp.Router, d *Deps) {
	s := d.Store
	p := d.Proposals

	// --- Core CRUD ---
	router.Register(mcp.ToolDef{
		Name:        "save_ontology_doc",
		Description: "保存一份完整本体 JSON 文档到版本化存储（校验→缺省填充→落库→记修订版本）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_json":{"type":"string","description":"完整本体 JSON"}},"required":["ontology_json"]}`),
	}, saveOntologyDocHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "read_ontology_doc",
		Description: "从版本化存储读取一份完整本体 JSON 文档。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, readOntologyDocHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "validate_ontology_doc",
		Description: "校验一份本体 JSON 文档（不保存），返回错误和建模建议。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_json":{"type":"string"}},"required":["ontology_json"]}`),
	}, validateOntologyDocHandler())

	// --- Entity/Attribute/Relationship upsert ---
	router.Register(mcp.ToolDef{
		Name:        "upsert_entity",
		Description: "向指定本体增/改一个实体（不存在则创建空本体）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"entity_json":{"type":"string"}},"required":["ontology_id","entity_json"]}`),
	}, upsertEntityHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "upsert_attribute",
		Description: "向指定本体的某个实体增/改一个属性。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"entity_id":{"type":"string"},"attribute_json":{"type":"string"}},"required":["ontology_id","entity_id","attribute_json"]}`),
	}, upsertAttributeHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "upsert_relationship",
		Description: "向指定本体增/改一个关系。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"relationship_json":{"type":"string"}},"required":["ontology_id","relationship_json"]}`),
	}, upsertRelationshipHandler(s))

	// --- Inheritance ---
	router.Register(mcp.ToolDef{
		Name:        "get_inheritance",
		Description: "查看本体的继承构成与漂移（从父模板继承了什么、子本体弱化了什么）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, getInheritanceHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "realign_inheritance",
		Description: "一键对齐：把父模板里子本体缺的对象/属性补回来。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, realignInheritanceHandler(s))

	// --- Assessment ---
	router.Register(mcp.ToolDef{
		Name:        "assess_health",
		Description: "给本体打结构健康分（0-100），返回业务语言的问题点。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, assessHealthHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "review_entities",
		Description: "实体审核：按人/事/物分组逐项体检命名、分类、主角、关系。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, reviewEntitiesHandler(s))

	// --- Glossary / Terms ---
	router.Register(mcp.ToolDef{
		Name:        "list_glossary",
		Description: "聚合本体的术语表：所有可命名元素 + 别名 + 歧义冲突。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, listGlossaryHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "resolve_terms",
		Description: "把口语/黑话对到本体里的对象/属性/概念，给置信度。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"},"term":{"type":"string"}},"required":["id","term"]}`),
	}, resolveTermsHandler(s))

	// --- Concepts ---
	router.Register(mcp.ToolDef{
		Name:        "upsert_concept",
		Description: "增/改一个概念（理解层：命名段 = 对象 + 条件）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"concept_json":{"type":"string"}},"required":["ontology_id","concept_json"]}`),
	}, upsertConceptHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "evaluate_concept",
		Description: "评估概念能否点亮：基准对象是否存在、条件字段是否对得上。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"},"concept_id":{"type":"string"}},"required":["id","concept_id"]}`),
	}, evaluateConceptHandler(s))

	// --- Versioning ---
	router.Register(mcp.ToolDef{
		Name:        "list_ontology_versions",
		Description: "返回本体的版本时间线（新→旧）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, listVersionsHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "diff_ontology_versions",
		Description: "比对两个版本的差异（增/删/改）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"},"from":{"type":"integer"},"to":{"type":"integer"}},"required":["id","from","to"]}`),
	}, diffVersionsHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "restore_ontology_version",
		Description: "以旧版本内容写一条新修订（安全回滚，不销毁前向历史）。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"},"version":{"type":"integer"}},"required":["id","version"]}`),
	}, restoreVersionHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "publish_ontology_doc",
		Description: "发布：打一个 release 版本标记。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, publishOntologyHandler(s))

	router.Register(mcp.ToolDef{
		Name:        "delete_ontology",
		Description: "删除一份本体及其全部版本/提议(不可恢复)。返回 {ok, existed}。",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	}, deleteOntologyHandler(s))

	// --- Proposals (require Proposals store) ---
	if p != nil {
		router.Register(mcp.ToolDef{
			Name:        "propose_change",
			Description: "提交本体变更提议（只入待办，不改本体；人审后才落地）。",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"kind":{"type":"string","enum":["attribute","entity","relationship"]},"entity_id":{"type":"string"},"payload":{"type":"string"},"reason":{"type":"string"},"proposer":{"type":"string"}},"required":["ontology_id","kind","payload"]}`),
		}, proposeChangeHandler(s, p))

		router.Register(mcp.ToolDef{
			Name:        "list_proposals",
			Description: "列出某本体的变更提议。",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"ontology_id":{"type":"string"},"status":{"type":"string"}},"required":["ontology_id"]}`),
		}, listProposalsHandler(p))

		router.Register(mcp.ToolDef{
			Name:        "approve_proposal",
			Description: "批准提议并把变更落入本体。",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
		}, approveProposalHandler(s, p))

		router.Register(mcp.ToolDef{
			Name:        "reject_proposal",
			Description: "驳回提议（本体不变）。",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
		}, rejectProposalHandler(p))
	}
}

// --- defaults ---

func applyDefaults(o *ontoyaml.Ontology) {
	for i := range o.Classes {
		if o.Classes[i].Status == "" {
			o.Classes[i].Status = "proposed"
		}
		if o.Classes[i].Source == "" {
			o.Classes[i].Source = "对话"
		}
	}
	for i := range o.Relationships {
		if o.Relationships[i].Cardinality == "" {
			o.Relationships[i].Cardinality = "1:N"
		}
		if o.Relationships[i].Direction == "" {
			o.Relationships[i].Direction = "one_way"
		}
		if o.Relationships[i].Status == "" {
			o.Relationships[i].Status = "proposed"
		}
	}
}

func validateDoc(o *ontoyaml.Ontology) []string {
	var errs []string
	if o.ID == "" {
		errs = append(errs, "ontology.id 不能为空")
	}
	if o.Name == "" {
		errs = append(errs, "ontology.name 不能为空")
	}
	entityIDs := map[string]bool{}
	for _, e := range o.Classes {
		if e.ID == "" {
			errs = append(errs, "实体 id 不能为空")
		}
		entityIDs[e.ID] = true
		if e.Name == "" {
			errs = append(errs, fmt.Sprintf("实体 %q 缺 name", e.ID))
		}
		if e.Kind != "" && !ontoyaml.ValidEntityKind(e.Kind) {
			errs = append(errs, fmt.Sprintf("实体 %q 的 kind %q 非法（须 person/event/thing）", e.ID, e.Kind))
		}
		if e.Status != "" && !ontoyaml.ValidEntityStatus(e.Status) {
			errs = append(errs, fmt.Sprintf("实体 %q 的 status %q 非法", e.ID, e.Status))
		}
		for _, a := range e.Attributes {
			if a.ID == "" {
				errs = append(errs, fmt.Sprintf("实体 %q 的属性 id 为空", e.ID))
			}
		}
	}
	for _, r := range o.Relationships {
		if r.ID == "" {
			errs = append(errs, "关系 id 不能为空")
		}
		// 引用闭合:from/to 必须填且指向已存在的实体(拒绝悬空引用,与旧 Nexus 行为对齐)。
		if r.From == "" || r.To == "" {
			errs = append(errs, fmt.Sprintf("关系 %q 缺 from/to", r.ID))
			continue
		}
		if !entityIDs[r.From] {
			errs = append(errs, fmt.Sprintf("关系 %q 的 from %q 指向不存在的实体", r.ID, r.From))
		}
		if !entityIDs[r.To] {
			errs = append(errs, fmt.Sprintf("关系 %q 的 to %q 指向不存在的实体", r.ID, r.To))
		}
	}
	return errs
}

func warnings(o *ontoyaml.Ontology) []string {
	r := ontoyaml.Validate(o, "semantic")
	var ws []string
	for _, w := range r.Warnings {
		ws = append(ws, w.Message)
	}
	return ws
}

func toDoc(o ontoyaml.Ontology) store.Document {
	return store.Document{Ontology: o}
}

// --- handlers ---

// structResult 返回结构化工具结果 {ok, ...},isError=!ok(满足 Ontopia 契约 R1:
// 写入工具返回 {ok, errors[], warnings[]} 而非人话;Go 客户端可直接解析,agent 也能读 isError)。
func structResult(ok bool, payload map[string]any) *mcp.ToolCallResult {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["ok"] = ok
	data, _ := json.Marshal(payload)
	return &mcp.ToolCallResult{Content: []mcp.ContentBlock{{Type: "text", Text: string(data)}}, IsError: !ok}
}

func errResult(errs ...string) *mcp.ToolCallResult {
	return structResult(false, map[string]any{"errors": errs})
}

func saveOntologyDocHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ OntologyJSON string `json:"ontology_json"` }
		json.Unmarshal(args, &p)
		var o ontoyaml.Ontology
		if err := json.Unmarshal([]byte(p.OntologyJSON), &o); err != nil {
			return errResult(fmt.Sprintf("JSON 解析失败：%v", err))
		}
		applyDefaults(&o)
		if errs := validateDoc(&o); len(errs) > 0 {
			return errResult(errs...)
		}
		for _, pr := range o.ParentRefs {
			if pr == o.ID {
				return errResult(fmt.Sprintf("本体 %q 不能把自己列为父本体。", o.ID))
			}
			if _, ok, _ := s.Read(ctx, pr); !ok {
				return errResult(fmt.Sprintf("父本体 %q 不存在。", pr))
			}
		}
		if err := s.Save(ctx, toDoc(o)); err != nil {
			return errResult(fmt.Sprintf("落库失败：%v", err))
		}
		return structResult(true, map[string]any{
			"id":            o.ID,
			"name":          o.Name,
			"entities":      len(o.Classes),
			"relationships": len(o.Relationships),
			"warnings":      warnings(&o),
		})
	}
}

func readOntologyDocHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, err := s.Read(ctx, p.ID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if !ok {
			// 本体尚不存在不是错误——返回空模板,引导 agent 直接 save_ontology_doc 建首版,
			// 而不是把首个工具调用变成 error 把 agent 带偏。
			return rawText(fmt.Sprintf(
				`{"id":%q,"name":"","classes":[],"relationships":[],"_status":"empty","_hint":"该本体还不存在;请基于需求直接调用 save_ontology_doc 写入首版。"}`,
				p.ID))
		}
		out, _ := json.MarshalIndent(d.Ontology, "", "  ")
		return rawText(string(out))
	}
}

func validateOntologyDocHandler() mcp.ToolFunc {
	return func(_ context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ OntologyJSON string `json:"ontology_json"` }
		json.Unmarshal(args, &p)
		var o ontoyaml.Ontology
		if err := json.Unmarshal([]byte(p.OntologyJSON), &o); err != nil {
			return mcp.ErrorResult(fmt.Sprintf("JSON 解析失败：%v", err))
		}
		if errs := validateDoc(&o); len(errs) > 0 {
			return mcp.ErrorResult("校验未通过：\n- " + strings.Join(errs, "\n- "))
		}
		if ws := warnings(&o); len(ws) > 0 {
			return rawText("OK：本体结构合法。\n建模建议：\n- " + strings.Join(ws, "\n- "))
		}
		return rawText("OK：本体结构合法。")
	}
}

func upsertEntityHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID string `json:"ontology_id"`
			EntityJSON string `json:"entity_json"`
		}
		json.Unmarshal(args, &p)
		var e ontoyaml.Entity
		if err := json.Unmarshal([]byte(p.EntityJSON), &e); err != nil {
			return mcp.ErrorResult(fmt.Sprintf("entity JSON 解析失败：%v", err))
		}
		d, ok, err := s.Read(ctx, p.OntologyID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if !ok {
			d = store.Document{Ontology: ontoyaml.Ontology{ID: p.OntologyID, Name: p.OntologyID}}
		}
		replaced := false
		for i := range d.Ontology.Classes {
			if d.Ontology.Classes[i].ID == e.ID {
				d.Ontology.Classes[i] = e
				replaced = true
				break
			}
		}
		if !replaced {
			d.Ontology.Classes = append(d.Ontology.Classes, e)
		}
		applyDefaults(&d.Ontology)
		if errs := validateDoc(&d.Ontology); len(errs) > 0 {
			return errResult(errs...)
		}
		if err := s.Save(ctx, d); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		verb := "新增"
		if replaced {
			verb = "更新"
		}
		return structResult(true, map[string]any{"id": e.ID, "name": e.Name, "action": verb, "kind": "entity"})
	}
}

func upsertAttributeHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID    string `json:"ontology_id"`
			EntityID      string `json:"entity_id"`
			AttributeJSON string `json:"attribute_json"`
		}
		json.Unmarshal(args, &p)
		var a ontoyaml.Attribute
		if err := json.Unmarshal([]byte(p.AttributeJSON), &a); err != nil {
			return mcp.ErrorResult(fmt.Sprintf("attribute JSON 解析失败：%v", err))
		}
		d, ok, err := s.Read(ctx, p.OntologyID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.OntologyID))
		}
		ei := -1
		for i := range d.Ontology.Classes {
			if d.Ontology.Classes[i].ID == p.EntityID {
				ei = i
				break
			}
		}
		if ei < 0 {
			return mcp.ErrorResult(fmt.Sprintf("本体 %q 里没有实体 %q。", p.OntologyID, p.EntityID))
		}
		replaced := false
		for i := range d.Ontology.Classes[ei].Attributes {
			if d.Ontology.Classes[ei].Attributes[i].ID == a.ID {
				d.Ontology.Classes[ei].Attributes[i] = a
				replaced = true
				break
			}
		}
		if !replaced {
			d.Ontology.Classes[ei].Attributes = append(d.Ontology.Classes[ei].Attributes, a)
		}
		if errs := validateDoc(&d.Ontology); len(errs) > 0 {
			return errResult(errs...)
		}
		if err := s.Save(ctx, d); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		verb := "新增"
		if replaced {
			verb = "更新"
		}
		return structResult(true, map[string]any{"id": a.ID, "name": a.Name, "action": verb, "kind": "attribute", "entity_id": p.EntityID})
	}
}

func upsertRelationshipHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID       string `json:"ontology_id"`
			RelationshipJSON string `json:"relationship_json"`
		}
		json.Unmarshal(args, &p)
		var r ontoyaml.Relationship
		if err := json.Unmarshal([]byte(p.RelationshipJSON), &r); err != nil {
			return mcp.ErrorResult(fmt.Sprintf("relationship JSON 解析失败：%v", err))
		}
		d, ok, err := s.Read(ctx, p.OntologyID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.OntologyID))
		}
		replaced := false
		for i := range d.Ontology.Relationships {
			if d.Ontology.Relationships[i].ID == r.ID {
				d.Ontology.Relationships[i] = r
				replaced = true
				break
			}
		}
		if !replaced {
			d.Ontology.Relationships = append(d.Ontology.Relationships, r)
		}
		applyDefaults(&d.Ontology)
		if errs := validateDoc(&d.Ontology); len(errs) > 0 {
			return errResult(errs...)
		}
		if err := s.Save(ctx, d); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		verb := "新增"
		if replaced {
			verb = "更新"
		}
		return structResult(true, map[string]any{"id": r.ID, "name": r.Name, "action": verb, "kind": "relationship"})
	}
}

func getInheritanceHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		if len(d.Ontology.ParentRefs) == 0 {
			return rawText("这份业务模型没有继承任何父模板。")
		}
		childEnt := map[string]ontoyaml.Entity{}
		for _, e := range d.Ontology.Classes {
			childEnt[e.ID] = e
		}
		var b strings.Builder
		for _, pr := range d.Ontology.ParentRefs {
			pd, ok, _ := s.Read(ctx, pr)
			if !ok {
				fmt.Fprintf(&b, "· 父模板 %q 读不到\n", pr)
				continue
			}
			fmt.Fprintf(&b, "继承自「%s」：\n", pd.Ontology.Name)
			for _, pe := range pd.Ontology.Classes {
				ce, redefined := childEnt[pe.ID]
				if !redefined {
					fmt.Fprintf(&b, "  · %s（沿用父模板）\n", pe.Name)
					continue
				}
				has := map[string]bool{}
				for _, a := range ce.Attributes {
					has[a.ID] = true
				}
				var dropped []string
				for _, a := range pe.Attributes {
					if !has[a.ID] {
						dropped = append(dropped, a.Name)
					}
				}
				if len(dropped) > 0 {
					fmt.Fprintf(&b, "  · %s（漂移：缺少 %s）\n", pe.Name, strings.Join(dropped, "、"))
				} else {
					fmt.Fprintf(&b, "  · %s（已覆盖，无漂移）\n", pe.Name)
				}
			}
		}
		return rawText(strings.TrimRight(b.String(), "\n"))
	}
}

func realignInheritanceHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		if len(d.Ontology.ParentRefs) == 0 {
			return rawText("没有父模板，无需对齐。")
		}
		idx := map[string]int{}
		for i := range d.Ontology.Classes {
			idx[d.Ontology.Classes[i].ID] = i
		}
		addedEnt, addedAttr := 0, 0
		for _, pr := range d.Ontology.ParentRefs {
			pd, ok, _ := s.Read(ctx, pr)
			if !ok {
				continue
			}
			for _, pe := range pd.Ontology.Classes {
				i, exists := idx[pe.ID]
				if !exists {
					ne := pe
					ne.Source = "继承:" + pr
					ne.InheritedFrom = pr
					for j := range ne.Attributes {
						if ne.Attributes[j].InheritedFrom == "" {
							ne.Attributes[j].InheritedFrom = pr
						}
					}
					d.Ontology.Classes = append(d.Ontology.Classes, ne)
					idx[pe.ID] = len(d.Ontology.Classes) - 1
					addedEnt++
					continue
				}
				has := map[string]bool{}
				for _, a := range d.Ontology.Classes[i].Attributes {
					has[a.ID] = true
				}
				for _, a := range pe.Attributes {
					if !has[a.ID] {
						na := a
						na.InheritedFrom = pr
						d.Ontology.Classes[i].Attributes = append(d.Ontology.Classes[i].Attributes, na)
						addedAttr++
					}
				}
			}
		}
		if addedEnt == 0 && addedAttr == 0 {
			return rawText("已对齐：没有需要从父模板补回的对象或信息。")
		}
		applyDefaults(&d.Ontology)
		if errs := validateDoc(&d.Ontology); len(errs) > 0 {
			return mcp.ErrorResult("对齐后校验未通过：\n- " + strings.Join(errs, "\n- "))
		}
		if err := s.SaveWithSource(ctx, d, "inheritance"); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		return rawText(fmt.Sprintf("已与父模板对齐：补回 %d 个对象、%d 项信息。", addedEnt, addedAttr))
	}
}

func assessHealthHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		r := assess.Health(&d.Ontology)
		return mcp.TextResult(map[string]any{
			"score":    r.Score,
			"findings": r.Findings,
		})
	}
}

func reviewEntitiesHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		o := &d.Ontology
		if len(o.Classes) == 0 {
			return rawText("还没有业务对象可审。")
		}
		touched := map[string]bool{}
		for _, r := range o.Relationships {
			touched[r.From] = true
			touched[r.To] = true
		}
		byKind := map[string]int{}
		firstCitizens := 0
		for _, e := range o.Classes {
			byKind[e.Kind]++
			if e.FirstCitizen {
				firstCitizens++
			}
		}
		var findings []string
		if firstCitizens == 0 {
			findings = append(findings, "主角缺位：没有指定第一公民。")
		} else if firstCitizens > 1 {
			findings = append(findings, fmt.Sprintf("主角过多：标了 %d 个第一公民。", firstCitizens))
		}
		if byKind["event"] == 0 {
			findings = append(findings, "缺『事』类：没有事件对象。")
		}
		for _, e := range o.Classes {
			if len(o.Classes) > 1 && !touched[e.ID] {
				findings = append(findings, fmt.Sprintf("「%s」没和任何对象建立关系。", e.Name))
			}
			if len(e.Attributes) == 0 {
				findings = append(findings, fmt.Sprintf("「%s」还没有任何属性。", e.Name))
			}
		}
		var b strings.Builder
		fmt.Fprintf(&b, "实体审核（%d 个对象：人 %d · 事 %d · 物 %d）\n",
			len(o.Classes), byKind["person"], byKind["event"], byKind["thing"])
		if len(findings) == 0 {
			b.WriteString("未发现明显问题。")
		} else {
			b.WriteString("发现：\n- " + strings.Join(findings, "\n- "))
		}
		return rawText(strings.TrimRight(b.String(), "\n"))
	}
}

func listGlossaryHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		o := &d.Ontology
		type row struct {
			label   string
			aliases []string
		}
		var rows []row
		termTargets := map[string]map[string]bool{}
		mark := func(term, target string) {
			t := strings.ToLower(strings.TrimSpace(term))
			if t == "" {
				return
			}
			if termTargets[t] == nil {
				termTargets[t] = map[string]bool{}
			}
			termTargets[t][target] = true
		}
		for _, e := range o.Classes {
			rows = append(rows, row{fmt.Sprintf("%s（%s · 对象）", e.Name, e.ID), e.Aliases})
			mark(e.Name, e.Name)
			for _, al := range e.Aliases {
				mark(al, e.Name)
			}
			for _, a := range e.Attributes {
				label := e.Name + "." + a.Name
				rows = append(rows, row{fmt.Sprintf("%s（%s · 属性）", label, a.ID), a.Aliases})
				mark(a.Name, label)
				for _, al := range a.Aliases {
					mark(al, label)
				}
			}
		}
		for _, c := range o.Concepts {
			rows = append(rows, row{fmt.Sprintf("%s（%s · 概念）", c.Name, c.ID), c.Aliases})
			mark(c.Name, c.Name)
			for _, al := range c.Aliases {
				mark(al, c.Name)
			}
		}
		var conflicts []string
		for t, targets := range termTargets {
			if len(targets) < 2 {
				continue
			}
			var ls []string
			for l := range targets {
				ls = append(ls, l)
			}
			sort.Strings(ls)
			conflicts = append(conflicts, fmt.Sprintf("「%s」→ %s", t, strings.Join(ls, " 与 ")))
		}
		sort.Strings(conflicts)
		var b strings.Builder
		fmt.Fprintf(&b, "术语表（%d 条）：\n", len(rows))
		for _, r := range rows {
			if len(r.aliases) > 0 {
				fmt.Fprintf(&b, "· %s  别名：%s\n", r.label, strings.Join(r.aliases, "、"))
			} else {
				fmt.Fprintf(&b, "· %s\n", r.label)
			}
		}
		if len(conflicts) > 0 {
			fmt.Fprintf(&b, "歧义冲突（%d）：\n", len(conflicts))
			for _, c := range conflicts {
				fmt.Fprintf(&b, "⚠ %s\n", c)
			}
		}
		return rawText(strings.TrimRight(b.String(), "\n"))
	}
}

func resolveTermsHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ID   string `json:"id"`
			Term string `json:"term"`
		}
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		q := strings.ToLower(strings.TrimSpace(p.Term))
		if q == "" {
			return mcp.ErrorResult("请给要识别的说法。")
		}
		o := &d.Ontology
		type hit struct {
			label string
			conf  float64
			why   string
		}
		var hits []hit
		consider := func(name, label string, aliases []string) {
			ln := strings.ToLower(strings.TrimSpace(name))
			if ln == q {
				hits = append(hits, hit{label, 1.0, "名称精确匹配"})
				return
			}
			for _, al := range aliases {
				if strings.ToLower(strings.TrimSpace(al)) == q {
					hits = append(hits, hit{label, 1.0, fmt.Sprintf("别名「%s」精确匹配", al)})
					return
				}
			}
			if ln != "" && (strings.Contains(ln, q) || strings.Contains(q, ln)) {
				hits = append(hits, hit{label, 0.6, "名称包含匹配"})
			}
		}
		for _, e := range o.Classes {
			consider(e.Name, fmt.Sprintf("%s（对象）", e.Name), e.Aliases)
			for _, a := range e.Attributes {
				consider(a.Name, fmt.Sprintf("%s.%s（属性）", e.Name, a.Name), a.Aliases)
			}
		}
		for _, c := range o.Concepts {
			consider(c.Name, fmt.Sprintf("%s（概念）", c.Name), c.Aliases)
		}
		if len(hits) == 0 {
			return rawText(fmt.Sprintf("没把「%s」对上本体里的任何元素。", p.Term))
		}
		sort.SliceStable(hits, func(i, j int) bool { return hits[i].conf > hits[j].conf })
		var b strings.Builder
		fmt.Fprintf(&b, "「%s」可能指：\n", p.Term)
		for _, h := range hits {
			fmt.Fprintf(&b, "· %s（置信度 %.1f，%s）\n", h.label, h.conf, h.why)
		}
		return rawText(strings.TrimRight(b.String(), "\n"))
	}
}

func upsertConceptHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID  string `json:"ontology_id"`
			ConceptJSON string `json:"concept_json"`
		}
		json.Unmarshal(args, &p)
		var c ontoyaml.Concept
		if err := json.Unmarshal([]byte(p.ConceptJSON), &c); err != nil {
			return mcp.ErrorResult(fmt.Sprintf("concept JSON 解析失败：%v", err))
		}
		if c.ID == "" || c.Name == "" {
			return mcp.ErrorResult("拒绝：概念需 id 和 name。")
		}
		d, ok, _ := s.Read(ctx, p.OntologyID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.OntologyID))
		}
		replaced := false
		for i := range d.Ontology.Concepts {
			if d.Ontology.Concepts[i].ID == c.ID {
				d.Ontology.Concepts[i] = c
				replaced = true
				break
			}
		}
		if !replaced {
			d.Ontology.Concepts = append(d.Ontology.Concepts, c)
		}
		if err := s.Save(ctx, d); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		verb := "新增"
		if replaced {
			verb = "更新"
		}
		return rawText(fmt.Sprintf("已%s概念「%s」。", verb, c.Name))
	}
}

func evaluateConceptHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ID        string `json:"id"`
			ConceptID string `json:"concept_id"`
		}
		json.Unmarshal(args, &p)
		d, ok, _ := s.Read(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到本体 %q。", p.ID))
		}
		var c *ontoyaml.Concept
		for i := range d.Ontology.Concepts {
			if d.Ontology.Concepts[i].ID == p.ConceptID {
				c = &d.Ontology.Concepts[i]
				break
			}
		}
		if c == nil {
			return mcp.ErrorResult(fmt.Sprintf("本体里没有概念 %q。", p.ConceptID))
		}
		entityMap := map[string]bool{}
		attrMap := map[string]map[string]bool{}
		for _, e := range d.Ontology.Classes {
			entityMap[e.ID] = true
			m := make(map[string]bool)
			for _, a := range e.Attributes {
				m[a.ID] = true
			}
			attrMap[e.ID] = m
		}
		var issues []string
		if !entityMap[c.Subject] {
			issues = append(issues, fmt.Sprintf("基准对象 %q 不存在。", c.Subject))
		}
		if c.Predicate != nil && entityMap[c.Subject] {
			checkPredicateFields(c.Predicate, c.Subject, attrMap, &issues)
		}
		if len(issues) > 0 {
			return rawText(fmt.Sprintf("概念「%s」还不能点亮：\n- %s", c.Name, strings.Join(issues, "\n- ")))
		}
		return rawText(fmt.Sprintf("概念「%s」定义就绪。", c.Name))
	}
}

func checkPredicateFields(p *ontoyaml.Predicate, subject string, attrMap map[string]map[string]bool, issues *[]string) {
	if p.IsLeaf() {
		if p.Field != "" {
			if attrs, ok := attrMap[subject]; ok && !attrs[p.Field] {
				*issues = append(*issues, fmt.Sprintf("条件字段 %q 不在实体 %q 中。", p.Field, subject))
			}
		}
		return
	}
	for i := range p.All {
		checkPredicateFields(&p.All[i], subject, attrMap, issues)
	}
	for i := range p.Any {
		checkPredicateFields(&p.Any[i], subject, attrMap, issues)
	}
}

func listVersionsHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		vs, err := s.ListVersions(ctx, p.ID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		out, _ := json.Marshal(vs)
		return rawText(string(out))
	}
}

func diffVersionsHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ID   string `json:"id"`
			From int    `json:"from"`
			To   int    `json:"to"`
		}
		json.Unmarshal(args, &p)
		a, ok1, _ := s.ReadVersion(ctx, p.ID, p.From)
		b, ok2, _ := s.ReadVersion(ctx, p.ID, p.To)
		if !ok1 || !ok2 {
			return mcp.ErrorResult(fmt.Sprintf("未找到指定版本（from=%d, to=%d）。", p.From, p.To))
		}
		return rawText(diffDocs(a.Ontology, b.Ontology, p.From, p.To))
	}
}

func restoreVersionHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ID      string `json:"id"`
			Version int    `json:"version"`
		}
		json.Unmarshal(args, &p)
		d, ok, _ := s.ReadVersion(ctx, p.ID, p.Version)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("未找到版本 %d。", p.Version))
		}
		if err := s.SaveWithSource(ctx, d, "restore"); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		return rawText(fmt.Sprintf("已回到版本 %d。", p.Version))
	}
}

func publishOntologyHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		ver, err := s.AppendRelease(ctx, p.ID)
		if err != nil {
			return mcp.ErrorResult(fmt.Sprintf("发布失败：%v", err))
		}
		return rawText(fmt.Sprintf("已发布 release v%d。", ver))
	}
}

func deleteOntologyHandler(s store.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		if p.ID == "" {
			return errResult("缺 id")
		}
		existed, err := s.Delete(ctx, p.ID)
		if err != nil {
			return errResult(fmt.Sprintf("删除失败：%v", err))
		}
		return structResult(true, map[string]any{"id": p.ID, "existed": existed})
	}
}

// --- Proposal handlers ---

func proposeChangeHandler(s store.Store, ps proposals.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID string `json:"ontology_id"`
			Kind       string `json:"kind"`
			EntityID   string `json:"entity_id"`
			Payload    string `json:"payload"`
			Reason     string `json:"reason"`
			Proposer   string `json:"proposer"`
		}
		json.Unmarshal(args, &p)
		if !proposals.ValidKind(p.Kind) || p.Payload == "" {
			return mcp.ErrorResult("拒绝：需合法 kind（attribute/entity/relationship）和 payload。")
		}
		if p.Kind == "attribute" && p.EntityID == "" {
			return mcp.ErrorResult("拒绝：属性提议需指明 entity_id。")
		}
		if !json.Valid([]byte(p.Payload)) {
			return mcp.ErrorResult("拒绝：payload 不是合法 JSON。")
		}
		sum := sha1.Sum([]byte(p.OntologyID + "\x00" + p.Kind + "\x00" + p.EntityID + "\x00" + p.Payload))
		id := "prop_" + hex.EncodeToString(sum[:6])
		pr := proposals.Proposal{
			ID: id, OntologyID: p.OntologyID, Kind: p.Kind, EntityID: p.EntityID,
			Payload: p.Payload, Reason: p.Reason, Proposer: p.Proposer, Status: "pending",
		}
		if err := ps.Save(ctx, pr); err != nil {
			return mcp.ErrorResult(err.Error())
		}
		return rawText(fmt.Sprintf("已提交提议 %s（待人审）。", id))
	}
}

func listProposalsHandler(ps proposals.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID string `json:"ontology_id"`
			Status     string `json:"status"`
		}
		json.Unmarshal(args, &p)
		list, err := ps.ListByStatus(ctx, p.OntologyID, p.Status)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if len(list) == 0 {
			return rawText("没有待审提议。")
		}
		var b strings.Builder
		fmt.Fprintf(&b, "提议 %d 条：\n", len(list))
		for _, pr := range list {
			fmt.Fprintf(&b, "· [%s] %s（%s，%s 提）：%s\n", pr.Status, pr.ID, pr.Kind, pr.Proposer, pr.Reason)
		}
		return rawText(strings.TrimRight(b.String(), "\n"))
	}
}

func approveProposalHandler(s store.Store, ps proposals.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		pr, ok, err := ps.Get(ctx, p.ID)
		if err != nil {
			return mcp.ErrorResult(err.Error())
		}
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("没找到提议 %q。", p.ID))
		}
		if pr.Status != "pending" {
			return rawText(fmt.Sprintf("提议已是 %q 状态。", pr.Status))
		}
		innerArgs := func(fields map[string]string) json.RawMessage {
			b, _ := json.Marshal(fields)
			return b
		}
		var result *mcp.ToolCallResult
		switch pr.Kind {
		case "entity":
			result = upsertEntityHandler(s)(ctx, innerArgs(map[string]string{"ontology_id": pr.OntologyID, "entity_json": pr.Payload}))
		case "attribute":
			result = upsertAttributeHandler(s)(ctx, innerArgs(map[string]string{"ontology_id": pr.OntologyID, "entity_id": pr.EntityID, "attribute_json": pr.Payload}))
		case "relationship":
			result = upsertRelationshipHandler(s)(ctx, innerArgs(map[string]string{"ontology_id": pr.OntologyID, "relationship_json": pr.Payload}))
		}
		if result != nil && result.IsError {
			return mcp.ErrorResult(fmt.Sprintf("提议无法落地：%s", extractText(result)))
		}
		ps.SetStatus(ctx, p.ID, "approved")
		return rawText("已批准并落地。")
	}
}

func rejectProposalHandler(ps proposals.Store) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct{ ID string `json:"id"` }
		json.Unmarshal(args, &p)
		pr, ok, _ := ps.Get(ctx, p.ID)
		if !ok {
			return mcp.ErrorResult(fmt.Sprintf("没找到提议 %q。", p.ID))
		}
		if pr.Status != "pending" {
			return rawText(fmt.Sprintf("提议已是 %q 状态。", pr.Status))
		}
		ps.SetStatus(ctx, p.ID, "rejected")
		return rawText("已驳回（本体未改动）。")
	}
}

func rawText(s string) *mcp.ToolCallResult {
	return &mcp.ToolCallResult{
		Content: []mcp.ContentBlock{{Type: "text", Text: s}},
	}
}

// --- diff helpers ---

func diffDocs(a, b ontoyaml.Ontology, fromV, toV int) string {
	entA := classJSON(a)
	entB := classJSON(b)
	relA := relJSON(a)
	relB := relJSON(b)
	conA := conceptJSONMap(a)
	conB := conceptJSONMap(b)
	namesA := classNames(a)
	namesB := classNames(b)
	mergeNames(namesA, namesB)

	var lines []string
	diffReport := func(label string, A, B map[string]string, names map[string]string) {
		var added, removed, modified []string
		for id, jb := range B {
			ja, ok := A[id]
			if !ok {
				added = append(added, nameOrID(id, names))
			} else if ja != jb {
				modified = append(modified, nameOrID(id, names))
			}
		}
		for id := range A {
			if _, ok := B[id]; !ok {
				removed = append(removed, nameOrID(id, names))
			}
		}
		sort.Strings(added)
		sort.Strings(removed)
		sort.Strings(modified)
		if len(added)+len(removed)+len(modified) == 0 {
			return
		}
		var parts []string
		if len(added) > 0 {
			parts = append(parts, fmt.Sprintf("+%d（%s）", len(added), strings.Join(added, "、")))
		}
		if len(modified) > 0 {
			parts = append(parts, fmt.Sprintf("~%d（%s）", len(modified), strings.Join(modified, "、")))
		}
		if len(removed) > 0 {
			parts = append(parts, fmt.Sprintf("-%d（%s）", len(removed), strings.Join(removed, "、")))
		}
		lines = append(lines, fmt.Sprintf("%s：%s", label, strings.Join(parts, "；")))
	}
	diffReport("对象", entA, entB, namesA)
	rn := relNames(a, b)
	diffReport("关系", relA, relB, rn)
	cn := conceptNamesMap(a, b)
	diffReport("概念", conA, conB, cn)

	if len(lines) == 0 {
		return fmt.Sprintf("版本 %d → %d：无结构差异。", fromV, toV)
	}
	return fmt.Sprintf("版本 %d → %d：\n- %s", fromV, toV, strings.Join(lines, "\n- "))
}

func classJSON(o ontoyaml.Ontology) map[string]string {
	m := make(map[string]string, len(o.Classes))
	for _, c := range o.Classes {
		b, _ := json.Marshal(c)
		m[c.ID] = string(b)
	}
	return m
}

func classNames(o ontoyaml.Ontology) map[string]string {
	m := make(map[string]string, len(o.Classes))
	for _, c := range o.Classes {
		m[c.ID] = c.Name
	}
	return m
}

func relJSON(o ontoyaml.Ontology) map[string]string {
	m := make(map[string]string, len(o.Relationships))
	for _, r := range o.Relationships {
		b, _ := json.Marshal(r)
		m[r.ID] = string(b)
	}
	return m
}

func relNames(a, b ontoyaml.Ontology) map[string]string {
	m := map[string]string{}
	for _, r := range a.Relationships {
		m[r.ID] = r.Name
	}
	for _, r := range b.Relationships {
		m[r.ID] = r.Name
	}
	return m
}

func conceptJSONMap(o ontoyaml.Ontology) map[string]string {
	m := make(map[string]string, len(o.Concepts))
	for _, c := range o.Concepts {
		b, _ := json.Marshal(c)
		m[c.ID] = string(b)
	}
	return m
}

func conceptNamesMap(a, b ontoyaml.Ontology) map[string]string {
	m := map[string]string{}
	for _, c := range a.Concepts {
		m[c.ID] = c.Name
	}
	for _, c := range b.Concepts {
		m[c.ID] = c.Name
	}
	return m
}

func mergeNames(dst, src map[string]string) {
	for k, v := range src {
		if _, ok := dst[k]; !ok {
			dst[k] = v
		}
	}
}

func nameOrID(id string, names map[string]string) string {
	if n, ok := names[id]; ok && n != "" {
		return n
	}
	return id
}

func extractText(r *mcp.ToolCallResult) string {
	if r == nil || len(r.Content) == 0 {
		return ""
	}
	return r.Content[0].Text
}
