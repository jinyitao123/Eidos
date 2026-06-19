#!/usr/bin/env python3
# Ontopia 视角契约冒烟(R7):存(from/to)→读→upsert→点亮concept→校验拒绝→delete。
# 用法:先起 server(PG_URL=... PORT=9091 go run ./cmd/ontologyserver),再 python3 此脚本。预期 7/7 ✓。

import json, urllib.request
B="http://localhost:9091"
def mcp(tool,args):
    body=json.dumps({"jsonrpc":"2.0","method":"tools/call","params":{"name":tool,"arguments":args},"id":1}).encode()
    r=urllib.request.urlopen(urllib.request.Request(B+"/mcp",body,{"Content-Type":"application/json"}))
    res=json.load(r)["result"]; txt=res["content"][0]["text"]
    try: data=json.loads(txt)
    except: data={"_raw":txt}
    return res.get("isError",False), data
def rget(id):
    try: return 200, json.load(urllib.request.urlopen(B+"/ontologies/"+id))
    except urllib.error.HTTPError as e: return e.code, None
P="__smoke__"; ok=lambda b:"✓" if b else "✗"
# 1 save with from/to
doc={"id":P,"name":"冒烟","classes":[{"id":"hero","name":"主角","kind":"person","first_citizen":True,"attributes":[{"id":"hp","name":"血量","type":"number"}]},{"id":"town","name":"城镇","kind":"thing","attributes":[]}],"relationships":[{"id":"lives","name":"居于","from":"hero","to":"town","cardinality":"1:1"}]}
e,d=mcp("save_ontology_doc",{"ontology_json":json.dumps(doc,ensure_ascii=False)})
print(f"1 save(from/to): {ok(not e and d.get('ok'))} ok={d.get('ok')} entities={d.get('entities')} warnings={len(d.get('warnings',[]))}")
# 2 read back
c,o=rget(P); print(f"2 read REST: {ok(c==200)} rels={[(r.get('from'),r.get('to')) for r in (o or {}).get('relationships',[])]}")
# 3 upsert relationship
e,d=mcp("upsert_relationship",{"ontology_id":P,"relationship_json":json.dumps({"id":"guards","name":"守卫","from":"hero","to":"town","cardinality":"1:N"})})
print(f"3 upsert_relationship: {ok(not e and d.get('ok'))} action={d.get('action')} kind={d.get('kind')}")
# 4 upsert entity + attribute
mcp("upsert_entity",{"ontology_id":P,"entity_json":json.dumps({"id":"quest","name":"任务","kind":"event","attributes":[]})})
e,d=mcp("upsert_attribute",{"ontology_id":P,"entity_id":"quest","attribute_json":json.dumps({"id":"reward","name":"奖励","type":"number"})})
print(f"4 upsert_attribute: {ok(not e and d.get('ok'))} action={d.get('action')}")
# 5 concept light-up
mcp("upsert_concept",{"ontology_id":P,"concept_json":json.dumps({"id":"boss","name":"精英","subject":"hero","predicate":{"field":"hp","op":">","value":100}})})
e,d=mcp("evaluate_concept",{"id":P,"concept_id":"boss"})
print(f"5 concept 点亮: {ok(not e)} -> {d.get('_raw', d)}")
# 6 rejection: dangling relationship → structured {ok:false,errors}
e,d=mcp("save_ontology_doc",{"ontology_json":json.dumps({"id":P,"name":"冒烟","classes":[{"id":"hero","name":"主角","kind":"person","attributes":[]}],"relationships":[{"id":"x","name":"断","from":"hero","to":"ghost","cardinality":"1:1"}]},ensure_ascii=False)})
print(f"6 校验拒绝结构化: {ok(e and d.get('ok')==False and d.get('errors'))} isError={e} errors={d.get('errors')}")
# 7 delete
e,d=mcp("delete_ontology",{"id":P}); c,_=rget(P)
print(f"7 delete_ontology: {ok(not e and d.get('ok') and d.get('existed') and c==404)} existed={d.get('existed')} read_after={c}")
