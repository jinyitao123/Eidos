package ontoyaml

import (
	"fmt"
	"regexp"
	"strings"
)

var snakeCaseRe = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)

// ValidationError represents a single validation issue.
type ValidationError struct {
	Type    string `json:"type"`    // "format" or "semantic"
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

// ValidationResult holds the complete validation outcome.
type ValidationResult struct {
	Valid    bool              `json:"valid"`
	Errors   []ValidationError `json:"errors"`
	Warnings []ValidationError `json:"warnings"`
}

// Validate runs format and/or semantic checks on an Ontology.
// checkLevel: "format", "semantic", or "full" (both).
func Validate(o *Ontology, checkLevel string) *ValidationResult {
	r := &ValidationResult{Valid: true}

	if checkLevel == "format" || checkLevel == "full" {
		validateFormat(o, r)
	}
	if checkLevel == "semantic" || checkLevel == "full" {
		validateSemantic(o, r)
	}

	r.Valid = len(r.Errors) == 0
	return r
}

func validateFormat(o *Ontology, r *ValidationResult) {
	classIDs := make(map[string]bool)

	// Check ontology ID
	if !snakeCaseRe.MatchString(o.ID) {
		r.addError("format", fmt.Sprintf("ontology id '%s' is not snake_case", o.ID), "ontology.id")
	}

	// Check classes
	firstCitizenCount := 0
	for i, c := range o.Classes {
		path := fmt.Sprintf("classes[%d]", i)

		if !snakeCaseRe.MatchString(c.ID) {
			r.addError("format", fmt.Sprintf("class id '%s' is not snake_case", c.ID), path+".id")
		}
		if classIDs[c.ID] {
			r.addError("format", fmt.Sprintf("duplicate class id '%s'", c.ID), path+".id")
		}
		classIDs[c.ID] = true

		if c.FirstCitizen {
			firstCitizenCount++
		}

		if !isValidPhase(c.Phase) {
			r.addError("format", fmt.Sprintf("class '%s' has invalid phase '%s'", c.ID, c.Phase), path+".phase")
		}

		attrIDs := make(map[string]bool)
		for j, a := range c.Attributes {
			aPath := fmt.Sprintf("%s.attributes[%d]", path, j)

			if !snakeCaseRe.MatchString(a.ID) {
				r.addError("format", fmt.Sprintf("attribute '%s.%s' is not snake_case", c.ID, a.ID), aPath+".id")
			}
			if attrIDs[a.ID] {
				r.addError("format", fmt.Sprintf("duplicate attribute id '%s' in class '%s'", a.ID, c.ID), aPath+".id")
			}
			attrIDs[a.ID] = true

			if !isValidType(a.Type) {
				r.addError("format", fmt.Sprintf("attribute '%s.%s' has invalid type '%s'", c.ID, a.ID, a.Type), aPath+".type")
			}

			if a.Type == "enum" && len(a.EnumValues) == 0 {
				r.addError("format", fmt.Sprintf("enum attribute '%s.%s' must have enum_values", c.ID, a.ID), aPath+".enum_values")
			}

			if a.Derived != "" && a.Required {
				r.addError("format", fmt.Sprintf("derived attribute '%s.%s' cannot be required", c.ID, a.ID), aPath+".required")
			}
		}
	}

	if firstCitizenCount == 0 {
		r.addError("format", "no class has first_citizen=true", "classes")
	} else if firstCitizenCount > 1 {
		r.addError("format", fmt.Sprintf("found %d classes with first_citizen=true, expected exactly 1", firstCitizenCount), "classes")
	}

	// Check relationships
	for i, rel := range o.Relationships {
		path := fmt.Sprintf("relationships[%d]", i)

		if !snakeCaseRe.MatchString(rel.ID) {
			r.addError("format", fmt.Sprintf("relationship id '%s' is not snake_case", rel.ID), path+".id")
		}

		if !classIDs[rel.From] {
			r.addError("format", fmt.Sprintf("relationship '%s' references unknown from class '%s'", rel.ID, rel.From), path+".from")
		}
		if !classIDs[rel.To] {
			r.addError("format", fmt.Sprintf("relationship '%s' references unknown to class '%s'", rel.ID, rel.To), path+".to")
		}

		if !isValidCardinality(rel.Cardinality) {
			r.addError("format", fmt.Sprintf("relationship '%s' has invalid cardinality '%s'", rel.ID, rel.Cardinality), path+".cardinality")
		}
	}

	// Check rules reference valid classes
	for i, rule := range o.Rules {
		path := fmt.Sprintf("rules[%d]", i)
		if rule.Condition.Entity != "" && !classIDs[rule.Condition.Entity] {
			r.addError("format", fmt.Sprintf("rule '%s' references unknown entity '%s'", rule.ID, rule.Condition.Entity), path+".condition.entity")
		}
	}
}

func validateSemantic(o *Ontology, r *ValidationResult) {
	classMap := make(map[string]*Class)
	for i := range o.Classes {
		classMap[o.Classes[i].ID] = &o.Classes[i]
	}

	// Check first citizen has enough attributes
	for _, c := range o.Classes {
		if c.FirstCitizen && len(c.Attributes) < 10 {
			r.addWarning("semantic",
				fmt.Sprintf("first citizen class '%s' has only %d attributes, recommended >= 10", c.ID, len(c.Attributes)),
				fmt.Sprintf("classes.%s", c.ID))
		}
	}

	// Check for isolated classes (no relationships)
	relatedClasses := make(map[string]bool)
	for _, rel := range o.Relationships {
		relatedClasses[rel.From] = true
		relatedClasses[rel.To] = true
	}
	for _, c := range o.Classes {
		if !relatedClasses[c.ID] {
			r.addWarning("semantic",
				fmt.Sprintf("class '%s' has no relationships (isolated)", c.ID),
				fmt.Sprintf("classes.%s", c.ID))
		}
	}

	// Check action trigger references
	actionIDs := make(map[string]bool)
	for _, a := range o.Actions {
		actionIDs[a.ID] = true
	}
	ruleIDs := make(map[string]bool)
	for _, rule := range o.Rules {
		ruleIDs[rule.ID] = true
	}
	for _, a := range o.Actions {
		for _, rID := range a.TriggersBefore {
			if !ruleIDs[rID] {
				r.addWarning("semantic",
					fmt.Sprintf("action '%s' triggers_before references unknown rule '%s'", a.ID, rID),
					fmt.Sprintf("actions.%s.triggers_before", a.ID))
			}
		}
		for _, rID := range a.TriggersAfter {
			if !ruleIDs[rID] {
				r.addWarning("semantic",
					fmt.Sprintf("action '%s' triggers_after references unknown rule '%s'", a.ID, rID),
					fmt.Sprintf("actions.%s.triggers_after", a.ID))
			}
		}
	}

	// Check rule trigger sources reference valid actions
	for _, rule := range o.Rules {
		if rule.Trigger.Type == "before_action" || rule.Trigger.Type == "after_action" {
			for _, src := range rule.Trigger.Source {
				src = strings.TrimSpace(src)
				if src != "" && !actionIDs[src] {
					r.addWarning("semantic",
						fmt.Sprintf("rule '%s' trigger references unknown action '%s'", rule.ID, src),
						fmt.Sprintf("rules.%s.trigger.source", rule.ID))
				}
			}
		}
	}
}

func (r *ValidationResult) addError(typ, msg, path string) {
	r.Errors = append(r.Errors, ValidationError{Type: typ, Message: msg, Path: path})
}

func (r *ValidationResult) addWarning(typ, msg, path string) {
	r.Warnings = append(r.Warnings, ValidationError{Type: typ, Message: msg, Path: path})
}

func isValidPhase(p string) bool {
	return p == "alpha" || p == "beta" || p == "full"
}

func isValidType(t string) bool {
	switch t {
	case "integer", "decimal", "string", "text", "boolean", "date", "datetime", "enum":
		return true
	}
	return false
}

func isValidCardinality(c string) bool {
	switch c {
	case "one_to_one", "one_to_many", "many_to_one", "many_to_many":
		return true
	}
	return false
}
