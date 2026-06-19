package executor

import (
	"strings"
	"testing"
)

func TestNewSelectsByKind(t *testing.T) {
	cases := []struct {
		kind string
		want string
		err  bool
	}{
		{"", "weave", false},
		{"weave", "weave", false},
		{"claude-code", "claude-code", false},
		{"claude", "claude-code", false},
		{"opencode", "opencode", false},
		{"  OpenCode ", "opencode", false},
		{"bogus", "", true},
	}
	for _, c := range cases {
		exe, err := New(Config{
			Kind:     c.kind,
			WeaveURL: "http://localhost:8080",
			MCPURL:   "http://127.0.0.1:9091/mcp",
		})
		if c.err {
			if err == nil {
				t.Errorf("kind %q: expected error, got nil", c.kind)
			}
			continue
		}
		if err != nil {
			t.Errorf("kind %q: unexpected error %v", c.kind, err)
			continue
		}
		if exe.Name() != c.want {
			t.Errorf("kind %q: got executor %q, want %q", c.kind, exe.Name(), c.want)
		}
	}
}

func TestNewMissingDeps(t *testing.T) {
	if _, err := New(Config{Kind: "weave"}); err == nil {
		t.Error("weave without WeaveURL should error")
	}
	if _, err := New(Config{Kind: "claude-code"}); err == nil {
		t.Error("claude-code without MCPURL should error")
	}
	if _, err := New(Config{Kind: "opencode"}); err == nil {
		t.Error("opencode without MCPURL should error")
	}
}

func TestSystemPromptFallback(t *testing.T) {
	// Known agent returns its own prompt.
	if got := systemPrompt("ontology-architect"); !strings.Contains(got, "本体架构师") {
		t.Errorf("ontology-architect prompt missing role marker: %q", got)
	}
	// Unknown agent falls back to _default (non-empty).
	if got := systemPrompt("does-not-exist"); strings.TrimSpace(got) == "" {
		t.Error("unknown agent should fall back to non-empty _default prompt")
	}
}

func TestOntologyIDFromProfile(t *testing.T) {
	cases := map[string]string{
		"project_id=proj_live":        "proj_live",
		"ontology_id=abc":             "abc",
		"id=xyz":                      "xyz",
		"foo=bar;project_id=p2;baz=q": "p2",
		"  project_id=spaced  ":       "spaced",
		"nothing here":                "",
		"":                            "",
	}
	for profile, want := range cases {
		if got := ontologyIDFromProfile(profile); got != want {
			t.Errorf("profile %q: got %q, want %q", profile, got, want)
		}
	}
}

func TestBuildSystemInjectsOntologyID(t *testing.T) {
	sys := buildSystem(ChatRequest{Agent: "ontology-architect", Profile: "project_id=proj_live"})
	if !strings.Contains(sys, "本体架构师") {
		t.Error("buildSystem should include role prompt")
	}
	if !strings.Contains(sys, "proj_live") {
		t.Error("buildSystem should inject ontology id from profile")
	}
}

func TestBuildTaskIncludesHistoryAndMessage(t *testing.T) {
	task := buildTask(ChatRequest{
		Message: "加一个周转率属性",
		History: []Message{
			{Role: "user", Content: "建一个客户对象"},
			{Role: "assistant", Content: "已建 customer"},
		},
	})
	for _, want := range []string{"此前对话", "建一个客户对象", "已建 customer", "本次指令", "加一个周转率属性"} {
		if !strings.Contains(task, want) {
			t.Errorf("buildTask missing %q in:\n%s", want, task)
		}
	}
	// No history → no "此前对话" section, just the message.
	bare := buildTask(ChatRequest{Message: "hi"})
	if strings.Contains(bare, "此前对话") {
		t.Error("buildTask with no history should not include history section")
	}
	if !strings.Contains(bare, "hi") {
		t.Error("buildTask should include the message")
	}
}

func TestStripPrefix(t *testing.T) {
	cases := map[string]string{
		"mcp__eidos__upsert_entity": "upsert_entity",     // claude 双下划线
		"eidos_read_ontology_doc":   "read_ontology_doc", // opencode 单下划线
		"upsert_attribute":          "upsert_attribute",  // 已是裸名
	}
	for in, want := range cases {
		if got := stripPrefix(in); got != want {
			t.Errorf("stripPrefix(%q): got %q, want %q", in, got, want)
		}
	}
}
